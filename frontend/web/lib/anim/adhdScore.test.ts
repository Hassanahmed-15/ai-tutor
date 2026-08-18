import test from "node:test";
import assert from "node:assert/strict";

import { initialScore, applyScore, applyAll, comboMultiplier, SCORE_RULES } from "../adhd/score";

test("XP and coins can never fall, whatever happens", () => {
  // The invariant that matters most. Loss aversion is a strong motivator and a bad idea for a brain
  // that treats a lost total as a reason to stop opening the app — so it is asserted against EVERY
  // event, not just the ones that look risky.
  const events = [
    { type: "beat-complete" }, { type: "drift" }, { type: "answer-wrong" },
    { type: "beat-complete" }, { type: "drift" }, { type: "drift" },
    { type: "boss-cleared" }, { type: "answer-wrong" }, { type: "focus-minute" },
  ] as const;

  let s = initialScore();
  for (const e of events) {
    const next = applyScore(s, e);
    assert.ok(next.xp >= s.xp, `${e.type} must never reduce XP`);
    assert.ok(next.coins >= s.coins, `${e.type} must never reduce coins`);
    s = next;
  }
});

test("a drift breaks the combo and costs nothing else", () => {
  const before = applyAll(initialScore(), [{ type: "beat-complete" }, { type: "beat-complete" }]);
  assert.equal(before.streak, 2);

  const after = applyScore(before, { type: "drift" });
  assert.equal(after.streak, 0, "the multiplier resets");
  assert.equal(after.xp, before.xp, "and nothing already earned is taken back");
  assert.equal(after.coins, before.coins);
  assert.equal(after.beats, before.beats, "a drift is not an un-completed beat");
});

test("a wrong answer is worth exactly zero penalty", () => {
  const before = applyAll(initialScore(), [{ type: "beat-complete" }]);
  const after = applyScore(before, { type: "answer-wrong" });
  // Getting something wrong is information about what to revisit — the card scheduler uses it.
  // Charging for it is how an ADHD learner learns to avoid answering at all.
  assert.deepEqual(after, before);
});

test("the first beat pays 1.0x, not a retroactive streak bonus", () => {
  const s = applyScore(initialScore(), { type: "beat-complete" });
  assert.equal(s.xp, SCORE_RULES.BEAT_XP, "the multiplier in force is the one earned BEFORE the beat");
  assert.equal(s.streak, 1);
});

test("the combo grows with the streak and is capped", () => {
  assert.equal(comboMultiplier(initialScore()), 1);

  let s = initialScore();
  for (let i = 0; i < 3; i++) s = applyScore(s, { type: "beat-complete" });
  assert.ok(Math.abs(comboMultiplier(s) - 1.6) < 1e-9, "3 in a row is 1.6x");

  // Uncapped, a long session would produce absurd numbers that make earlier beats feel worthless.
  for (let i = 0; i < 100; i++) s = applyScore(s, { type: "beat-complete" });
  assert.equal(comboMultiplier(s), SCORE_RULES.COMBO_MAX);
});

test("a streak genuinely pays more than the same beats interrupted", () => {
  const unbroken = applyAll(initialScore(), [
    { type: "beat-complete" }, { type: "beat-complete" }, { type: "beat-complete" },
  ]);
  const interrupted = applyAll(initialScore(), [
    { type: "beat-complete" }, { type: "drift" },
    { type: "beat-complete" }, { type: "drift" },
    { type: "beat-complete" },
  ]);

  assert.equal(unbroken.beats, interrupted.beats, "same work done");
  assert.ok(unbroken.xp > interrupted.xp, "but sustained focus is worth more");
  // And the interrupted learner still ends up ahead of where they started — never punished.
  assert.ok(interrupted.xp > 0);
});

test("focus minutes pay coins without touching XP or the combo", () => {
  const before = applyAll(initialScore(), [{ type: "beat-complete" }]);
  const after = applyScore(before, { type: "focus-minute" });
  assert.equal(after.coins, before.coins + SCORE_RULES.FOCUS_MINUTE_COINS);
  assert.equal(after.xp, before.xp, "attention is rewarded separately from progress");
  assert.equal(after.streak, before.streak);
});
