/**
 * Daily streak with real stakes, and the freeze that keeps it survivable.
 *
 * REQUESTED, AND RECORDED AS A DECISION. I argued for a streak that cannot be lost; the call was
 * made for one with genuine stakes, and a streak that cannot break is not a streak. So it breaks.
 *
 * FREEZES ARE THE PRESSURE VALVE, and they are not a softening of the request — they are Duolingo's
 * own mechanic, and they exist because of a measurable failure mode: for a learner with rejection
 * sensitive dysphoria, losing a long streak is not a small disappointment, it is the moment they
 * stop opening the app. A freeze converts "I ruined it" into "that cost me one of my three", which
 * is a setback rather than a verdict.
 *
 * A pure function of `(state, today)` — no `Date.now()` inside, so a month of behaviour is testable
 * in milliseconds and there is no clock to mock.
 */

export type StreakState = {
  /** Consecutive qualifying days. */
  days: number;
  /** ISO date (YYYY-MM-DD) of the last day that counted. Null before the first ever session. */
  lastDay: string | null;
  /** Banked freezes, spent automatically before a break is recorded. */
  freezes: number;
  /** Longest run ever reached. Never decreases — the one number a bad week cannot take away. */
  best: number;
};

export const STREAK_RULES = {
  /** Earned every N days, so the protection arrives before the streak is long enough to hurt. */
  FREEZE_EVERY: 5,
  MAX_FREEZES: 3,
} as const;

export function initialStreak(): StreakState {
  return { days: 0, lastDay: null, freezes: 0, best: 0 };
}

/** Whole days between two ISO dates. Date-only, so a late-night session is not a different day. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export type StreakOutcome =
  | "first-day"
  | "same-day"
  | "continued"
  /** A gap was covered by spending banked freezes — the streak survives. */
  | "frozen"
  /** A gap too long, or no freezes left. The streak restarts at 1. */
  | "broken";

/**
 * Record a qualifying session on `today` (an ISO date string).
 *
 * Returns the outcome as well as the state so the UI can say what happened. That matters for the
 * anti-shame rule: "a freeze covered yesterday" and "your streak reset" are the same state
 * transition to the model and completely different sentences to the learner.
 */
export function recordDay(prev: StreakState, today: string): { state: StreakState; outcome: StreakOutcome } {
  if (!prev.lastDay) {
    const days = 1;
    return { state: { ...prev, days, lastDay: today, best: Math.max(prev.best, days) }, outcome: "first-day" };
  }

  const gap = daysBetween(prev.lastDay, today);

  // Same day, or a clock that went backwards. Idempotent either way: a second lecture today must not
  // count twice, and must certainly not break anything.
  if (gap <= 0) return { state: prev, outcome: "same-day" };

  if (gap === 1) {
    const days = prev.days + 1;
    return { state: withEarnedFreeze({ ...prev, days, lastDay: today, best: Math.max(prev.best, days) }), outcome: "continued" };
  }

  // A gap of N days needs N-1 freezes: yesterday is the day being covered, not today.
  const missed = gap - 1;
  if (missed <= prev.freezes) {
    const days = prev.days + 1;
    return {
      state: withEarnedFreeze({ ...prev, days, lastDay: today, freezes: prev.freezes - missed, best: Math.max(prev.best, days) }),
      outcome: "frozen",
    };
  }

  // Broken. `best` is deliberately preserved — the record of what they achieved is not erased by a
  // bad week, and it is the thing worth pointing at when the new streak is short.
  return { state: { days: 1, lastDay: today, freezes: 0, best: prev.best }, outcome: "broken" };
}

/** Grant a freeze every FREEZE_EVERY days, capped. */
function withEarnedFreeze(s: StreakState): StreakState {
  if (s.days % STREAK_RULES.FREEZE_EVERY !== 0) return s;
  return { ...s, freezes: Math.min(STREAK_RULES.MAX_FREEZES, s.freezes + 1) };
}
