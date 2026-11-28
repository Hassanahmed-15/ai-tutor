/**
 * NO HALF LINE AT THE TOP OF THE NOTES COLUMN (QA 2026-11-28). The board's writing (components/canvas/BlocksView.tsx)
 * scrolls to follow Aria, which is right for a long board, but it scrolled by whatever the newest piece needed, so
 * the top edge cut a line in half (its lower half showing under the heading). The column now stops only where no
 * line is cut — just above a line, clear of the top's short fade — and never so far that the start of the sentence
 * she is saying goes off the top, unless that sentence is taller than the column. Pure (lib/anim/scrollSnap.test.ts).
 */

export type Band = { top: number; bottom: number };

/** Lines of writing from the boxes of its glyph runs (in the column's scroll coordinates): runs that overlap are one line. */
export function lineBands(boxes: Band[]): Band[] {
  const sorted = boxes.filter((b) => b.bottom > b.top).sort((a, b) => a.top - b.top);
  const out: Band[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    // Most of the shorter box inside the last line: the same line (a superscript, a bold word, a typeset term).
    if (last && b.top < last.bottom - Math.min(b.bottom - b.top, last.bottom - last.top) * 0.4) last.bottom = Math.max(last.bottom, b.bottom);
    else out.push({ top: b.top, bottom: b.bottom });
  }
  return out;
}

/**
 * Where the column should scroll to so the newest piece (its bottom at `newestBottom`) is in view — ideally in the
 * lower part (82% down), as BlocksView always did — at a stop that cuts no line, with the start of the sentence
 * being said (`keepTop`) still on the board whenever the newest piece fits under it. Null: no need to scroll.
 * All in the column's scroll coordinates; `view` is its visible height, `fade` its top fade, `max` the furthest it scrolls.
 */
export function followScrollTop(o: { current: number; newestBottom: number; view: number; bands: Band[]; keepTop?: number; fade?: number; max?: number }): number | null {
  const fade = o.fade ?? 6;
  const max = Math.max(0, o.max ?? Infinity);
  const comfort = o.newestBottom - o.view * 0.82;
  if (comfort <= o.current + 4) return null;
  const lo = Math.max(0, o.newestBottom - o.view + 8);
  const keep = o.keepTop !== undefined ? o.keepTop - fade : Infinity;
  const hi = Math.min(max, keep >= lo ? keep : Infinity);
  const target = Math.max(lo, Math.min(comfort, hi));
  // A stop cuts a line when the top edge runs through it. The best stop for a line is just above it, at most `fade`
  // above (so it is clear of the fade) and never above the bottom of the line before (so that one is gone whole).
  const cuts = (s: number) => o.bands.some((b) => b.top < s - 0.5 && b.bottom > s + 0.5);
  const above = o.bands.map((b, i) => Math.max(i > 0 ? o.bands[i - 1].bottom : -Infinity, b.top - fade));
  const stops = [target, lo, ...above].filter((s) => s >= lo - 0.5 && s <= hi + 0.5 && !cuts(s));
  // The clean stop nearest the target, a later one first (the newest piece higher, never lower than asked).
  stops.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || b - a);
  const at = stops[0] ?? target;
  const out = Math.max(0, Math.min(max, at));
  return out > o.current + 1 ? out : null;
}
