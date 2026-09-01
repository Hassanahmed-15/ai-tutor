import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentContext, buildLessonContext } from "../lessonChatContext";
import type { Beat } from "../lessonContent";

/**
 * What the side chat is allowed to know.
 *
 * The panel used to send the current beat and nothing else, so it could not say what was coming
 * next, could not refer back to what it had taught, and answered questions about the student's own
 * uploaded PDF from general knowledge. These pin the three things that fixes.
 */

const beat = (i: number, title: string, script: string): Beat =>
  ({
    id: `b${i}`,
    title,
    teacherMove: "",
    stepLabel: "",
    slideKind: "definition",
    points: [],
    script,
  }) as Beat;

const beats = [
  beat(0, "What integration is", "Integration finds the area under a curve."),
  beat(1, "The trapezoid rule", "Straight lines between points approximate the curve."),
  beat(2, "Simpson's 1/3 rule", "Parabolas through three points do better than straight lines."),
  beat(3, "Error analysis", "The error term scales with the fourth derivative."),
  beat(4, "Choosing a method", "Smooth functions favour Simpson; noisy data does not."),
];

test("THE FIX: the chat can see what is still to come", () => {
  const context = buildLessonContext(beats, 1);
  assert.match(context, /Error analysis/, "a later section must be visible");
  assert.match(context, /still to come/, "and be marked as not yet taught");
});

test("and what has already been taught", () => {
  const context = buildLessonContext(beats, 3);
  assert.match(context, /What integration is/);
  assert.match(context, /already taught/);
});

test("the current beat is marked, so the answer knows where the student is", () => {
  const context = buildLessonContext(beats, 2);
  const line = context.split("\n").find((l) => l.includes("PLAYING NOW"));
  assert.ok(line, "one section must be marked as playing");
  assert.match(line, /Simpson/);
});

test("nearby beats carry their script; distant ones are titles only", () => {
  // A lecture long enough to HAVE a distant beat — with only five sections every one is within the
  // window, which is correct behaviour and simply does not exercise the cap.
  const long = Array.from({ length: 14 }, (_, i) =>
    beat(i, `Section ${i}`, `The full teaching script for section ${i}, which is only sent when near.`),
  );
  const context = buildLessonContext(long, 6);

  // Neighbouring content is what "what did you just say?" needs.
  assert.match(context, /full teaching script for section 6/);
  assert.match(context, /full teaching script for section 7/);
  // The far end stays a title, so one question does not paste the whole lecture into the prompt.
  assert.ok(!context.includes("full teaching script for section 13"));
  assert.match(context, /Section 13/, "but it is still listed, so the chat knows it exists");
});

test("an empty lecture produces nothing rather than a header with no body", () => {
  assert.equal(buildLessonContext([], 0), "");
});

test("a PDF reaches the chat with its page labels intact", () => {
  const doc = {
    contentBlocks: [
      { id: "p4-b1", pageNumber: 4, heading: "Simpson's Rule", text: "Requires an even number of intervals." },
      { id: "p7-b2", pageNumber: 7, text: "The composite form sums over sub-intervals." },
    ],
  };
  const context = buildDocumentContext(doc);
  assert.match(context, /\[page 4\]/, "labels let an answer say where it read something");
  assert.match(context, /even number of intervals/);
  assert.match(context, /\[page 7\]/);
});

test("a deck with no parsed document falls back to its slide text", () => {
  const context = buildDocumentContext(null, "Slide 1: Cloud layers\nSlide 2: IaaS, PaaS, SaaS");
  assert.match(context, /IaaS, PaaS, SaaS/);
});

test("no document at all yields an empty string, never the word undefined", () => {
  assert.equal(buildDocumentContext(null), "");
  assert.equal(buildDocumentContext(undefined, ""), "");
  assert.equal(buildDocumentContext({ contentBlocks: [] }), "");
});

test("a huge document is capped rather than sent whole", () => {
  const blocks = Array.from({ length: 400 }, (_, i) => ({
    id: `b${i}`,
    pageNumber: i,
    text: "A sentence of source material that repeats many times over. ".repeat(6),
  }));
  const context = buildDocumentContext({ contentBlocks: blocks });
  assert.ok(context.length <= 30000, `document context was ${context.length} chars`);
  assert.ok(context.length > 0, "capping must not empty it");
});

