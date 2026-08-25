"use client";

import { useCallback, useEffect, useState } from "react";
import { READING_LEVELS, type ReadingLevel } from "./dyslexiaLectureContent";

/**
 * Reading-comfort settings for the dyslexia track.
 *
 * WHY THESE ARE ADJUSTABLE AT ALL. OpenDyslexic is the visible signature of this mode, but the
 * evidence for a specialised typeface is far weaker than the evidence for generous SPACING — and
 * preference varies enough person to person that a fixed choice suits some readers no better than
 * the default would. A reader who finds the font harder currently has no way out of it, which makes
 * the track unusable for them. So the typeface is a control rather than a fact.
 *
 * WHY localStorage AND NOT THE ACCOUNT. These are rendering knobs adjusted while looking at the
 * screen, so they want instant feedback on every drag of a slider. The profile endpoint does a full
 * read-then-replace of the user document per call, and persisting five fields would mean touching
 * UserDoc.profile, mergeProfile, LearnerProfile, migrateUserDoc and the settings screen — a schema
 * migration for a per-device preference. The reading level already lived in localStorage; this
 * absorbs that key rather than adding a second one beside it.
 */

export type DyslexiaFont = "opendyslexic" | "sans";
export type DyslexiaTint = "none" | "cream" | "peach" | "mint" | "blue";

export type DyslexiaPrefs = {
  font: DyslexiaFont;
  /** em. The CSS default is 0.02em. */
  letterSpacing: number;
  /** em. The CSS default is 0.08em. */
  wordSpacing: number;
  /** unitless multiplier. The CSS default is 1.7. */
  lineHeight: number;
  tint: DyslexiaTint;
  /** 0..0.35 — beyond that the text underneath starts to lose contrast. */
  tintOpacity: number;
  readLevel: ReadingLevel;
};

export const DEFAULT_PREFS: DyslexiaPrefs = {
  font: "opendyslexic",
  letterSpacing: 0.02,
  wordSpacing: 0.08,
  lineHeight: 1.7,
  tint: "none",
  tintOpacity: 0.12,
  readLevel: "simple",
};

const PREFS_KEY = "aria.dyslexia.prefs";
/** The key the reading level used to live in, read once so an existing choice is not lost. */
const LEGACY_READ_LEVEL_KEY = "aria.dyslexia.readlevel";

/**
 * Tint colours.
 *
 * Coloured overlays are a contested intervention — the evidence for "scotopic sensitivity" is thin,
 * and this is offered because a good number of readers report real comfort from it, not because it
 * is established treatment. Hence: off by default, and framed as comfort rather than remedy.
 */
export const TINT_COLORS: Record<DyslexiaTint, string> = {
  none: "transparent",
  cream: "#f5e6c8",
  peach: "#f6d9c6",
  mint: "#cfe9d8",
  blue: "#cfdcf0",
};

export const TINT_LABELS: Record<DyslexiaTint, string> = {
  none: "None",
  cream: "Cream",
  peach: "Peach",
  mint: "Mint",
  blue: "Blue",
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function loadPrefs(): DyslexiaPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<DyslexiaPrefs>) : {};

    // Migrate the standalone reading-level key, so nobody's existing choice resets to default.
    const legacy = localStorage.getItem(LEGACY_READ_LEVEL_KEY);
    const readLevel =
      stored.readLevel && (READING_LEVELS as string[]).includes(stored.readLevel)
        ? stored.readLevel
        : legacy && (READING_LEVELS as string[]).includes(legacy)
          ? (legacy as ReadingLevel)
          : DEFAULT_PREFS.readLevel;

    return {
      font: stored.font === "sans" ? "sans" : "opendyslexic",
      letterSpacing: clamp(stored.letterSpacing, 0, 0.35, DEFAULT_PREFS.letterSpacing),
      wordSpacing: clamp(stored.wordSpacing, 0, 0.6, DEFAULT_PREFS.wordSpacing),
      lineHeight: clamp(stored.lineHeight, 1.2, 2.6, DEFAULT_PREFS.lineHeight),
      tint: stored.tint && stored.tint in TINT_COLORS ? stored.tint : "none",
      tintOpacity: clamp(stored.tintOpacity, 0, 0.35, DEFAULT_PREFS.tintOpacity),
      readLevel,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** The CSS custom properties the `.font-dyslexic` rule reads. Spread onto the player root. */
export function prefsToCssVars(prefs: DyslexiaPrefs): React.CSSProperties {
  return {
    "--dys-font-family":
      prefs.font === "sans"
        ? 'var(--font-body), ui-sans-serif, system-ui, sans-serif'
        : '"OpenDyslexic", "Comic Sans MS", var(--font-body), sans-serif',
    "--dys-letter-spacing": `${prefs.letterSpacing}em`,
    "--dys-word-spacing": `${prefs.wordSpacing}em`,
    "--dys-line-height": `${prefs.lineHeight}`,
  } as React.CSSProperties;
}

export function useDyslexiaPrefs() {
  // Defaults on the first render so the server and client markup agree; the stored values are read
  // after mount, where localStorage exists.
  const [prefs, setPrefs] = useState<DyslexiaPrefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<DyslexiaPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // A full or blocked store must not break the lesson; the setting simply will not persist.
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => update(DEFAULT_PREFS), [update]);

  return { prefs, update, reset, hydrated };
}
