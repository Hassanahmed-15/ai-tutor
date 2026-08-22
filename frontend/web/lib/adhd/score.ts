/**
 * XP, combo and coins for the ADHD track.
 *
 * A pure reducer over `(state, event)` — no React, no timers, no clock — for the same reason
 * `focusState.ts` is one: every rule here is a claim about behaviour, and a claim you cannot test
 * without a webcam and a four-minute lecture is a claim nobody will ever check.
 *
 * XP ONLY EVER GOES UP, AND EVERY BEAT IS WORTH THE SAME.
 *
 * The scale is deliberately tiny and flat: a completed beat is +5, a correct checkpoint is +20, and
 * a skipped beat is worth exactly nothing. Not a penalty — nothing. Three rules a learner can hold
 * in their head, which is the whole point; a score you cannot predict cannot motivate you.
 *
 * This reverses an earlier design in which a skip subtracted 25. Recording why, because the reversal
 * is the substance of this file:
 *
 *  - A SKIP now costs nothing. It earns nothing either, which is already the entire incentive — the
 *    learner who skips watches their total sit still while the lecture moves on. Subtracting on top
 *    of that made a visibly dropping number the feedback for disengaging, and for a learner with
 *    rejection sensitive dysphoria that is precisely the feedback that ends sessions.
 *  - A WRONG ANSWER still costs nothing, as it always has. It is information about what to revisit,
 *    not a failure. Charging for it is how a learner concludes the safe move is to stop answering.
 *
 * So nothing in here subtracts any more, and `xp` is monotonic by construction.
 *
 * WHAT REPLACED THE PENALTY. Skipping is still the disengagement signal, and ignoring it entirely
 * would be its own failure. It is now answered by `skipRun` — consecutive beats skipped — which at
 * `SKIP_RUN_FOR_CHECKIN` asks the lecture to stop and the companion to actually talk to the learner
 * (see `needsCheckin`). A conversation is a better response to "this person has checked out" than a
 * smaller number is.
 *
 * THE COMBO MOVED TO COINS. A streak used to multiply beat XP, which is incompatible with "a beat is
 * always +5" — the fifth beat paying 8 and the first paying 5 is exactly the unpredictability the
 * flat scale exists to remove. The multiplier still exists and still rewards an unbroken run; it is
 * paid in coins, which are a separate currency that tracks attention rather than progress.
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
  /**
   * Consecutive beats skipped, reset by any completed beat.
   *
   * Separate from `skipped` because the total says how the session went and this says how it is
   * going. Five skips spread over a long lecture is a learner choosing what to watch; five in a row
   * is a learner who has left, and only the second one is worth interrupting for.
   */
  skipRun: number;
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
  /**
   * The learner has come back from a check-in conversation. Clears `skipRun` so the same
   * conversation cannot immediately re-trigger on the run that caused it.
   */
  | { type: "checkin-cleared" }
  /** Recorded so the receipt can be honest, but worth zero penalty by design. */
  | { type: "answer-wrong" }
  /** Sustained attention pays a coin. Emitted by the focus tracker, not by the lecture. */
  | { type: "focus-minute" }
  /** The learner skipped past a beat. Earns nothing, costs nothing, and breaks the combo. */
  | { type: "beat-skipped" }
  /** A checkpoint answered correctly. */
  | { type: "answer-correct" }
  /** A whole minute held above the drift threshold — rewards NOT drifting, per the brief. */
  | { type: "focus-bonus" }
  /**
   * A checkpoint was dismissed without an answer.
   *
   * Costs NOTHING, exactly like `answer-wrong`. It exists so the teacher's face can react and the
   * receipt can be honest — not to charge for it. The penalty in this track lands on skipping the
   * LESSON, never on struggling with a question.
   */
  | { type: "question-unanswered" };

