/**
 * XP, combo and coins for the ADHD track.
 *
 * A pure reducer over `(state, event)` — no React, no timers, no clock — for the same reason
 * `focusState.ts` is one: every rule here is a claim about behaviour, and a claim you cannot test
 * without a webcam and a four-minute lecture is a claim nobody will ever check.
 *
 * TWO INVARIANTS, BOTH FROM REJECTION SENSITIVE DYSPHORIA.
 *
 * 1. XP AND COINS NEVER FALL. The combo multiplier resets, because a multiplier that cannot break is
 *    not a multiplier — but nothing already banked is ever taken back. Loss aversion is a powerful
 *    motivator and a bad idea for a brain that treats a lost total as a reason to stop opening the
 *    app at all. `applyScore` enforces this structurally rather than by convention: there is no
 *    event that can subtract.
 *
 * 2. A WRONG ANSWER COSTS NOTHING. It is a fact about what to revisit, not a punishment. The only
 *    thing it changes is which concept comes back sooner.
 *
 * The award sizes are deliberately small integers. The point is that something happens THE INSTANT a
 * beat ends — delay is exactly what an ADHD reward system discounts, so a summary screen twenty
 * minutes later does almost no motivational work, however large the number on it.
 */

export type ScoreState = {
  xp: number;
  coins: number;
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
  | { type: "focus-minute" };

export const SCORE_RULES = {
  BEAT_XP: 40,
  BOSS_XP: 90,
  BEAT_COINS: 4,
  FOCUS_MINUTE_COINS: 2,
  /** Each unbroken beat adds this much multiplier, so 3 in a row is 1.6x. */
  COMBO_STEP: 0.2,
  COMBO_MAX: 3,
} as const;

export function initialScore(): ScoreState {
  return { xp: 0, coins: 0, streak: 0, beats: 0, bosses: 0 };
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
      // Deliberately a no-op on score. Getting something wrong is information about what to revisit,
      // and the card scheduler is where that information is actually used.
      return prev;
  }
}

/** Convenience for reducing a whole sequence — used heavily by the tests. */
export function applyAll(prev: ScoreState, events: ScoreEvent[]): ScoreState {
  return events.reduce(applyScore, prev);
}
