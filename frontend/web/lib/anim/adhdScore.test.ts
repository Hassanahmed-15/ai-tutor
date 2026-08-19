import test from "node:test";
import assert from "node:assert/strict";

import { initialScore, applyScore, applyAll, comboMultiplier, finalScore, SCORE_RULES } from "../adhd/score";

test("SKIPPING is the only event that can reduce XP", () => {
  // This file used to assert "XP can never fall". That invariant was reversed on purpose so the
  // leaderboard has stakes — so the test is rewritten to pin the NEW rule rather than deleted,
  // because the distinction it protects is the one that matters: the penalty must land on
  // disengaging, never on getting something wrong.
  const events = [
    { type: "beat-complete" }, { type: "drift" }, { type: "answer-wrong" },
    { type: "beat-complete" }, { type: "drift" }, { type: "boss-cleared" },
    { type: "answer-correct" }, { type: "focus-minute" }, { type: "focus-bonus" },
  ] as const;

  let s = initialScore();
  for (const e of events) {
    const next = applyScore(s, e);
    assert.ok(next.xp >= s.xp, `${e.type} must not reduce XP — only a skip may`);
    assert.ok(next.coins >= s.coins, `${e.type} must never reduce coins`);
    s = next;
  }

  const skipped = applyScore(s, { type: "beat-skipped" });
  assert.ok(skipped.xp < s.xp, "and a skip genuinely costs");
  assert.equal(skipped.coins, s.coins, "coins track attention, which is not something you spend");
});

test("a wrong answer is still free, and only withholds the perfect bonus", () => {
  // The line that must not move. Charging for wrong answers is how a learner works out that the
  // safe play is to stop answering at all.
  const before = applyAll(initialScore(), [{ type: "beat-complete" }, { type: "answer-correct" }]);
  const after = applyScore(before, { type: "answer-wrong" });
  assert.equal(after.xp, before.xp, "no XP is taken for being wrong");
  assert.equal(after.wrong, 1, "but it is remembered");
  assert.ok(finalScore(after) < finalScore(before), "the all-correct bonus is simply not owed");
});

test("XP is floored at zero — a learner is never worth less than nothing", () => {
  let s = initialScore();
  for (let i = 0; i < 10; i++) s = applyScore(s, { type: "beat-skipped" });
  assert.equal(s.xp, 0);
  assert.equal(s.skipped, 10, "still counted, so the receipt can explain the score");
});

test("watching beats out-scores skipping them, which is the whole point", () => {
  const watched = applyAll(initialScore(), [
    { type: "beat-complete" }, { type: "beat-complete" }, { type: "beat-complete" },
  ]);
  const skipped = applyAll(initialScore(), [
    { type: "beat-skipped" }, { type: "beat-skipped" }, { type: "beat-skipped" },
  ]);
  assert.ok(watched.xp > skipped.xp, "the fastest route to a high score must be to learn");
});

test("the perfect bonus needs answers, not merely an absence of wrong ones", () => {
  // A learner who answered nothing has `wrong === 0` too. Paying them a perfection bonus would
  // reward avoiding every checkpoint, which is the exact opposite of the intent.
  const silent = applyAll(initialScore(), [{ type: "beat-complete" }]);
  assert.equal(finalScore(silent), silent.xp, "no answers means no bonus");

  const perfect = applyAll(initialScore(), [{ type: "beat-complete" }, { type: "answer-correct" }]);
  assert.ok(finalScore(perfect) > perfect.xp, "answering everything correctly does pay");
});

test("not drifting is rewarded", () => {
  // The brief asked for this directly: less drift should mean more points.
  const focused = applyAll(initialScore(), [
    { type: "beat-complete" }, { type: "focus-bonus" }, { type: "focus-bonus" },
  ]);
  const distracted = applyAll(initialScore(), [
    { type: "beat-complete" }, { type: "drift" }, { type: "drift" },
  ]);
  assert.ok(focused.xp > distracted.xp);
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
