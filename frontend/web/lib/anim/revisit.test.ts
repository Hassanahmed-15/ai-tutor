/**
 * Jump back, then return: which earlier slide a question is about (lib/revisit.ts). A wrong "yes"
 * yanks the student away from the slide they asked about; a wrong "no" re-teaches from scratch
 * what slide 1 already drew.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Beat } from "../lessonContent";
import { composeIllustratedBoard } from "./illustratedLayout";
import { boardWordsOf, explicitSlide, findRevisitTarget, questionTerms, revisitMarks } from "../revisit";

const ID = "0123456789abcdef0123456789abcdef";
const picture = (title: string, notes: string[], parts: Array<{ name: string; x: number; y: number }>, labels: string[] = []) =>
  composeIllustratedBoard({
    title,
    sentences: ["one.", "two.", "three.", "four."],
    parts,
    notes: notes.map((text, i) => ({ text, sentence: i })),
    labels,
    paper: "#fffaec",
    illustrationId: ID,
    memory: { v: 1, id: ID, subject: title, paper: "#fffaec", conceptId: title, title, parts, notes, labels, focus: null },
  });
const beat = (id: string, title: string, script: string, code?: string): Beat =>
  ({ id, title, script, points: [], draw: { ops: code ? [{ kind: "reactAnimation", code, at: 0, endAt: 1 }] : [{ kind: "clear" }] } }) as unknown as Beat;

const CHLORO_PARTS = [{ name: "stroma", x: 0.75, y: 0.62 }, { name: "grana", x: 0.4, y: 0.52 }, { name: "inner membrane", x: 0.5, y: 0.27 }];
const LECTURE: Beat[] = [
  beat("b1", "Inside a Chloroplast", "Photosynthesis happens inside the chloroplast. Stacks of thylakoids form grana. The thick fluid around them is the stroma.", picture("Inside a Chloroplast", ["site of photosynthesis", "stroma surrounds grana"], CHLORO_PARTS, ["grana"])),
  beat("b2", "Capturing Light", "Chlorophyll in the thylakoid membranes absorbs red and blue light for photosynthesis.", picture("Capturing Light", ["absorbs red + blue light"], [{ name: "thylakoid", x: 0.4, y: 0.4 }])),
  beat("b3", "How Leaves Breathe", "Carbon dioxide enters photosynthesis through stomata. Guard cells open and close each pore.", picture("How Leaves Breathe", ["CO₂ in through stomata"], [{ name: "guard cells", x: 0.5, y: 0.5 }])),
  beat("b4", "The Calvin Cycle", "The Calvin cycle builds sugar from carbon dioxide in photosynthesis, using ATP and NADPH."),
];

test("a question about what an earlier slide taught goes back to that slide", () => {
  assert.deepEqual(findRevisitTarget("wait, what was the stroma again?", LECTURE, 3)?.index, 0);
  assert.deepEqual(findRevisitTarget("how do guard cells open?", LECTURE, 3)?.index, 2);
});

test("a question about the current slide, or the lecture's general topic, is answered where it is", () => {
  assert.equal(findRevisitTarget("why does the Calvin cycle need ATP?", LECTURE, 3), null, "the current slide taught it");
  assert.equal(findRevisitTarget("what is photosynthesis?", LECTURE, 3), null, "every slide says it: nowhere in particular");
  assert.equal(findRevisitTarget("what is a mitochondrion?", LECTURE, 3), null, "no slide taught it");
  assert.equal(findRevisitTarget("what was the stroma?", LECTURE, 0), null, "nothing before the first slide");
});

test("the student can name the slide", () => {
  assert.equal(explicitSlide("go back to slide 2 please", 5), 1);
  assert.equal(explicitSlide("on the first slide you said", 5), 0);
  assert.equal(explicitSlide("what was on the previous slide", 5), 4);
  assert.equal(explicitSlide("what was on the slide before", 5), 4);
  // "The last slide" is the lecture's final slide, wherever the student is.
  assert.equal(explicitSlide("what's in the last slide?", 2, 7), 6);
  assert.equal(explicitSlide("what does the final slide cover", 2, 7), 6);
  assert.equal(explicitSlide("what's in the last slide?", 2), null, "with no total, 'last' is not placed");
  assert.equal(findRevisitTarget("can we go back to slide 1", LECTURE, 3)?.reason, "named");
  assert.equal(findRevisitTarget("show slide 4 again", LECTURE, 3), null, "slide 4 is the current one");
});

test("question words are the ones that carry meaning", () => {
  assert.deepEqual(questionTerms("Wait, what was the STROMA again?"), ["wait", "stroma"]);
});

test("the old board's words are what it wrote and pictured, and a part is ringed where it is", () => {
  const words = boardWordsOf(LECTURE[0]);
  for (const w of ["Inside a Chloroplast", "stroma surrounds grana", "stroma", "grana", "inner membrane"]) assert.ok(words.includes(w), w);
  const marks = revisitMarks(LECTURE[0], ["stroma", "grana", "stroma surrounds grana", "not on the board"]);
  const stroma = marks.find((m) => "name" in m && m.name === "stroma") as { x: number; y: number } | undefined;
  assert.ok(stroma && stroma.x > 396 && stroma.y > 124, "an unlabelled part is ringed on the picture");
  assert.ok(marks.some((m) => "text" in m && m.text === "grana"), "a labelled part is ringed where its label is written");
  assert.equal(marks.length, 3, "at most three, and only what is on the board");
});

test("a video lesson goes back only to a slide the student names", () => {
  // The same question that is sent back to slide 1 in an ordinary lesson…
  assert.equal(findRevisitTarget("wait, what was the stroma again?", LECTURE, 3)?.index, 0);
  // …is answered by the chat in a video lesson, which holds the whole transcript.
  assert.equal(findRevisitTarget("wait, what was the stroma again?", LECTURE, 3, { namedOnly: true }), null);
  assert.equal(findRevisitTarget("go back to slide 1", LECTURE, 3, { namedOnly: true })?.index, 0);
  // The last slide is ahead of the student: not a revisit, so the chat answers it.
  assert.equal(findRevisitTarget("what's in the last slide?", LECTURE, 1, { total: 6, namedOnly: true }), null);
});
