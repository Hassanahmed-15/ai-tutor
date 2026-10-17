/**
 * Text a figure component shortened to fit while it was built. The board validator collects these
 * and the board writer is told, so the next attempt is written to fit instead of being cut again
 * ("Effects and consequenc" was cut mid-word inside a cause map, audit 2026-10-17).
 */
import { trimToFit } from "../text/fit";

let recorded: string[] = [];
let recordedItems: Array<{ text: string; max: number }> = [];

/** `max` = the characters the room holds, when known: the text then goes to the shorten pass whole. */
export function recordFigureCut(text: string, room: string, max?: number): void {
  if (recorded.length < 20) recorded.push(`"${text.slice(0, 70)}${text.length > 70 ? "…" : ""}" did not fit ${room}`);
  if (max && recordedItems.length < 20) recordedItems.push({ text: text.replace(/\s+/g, " ").trim(), max: Math.max(4, Math.floor(max)) });
}

/** The whole texts that did not fit, with their room in characters, since the last call. */
export function takeFigureCutItems(): Array<{ text: string; max: number }> {
  const out = recordedItems;
  recordedItems = [];
  return out;
}

/** Starts a fresh record (before a build) and returns what was recorded since the last call. */
export function takeFigureCuts(): string[] {
  const out = recorded;
  recorded = [];
  return out;
}

/** Text kept to `max` characters: recorded for the shorten pass, and ended at a natural break meanwhile (never "…"). */
export function fitText(text: string, max: number): string {
  if (text.length <= max) return text;
  recordFigureCut(text, `${max} characters`, max);
  return trimToFit(text, max);
}
