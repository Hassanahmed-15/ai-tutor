"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The lecture's playback speed, remembered between lectures.
 *
 * A fixed set, not a slider: a slider invites 1.37x, and a speed nobody chose on purpose is a speed
 * nobody notices they are stuck on. 0.75x and 2x came back at the manager's request (2026-10-23: "more
 * speed options should be given such as 0.75x or 2x"), with 1.25x between; the board's pen keeps pace
 * with the voice at every speed (components/canvas/MarkerWriter.tsx). A stored speed no longer offered
 * reads back as normal speed (parseRate). Kept per browser in localStorage, like the dyslexia and autism
 * preferences — it is a listening preference, not something the account needs to carry.
 */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

const STORAGE_KEY = "aria.lecture.rate";

/** A stored value back to one of the offered speeds; anything else is normal speed. */
export function parseRate(raw: unknown): PlaybackRate {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return (PLAYBACK_RATES as readonly number[]).includes(value as number) ? (value as PlaybackRate) : 1;
}

/** "1x", "1.5x", "0.25x" — how the control labels a speed. */
export function rateLabel(rate: number): string {
  return `${rate}×`;
}

function loadRate(): PlaybackRate {
  try {
    return parseRate(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private mode or a blocked store: normal speed, and the lecture still plays.
    return 1;
  }
}

/**
 * The speed, and a setter that remembers it.
 *
 * Normal speed on the first render so server and client markup agree; the stored speed is read after
 * mount, where localStorage exists. Deferred a tick rather than set straight in the effect body,
 * which this codebase's lint rightly rejects as a cascading render.
 */
export function usePlaybackRate(): [PlaybackRate, (rate: number) => void] {
  const [rate, setRateState] = useState<PlaybackRate>(1);

  useEffect(() => {
    const timer = window.setTimeout(() => setRateState(loadRate()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setRate = useCallback((next: number) => {
    const chosen = parseRate(next);
    setRateState(chosen);
    try {
      localStorage.setItem(STORAGE_KEY, String(chosen));
    } catch {
      // A full or blocked store must not break the lesson; the speed simply will not persist.
    }
  }, []);

  return [rate, setRate];
}
