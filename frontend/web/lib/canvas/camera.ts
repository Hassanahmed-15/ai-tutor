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
  const bump = Math.min(0.7, (dist / Math.max(a.w, b.w)) * 0.32);
  const w = Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * e) * (1 + bump * 4 * e * (1 - e));
  const h = w / aspect;
  const cx = acx + (bcx - acx) * e;
  const cy = acy + (bcy - acy) * e;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
