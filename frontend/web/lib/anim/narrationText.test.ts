import test from "node:test";
import assert from "node:assert/strict";
import { boardSpokenSentences, CHECK_PRAISE, narrationInput, splitNarrationSentences } from "../narrationText";

// Narration made ahead (2026-11-07): the worker stores each clip under its exact sentence, and the player asks for
// exactly that sentence, so both split a board's words here.

test("a script is split as the player says it: source tags and the old closing prompt are never said", () => {
  const script = "A heap keeps its largest value on top [S1]. Each parent is at least its children! Sources: [S1], [S2]. Now try the same reasoning on a new example of your own, and explain what changes.";
  assert.deepEqual(splitNarrationSentences(script), ["A heap keeps its largest value on top.", "Each parent is at least its children!"]);
  assert.equal(narrationInput("  one sentence.  "), "one sentence.");
});

test("a board's spoken sentences are its script, its card's question, each wrong answer's feedback and the praise", () => {
  const beat = {
    script: "We insert 6. The tree is now out of balance.",
    draw: { ops: [{ kind: "canvasBoard", spec: { interaction: { kind: "quiz", question: "Which node is out of balance?", options: [
      { text: "8", correct: true, feedback: "Yes." },
      { text: "3", correct: false, feedback: "Not quite. Look at the heights under 8." },
    ] } } }] },
  };
  const said = boardSpokenSentences(beat);
  for (const s of ["We insert 6.", "The tree is now out of balance.", "Which node is out of balance?", "Not quite.", "Look at the heights under 8."]) assert.ok(said.includes(s), s);
  assert.ok(!said.includes("Yes."), "a right answer is praised, its feedback is not said");
  // "Exactly right. Great job!" is said as two clips, so both are made.
  assert.ok(said.includes("Exactly right.") && said.includes("Great job!"));
  assert.equal(new Set(said).size, said.length, "no sentence is made twice");
});

test("a board with no check card is only its script; praise is the board's own list", () => {
  assert.deepEqual(boardSpokenSentences({ script: "One. Two." }), ["One.", "Two."]);
  assert.deepEqual(boardSpokenSentences({ script: "One.", draw: { ops: [{ kind: "canvasBoard", spec: { interaction: { kind: "try" } } }] } }), ["One."]);
  assert.equal(CHECK_PRAISE.length, 4);
});
