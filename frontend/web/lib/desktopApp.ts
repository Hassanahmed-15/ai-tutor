"use client";

import { useSyncExternalStore } from "react";

/**
 * IS THIS PAGE INSIDE THE ARIA DESKTOP APP? Only the app has the screen-mark shortcut (⌃⌥A), so
 * the instructions for it show there and nowhere else.
 *
 * The app removes its user-agent marks (so Google sign-in works) but its preload sets Chrome's
 * speech recogniser to `undefined` (desktop-app/preload.js): the name is there with no value. No
 * browser does that (Chrome has the function, Firefox has no such name), so it identifies the app
 * without changing the app. `?desktop=1` shows the instructions in a browser, for testing.
 */
export function isDesktopApp(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).has("desktop")) return true;
  const w = window as unknown as Record<string, unknown>;
  return /Chrome\//.test(navigator.userAgent) && "webkitSpeechRecognition" in window && w.webkitSpeechRecognition === undefined;
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);
}

/** { desktop, mac }, known only after the first render (the server cannot tell). */
const never = () => () => {};
export function useDesktopApp(): { desktop: boolean; mac: boolean } {
  const desktop = useSyncExternalStore(never, isDesktopApp, () => false);
  const mac = useSyncExternalStore(never, isMac, () => false);
  return { desktop, mac };
}

/** The screen-mark shortcut as key caps for this computer. */
export function markKeys(mac: boolean): string[] {
  return mac ? ["⌃ Control", "⌥ Option", "A"] : ["Ctrl", "Alt", "A"];
}
