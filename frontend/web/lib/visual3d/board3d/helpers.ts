// Shared drawing helpers so templates stay small: a stage for vectors, a row of memory-style cells,
// a binary-tree layout, a graph layout, and number formatting for labels.
import type { Board, Vec3 } from "./board";
import type { ColorToken } from "../theme";
import { fmt } from "../expr";

export const vecLabel = (v: number[]) => `(${v.map((x) => fmt(x)).join(", ")})`;

/** Axes and a floor grid sized to the vectors, camera framed on them. */
export function vectorStage(b: Board, points: Vec3[]) {
  const reach = Math.max(2, ...points.map((p) => Math.hypot(...p))) * 1.1;
  b.axes("axes", { size: reach, negative: true });
  b.grid("grid", { size: Math.ceil(reach), step: 1 });
  // A margin around the vectors so their labels (written past the tips) stay on screen.
  b.fit([[0, 0, 0], ...points.map((p) => p.map((c) => c * 1.3) as Vec3)], "iso");
  return reach;
}

/** A row of cells (array slots, queue slots, buckets…) centred on x = 0, at height z. */
export function cellX(k: number, n: number, w = 1.1) { return (k - (n - 1) / 2) * w; }
export function cells(b: Board, prefix: string, labels: string[], opts: { z?: number; y?: number; w?: number; color?: ColorToken; under?: (k: number) => string; over?: (k: number) => string } = {}) {
  const n = labels.length, w = opts.w ?? 1.1, z = opts.z ?? 0, y = opts.y ?? 0;
  labels.forEach((text, k) => {
    b.box(`${prefix}${k}`, { at: [cellX(k, n, w), y, z], size: [w * 0.92, 0.6, 0.6], color: opts.color ?? "idle", label: text, opacity: 0.9, inside: true });
    if (opts.under) b.label(`${prefix}u${k}`, { at: [cellX(k, n, w), y, z - 0.6], text: opts.under(k), color: "muted", small: true });
    if (opts.over) b.label(`${prefix}o${k}`, { at: [cellX(k, n, w), y, z + 0.95], text: opts.over(k), color: "muted", small: true });
  });
}

/** Position of node i of a binary tree stored as an array (heap order), for n nodes. */
export function heapPos(i: number, n: number, top = 3, dx = 4.2): Vec3 {
  const depth = Math.floor(Math.log2(i + 1));
  const first = 2 ** depth - 1, slots = 2 ** depth;
  const levels = Math.max(1, Math.floor(Math.log2(Math.max(n, 1))) + 1);
  const span = dx * 2 ** (levels - 1) * 0.55;
  return [((i - first + 0.5) / slots - 0.5) * span, 0, top - depth * 1.25];
}

/** A tidy deterministic layout for a small graph: nodes on a circle (radial), or given order. */
export function circleLayout(ids: string[], radius = 3): Map<string, Vec3> {
  const m = new Map<string, Vec3>();
  ids.forEach((id, k) => {
    const a = Math.PI / 2 - (2 * Math.PI * k) / ids.length;
    m.set(id, [radius * Math.cos(a), 0, radius * Math.sin(a)]);
  });
  return m;
}
