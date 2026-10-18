/**
 * THE RENDERER'S FIT RULES, AS GEOMETRY. Pure; components/canvas/CanvasPanel.tsx, LessonCanvas.tsx
 * and components/avatar/BoardAvatar.tsx run them. Tests: lib/anim/renderClarity.test.ts.
 *
 * The owner's rule (2026-10-17): no text is ever cut. Text that would run past its room is set
 * smaller first (down to a readable floor), then on a second line; past that it takes more lines
 * rather than lose words.
 */
import { textWidth, wrap, type Rect, type Pt } from "./layout";
import type { View } from "./camera";

/**
 * `text` set to fit `maxW`: one line at `size`, smaller down to `oneLineMin` (default `min`), then
 * two (up to `maxLines`) lines from `linesFrom` (default `size`) down to `min`. When even that does
 * not fit, every word is kept at `min` on as many lines as it takes — never "…", never a dropped word.
 */
export function fitText(text: string, maxW: number, size: number, min: number, maxLines = 2, oneLineMin = min, linesFrom = size): { lines: string[]; size: number } {
  const t = text.replace(/\s+/g, " ").trim();
  const floor = Math.min(size, min);
  if (!t || !(maxW > 0)) return { lines: [t], size };
  for (let s = size; s >= Math.max(floor, oneLineMin); s -= 1) if (textWidth(t, s) <= maxW) return { lines: [t], size: s };
  for (let n = 2; n <= Math.max(2, maxLines); n++) {
    for (let s = Math.min(size, linesFrom); s >= floor; s -= 1) {
      // A very large line limit: wrap() only shortens text past its limit, and this must not.
      const lines = wrap(t, s, maxW, 99);
      if (lines.length <= n && lines.every((l) => textWidth(l, s) <= maxW)) return { lines, size: s };
    }
  }
  return { lines: wrap(t, floor, maxW, 99), size: floor };
}

/**
 * One rendered line of words, in board units: its left and right ends, its glyph box's top and
 * bottom, and where its underline goes.
 */
export type TextRow = { x0: number; x1: number; top: number; bottom: number; under: number };

/**
 * Where an underline goes under a line set at `size` whose baseline is at `baseline`: below the
 * descenders (g, p, y reach ~0.25 em) and above the next line's ascenders (a line 1.28 em further
 * down rises ~0.75 em) — a stroke ~0.15 em thick centred at 0.39 em clears both.
 */
export const underlineY = (baseline: number, size: number) => baseline + size * 0.39;

/**
 * The lines of writing in a set of glyph boxes (one per <text>, <tspan> or typeset term): boxes
 * that share most of their height are one line. A box may say where its underline goes (from its
 * baseline); one that does not is underlined just below its box. Sorted top to bottom.
 */
export function textRows(boxes: Array<Rect & { under?: number }>): TextRow[] {
  const rows: TextRow[] = [];
  for (const b of [...boxes].filter((r) => r.w > 1 && r.h > 1).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const mid = b.y + b.h / 2;
    const under = b.under ?? b.y + b.h + 3;
    const row = rows.find((r) => mid > r.top && mid < r.bottom && Math.min(r.bottom, b.y + b.h) - Math.max(r.top, b.y) > Math.min(r.bottom - r.top, b.h) * 0.5);
    if (row) {
      row.x0 = Math.min(row.x0, b.x);
      row.x1 = Math.max(row.x1, b.x + b.w);
      row.top = Math.min(row.top, b.y);
      row.bottom = Math.max(row.bottom, b.y + b.h);
      row.under = Math.max(row.under, under);
    } else rows.push({ x0: b.x, x1: b.x + b.w, top: b.y, bottom: b.y + b.h, under });
  }
  return rows.sort((a, b) => a.top - b.top);
}

/**
 * The camera's framing while a task card stands at the right: the board as large as the space LEFT
 * of the card's column allows (in screen pixels), instead of a fixed extra half-board of world to
 * its right, which shrank the board to ~60% and showed the neighbouring boards around it (audit
 * 2026-10-17). Null when the screen is too narrow for a column (the card then covers the board
 * anyway, and the old framing stays).
 */
export function cardSideView(board: Rect, box: { w: number; h: number }, columnPx: number, pad = 0.02): View | null {
  const left = box.w - columnPx;
  if (!(box.w > 0 && box.h > 0) || left < box.w * 0.45) return null;
  const k = Math.min(left / (board.w * (1 + pad * 2)), box.h / (board.h * (1 + pad * 2)));
  const w = box.w / k;
  const h = box.h / k;
  return { x: board.x + board.w / 2 - left / 2 / k, y: board.y + board.h / 2 - h / 2, w, h };
}

/**
 * Where Dot rests: her home corner when nothing written or drawn is under her; otherwise the
 * nearest clear spot on the board at her full size, then at a smaller size; and when the board is
 * full, the corner of the board's frame where she covers least (never the middle of the words).
 */
export function restSpot(raw: Pt, size: number, bounds: Rect, busy: Rect[], smaller = 0.62, step = 24): { at: Pt; scale: number } {
  const overlap = (q: Pt, half: number) =>
    busy.reduce((s, r) => s + Math.max(0, Math.min(q.x + half, r.x + r.w) - Math.max(q.x - half, r.x)) * Math.max(0, Math.min(q.y + half, r.y + r.h) - Math.max(q.y - half, r.y)), 0);
  const inside = (q: Pt, half: number) => q.x - half >= bounds.x && q.y - half >= bounds.y && q.x + half <= bounds.x + bounds.w && q.y + half <= bounds.y + bounds.h;
  if (overlap(raw, size / 2) === 0) return { at: raw, scale: 1 };
  for (const scale of [1, smaller]) {
    const half = (size * scale) / 2;
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let y = bounds.y + half; y <= bounds.y + bounds.h - half; y += step) {
      for (let x = bounds.x + half; x <= bounds.x + bounds.w - half; x += step) {
        const q = { x, y };
        const d = Math.hypot(x - raw.x, y - raw.y);
        if (d < bestD && inside(q, half) && overlap(q, half) === 0) {
          best = q;
          bestD = d;
        }
      }
    }
    if (best) return { at: best, scale };
  }
  const scale = Math.min(smaller, 0.5);
  const half = (size * scale) / 2;
  const corners: Pt[] = [
    { x: bounds.x + bounds.w - half, y: bounds.y + bounds.h - half }, { x: bounds.x + half, y: bounds.y + bounds.h - half },
    { x: bounds.x + bounds.w - half, y: bounds.y + half }, { x: bounds.x + half, y: bounds.y + half },
  ];
  return { at: corners.reduce((a, b) => (overlap(b, half) < overlap(a, half) ? b : a), corners[0]), scale };
}
