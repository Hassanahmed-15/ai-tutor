import type { VisemeName } from "./visemes";

/**
 * THE SCRIPT OF A SENTENCE: the mouth shapes the words call for, in order, with how long each
 * lasts relative to the others. Gemini sends the words of a reply BEFORE the audio that says them,
 * so by the time a sound plays we already know what the lips should be doing; the audio only has
 * to tell us how far along we are (its clock) and confirm what it hears (the viseme listener).
 *
 * Pure. The text→viseme rules themselves are TalkingHead's (lib/avatar/vendor/lipsync-en.mjs);
 * this module takes their output and does the timing and the reconciling, which is what is tested
 * (lib/anim/avatarScript.test.ts).
 */

export type Script = {
  visemes: VisemeName[];
  /** Start of each viseme, in relative units, cumulative from 0. */
  starts: number[];
  /** Total relative length; `starts[i] / total` is where viseme i begins. */
  total: number;
};

export const EMPTY_SCRIPT: Script = { visemes: [], starts: [], total: 0 };

/** Build a script from rule output (visemes with relative durations), appending to an earlier one. */
export function appendToScript(script: Script, visemes: string[], durations: number[], wordGap = 0.6): Script {
  const next: Script = { visemes: [...script.visemes], starts: [...script.starts], total: script.total };
  if (visemes.length && next.visemes.length) next.total += wordGap; // the breath between words
  for (let i = 0; i < visemes.length; i++) {
    const v = visemes[i] as VisemeName;
    const d = durations[i] ?? 1;
    // The same shape twice in a row is one longer shape.
    if (next.visemes.length && next.visemes[next.visemes.length - 1] === v) {
      next.total += d * 0.7;
      continue;
    }
    next.visemes.push(v);
    next.starts.push(next.total);
    next.total += d;
  }
  return next;
}

/** The index of the viseme the script expects at `progress` (0..1 through the spoken audio), or -1. */
export function expectedIndex(script: Script, progress: number): number {
  if (script.visemes.length === 0 || !(progress >= 0)) return -1;
  const at = Math.min(1, progress) * script.total;
  let lo = 0;
  let hi = script.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (script.starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Reconcile what the script expects with what the listener heard. The listener is right about
 * timing and often about the shape; the script is right about the shape and roughly about timing.
 * So: if what was heard is one of the shapes due around now (within `window` steps), trust the
 * ear and move the script's cursor there; otherwise show the script's shape and keep the cursor.
 * Returns the viseme to show and the cursor to keep.
 */
export function reconcile(script: Script, cursor: number, expected: number, heard: VisemeName | null, window = 1): { viseme: VisemeName | null; cursor: number } {
  if (script.visemes.length === 0) return { viseme: heard, cursor };
  const centre = Math.min(script.visemes.length - 1, Math.max(cursor, expected));
  // Lips the ear cannot see are the script's alone: a sealed p/b/m, f/v on the teeth, th.
  const due = script.visemes[centre];
  if (due === "PP" || due === "FF" || due === "TH") return { viseme: due, cursor: centre };
  if (heard && heard !== "sil") {
    const lo = Math.max(0, centre - window);
    const hi = Math.min(script.visemes.length - 1, centre + window);
    for (let i = centre; i <= hi; i++) if (script.visemes[i] === heard) return { viseme: heard, cursor: i };
    for (let i = centre - 1; i >= lo; i--) if (script.visemes[i] === heard) return { viseme: heard, cursor: i };
  }
  const i = Math.min(script.visemes.length - 1, Math.max(0, Math.max(cursor, expected)));
  return { viseme: script.visemes[i], cursor: i };
}
