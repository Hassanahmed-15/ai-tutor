/**
 * Text a figure component shortened to fit while it was built. The board validator collects these
 * and the board writer is told, so the next attempt is written to fit instead of being cut again
 * ("Effects and consequenc" was cut mid-word inside a cause map, audit 2026-10-17).
 */
let recorded: string[] = [];

export function recordFigureCut(text: string, room: string): void {
  if (recorded.length < 20) recorded.push(`"${text.slice(0, 70)}${text.length > 70 ? "…" : ""}" did not fit ${room}`);
}

/** Starts a fresh record (before a build) and returns what was recorded since the last call. */
export function takeFigureCuts(): string[] {
  const out = recorded;
  recorded = [];
  return out;
}

/** Shortens text to `max` characters at a word (with "…"), recording the cut; short text is returned as is. */
export function fitText(text: string, max: number): string {
  if (text.length <= max) return text;
  recordFigureCut(text, `${max} characters`);
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at >= max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:(–-]+$/, "")}…`;
}
