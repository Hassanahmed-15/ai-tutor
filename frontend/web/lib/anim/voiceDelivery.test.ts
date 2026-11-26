import { test } from "node:test";
import assert from "node:assert/strict";
import { actBoard, deliveryFor, spokenWords } from "../voiceDelivery";

// luna's real lines from a saved course lecture (Circulatory systems) — the words must never change.
const LINES: Array<[string, string]> = [
  ["Think of a water pump pushing water through connected pipes.", "story"],
  ["This keeps blood moving in one direction, called one-way flow.", "definition"],
  ["Deoxygenated blood travels from the heart to the lungs and returns oxygenated to the heart; this is pulmonary circulation.", "definition"],
  ["In your head, a fish has one or two heart passes?", "question"],
  ["The answer is one.", "reveal"],
  ["A common mistake is omitting the return from the lungs to the heart or saying fish blood passes twice.", "warning"],
  ["That's right — well done!", "praise"],
  ["State, in three marks, how valves help blood flow.", "task"],
  ["High pressure moves blood faster through systemic circulation, body-wide blood flow.", "plain"],
  ["We call this single circulation.", "definition"],
];

test("every line is acted without changing a single word", () => {
  for (const [line] of LINES) assert.equal(spokenWords(deliveryFor(line).input), line);
});

test("each kind of moment gets its acting", () => {
  for (const [line, kind] of LINES) assert.equal(deliveryFor(line).kind, kind, line);
  // Pauses are off by default (round 1: unnatural): the voice gets the sentence exactly.
  assert.equal(deliveryFor("The answer is one.").input, "The answer is one.");
  assert.equal(deliveryFor("We call this single circulation.").input, "We call this single circulation.");
  assert.equal(deliveryFor("In your head, a fish has one or two heart passes?").style, "curious");
});

// acted4 (2026-11-26) adds lively/engaged/calm, upbeat, amazed, emphatic, playful, satisfied. NOT YET checked on the
// cloned voice for added words (the transcription check needs the Gemini key) — listen before relying on them.
test("only styles checked never to add words are used (\"friendly\" added \"Okay, so\")", () => {
  const allowed = new Set(["", "curious", "gentle", "warm", "warm, pleased", "playful", "emphatic", "engaged"]);
  for (const [line] of LINES) assert.ok(allowed.has(deliveryFor(line).style), `${line} → ${deliveryFor(line).style}`);
});

test("styles stay a couple of words (a longer style drifted the cloned voice)", () => {
  for (const [line] of LINES) assert.ok(deliveryFor(line).style.split(/[\s,]+/).filter(Boolean).length <= 2, line);
});

// acted4: a real board (completing the square, sync QA lecture, 2026-11-26).
const BOARD = [
  "With x² alone, we can complete the square by supplying the missing corner of an algebraic square.",
  "The key identity is x² + 2px + p² = (x + p)².",
  "For x² + (b/a)x, the middle coefficient equals 2p, so p = b/(2a).",
  "We add (b/2a)² to both sides, and the left side becomes the perfect square trinomial (x + b/2a)².",
  "This method is not guessing; the added term is fixed by half the x coefficient, then squaring it.",
];
const TERMS = ["perfect square trinomial", "completing the square", "algebraic square"];

test("acted4: every sentence of a board is acted, and its words never change", () => {
  const acted = actBoard(BOARD, TERMS);
  assert.equal(acted.length, BOARD.length);
  acted.forEach((d, i) => {
    assert.ok(d.style, `sentence ${i + 1} has no acting`);
    assert.equal(spokenWords(d.input), BOARD[i]);
  });
});

test("acted4: the board has a shape — a lift at the start, a peak on the key idea, settling at the end", () => {
  const acted = actBoard(BOARD, TERMS);
  assert.match(acted[0].style, /^upbeat/);
  assert.match(acted[1].style, /^emphatic/);
  assert.match(acted.at(-1)!.style, /^warm, satisfied/);
});

test("acted4: the board's bold key term is stressed where she says it", () => {
  const acted = actBoard(BOARD, TERMS);
  assert.match(acted[0].style, /stressing "algebraic square"/);
  assert.match(acted[3].style, /stressing "perfect square trinomial"/);
  assert.doesNotMatch(acted[2].style, /stressing/);
});

test("acted4: at most two peaks a board, so the key idea still stands out", () => {
  const many = Array.from({ length: 8 }, (_, i) => `The key idea number ${i + 1} is that this means something.`);
  const peaks = actBoard(many).filter((d) => /^emphatic/.test(d.style)).length;
  assert.equal(peaks, 2);
});

test("acted4: a style is still a couple of words, besides the term it stresses", () => {
  for (const d of actBoard(BOARD, TERMS)) {
    const words = d.style.replace(/stressing "[^"]+"/, "stressing").split(/[\s,]+/).filter(Boolean);
    assert.ok(words.length <= 3, d.style);
  }
});
