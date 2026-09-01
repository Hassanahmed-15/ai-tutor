/**
 * The prompt that carries a whole document — its pages as pictures, and the part the student
 * pointed at.
 *
 * All pure string and array work, so none of it needs a key or a client. What is worth asserting
 * here is not the wording but the STRUCTURE the wording depends on: that a selection is announced
 * before the pages it sits among, that each crop follows its own page, and that a selection whose
 * page failed to render is still sent. Each of those is a bug that would otherwise be invisible —
 * the call succeeds, the lecture is merely about the wrong thing.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImageParts,
  describeRegion,
  documentImagesSection,
  questionSection,
  regionEmphasisSection,
  FULL_CONTEXT_RULES,
  lectureShape,
  shapeInstructions,
  LECTURE_SHAPES,
  type ContextPageImage,
  type ContextRegionImage,
} from "../fullDocumentContext";

const png = (tag: string) => `data:image/jpeg;base64,${tag}`;

const page = (pageNumber: number): ContextPageImage => ({ pageNumber, dataUrl: png(`p${pageNumber}`) });

const region = (
  pageNumber: number,
  rect: { x: number; y: number; width: number; height: number },
): ContextRegionImage => ({ pageNumber, dataUrl: png(`r${pageNumber}`), rect });

/* ── which shape the request asked for ───────────────────────────────────── */

test("selecting pages and asking nothing is a request to be TAUGHT", () => {
  const shape = lectureShape({ hasRegions: false, question: "" });
  assert.equal(shape.mode, "full-lecture");
  assert.ok(shape.minBeats >= 10, "a full lecture is a lecture, not a paragraph");
});

test("typing a question asks for an ANSWER, even with nothing drawn", () => {
  /*
   * The bug this pins. The shape used to be decided by whether a box had been dragged, so a typed
   * question with no drag fell through to the full-lecture branch — and the student who asked how
   * many professors were in a list got a twelve-beat tour of their own document.
   */
  const shape = lectureShape({ hasRegions: false, question: "how many professors are in the list" });
  assert.equal(shape.mode, "concise-answer");
  assert.ok(shape.maxBeats <= 2);
});

test("dragging a box asks for an answer too, with or without words", () => {
  assert.equal(lectureShape({ hasRegions: true, question: "" }).mode, "concise-answer");
  assert.equal(lectureShape({ hasRegions: true, question: "explain this" }).mode, "concise-answer");
});

test("whitespace is not a question", () => {
  // Otherwise an empty input box silently turns every upload into a two-beat answer.
  assert.equal(lectureShape({ hasRegions: false, question: "   " }).mode, "full-lecture");
});

test("the concise floor sits well below what the prompt asks for", () => {
  /*
   * The floor exists to catch an empty script, not to police brevity. Setting it near the target is
   * exactly how the previous 125-word floor turned a good short answer into a rejection followed by
   * five paid attempts to pad it back out.
   */
  const { wordFloor, wordTarget } = LECTURE_SHAPES.conciseAnswer;
  assert.ok(wordFloor < wordTarget[0], "a floor at or above the target rejects what we asked for");
});

/* ── the instructions those shapes produce ───────────────────────────────── */

test("a concise answer is told to lead with the answer and stop", () => {
  const lines = shapeInstructions(LECTURE_SHAPES.conciseAnswer).join("\n");
  assert.match(lines, /LEAD WITH THE ANSWER/);
  assert.match(lines, /FIRST SENTENCE/);
  assert.match(lines, /1 or 2 teaching beats/);
  assert.match(lines, /do not survey/i);
});

test("a concise answer explicitly overrides the system prompt's 10-12 beats", () => {
  // That line is the strongest competing instruction in the request; declining to repeat it is not
  // enough to displace it.
  assert.match(shapeInstructions(LECTURE_SHAPES.conciseAnswer).join("\n"), /IGNORE the instruction[\s\S]*10-12 beats/);
});

test("a full lecture is still asked for at full length", () => {
  const lines = shapeInstructions(LECTURE_SHAPES.fullLecture).join("\n");
  assert.match(lines, /10 to 16 teaching beats/);
  assert.match(lines, /AT LEAST 130 spoken words/);
  assert.doesNotMatch(lines, /LEAD WITH THE ANSWER/);
});

test("a deck is described in deck words, not document words", () => {
  const lines = shapeInstructions(LECTURE_SHAPES.conciseAnswer, "slide").join("\n");
  assert.match(lines, /deck/);
  assert.doesNotMatch(lines, /survey the document/);
});

/* ── where on the page ───────────────────────────────────────────────────── */

test("describeRegion names the quadrant a box actually sits in", () => {
  assert.match(describeRegion({ x: 0.02, y: 0.02, width: 0.2, height: 0.2 }), /upper left/);
  assert.match(describeRegion({ x: 0.75, y: 0.8, width: 0.2, height: 0.15 }), /lower right/);
  // Dead centre reads as "centre", not "middle centre", which is how a person would say it.
  const middle = describeRegion({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 });
  assert.match(middle, /the centre of the page/);
  assert.doesNotMatch(middle, /middle centre/);
});

