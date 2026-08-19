/**
 * XP, combo and coins for the ADHD track.
 *
 * A pure reducer over `(state, event)` — no React, no timers, no clock — for the same reason
 * `focusState.ts` is one: every rule here is a claim about behaviour, and a claim you cannot test
 * without a webcam and a four-minute lecture is a claim nobody will ever check.
 *
 * THE PENALTY LANDS ON DISENGAGING, NEVER ON GETTING IT WRONG.
 *
 * This file previously enforced "XP can never fall", and that was reversed deliberately: a
 * leaderboard needs stakes, and skipping through a lecture had to cost something real. Recording the
 * trade-off, because the invariant existed for a reason — for a learner with rejection sensitive
 * dysphoria a visibly dropping total is exactly the feedback that ends sessions.
 *
 * What survives the reversal is the distinction that actually matters:
 *
 *  - SKIPPING subtracts. It is the disengagement signal — the learner chose to stop watching.
 *  - A WRONG ANSWER still costs nothing. It is information about what to revisit, not a failure.
 *    Charging for wrong answers is how a learner concludes the safe move is to stop answering.
 *
 * Coins still never fall. They track attention, which is not something anyone chooses to spend.
 *
 * The award sizes are deliberately small integers. The point is that something happens THE INSTANT a
 * beat ends — delay is exactly what an ADHD reward system discounts, so a summary screen twenty
 * minutes later does almost no motivational work, however large the number on it.
 */

export type ScoreState = {
  xp: number;
  coins: number;
  /** Correct checkpoint answers this session. */
  correct: number;
  /** Wrong ones — only used to decide whether the all-correct bonus is owed. */
  wrong: number;
  /** Beats skipped. Surfaced in the receipt so the score is explainable. */
  skipped: number;
  /** Consecutive beats completed without a drift. Drives the multiplier. */
  streak: number;
  /** Beats completed this session — what the end-of-session receipt counts. */
  beats: number;
  /** Bosses cleared this session. */
  bosses: number;
};

export type ScoreEvent =
  | { type: "beat-complete" }
  | { type: "boss-cleared" }
  /** A drift breaks the combo. It does NOT cost anything already earned. */
  | { type: "drift" }
  /** Recorded so the receipt can be honest, but worth zero penalty by design. */
  | { type: "answer-wrong" }
  /** Sustained attention pays a coin. Emitted by the focus tracker, not by the lecture. */
  | { type: "focus-minute" }
  /** The learner skipped past a beat. The one event that subtracts. */
  | { type: "beat-skipped" }
  /** A checkpoint answered correctly. */
  | { type: "answer-correct" }
  /** A whole minute held above the drift threshold — rewards NOT drifting, per the brief. */
  | { type: "focus-bonus" };

export const SCORE_RULES = {
  BEAT_XP: 40,
  BOSS_XP: 90,
  BEAT_COINS: 4,
  FOCUS_MINUTE_COINS: 2,
  /** Skipping costs less than watching earns, so the fastest route to a high score is still to learn. */
  SKIP_PENALTY: 25,
  ANSWER_XP: 30,
  /** Paid at session end only if nothing was answered wrong. */
  ALL_CORRECT_BONUS: 100,
  /** Per minute of sustained attention. Not drifting is the thing being rewarded. */
  FOCUS_BONUS_XP: 15,
  /** Each unbroken beat adds this much multiplier, so 3 in a row is 1.6x. */
  COMBO_STEP: 0.2,
  COMBO_MAX: 3,
} as const;

export function initialScore(): ScoreState {
  return { xp: 0, coins: 0, correct: 0, wrong: 0, skipped: 0, streak: 0, beats: 0, bosses: 0 };
}

/** The live multiplier for the current streak. 1.0 with no streak, capped so it cannot run away. */
export function comboMultiplier(s: ScoreState): number {
  return Math.min(SCORE_RULES.COMBO_MAX, 1 + s.streak * SCORE_RULES.COMBO_STEP);
}

export function applyScore(prev: ScoreState, event: ScoreEvent): ScoreState {
  switch (event.type) {
    case "beat-complete": {
      // The multiplier in force is the one EARNED BEFORE this beat, so the first beat of a session
      // pays 1.0x rather than retroactively crediting a streak it just created.
      const gained = Math.round(SCORE_RULES.BEAT_XP * comboMultiplier(prev));
      return {
        ...prev,
        xp: prev.xp + gained,
        coins: prev.coins + SCORE_RULES.BEAT_COINS,
        streak: prev.streak + 1,
        beats: prev.beats + 1,
      };
    }

    case "boss-cleared": {
      const gained = Math.round(SCORE_RULES.BOSS_XP * comboMultiplier(prev));
      return { ...prev, xp: prev.xp + gained, streak: prev.streak + 1, bosses: prev.bosses + 1 };
    }

    case "focus-minute":
      return { ...prev, coins: prev.coins + SCORE_RULES.FOCUS_MINUTE_COINS };

    case "drift":
      // The ONLY thing a drift does. Note what is absent: no XP change, no coin change.
      return { ...prev, streak: 0 };

    case "answer-wrong":
      // Deliberately costs NOTHING. Getting something wrong is information about what to revisit, and
      // the card scheduler is where that information is used. It is only counted so the all-correct
      // bonus knows it is not owed.
      return { ...prev, wrong: prev.wrong + 1 };

    case "answer-correct":
      return { ...prev, xp: prev.xp + SCORE_RULES.ANSWER_XP, correct: prev.correct + 1 };

    case "focus-bonus":
      // Rewards NOT drifting, which is the behaviour the brief asked to reward.
      return { ...prev, xp: prev.xp + SCORE_RULES.FOCUS_BONUS_XP };

    case "beat-skipped":
      // The only subtracting event. Floored at zero: a leaderboard needs stakes, but a negative
      // total is a scoreboard telling a learner they are worth less than nothing, which helps
      // no one and is not what stakes means.
      return {
        ...prev,
        xp: Math.max(0, prev.xp - SCORE_RULES.SKIP_PENALTY),
        skipped: prev.skipped + 1,
        streak: 0,
      };
  }
}

/** Convenience for reducing a whole sequence — used heavily by the tests. */
export function applyAll(prev: ScoreState, events: ScoreEvent[]): ScoreState {
  return events.reduce(applyScore, prev);
}

/**
 * The figure that goes on the leaderboard.
 *
 * Separate from the running `xp` because the all-correct bonus can only be known once the session is
 * over — paying it early would mean withdrawing it the moment someone gets one wrong, which is
 * precisely the visibly-dropping-total problem the skip penalty was carefully limited to avoid.
 */
export function finalScore(s: ScoreState): number {
  const perfect = s.correct > 0 && s.wrong === 0;
  return s.xp + (perfect ? SCORE_RULES.ALL_CORRECT_BONUS : 0);
}
