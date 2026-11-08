// Linear transformation of the unit cube by a 3×3 matrix: the cube and basis vectors morph from I to
// A; the determinant is the new volume (negative = the space is flipped). Real 3×3 maths.
import { z } from "zod/v4";
import { defineTemplate, type Result } from "../../contract";
import type { Board, Vec3 } from "../../board3d/board";
import { vecLabel } from "../../board3d/helpers";
import { fmt } from "../../expr";
import { Matrix3S } from "../shared";

export type M3 = number[][];
export const det3 = (m: M3) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
export const apply3 = (m: M3, v: Vec3): Vec3 => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]) as Vec3;
const lerpM = (m: M3, t: number): M3 => m.map((row, r) => row.map((x, c) => (r === c ? 1 : 0) * (1 - t) + x * t));
const CORNERS: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

function drawCube(b: Board, m: M3) {
  const p = CORNERS.map((c) => apply3(m, c));
  EDGES.forEach(([i, j], k) => b.line(`e${k}`, { points: [p[i], p[j]], color: "idle", width: 0.022 }));
  (["x", "y", "z"] as const).forEach((ax, k) => b.arrow(`i${k}`, { from: [0, 0, 0], to: apply3(m, CORNERS[[1, 3, 4][k]]), color: ax }));
}

function scene(b: Board, m: M3): Result {
  b.clear();
  const d = det3(m);
  const imgs = [0, 1, 2].map((k) => apply3(m, [[1, 0, 0], [0, 1, 0], [0, 0, 1]][k] as Vec3));
  const reach = Math.max(1.5, ...CORNERS.map((c) => Math.hypot(...apply3(m, c))));
  b.axes("axes", { size: reach * 1.1, negative: true });
  b.grid("grid", { size: Math.ceil(reach), step: 1 });
  drawCube(b, lerpM(m, 0));
  b.fit([[0, 0, 0], [1, 1, 1], ...CORNERS.map((c) => apply3(m, c))], "iso");
  b.state.m = m;
  return {
    facts: { matrix: m, determinant: fmt(d, 6), volume: fmt(Math.abs(d)), orientation: d < 0 ? "flipped" : d === 0 ? "squashed flat" : "kept", images_of_basis: imgs },
    steps: [
      { caption: "Start with the unit cube: volume 1", apply: () => {} },
      { caption: `Apply the matrix: i, j, k go to ${imgs.map(vecLabel).join(", ")} (the columns)`, apply: async (bb, o) => { await bb.tween(o.animate ? 1600 : 0, (t) => drawCube(bb, lerpM(m, t))); } },
      { caption: d === 0 ? "det = 0: the cube is squashed flat, volume 0" : `det = ${fmt(d)}: the volume is now ${fmt(Math.abs(d))}${d < 0 ? ", and space is flipped (mirror image)" : ""}`, apply: () => {} },
    ],
    summary: `The matrix sends the unit cube to a shape of volume |det| = ${fmt(Math.abs(d))}${d < 0 ? " (orientation flipped)" : ""}.`,
  };
}

export const linearTransformTemplate = defineTemplate({
  id: "linear_transform", domain: "math", family: "linear_algebra", title: "A matrix as a transformation",
  topics: ["linear transformation", "transformation matrix", "3x3 matrix", "determinant", "unit cube", "volume scale"],
  schema: z.object({ matrix: Matrix3S }), defaults: { matrix: [[1, 0.5, 0], [0, 1.5, 0], [0, 0, 1]] },
  narrationHints: ["The columns of the matrix are where i, j and k land.", "The determinant is how much volume is scaled."],
  run: (b, a) => scene(b, a.matrix),
  actions: { set_matrix: { description: "Use a different 3×3 matrix.", schema: z.object({ matrix: Matrix3S }), run: (b, a) => scene(b, a.matrix) } },
});
