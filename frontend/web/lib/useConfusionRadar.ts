"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Confusion Radar — the README's signature adaptivity mechanism, made real.
 *
 * The player already collected these signals and then ignored them. This fuses them into one
 * per-beat confusion score so the lesson can actually respond (ease the pace + offer to re-explain
 * a different way). Signals, cheapest first:
 *
 *   - checkpoint attempts (a wrong answer is the strongest explicit signal)
 *   - dwell: unusually long on one beat relative to its narration length
 *   - repeats: replaying/rewinding the same beat
 *   - questions: interruptions/questions asked while on this beat
 *   - attention (OPTIONAL, camera): on-device engagement/drift — off by default, consent-gated,
 *     matching the README's privacy stance. Never required; it only sharpens the score.
 *
 * Score is 0..1; `confused` latches once it crosses the threshold so the UI can offer help without
 * flickering, and everything resets when the beat changes.
 */

export type ConfusionSignals = {
  /** Wrong/failed checkpoint attempts on the current beat. */
  checkpointAttempts: number;
  /** Times the student replayed/rewound this beat. */
  repeats: number;
  /** Questions/interruptions raised while on this beat. */
  questions: number;
  /** Optional camera signal: sustained disengagement (from useAttentionMonitor). */
  drifting?: boolean;
  /** Optional camera signal: 0..1 engagement (from useAttentionMonitor). */
  engagement?: number;
};

export type ConfusionState = {
  /** 0 (following fine) .. 1 (clearly lost). */
  score: number;
  /** True once the score crossed the threshold on this beat (latched until the beat changes). */
  confused: boolean;
  /** Short human reason for the strongest contributing signal — shown to the student. */
  reason: string;
};

const THRESHOLD = 0.6;

export function useConfusionRadar(beatKey: string, signals: ConfusionSignals): ConfusionState & { dismiss: () => void } {
  const [latched, setLatched] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const beatStartedAt = useRef<number>(Date.now());

  // Reset everything when the beat changes — confusion is per-beat, not cumulative.
  useEffect(() => {
    setLatched(false);
    setDismissed(false);
    beatStartedAt.current = Date.now();
  }, [beatKey]);

  const { score, reason } = useMemo(() => {
    let s = 0;
    let why = "";
    // A missed checkpoint is the clearest "I don't get it" we ever get.
    if (signals.checkpointAttempts >= 1) {
      s += signals.checkpointAttempts >= 2 ? 0.65 : 0.4;
      why = "that checkpoint tripped you up";
    }
    if (signals.repeats >= 1) {
      s += Math.min(0.3, signals.repeats * 0.2);
      why = why || "you replayed this part";
    }
    if (signals.questions >= 2) {
      s += 0.25;
      why = why || "you asked about this a couple of times";
    }
    // Camera is a bonus signal only — never required, never dominant on its own.
    if (signals.drifting) {
      s += 0.25;
      why = why || "you seemed to drift off here";
    } else if (typeof signals.engagement === "number" && signals.engagement < 0.5) {
      s += 0.15;
      why = why || "this part looked heavy going";
    }
    return { score: Math.max(0, Math.min(1, s)), reason: why || "this part looks tricky" };
  }, [signals.checkpointAttempts, signals.repeats, signals.questions, signals.drifting, signals.engagement]);

  useEffect(() => {
    if (score >= THRESHOLD) setLatched(true);
  }, [score]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { score, confused: latched && !dismissed, reason, dismiss };
}
