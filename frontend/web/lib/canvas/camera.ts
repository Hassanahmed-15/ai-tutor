/**
 * The canvas camera: what to frame, and how to fly there.
 *
 * A move between two framings is a "smooth zoom" (van Wijk & Nuij): the view pulls back a little
 * mid-flight in proportion to the distance travelled, so a long move reads as travelling across one
 * board rather than a slide sliding sideways, and a zoom into a detail is one continuous push.
 */

import type { Rect } from "./layout";

export type View = { x: number; y: number; w: number; h: number };

/** Grow `rect` (plus padding) to the viewport's aspect ratio, centred. */
export function fitView(rect: Rect, aspect: number, pad = 0.04): View {
  let w = rect.w * (1 + pad * 2);
  let h = rect.h * (1 + pad * 2);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  return { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
}

/** The smallest rect holding all of `rects`. */
export function unionRects(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 1000, h: 560 };
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** How long a flight between two views should take, in ms. */
export function flightMs(a: View, b: View): number {
  const zoom = Math.abs(Math.log2(b.w / a.w));
  const dist = Math.hypot(b.x + b.w / 2 - (a.x + a.w / 2), b.y + b.h / 2 - (a.y + a.h / 2)) / Math.max(a.w, b.w);
  return Math.round(Math.min(2800, 900 + zoom * 320 + dist * 520));
}

/** The view `t` (0-1) of the way from `a` to `b`. */
export function viewAt(a: View, b: View, t: number): View {
  const e = ease(Math.max(0, Math.min(1, t)));
  const aspect = a.w / a.h;
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dist = Math.hypot(bcx - acx, bcy - acy);
  // The pull-back mid-flight (van Wijk) shows where the camera is going.
  const bump = Math.min(0.7, (dist / Math.max(a.w, b.w)) * 0.32);
  const w = Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * e) * (1 + bump * 4 * e * (1 - e));
  const h = w / aspect;
  const cx = acx + (bcx - acx) * e;
  const cy = acy + (bcy - acy) * e;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * THE CAMERA DIRECTOR for maths and computer science. The owner asked for zoom and motion (2026-10-21)
 * and then, the same day, for it to be steady and in the right place: "I don't want it changing and
 * zooming every 2 or 3 seconds … Aria is writing and speaking somewhere else and it's zoomed in
 * somewhere else". A shot cut from the clock did both. Now the camera works like an operator
 * following a teacher's hand:
 *
 *   - it is told where the marker is about to draw (MarkerWriter onRegion), before the pen moves;
 *   - ink that lands inside the current frame changes nothing — the shot holds;
 *   - it moves in close on its own only after a shot has held for `hold` ms, and only onto a piece of
 *     ink small enough for a real close-up (framed with room around it, never closer than `closest`
 *     of the board);
 *   - it moves AT ONCE, whatever the hold, when the marker would otherwise draw off screen, or Aria
 *     points at something outside the frame: to a close-up there if one fits, else back to the whole
 *     board.
 *
 * Shots are board-space rectangles at the board's aspect; null is the whole board. Pure.
 */
export type Shot = { shot: Rect | null; changedAt: number };
export const DIRECTOR_HOLD_MS = 5000;
const CLOSEST = 0.7;
/** Only a piece that takes this long (ms) to draw is worth a close-up. */
export const CLOSE_UP_MIN_MS = 3000;

/** The close-up that frames `box` with room around it, or null when no close-up fits it. */
export function closeUpOn(box: Rect, board: { w: number; h: number }, closest = CLOSEST): Rect | null {
  const w = Math.max(box.w * 1.5, (box.h * 1.5 * board.w) / board.h, board.w * closest);
  if (w > board.w * 0.86) return null;
  const h = (w * board.h) / board.w;
  return { x: Math.max(0, Math.min(board.w - w, box.x + box.w / 2 - w / 2)), y: Math.max(0, Math.min(board.h - h, box.y + box.h / 2 - h / 2)), w, h };
}

/** Is `box` inside `shot`, with a small margin so a pen at the frame's edge counts as outside? */
export function inShot(shot: Rect, box: Rect): boolean {
  const m = shot.w * 0.03;
  return box.x >= shot.x + m && box.y >= shot.y + m && box.x + box.w <= shot.x + shot.w - m && box.y + box.h <= shot.y + shot.h - m;
}

/**
 * The marker is about to draw `box` (null: somewhere unknown, or everywhere). `drawing` is false for
 * a note or a heading: never worth a close-up of its own (a zoom onto a bullet note cropped the
 * board, playback QA 2026-10-21), but still never written off screen.
 */
export function directInk(state: Shot, box: Rect | null, now: number, board: { w: number; h: number }, hold = DIRECTOR_HOLD_MS, drawing = true, ms = Infinity): Shot {
  // A close-up is worth it only for a drawing that takes a while to draw: a short piece (under 3 s)
  // never moves the camera in — it could only zoom in and straight back out.
  const close = box && drawing && ms >= CLOSE_UP_MIN_MS ? closeUpOn(box, board) : null;
  if (state.shot) {
    if (box && inShot(state.shot, box)) return state;
    // Off screen: it must move now — into a close-up there only when the shot has held long enough.
    return { shot: close && now - state.changedAt >= hold ? close : null, changedAt: now };
  }
  if (close && now - state.changedAt >= hold) return { shot: close, changedAt: now };
  return state;
}

/** Aria points at `box` (a cue's target): a close-up that leaves it out gives way to the whole board. */
export function directFocus(state: Shot, box: Rect | null, now: number): Shot {
  if (!state.shot || !box || inShot(state.shot, box)) return state;
  return { shot: null, changedAt: now };
}
