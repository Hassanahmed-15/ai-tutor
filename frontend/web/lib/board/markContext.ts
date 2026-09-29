import { boardPictureMemoryOf, pointOnBoard, zoomView, BOARD_W, BOARD_H } from "../anim/illustratedLayout";

/**
 * WHAT A MARK ON A PICTURE COVERS, IN WORDS.
 *
 * A pen circle round part of a picture covers no written text, so the live tutor was told nothing
 * about it: the student circled the grana, asked "what's this?", and Aria could not know
 * (2026-09-29: "the pen and highlighter aren't working — they should work with visual context").
 * A picture board carries where each of its parts is (BOARD_PICTURE memory, through its own zoom),
 * so the parts inside the mark — or, failing that, the one nearest it — are named here, for free
 * and at once. Marks are in the board's own frame, fractions of its 1000 x 560.
 */
export function picturePartsInMark(code: string | null | undefined, points: Array<{ x: number; y: number }>): string[] {
  const memory = boardPictureMemoryOf(code) as { parts?: Array<{ name: string; x: number; y: number }>; focus?: string | null } | null;
  if (!memory?.parts?.length || points.length === 0) return [];
  const xs = points.map((p) => p.x * BOARD_W);
  const ys = points.map((p) => p.y * BOARD_H);
  const pad = 14;
  const box = { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad };
  const focus = memory.focus ? memory.parts.find((p) => p.name === memory.focus) ?? null : null;
  const view = zoomView(focus);
  const placed = memory.parts.map((part) => ({ name: part.name, ...pointOnBoard(part, view) }));
  const inside = placed.filter((p) => p.px >= box.x0 && p.px <= box.x1 && p.py >= box.y0 && p.py <= box.y1).map((p) => p.name);
  if (inside.length) return [...new Set(inside)].slice(0, 3);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const nearest = placed
    .map((p) => ({ name: p.name, d: Math.hypot(p.px - cx, p.py - cy) }))
    .sort((a, b) => a.d - b.d)[0];
  return nearest && nearest.d <= 70 ? [nearest.name] : [];
}
