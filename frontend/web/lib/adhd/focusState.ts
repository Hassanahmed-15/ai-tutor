/**
 * The attention state machine behind the ADHD track.
 *
 * WHAT THIS ADDS. `useAttentionMonitor` already answers one question — is the learner drifting right
 * now — and the player already reacts to it. What it cannot answer is the question that matters just
 * as much: is the learner LOCKED IN, and for how long.
 *
 * ADHD is attention *dysregulation*, not a uniform deficit. The same person who drifts at ninety
 * seconds can hold three hours of hyperfocus, and that state is the most valuable one a lesson ever
 * reaches. Today the player will interrupt it: the comprehension check fires on a fixed beat count
 * (`UNDERSTANDING_CHECK_EVERY = 4`) with no idea what it is walking into. Breaking hyperfocus to ask
 * "are you following?" is the most expensive possible moment to ask.
 *
 * So this classifies engagement over time into four states and lets the player behave differently in
 * each. Deliberately a PURE reducer over `(previous state, engagement, elapsed)` with no camera, no
 * React and no timers, so every transition is testable without a webcam — the same reason the board
 * validators are pure.
 */

export type FocusState =
  /** Not enough signal yet, or the camera is off. Behave exactly as the non-ADHD player does. */
  | "unknown"
  /** Engaged and steady. The normal case. */
  | "settled"
  /** Sustained high engagement. Protect it: suppress every scheduled interruption. */
  | "hyperfocus"
  /** Fell out of a long hyperfocus. The genuinely good moment to offer a break. */
  | "crashing"
  /** Sustained low engagement. The existing drift response owns this. */
  | "drifting";

/**
 * Thresholds. `DRIFT_AT` intentionally matches useAttentionMonitor's own DRIFT_THRESHOLD (0.7) so the
 * two never disagree about what "drifting" means — two components with two definitions of the same
 * word is how a system starts contradicting itself on screen.
 */
export const FOCUS_THRESHOLDS = {
  /** At or below this, attention is gone. */
  DRIFT_AT: 0.7,
  /** At or above this, attention is unusually strong. */
  HYPERFOCUS_AT: 0.88,
  /** How long that has to hold before it counts as hyperfocus rather than a good minute. */
  HYPERFOCUS_AFTER_MS: 90_000,
  /** A drop this large from a hyperfocus peak is a crash, not ordinary variation. */
  CRASH_DROP: 0.25,
} as const;

export type FocusTracker = {
  state: FocusState;
  /** How long the current state has held, in ms. */
  heldMs: number;
  /** Highest engagement seen during the current hyperfocus run; 0 when not in one. */
  peak: number;
  /** Total ms spent in hyperfocus this session — what the end-of-session summary reports. */
  hyperfocusMs: number;
};

export function initialFocus(): FocusTracker {
  return { state: "unknown", heldMs: 0, peak: 0, hyperfocusMs: 0 };
}

/**
 * Advance the tracker by one sample.
 *
 * `engagement` is null when the camera is off or the model has not produced a score yet. That case
 * must land on "unknown" rather than any other state: a missing signal is not evidence of calm, and
 * treating it as `settled` would let the player claim knowledge it does not have.
 */
export function advanceFocus(prev: FocusTracker, engagement: number | null, dtMs: number): FocusTracker {
  if (engagement === null || !Number.isFinite(engagement)) {
    return { state: "unknown", heldMs: 0, peak: 0, hyperfocusMs: prev.hyperfocusMs };
  }

  const dt = Math.max(0, dtMs);
  const held = (next: FocusState) => (prev.state === next ? prev.heldMs + dt : 0);

  // A crash only exists relative to a hyperfocus run, so it is checked before the plain bands.
  if (prev.state === "hyperfocus" && engagement <= prev.peak - FOCUS_THRESHOLDS.CRASH_DROP) {
    return {
      state: "crashing",
      heldMs: 0,
      peak: 0,
      hyperfocusMs: prev.hyperfocusMs + prev.heldMs,
    };
  }

  if (engagement <= FOCUS_THRESHOLDS.DRIFT_AT) {
    // Leaving a hyperfocus run banks the time already accrued, so the session total stays honest
    // even when the run ends by drifting rather than by a clean crash.
    const banked = prev.state === "hyperfocus" ? prev.hyperfocusMs + prev.heldMs : prev.hyperfocusMs;
    return { state: "drifting", heldMs: held("drifting"), peak: 0, hyperfocusMs: banked };
  }

  if (engagement >= FOCUS_THRESHOLDS.HYPERFOCUS_AT) {
    const peak = Math.max(prev.peak, engagement);
    // `held()` already adds dt; adding it again made the run accrue at double speed and promote at
    // ~45s against a 90s threshold, which is exactly the kind of off-by-a-factor that a pure
    // reducer exists to make visible.
    const heldHigh = prev.state === "hyperfocus" ? prev.heldMs + dt : held("settled");

    if (prev.state === "hyperfocus") {
      return { state: "hyperfocus", heldMs: heldHigh, peak, hyperfocusMs: prev.hyperfocusMs };
    }
    // Promote once high engagement has been SUSTAINED. Without the dwell a single strong sample
    // would silence the comprehension checks for the rest of the lesson.
    //
    // heldMs CARRIES OVER rather than resetting: those 90 seconds were part of the focused run, and
    // resetting them meant a run that had only just crossed the line banked less time than the
    // threshold it had just passed — so shouldOfferBreak could never fire on a fresh crash.
    if (heldHigh >= FOCUS_THRESHOLDS.HYPERFOCUS_AFTER_MS) {
      return { state: "hyperfocus", heldMs: heldHigh, peak, hyperfocusMs: prev.hyperfocusMs };
    }
    return { state: "settled", heldMs: heldHigh, peak, hyperfocusMs: prev.hyperfocusMs };
  }

  // Between the bands: ordinary engaged attention.
  const banked = prev.state === "hyperfocus" ? prev.hyperfocusMs + prev.heldMs : prev.hyperfocusMs;
  return { state: "settled", heldMs: held("settled"), peak: 0, hyperfocusMs: banked };
}

/**
 * May the player interrupt right now with something it scheduled itself — a comprehension check, a
 * tip, a break prompt?
 *
 * The whole point of the machine. An interruption the LEARNER asked for is always allowed; this
 * governs only the ones the app decided to make.
 */
export function mayInterrupt(t: FocusTracker): boolean {
  return t.state !== "hyperfocus";
}

/** True at the one moment a break is genuinely welcome: straight after a long hyperfocus run. */
export function shouldOfferBreak(t: FocusTracker): boolean {
  return t.state === "crashing" && t.hyperfocusMs >= FOCUS_THRESHOLDS.HYPERFOCUS_AFTER_MS;
}

/** Whole minutes of hyperfocus this session, for the end-of-session summary. */
export function hyperfocusMinutes(t: FocusTracker): number {
  const live = t.state === "hyperfocus" ? t.heldMs : 0;
  return Math.floor((t.hyperfocusMs + live) / 60_000);
}
