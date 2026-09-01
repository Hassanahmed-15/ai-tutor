import test from "node:test";
import assert from "node:assert/strict";
import { buildFingerSpellingPlan, playbackDelayMs, transcriptWords } from "../../components/sign-language/processing";

test("the signing adapter preserves transcript words instead of rewriting captions", () => {
  assert.deepEqual(transcriptWords("Energy flows through ATP."), ["ENERGY", "FLOWS", "THROUGH", "ATP"]);
});

test("numbers are fingerspelled as readable words", () => {
  assert.deepEqual(transcriptWords("2 cells"), ["TWO", "CELLS"]);
});

test("the upstream fallback produces one alphabet unit per letter", () => {
  const plan = buildFingerSpellingPlan("Hi there");
  assert.equal(plan.map((unit) => unit.letter).join(""), "HITHERE");
  assert.equal(plan[2].word, "THERE");
  assert.equal(plan[2].wordIndex, 1);
});

test("faster signing shortens both letters and word boundaries", () => {
  assert.ok(playbackDelayMs(1.5, false) < playbackDelayMs(0.75, false));
  assert.ok(playbackDelayMs(1, true) > playbackDelayMs(1, false));
});