test("describeRegion reports the area, and never rounds a real box to 0%", () => {
  assert.match(describeRegion({ x: 0, y: 0, width: 0.5, height: 0.5 }), /about 25% of it/);
  // A small but deliberate selection must not be described as "0% of it".
  assert.match(describeRegion({ x: 0.1, y: 0.1, width: 0.03, height: 0.03 }), /about 1% of it/);
});

/* ── the selection is the subject ────────────────────────────────────────── */

test("no selection produces no section at all", () => {
  // An empty heading shouted at the model would claim a selection that does not exist.
  assert.equal(regionEmphasisSection([]), "");
});

test("the selection section names the page and says it overrides surveying", () => {
  const text = regionEmphasisSection([region(4, { x: 0.1, y: 0.6, width: 0.4, height: 0.3 })]);
  assert.match(text, /SELECTED A SPECIFIC PART/);
  assert.match(text, /page 4/);
  assert.match(text, /lower left/);
  // The instruction that stops a 20-page upload becoming a 20-page survey.
  assert.match(text, /Everything else in this document is background/);
  // And the one that stops "explain this" being used as the lecture's title.
  assert.match(text, /they have named nothing/i);
});

test("a deck's selection is described in slides, never pages", () => {
  const text = regionEmphasisSection([region(2, { x: 0.1, y: 0.1, width: 0.3, height: 0.3 })], "slide");
  assert.match(text, /slide 2/);
  assert.doesNotMatch(text, /page 2/);
});

test("multiple selections are numbered so each can be referred to", () => {
  const text = regionEmphasisSection([
    region(1, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }),
    region(3, { x: 0.5, y: 0.5, width: 0.2, height: 0.2 }),
  ]);
  assert.match(text, /Selection 1/);
  assert.match(text, /Selection 2/);
});

/* ── announcing the attached pages ───────────────────────────────────────── */

test("the images section lists the pages actually attached", () => {
  const text = documentImagesSection([page(3), page(7)]);
  assert.match(text, /page 3, 7/);
  // The rule the whole feature turns on: pixels outrank the extracted text.
  assert.match(text, /believe the image/);
  assert.match(text, /do not invent content for a page that is not attached/i);
});

test("no pages produces no section", () => {
  assert.equal(documentImagesSection([]), "");
});

/* ── ordering: context, then detail ──────────────────────────────────────── */

test("pages ascend and each selection follows its own page", () => {
  const parts = buildImageParts(
    [page(5), page(2)],
    [region(5, { x: 0.1, y: 0.1, width: 0.3, height: 0.3 })],
  );
  const images = parts.filter((part) => part.type === "image_url");
  assert.deepEqual(
    images.map((part) => (part as { image_url: { url: string } }).image_url.url),
    [png("p2"), png("p5"), png("r5")],
    "page 2 first, then page 5, then the crop taken from page 5",
  );
});

test("every image is sent at high detail", () => {
  // At low detail the model gets an 85-token thumbnail that cannot resolve body text — which is
  // the entire reason the page is attached.
  const parts = buildImageParts([page(1)], []);
  for (const part of parts.filter((p) => p.type === "image_url")) {
    assert.equal((part as { image_url: { detail: string } }).image_url.detail, "high");
  }
  assert.equal(FULL_CONTEXT_RULES.DETAIL, "high");
});

test("a selection whose page did not render is still sent", () => {
  // Losing the most specific thing the student gave us in order to keep a tidy ordering rule would
  // be the worst possible trade.
  const parts = buildImageParts([page(1)], [region(9, { x: 0.2, y: 0.2, width: 0.3, height: 0.3 })]);
  const urls = parts
    .filter((part) => part.type === "image_url")
    .map((part) => (part as { image_url: { url: string } }).image_url.url);
  assert.ok(urls.includes(png("r9")), "the orphaned crop must survive");
});

test("no more pages are attached than one call can carry", () => {
  const many = Array.from({ length: 40 }, (_, index) => page(index + 1));
  const images = buildImageParts(many, []).filter((part) => part.type === "image_url");
  assert.equal(images.length, FULL_CONTEXT_RULES.MAX_PAGE_IMAGES);
});

test("each page image is introduced by a label naming its number", () => {
  const parts = buildImageParts([page(6)], []);
  assert.equal(parts[0].type, "text");
  assert.match((parts[0] as { text: string }).text, /page 6/);
});

/* ── the question ────────────────────────────────────────────────────────── */

test("a typed question is quoted and told to stop when answered", () => {
  const text = questionSection("what does the correlation matrix show?", false);
  assert.match(text, /"what does the correlation matrix show\?"/);
  assert.match(text, /stop when it is answered/);
});

test("pointing without words still states there is a subject", () => {
  // Pressing enter having drawn a box is a real request, not an empty one.
  const text = questionSection("", true);
  assert.match(text, /they pointed at the selection/);
});

test("no question and no selection produces nothing to answer", () => {
  assert.equal(questionSection("", false), "");
});
