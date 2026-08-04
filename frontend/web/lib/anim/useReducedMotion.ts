"use client";

import { useSyncExternalStore } from "react";

/**
 * Tracks the OS "reduce motion" preference.
 *
 * globals.css already answers `prefers-reduced-motion` with `animation: none !important`,
 * but that only reaches CSS keyframes. Every JS-driven surface — LiveSketch's rAF clock, the
 * generated animations inside ReactAnimationSandbox, RagScene — ignored the preference
 * entirely and kept moving. For a tutor whose whole premise is adapting to how a particular
 * student's mind works, motion that cannot be turned off is the wrong default: for a
 * vestibular disorder it is nauseating, and for several attention profiles it is simply
 * unreadable.
 *
 * The contract is "show me the finished state", not "show me the same animation slower".
 * Callers pass this into `withReducedMotion` (rate.ts) or jump their clock to the end.
 *
 * Implemented with useSyncExternalStore rather than useState + useEffect: a media query IS an
 * external store, so this reads the real value on the first client render instead of painting
 * one frame of motion and then correcting itself.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/** The server has no media queries; assume motion is fine and let the client correct it. */
function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