export const SCORE_RULES = {
  /** Every completed beat, flat. No multiplier — see the combo note in the file header. */
  BEAT_XP: 5,
  BOSS_XP: 15,
  BEAT_COINS: 4,
  FOCUS_MINUTE_COINS: 2,
  /** A correct checkpoint is worth four beats: answering is harder than watching, and rarer. */
  ANSWER_XP: 20,
  /** Paid at session end only if nothing was answered wrong. */
  ALL_CORRECT_BONUS: 25,
  /** Per minute of sustained attention. Not drifting is the thing being rewarded. */
  FOCUS_BONUS_XP: 3,
  /** Each unbroken beat adds this much multiplier, so 3 in a row is 1.6x. Paid in COINS. */
  COMBO_STEP: 0.2,
  COMBO_MAX: 3,
  /**
   * Consecutive skipped beats before the lecture stops and the companion asks what is going on.
   *
   * Three, because two in a row is plausibly "I already know this bit" and three is a pattern. It is
   * a run and not a total: a learner who skips three, watches five, then skips three more gets asked
   * twice, and rightly — both runs are moments they left.
   */
  SKIP_RUN_FOR_CHECKIN: 3,
} as const;

export function initialScore(): ScoreState {
  return { xp: 0, coins: 0, correct: 0, wrong: 0, skipped: 0, skipRun: 0, streak: 0, beats: 0, bosses: 0 };
}

/**
 * Has the learner skipped enough in a row to be worth interrupting for?
 *
 * Deliberately a function of `skipRun` and not of `xp`. "Stop the lecture when XP is zero" was the
 * obvious first rule and is unusable: XP starts at zero, so it fires on beat one of every session,
 * and — now that nothing subtracts — it can never fire again afterwards. A run of skips is the
 * signal that was actually meant.
 */
export function needsCheckin(s: ScoreState): boolean {
  return s.skipRun >= SCORE_RULES.SKIP_RUN_FOR_CHECKIN;
}

/** The live multiplier for the current streak. 1.0 with no streak, capped so it cannot run away. */
export function comboMultiplier(s: ScoreState): number {
  return Math.min(SCORE_RULES.COMBO_MAX, 1 + s.streak * SCORE_RULES.COMBO_STEP);
}

export function applyScore(prev: ScoreState, event: ScoreEvent): ScoreState {
  switch (event.type) {
    case "beat-complete": {
      // FLAT. Every beat is worth the same +5, whatever the streak. The multiplier in force — the one
      // EARNED BEFORE this beat, so the first beat pays 1.0x rather than retroactively crediting a
      // streak it just created — is applied to coins instead.
      return {
        ...prev,
        xp: prev.xp + SCORE_RULES.BEAT_XP,
        coins: prev.coins + Math.round(SCORE_RULES.BEAT_COINS * comboMultiplier(prev)),
        streak: prev.streak + 1,
        skipRun: 0,
        beats: prev.beats + 1,
      };
    }

    case "boss-cleared":
      return {
        ...prev,
        xp: prev.xp + SCORE_RULES.BOSS_XP,
        streak: prev.streak + 1,
        skipRun: 0,
        bosses: prev.bosses + 1,
      };

    case "focus-minute":
      return { ...prev, coins: prev.coins + SCORE_RULES.FOCUS_MINUTE_COINS };

    case "drift":
      // The ONLY thing a drift does. Note what is absent: no XP change, no coin change.
      return { ...prev, streak: 0 };

    case "question-unanswered":
      // Deliberately inert in the score. The signal's whole job is the face.
      return prev;

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
      // Nothing is added and nothing is taken. Not earning the +5 IS the consequence; a number that
      // visibly falls is the feedback that ends sessions, and it was never needed to make watching
      // the better move. What a skip does do is break the combo and extend the run that eventually
      // stops the lecture for a conversation — see `needsCheckin`.
      return {
        ...prev,
        skipped: prev.skipped + 1,
        skipRun: prev.skipRun + 1,
        streak: 0,
      };

    case "checkin-cleared":
      // The run is answered, not forgiven: `skipped` keeps its count for the receipt. Only the
      // consecutive run resets, so the next check-in needs a fresh run of its own.
      return { ...prev, skipRun: 0 };
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
 * over — paying it early would mean withdrawing it the moment someone gets one wrong, and a total
 * that visibly falls is the one thing this scale is built to never do.
 */
export function finalScore(s: ScoreState): number {
  const perfect = s.correct > 0 && s.wrong === 0;
  return s.xp + (perfect ? SCORE_RULES.ALL_CORRECT_BONUS : 0);
}
