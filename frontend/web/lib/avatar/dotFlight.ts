/**
 * WHERE DOT GOES WHEN SHE POINTS, AS GEOMETRY. Pure; components/avatar/BoardAvatar.tsx runs it.
 * Tests: lib/anim/dotFlight.test.ts.
 *
 * The rules come from the research brief of 2026-10-12 (pointing agents, deictic cues, motion):
 *  - She goes only to the specific thing the narration names, and stands BESIDE it with a clear gap,
 *    never on it: attention follows what a pointer points AT (Ouwehand et al. 2015), and a pointer on
 *    top hides the target (Vogel & Baudisch 2007).
 *  - She points with her eyes plus a thin beam (gaze + gesture beats either alone).
 *  - Each departure is an onset that pulls the eye (Abrams & Christ 2003): at most one flight from
 *    home every FLIGHT_GAP_S; a new target she can already see from where she is gets a new beam,
 *    not another flight; she goes home soon after the narration moves on.
 */
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Clear space kept between Dot and what she points at. */
export const GAP = 16;
// The owner found her pointing wrong (2026-10-21): with 8 s between departures, 4 s between hops and
// a 260 px reach she mostly stood beside the LAST thing named and sent only a thin beam to the new one.
// She now stands beside what Aria is saying; the gaps only stop her flickering between two targets.
/** Seconds between two departures from her corner. */
export const FLIGHT_GAP_S = 2.5;
/** Seconds between two hops while she is out; a hop that comes too soon is made once it is allowed. */
export const HOP_GAP_S = 1.2;
/** A new target this close (px, edge to her centre) is pointed at from where she stands: right beside it. */
export const REACH = 110;
/** Flight and return durations (s). */
export const FLY_S = 0.5;
export const RETURN_S = 0.65;
/** How long she stays after the target lifts before flying home (s). */
export const LINGER_S = 0.5;

const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const boxAt = (c: Pt, size: number): Rect => ({ x: c.x - size / 2, y: c.y - size / 2, w: size, h: size });
const inside = (r: Rect, b: Rect) => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;

/**
 * The best place for Dot's centre beside `target`: right of it first (lines of text and code end
 * in open space), then left, below, above, the corners. A spot must leave the target a GAP, stay
 * within `bounds`, and is scored by how much writing it would cover, then how much of a card (a
 * code listing, a table), then by how far it is.
 * Null when nothing fits (she then points from her corner).
 */
export function parkingSpot(target: Rect, size: number, bounds: Rect, ink: Rect[], from: Pt, cards: Rect[] = []): Pt | null {
  const half = size / 2;
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const right = target.x + target.w + GAP + half;
  const left = target.x - GAP - half;
  const below = target.y + target.h + GAP + half;
  const above = target.y - GAP - half;
  const candidates: Pt[] = [
    { x: right, y: cy }, { x: left, y: cy }, { x: right, y: below - half * 0.6 }, { x: cx, y: below },
    { x: left, y: below - half * 0.6 }, { x: right, y: above + half * 0.6 }, { x: cx, y: above }, { x: left, y: above + half * 0.6 },
  ];
  const usable: Rect = { x: bounds.x + 6, y: bounds.y + 6, w: bounds.w - 12, h: bounds.h - 12 };
  let best: Pt | null = null;
  let bestScore = Infinity;
  let bestCovered = 0;
  candidates.forEach((c, order) => {
    const box = boxAt(c, size);
    if (!inside(box, usable)) return;
    if (area(box, { x: target.x - GAP + 2, y: target.y - GAP + 2, w: target.w + 2 * GAP - 4, h: target.h + 2 * GAP - 4 }) > 0) return;
    const covered = ink.reduce((s, r) => s + area(box, r), 0) / (size * size);
    // Standing on a card (a code listing, a table) is worse than open board, better than on words.
    const onCard = cards.reduce((s, r) => s + area(box, r), 0) / (size * size);
    const score = covered * 1000 + onCard * 300 + order * 6 + Math.hypot(c.x - from.x, c.y - from.y) * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = c;
      bestCovered = covered;
    }
  });
  // Every spot beside the target would cover words (a full exam board): no spot — she points from
  // where she stands rather than land on the text ("…or omit the direction" was hidden under her
  // on two exam boards; live test, 2026-10-17).
  return bestCovered > 0.03 ? null : best;
}

/** The smallest rectangle holding both. */
export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Distance from a point to a rectangle's edge (0 inside). */
export function distanceTo(p: Pt, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** Does a Dot of `size` centred at `c` cover any of `r` (with the gap)? */
export function covers(c: Pt, size: number, r: Rect): boolean {
  return area(boxAt(c, size), { x: r.x - GAP / 2, y: r.y - GAP / 2, w: r.w + GAP, h: r.h + GAP }) > 0;
}

/** Ease in and out (cubic). */
export function ease(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/** A gentle arc from a to b (lifted by 14% of the distance), at eased time t. */
export function arcPoint(a: Pt, b: Pt, t: number): Pt {
  const e = ease(t);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - d * 0.14;
  const u = 1 - e;
  return { x: u * u * a.x + 2 * u * e * mx + e * e * b.x, y: u * u * a.y + 2 * u * e * my + e * e * b.y };
}

/** The beam: from Dot's rim towards the target's nearest edge, stopping short of it. */
export function beam(c: Pt, radius: number, target: Rect): { from: Pt; to: Pt } | null {
  const pad = 6;
  const nx = Math.max(target.x - pad, Math.min(c.x, target.x + target.w + pad));
  const ny = Math.max(target.y - pad, Math.min(c.y, target.y + target.h + pad));
  const d = Math.hypot(nx - c.x, ny - c.y);
  if (d < radius + 8) return null;
  const ux = (nx - c.x) / d;
  const uy = (ny - c.y) / d;
  return { from: { x: c.x + ux * (radius + 2), y: c.y + uy * (radius + 2) }, to: { x: nx - ux * 2, y: ny - uy * 2 } };
}

/** Where her eyes should look (-1..1) to look from `c` at `target`. */
export function gazeAt(c: Pt, target: Rect): Pt {
  const tx = target.x + target.w / 2 - c.x;
  const ty = target.y + target.h / 2 - c.y;
  const d = Math.hypot(tx, ty) || 1;
  return { x: tx / d, y: ty / d };
}
