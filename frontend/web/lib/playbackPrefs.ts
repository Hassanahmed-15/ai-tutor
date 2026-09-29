"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The lecture's playback speed, remembered between lectures.
 *
 * Only these five: a slider invites 1.37x, and a speed nobody chose on purpose is a speed nobody
 * notices they are stuck on. Kept per browser in localStorage, like the dyslexia and autism
 * preferences — it is a listening preference, not something the account needs to carry.
 */
export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2] as const;
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
