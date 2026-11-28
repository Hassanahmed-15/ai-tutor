import { test } from "node:test";
import assert from "node:assert/strict";
import { dropEchoedSentences, echoes } from "../canvas/echoes";

// The case from the PDF test of 2026-11-28 (phone photos, strict), board 2's first two sentences.
const A = "For an ohmic conductor at constant temperature, current is directly proportional to voltage.";
const B = "For an ohmic conductor at constant temperature, the current through it is directly proportional to the voltage across it.";
const C = "Ohm's law is V = I × R, with voltage in volts, current in amperes and resistance in ohms.";
const D = "Figure 1 plots current against voltage for resistors of 1 ohm, 2 ohms and 5 ohms.";

test("two neighbours saying the same thing: the fuller is kept, the passages and notes move with them", () => {
  assert.equal(echoes(A, B), true);
  assert.equal(echoes(B, C), false);
  const { beat, dropped } = dropEchoedSentences({
    script: [A, B, C, D].join(" "),
    sentenceBlocks: ["p1-b3", "p1-b3x", "p1-b4", "p1-b5"],
    boardNotes: [{ s: 0, text: "ohmic" }, { s: 2, text: "V = IR" }, { s: 3, text: "Figure 1" }],
    teachingCycle: { teach: 0, predict: 1, reveal: 2, transfer: 3 },
  });
  assert.deepEqual(dropped, [A]);
  assert.equal(beat.script, [B, C, D].join(" "));
  assert.deepEqual(beat.sentenceBlocks, ["p1-b3x", "p1-b4", "p1-b5"]);
  assert.deepEqual(beat.boardNotes!.map((n) => n.s), [0, 1, 2]);
  assert.deepEqual(beat.teachingCycle, { teach: 0, predict: 0, reveal: 1, transfer: 2 });
});

test("sentences that only share a few words are both kept", () => {
  const script = "In a series circuit the same current flows through each component. In a parallel circuit the current splits between the branches.";
  assert.deepEqual(dropEchoedSentences({ script }).dropped, []);
});

test("a short sentence is never judged an echo", () => {
  assert.equal(echoes("Ohm's law.", "Ohm's law is V = I × R."), false);
});
