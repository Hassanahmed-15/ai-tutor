import test from "node:test";
import assert from "node:assert/strict";

import { initialScore, applyScore, applyAll, comboMultiplier, finalScore, needsCheckin, SCORE_RULES } from "../adhd/score";

test("NOTHING reduces XP — not a skip, not a wrong answer, not a drift", () => {
  // This assertion has been round-tripped once already: it began as "XP can never fall", was
  // reversed so a skip subtracted 25, and is now back. Recording that, because the reversal is the
  // point rather than an accident — a skip earning nothing is the whole incentive, and a visibly
  // dropping total was the feedback that ended sessions on top of it.
  const events = [
    { type: "beat-complete" }, { type: "drift" }, { type: "answer-wrong" },
    { type: "beat-complete" }, { type: "drift" }, { type: "boss-cleared" },
    { type: "answer-correct" }, { type: "focus-minute" }, { type: "focus-bonus" },
    { type: "beat-skipped" }, { type: "beat-skipped" }, { type: "question-unanswered" },
    { type: "checkin-cleared" },
  ] as const;

  let s = initialScore();
  for (const e of events) {
    const next = applyScore(s, e);
    assert.ok(next.xp >= s.xp, `${e.type} must never reduce XP`);
    assert.ok(next.coins >= s.coins, `${e.type} must never reduce coins`);
    s = next;
  }
});

test("a skip is worth exactly nothing — it neither adds nor subtracts", () => {
  const before = applyAll(initialScore(), [{ type: "beat-complete" }, { type: "beat-complete" }]);
  const after = applyScore(before, { type: "beat-skipped" });

  assert.equal(after.xp, before.xp, "not earning the +5 IS the consequence; nothing is taken on top");
  assert.equal(after.coins, before.coins, "coins track attention, which is not something you spend");
  assert.equal(after.beats, before.beats, "a skipped beat is not a completed one");
  assert.equal(after.skipped, before.skipped + 1, "but it is counted, so the receipt can explain itself");
  assert.equal(after.streak, 0, "and it breaks the combo");
});

test("a completed beat is ALWAYS worth the same 5, whatever the streak", () => {
  // The rule the flat scale exists for: a learner can predict what the next beat pays. When this was
  // multiplied by the combo, the fifth beat paid 8 and the first paid 5 for identical work.
  let s = initialScore();
  for (let i = 0; i < 12; i++) {
    const next = applyScore(s, { type: "beat-complete" });
    assert.equal(next.xp - s.xp, SCORE_RULES.BEAT_XP, `beat ${i + 1} must pay exactly BEAT_XP`);
    s = next;
  }
  assert.equal(s.xp, 12 * SCORE_RULES.BEAT_XP);
});

test("a correct checkpoint is worth 20, four times a beat", () => {
  const before = applyAll(initialScore(), [{ type: "beat-complete" }]);
  const after = applyScore(before, { type: "answer-correct" });
  assert.equal(after.xp - before.xp, SCORE_RULES.ANSWER_XP);
  assert.equal(SCORE_RULES.ANSWER_XP, 4 * SCORE_RULES.BEAT_XP, "answering is harder than watching");
  assert.equal(after.correct, 1);
});

test("a run of skipped beats asks for a check-in; an interrupted run does not", () => {
  // The trigger is a RUN, not a total, and not `xp === 0`. XP starts at zero and now never falls, so
  // a zero-XP test would fire on beat one of every session and never again after that.
  assert.equal(needsCheckin(initialScore()), false, "a fresh session is not a disengaged one");

  let run = initialScore();
  for (let i = 0; i < SCORE_RULES.SKIP_RUN_FOR_CHECKIN; i++) {
    run = applyScore(run, { type: "beat-skipped" });
  }
  assert.ok(needsCheckin(run), "consecutive skips are someone who has left");

  // The same number of skips, broken up by actually watching something, is someone choosing.
  let picky = initialScore();
  for (let i = 0; i < SCORE_RULES.SKIP_RUN_FOR_CHECKIN; i++) {
    picky = applyAll(picky, [{ type: "beat-skipped" }, { type: "beat-complete" }]);
  }
  assert.equal(picky.skipped, SCORE_RULES.SKIP_RUN_FOR_CHECKIN, "same skips");
  assert.equal(needsCheckin(picky), false, "but never three in a row");
});

test("coming back from a check-in clears the run without erasing the history", () => {
  let s = initialScore();
  for (let i = 0; i < SCORE_RULES.SKIP_RUN_FOR_CHECKIN; i++) s = applyScore(s, { type: "beat-skipped" });

  const back = applyScore(s, { type: "checkin-cleared" });
  assert.equal(needsCheckin(back), false, "the same run must not re-trigger the conversation it caused");
  assert.equal(back.skipped, s.skipped, "the receipt still knows what happened");
  assert.equal(back.xp, s.xp, "and coming back costs nothing either");
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

test("a session of nothing but skips ends on zero, never below it", () => {
  let s = initialScore();
  for (let i = 0; i < 10; i++) s = applyScore(s, { type: "beat-skipped" });
  assert.equal(s.xp, 0, "no floor arithmetic needed any more — nothing subtracts in the first place");
  assert.equal(s.skipped, 10, "still counted, so the receipt can explain the score");
  assert.equal(s.skipRun, 10, "and the run is what the companion reacts to");
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

test("a streak genuinely pays more than the same beats interrupted — in COINS", () => {
  // The combo moved off XP when beats went flat. It still has to mean something, or the multiplier
  // on the score chip is decoration; coins are where it landed, because they track attention rather
  // than progress and a learner who never drifts should have more of them.
  const unbroken = applyAll(initialScore(), [
    { type: "beat-complete" }, { type: "beat-complete" }, { type: "beat-complete" },
  ]);
  const interrupted = applyAll(initialScore(), [
    { type: "beat-complete" }, { type: "drift" },
    { type: "beat-complete" }, { type: "drift" },
    { type: "beat-complete" },
  ]);

  assert.equal(unbroken.beats, interrupted.beats, "same work done");
  assert.equal(unbroken.xp, interrupted.xp, "and identical XP — a beat is a beat");
  assert.ok(unbroken.coins > interrupted.coins, "but sustained focus is worth more");
  assert.ok(interrupted.coins > 0, "and the interrupted learner is never punished, only paid less");
});

test("focus minutes pay a flat coin rate without touching XP or the combo", () => {
  const before = applyAll(initialScore(), [{ type: "beat-complete" }]);
  const after = applyScore(before, { type: "focus-minute" });
  // Flat, unlike beat coins: this already rewards sustained attention directly, and multiplying it
  // by the streak would pay twice for the same thing.
  assert.equal(after.coins, before.coins + SCORE_RULES.FOCUS_MINUTE_COINS);
  assert.equal(after.xp, before.xp, "attention is rewarded separately from progress");
  assert.equal(after.streak, before.streak);
});