/* ── what was read off the pixels ────────────────────────────────────────── */

test("the OCR transcript reaches the chat", () => {
  /*
   * The gap this closes. contentBlocks are the text objects a PDF DECLARES, which on a real paper
   * is frequently just the captions — so a chat given blocks alone answers a question about a
   * formula from the sentence describing it. That is the same failure the OCR pass exists to
   * prevent, reappearing one layer up in the side panel.
   */
  const doc = { contentBlocks: [{ id: "b1", pageNumber: 4, text: "Fig. 3: Lower-triangular Pearson correlation matrix." }] };
  const context = buildDocumentContext(doc, "", "Glucose vs Outcome r = 0.49; BMI vs Age r = 0.03");
  assert.match(context, /r = 0\.49/, "the transcript is missing");
  assert.match(context, /correlation matrix/, "the extracted text was dropped");
});

test("the transcript survives when the extracted text would fill the cap", () => {
  /*
   * Ordering is the whole protection here. The cap truncates the tail, and the transcript is the
   * one part that cannot be recovered from anywhere else — so if it were appended, the document
   * most in need of it (a long one) is exactly the document that would lose it.
   */
  const blocks = Array.from({ length: 400 }, (_, i) => ({
    id: `b${i}`,
    pageNumber: i,
    text: "Filler source material that repeats and repeats. ".repeat(8),
  }));
  const context = buildDocumentContext({ contentBlocks: blocks }, "", "UNIQUE-TRANSCRIPT-MARKER d(x,y) = sqrt(sum)");
  assert.match(context, /UNIQUE-TRANSCRIPT-MARKER/, "the transcript was truncated away");
  assert.ok(context.length <= 30000, `context was ${context.length} chars`);
});

test("a deck's slide text still works alongside a transcript", () => {
  const context = buildDocumentContext(null, "Slide 1: Cloud layers", "read from slide 1: IaaS sits below PaaS");
  assert.match(context, /IaaS sits below PaaS/);
  assert.match(context, /Cloud layers/);
});

test("no transcript leaves the previous behaviour untouched", () => {
  // Every existing caller passes two arguments; the third must not change what they get.
  const doc = { contentBlocks: [{ id: "b1", pageNumber: 1, text: "Only the declared text." }] };
  assert.equal(buildDocumentContext(doc, ""), buildDocumentContext(doc, "", ""));
  assert.match(buildDocumentContext(doc, ""), /Only the declared text/);
});

/* ── the whole document, not just the pages they picked ──────────────────── */

test("the full document supersedes the pages that survived parsing", () => {
  /*
   * The defect this closes. parse-pdf renders every page and gets every page's text back for free,
   * then discards everything outside the student's selection — correct for cropping and vision,
   * which the selection exists to bound, and wrong for text that cost nothing. The consequence was
   * that selecting page 4 made page 7 unaskable: the chat had never seen it and answered from
   * general knowledge instead, just as fluently.
   */
  const scoped = { contentBlocks: [{ id: "b1", pageNumber: 4, text: "Only page four survived parsing." }] };
  const context = buildDocumentContext(scoped, "", "", "[page 4] Only page four survived parsing.\n\n[page 7] UNSELECTED-PAGE-MARKER on page seven.");
  assert.match(context, /UNSELECTED-PAGE-MARKER/, "a page outside the selection is still unreachable");
});

test("the transcript stays ahead of the full document", () => {
  // The transcript is what was read off the PIXELS, and is still the only source for anything the
  // extracted text cannot contain — so it must not be the part a cap truncates away.
  const huge = Array.from({ length: 900 }, (_, i) => `[page ${i}] Filler text that repeats. `).join("");
  const context = buildDocumentContext(null, "", "TRANSCRIPT-MARKER d(x,y) = sqrt(sum)", huge);
  assert.match(context, /TRANSCRIPT-MARKER/);
  assert.ok(context.length <= 30000, `context was ${context.length} chars`);
});

test("without a full document the scoped blocks are still used", () => {
  // A deck, or a server with no Python renderer, produces no whole-document text. That must degrade
  // to what the chat had before rather than to nothing.
  const scoped = { contentBlocks: [{ id: "b1", pageNumber: 1, text: "Scoped block text." }] };
  assert.match(buildDocumentContext(scoped, "", "", ""), /Scoped block text/);
});
