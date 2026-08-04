/**
 * Relative positioning — Manim's `next_to(target, direction, buff)`.
 *
 * Right now every coordinate in a DrawScript is a literal the model invented, and nothing
 * connects a label to the thing it labels. The cost of that shows up in drawPrompt.ts, which
 * spends roughly fifteen lines asking the model to maintain "an explicit list of every label's
 * rectangle {x, y, width, height}" and verify pairwise non-intersection before placing each
 * one. That is a runtime job being outsourced to an LLM's mental arithmetic, and it is exactly
 * the failure the prompt itself calls "a very common failure".
 *
 * With this, a label can say *which part it belongs to* and let the renderer work out where
 * that lands. Coordinates are on the DrawScript 0-100 grid, using the same centre +
 * half-extent convention as `LaidOutNode` in lib/layout.ts so the two share one mental model.
 */

import { SAFE, type Point } from "./arrange";

export interface Bounds {
  /** Centre. */
  x: number;
  y: number;
  /** Half-extents, so `x - w` is the left edge. */
  w: number;
  h: number;
}

export type Direction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "upLeft"
  | "upRight"
  | "downLeft"
  | "downRight"
  | "center";

/** Unit vector per direction, y positive downwards to match SVG. */
const VECTORS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  upLeft: { x: -1, y: -1 },
  upRight: { x: 1, y: -1 },
  downLeft: { x: -1, y: 1 },
  downRight: { x: 1, y: 1 },
  center: { x: 0, y: 0 },
};

export const DIRECTIONS = Object.keys(VECTORS) as Direction[];

export function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && value in VECTORS;
}

/**
 * Places a point just outside `target`'s edge in `direction`, separated by `buff`.
 *
 * `self` is the half-extent of the thing being placed. Passing it means the returned point is
 * the new object's *centre* with its own size accounted for, so a wide label and a small dot
 * both end up with the same visual gap — which is the whole reason Manim takes the mobject
 * rather than a bare point.
 */
export function nextTo(
  target: Bounds,
  direction: Direction = "up",
  buff = 6,
  self: { w: number; h: number } = { w: 0, h: 0 },
): Point {
  const vec = VECTORS[direction];
  return clampToSafe({
    x: target.x + vec.x * (target.w + buff + self.w),
    y: target.y + vec.y * (target.h + buff + self.h),
  });
}

function clampToSafe(p: Point): Point {
  return {
    x: Math.max(SAFE.minX, Math.min(SAFE.maxX, p.x)),
    y: Math.max(SAFE.minY, Math.min(SAFE.maxY, p.y)),
  };
}

/** Do two boxes overlap, allowing `pad` of required clearance between them? */
export function intersects(a: Bounds, b: Bounds, pad = 0): boolean {
  return Math.abs(a.x - b.x) < a.w + b.w + pad && Math.abs(a.y - b.y) < a.h + b.h + pad;
}

/** Grows `a` to also contain `b` — Manim's `VGroup` bounding box. */
export function unionBounds(a: Bounds, b: Bounds): Bounds {
  const minX = Math.min(a.x - a.w, b.x - b.w);
  const maxX = Math.max(a.x + a.w, b.x + b.w);
  const minY = Math.min(a.y - a.h, b.y - b.h);
  const maxY = Math.max(a.y + a.h, b.y + b.h);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: (maxX - minX) / 2, h: (maxY - minY) / 2 };
}

/**
 * Order in which alternative placements are tried when the requested one collides.
 * Opposite-side first: if a label doesn't fit above its target, below is the placement a
 * reader is least likely to misattribute to a neighbour.
 */
const FALLBACKS: Record<Direction, Direction[]> = {
  up: ["up", "down", "right", "left", "upRight", "upLeft"],
  down: ["down", "up", "right", "left", "downRight", "downLeft"],
  left: ["left", "right", "up", "down", "upLeft", "downLeft"],
  right: ["right", "left", "up", "down", "upRight", "downRight"],
  upLeft: ["upLeft", "upRight", "downLeft", "up", "left"],
  upRight: ["upRight", "upLeft", "downRight", "up", "right"],
  downLeft: ["downLeft", "downRight", "upLeft", "down", "left"],
  downRight: ["downRight", "downLeft", "upRight", "down", "right"],
  center: ["center"],
};

/**
 * `nextTo`, but if the preferred side is already occupied it tries the other sides before
 * giving up. Returns the first placement that clears every box in `occupied`.
 *
 * This is the piece that lets the prompt stop describing rectangle intersection tests: the
 * model names a target and a preferred side, and overlap resolution happens here where the
 * real geometry is known.
 */
export function nextToAvoiding(
  target: Bounds,
  occupied: Bounds[],
  direction: Direction = "up",
  buff = 6,
  self: { w: number; h: number } = { w: 0, h: 0 },
  pad = 1.5,
): Point {
  for (const dir of FALLBACKS[direction]) {
    const point = nextTo(target, dir, buff, self);
    const box: Bounds = { x: point.x, y: point.y, w: self.w, h: self.h };
    if (!occupied.some((other) => intersects(box, other, pad))) return point;
  }
  // Every side was taken. Push out along the preferred direction with a wider buffer rather
  // than stacking directly on top of another label — a slightly detached label is readable,
  // an overlapping pair is not.
  return nextTo(target, direction, buff * 2.5, self);
}
