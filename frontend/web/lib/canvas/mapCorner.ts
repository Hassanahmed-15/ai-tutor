import type { View } from "./camera";
import type { Rect } from "./layout";

/**
 * THE LESSON MAP NEVER SITS ON THE WRITING (QA 2026-11-28: the bottom-left board-number grid covered words and a
 * "Check yourself" answer on many boards). The map is a small pill in the corner until the student opens it
 * (components/canvas/LessonCanvas.tsx CornerMap), and the camera keeps the board's writing clear of that pill:
 * when the pill would land on the board's writing area, the view pulls back just enough. Pure (lib/anim/mapCorner.test.ts).
 */

/** The collapsed pill, in screen pixels: its size and its inset from the bottom-left corner. */
export const MAP_PILL = { w: 76, h: 28, inset: 12 };

/** The part of a board that holds writing: inside its frame margin (board units). */
export function writingArea(board: Rect, margin = 24): Rect {
  return { x: board.x + margin, y: board.y + margin, w: Math.max(0, board.w - margin * 2), h: Math.max(0, board.h - margin * 2) };
}

/** Whether the pill, in the bottom-left corner of a `box` showing `view`, lands on `area` (world units). */
export function pillCovers(view: View, area: Rect, box: { w: number; h: number }, pill = MAP_PILL): boolean {
  if (!(view.w > 0) || !(box.w > 0) || !(box.h > 0)) return false;
  const k = box.w / view.w;
  const left = (area.x - view.x) * k;
  const right = (area.x + area.w - view.x) * k;
  const top = (area.y - view.y) * k;
  const bottom = (area.y + area.h - view.y) * k;
  const px0 = pill.inset, px1 = pill.inset + pill.w;
  const py0 = box.h - pill.inset - pill.h, py1 = box.h - pill.inset;
  return left < px1 && right > px0 && top < py1 && bottom > py0;
}

/** The view, pulled back around its centre by the least that keeps the pill off `area` (at most 20%); unchanged when it already is. */
export function clearOfPill(view: View, area: Rect, box: { w: number; h: number }, pill = MAP_PILL): View {
  if (!pillCovers(view, area, box, pill)) return view;
  for (let g = 1.01; g <= 1.2001; g += 0.01) {
    const v = { x: view.x + (view.w * (1 - g)) / 2, y: view.y + (view.h * (1 - g)) / 2, w: view.w * g, h: view.h * g };
    if (!pillCovers(v, area, box, pill)) return v;
  }
  return view;
}
