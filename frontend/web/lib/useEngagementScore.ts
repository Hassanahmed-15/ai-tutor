"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Engagement rate — one 0..100 number describing how engaged the student is right now.
 *
 * Deliberately MULTI-FACTOR: the camera is only ever ONE input, never the whole score. When the
 * student grants camera access it sharpens the estimate; when they decline (or it fails) the score
 * still works from behavioural signals alone, so the feature degrades instead of disappearing.
 *
 * Inputs (all optional except elapsed time):
 *   - camera attention: on-device engagement 0..1 + sustained-drift flag
 *   - drift events: how many times focus has wandered this lesson
 *   - questions asked: a student who asks things is engaged; total silence for a long stretch is not
 *   - checkpoint attempts: repeated wrong answers pull the score down
 *   - interactions: any click/answer/question refreshes an "active recently" timer
 *
 * Returns a smoothed rate so the badge doesn't twitch, plus a `low` flag the player can act on.
 */

export type EngagementInputs = {
  /** 0..1 from useAttentionMonitor — pass undefined when the camera isn't running. */
  cameraEngagement?: number;
  /** Sustained disengagement from the camera. */
  cameraDrifting?: boolean;
  /** True only when the camera is actually running and healthy. */
  cameraActive: boolean;
  /** Times focus has drifted this lesson (camera or inferred). */
  driftEvents: number;
  /** Questions/interruptions the student has raised this lesson. */
  questionsAsked: number;
  /** Wrong/failed checkpoint attempts so far. */
  checkpointAttempts: number;
  /** Bumped by the player on any meaningful interaction (answer, question, control). */
  lastInteractionAt: number;
  /** Whether the lesson is actually running (paused lessons shouldn't decay the score). */
  active: boolean;
};

export type EngagementState = {
  /** 0..100, smoothed. */
  rate: number;
  /** Below the LOW threshold: check in with a question, but let the lecture keep playing. */
  low: boolean;
  /** Below the CRITICAL threshold: they've properly checked out — pause the lecture. */
  critical: boolean;
  /** Which inputs are contributing — shown in the UI so the number isn't a black box. */
  usingCamera: boolean;
  /** Short human explanation of the biggest drag on the score. */
  reason: string;
};

// The two bands the lesson reacts to:
//   30-50 → the TEACHER stops and asks a question, and waits for the answer (see useTeacherQuiz)
//   below 30 → properly checked out; this is the only band that stops the lecture outright
const LOW_THRESHOLD = 50;
const CRITICAL_THRESHOLD = 30;
const LOW_SUSTAIN_MS = 12_000; // must stay low this long before we act (avoids nagging)
const IDLE_AFTER_MS = 90_000; // no interaction for this long starts costing engagement

export function useEngagementScore(inputs: EngagementInputs): EngagementState {
  const [smoothed, setSmoothed] = useState(75);
  const [low, setLow] = useState(false);
  const [critical, setCritical] = useState(false);
  const lowSinceRef = useRef<number | null>(null);
  const criticalSinceRef = useRef<number | null>(null);
  const [, forceTick] = useState(0);

  // Re-evaluate on a slow timer so idle time actually decays the score even with no React updates.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const { raw, reason, usingCamera } = useMemo(() => {
    const usingCam = inputs.cameraActive && typeof inputs.cameraEngagement === "number";
    let why = "";

    // Behavioural base — always computed, camera or not.
    let behavioural = 0.78;
    const idleMs = Date.now() - inputs.lastInteractionAt;
    if (inputs.active && idleMs > IDLE_AFTER_MS) {
      // Gentle decay: -0.1 per extra 60s idle, floored.
      behavioural -= Math.min(0.35, ((idleMs - IDLE_AFTER_MS) / 60_000) * 0.1);
      why = "you've been quiet for a while";
    }
    if (inputs.checkpointAttempts >= 1) {
      behavioural -= inputs.checkpointAttempts >= 2 ? 0.28 : 0.15;
      why = "those checkpoint answers aren't landing";
    }
    if (inputs.driftEvents >= 1) {
      behavioural -= Math.min(0.25, inputs.driftEvents * 0.1);
      why = why || "your focus has wandered a few times";
    }
    // Asking questions is a positive signal — an engaged student interrupts.
    if (inputs.questionsAsked >= 1) behavioural += Math.min(0.12, inputs.questionsAsked * 0.05);
    behavioural = Math.max(0, Math.min(1, behavioural));

    // Blend in the camera when we have it — 55% camera / 45% behaviour, so behaviour ALWAYS counts.
    let combined = behavioural;
    if (usingCam) {
      const cam = Math.max(0, Math.min(1, inputs.cameraEngagement as number));
      combined = cam * 0.55 + behavioural * 0.45;
      if (inputs.cameraDrifting) {
        combined = Math.min(combined, 0.4);
        why = "you're looking away from the board";
      }
    }
    return { raw: Math.round(combined * 100), reason: why || "you're following along", usingCamera: usingCam };
  }, [
    inputs.cameraActive,
    inputs.cameraEngagement,
    inputs.cameraDrifting,
    inputs.driftEvents,
    inputs.questionsAsked,
    inputs.checkpointAttempts,
    inputs.lastInteractionAt,
    inputs.active,
  ]);

  // Smooth so the badge glides rather than jumping around.
  useEffect(() => {
    setSmoothed((prev) => Math.round(prev + (raw - prev) * 0.3));
  }, [raw]);

  // Latch `low` only after it has been sustained, and clear it as soon as they recover.
  useEffect(() => {
    if (smoothed < LOW_THRESHOLD) {
      lowSinceRef.current ??= Date.now();
      if (Date.now() - (lowSinceRef.current ?? 0) >= LOW_SUSTAIN_MS) setLow(true);
    } else {
      lowSinceRef.current = null;
      setLow(false);
    }
    // Critical is latched separately (and faster) — this is the only band that stops the lecture.
    if (smoothed < CRITICAL_THRESHOLD) {
      criticalSinceRef.current ??= Date.now();
      if (Date.now() - (criticalSinceRef.current ?? 0) >= LOW_SUSTAIN_MS / 2) setCritical(true);
    } else {
      criticalSinceRef.current = null;
      setCritical(false);
    }
  }, [smoothed]);

  return { rate: smoothed, low, critical, usingCamera, reason };
}
