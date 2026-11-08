// More geometry: points_distance_3d, cross_section (a plane slicing a cube) and net_unfold (a cube
// unfolding to its net — the hinge maths from maths-lab's nets).
import { z } from "zod/v4";
import { defineTemplate, type Result, type Step } from "../../contract.ts";
import { add, cross, dot, norm, scale, sub, type Board, type Vec3 } from "../../board3d/board.ts";
import { vecLabel, vectorStage } from "../../board3d/helpers.ts";
import { fmt } from "../../expr.ts";
import { Vec3S } from "../shared.ts";

// ── points_distance_3d ──────────────────────────────────────────────────────────────────────────
function pts(b: Board, A: Vec3, B: Vec3): Result {
  b.clear();
  vectorStage(b, [A, B]);
  const d = norm(sub(B, A)), M = scale(add(A, B), 0.5);
  b.node("A", { at: A, color: "accent", size: 0.1, label: `A ${vecLabel(A)}` });
  b.node("B", { at: B, color: "active", size: 0.1, label: `B ${vecLabel(B)}` });
  b.state.pts = { A, B };
  const C: Vec3 = [B[0], B[1], A[2]];
  return {
    facts: { A, B, distance: fmt(d), midpoint: M.map((c) => fmt(c)), differences: sub(B, A).map((c) => fmt(c)) },
    steps: [
      { caption: `Go from A to B: change in x ${fmt(B[0] - A[0])}, in y ${fmt(B[1] - A[1])}, in z ${fmt(B[2] - A[2])}`, apply: (bb) => bb.line("box", { points: [A, [B[0], A[1], A[2]], C, B], color: "muted", dashed: true }) },
      { caption: `Distance = √(${sub(B, A).map((c) => `${fmt(c)}²`).join(" + ")}) = ${fmt(d)}`, apply: (bb) => bb.line("AB", { points: [A, B], color: "done", width: 0.035 }) },
      { caption: `The midpoint averages the coordinates: ${vecLabel(M)}`, apply: (bb) => bb.node("M", { at: M, color: "warn", size: 0.09, label: `M ${vecLabel(M)}` }) },
    ],
    summary: `A to B is ${fmt(d)} long; the midpoint is ${vecLabel(M)}.`,
  };
}
export const pointsDistanceTemplate = defineTemplate({
  id: "points_distance_3d", domain: "math", family: "geometry", title: "Distance and midpoint in 3D",
  topics: ["distance between points", "midpoint", "3d coordinates", "distance formula"], schema: z.object({ A: Vec3S, B: Vec3S }), defaults: { A: [1, 2, 3], B: [4, 0, 1] },
  narrationHints: ["Pythagoras works in 3D: add the three squared differences.", "The midpoint is the average of the coordinates."], run: (b, a) => pts(b, a.A as Vec3, a.B as Vec3), actions: {},
});

// ── cross_section ───────────────────────────────────────────────────────────────────────────────
const CUBE: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
/** Where the plane n·p = d cuts a cube of side s: the section polygon, in order around its centre. */
export function section(n: Vec3, d: number, s: number): Vec3[] {
  const P = CUBE.map((c) => scale(c, s)), hits: Vec3[] = [];
  for (const [i, j] of EDGES) {
    const a = dot(n, P[i]) - d, b = dot(n, P[j]) - d;
    if (Math.abs(a) < 1e-12) hits.push(P[i]);
    if (a * b < 0) hits.push(add(P[i], scale(sub(P[j], P[i]), a / (a - b))));
  }
  const uniq = hits.filter((p, k) => hits.findIndex((q) => norm(sub(p, q)) < 1e-9) === k);
  if (uniq.length < 3) return uniq;
  const c = scale(uniq.reduce((m, p) => add(m, p), [0, 0, 0]), 1 / uniq.length), u = sub(uniq[0], c), w = cross(n, u);
  return uniq.sort((p, q) => Math.atan2(dot(sub(p, c), w), dot(sub(p, c), u)) - Math.atan2(dot(sub(q, c), w), dot(sub(q, c), u)));
}
const CSArgs = z.object({ normal: Vec3S.describe("The plane's normal vector [a, b, c]."), d: z.number().describe("Plane a x + b y + c z = d."), side: z.number().min(1).max(5).default(3) });
function cut(b: Board, a: z.infer<typeof CSArgs>): Result {
  b.clear();
  const s = a.side, n = a.normal as Vec3;
  b.solid("cube", { shape: "box", dims: [s, s, s], at: [s / 2, s / 2, s / 2], color: "muted", opacity: 0.25 });
  b.axes("axes", { size: s * 1.3 });
  b.fit([[0, 0, 0], [s, s, s]], "iso");
  b.state.cs = a;
  const poly = section(n, a.d, s);
  const shape = ["no section", "a point", "an edge", "a triangle", "a quadrilateral", "a pentagon", "a hexagon"][poly.length] ?? `${poly.length} sides`;
  return { facts: { plane: `${fmt(n[0])}x + ${fmt(n[1])}y + ${fmt(n[2])}z = ${fmt(a.d)}`, section: shape, vertices: poly.length }, steps: [{ caption: `The plane cuts the cube in ${shape}`, apply: async (bb, o) => { if (poly.length >= 3) { bb.polygon("sec", { points: poly, color: "warn", opacity: 0.6 }); await bb.pulse("sec", o); } } }], summary: `The plane cuts the cube in ${shape}.` };
}
export const crossSectionTemplate = defineTemplate({
  id: "cross_section", domain: "math", family: "geometry", title: "Cross-section of a cube",
  topics: ["cross section", "cross-section", "plane cuts a cube", "slice of a solid"], schema: CSArgs, defaults: { normal: [1, 1, 1], d: 4.5, side: 3 },
  narrationHints: ["A plane can cut a cube in a triangle, a quadrilateral, a pentagon or a hexagon."], run: (b, a) => cut(b, a),
  actions: { set_plane: { description: "Cut with another plane.", schema: z.object({ normal: Vec3S, d: z.number() }), run: (b, x) => cut(b, { ...(b.state.cs as z.infer<typeof CSArgs>), ...x }) } },
});

// ── net_unfold ──────────────────────────────────────────────────────────────────────────────────
// Cube net as a hinge tree: base, four sides on its edges, top on the back face. fold 1 = cube.
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function rotate(p: Vec3, a: Vec3, u: Vec3, th: number): Vec3 {
  const v = sub(p, a), c = Math.cos(th), s = Math.sin(th);
  return add(a, add(add(scale(v, c), scale(cross(u, v), s)), scale(u, dot(u, v) * (1 - c))));
}
export function cubeNet(s: number, fold: number): Vec3[][] {
  const faces = [
    { pts: rect(0, 0, s, s), parent: -1, hinge: [0, 0] }, { pts: rect(0, -s, s, 0), parent: 0, hinge: [3, 2] }, { pts: rect(0, s, s, 2 * s), parent: 0, hinge: [0, 1] },
    { pts: rect(-s, 0, 0, s), parent: 0, hinge: [1, 2] }, { pts: rect(s, 0, 2 * s, s), parent: 0, hinge: [0, 3] }, { pts: rect(0, 2 * s, s, 3 * s), parent: 2, hinge: [0, 1] },
  ];
  const T: ((p: Vec3) => Vec3)[] = [];
  faces.forEach((f, k) => {
    if (f.parent < 0) { T[k] = (p) => p; return; }
    const h = s / 2, A: Vec3 = [f.pts[f.hinge[0]][0] - h, f.pts[f.hinge[0]][1] - h, 0], B: Vec3 = [f.pts[f.hinge[1]][0] - h, f.pts[f.hinge[1]][1] - h, 0], u = scale(sub(B, A), 1 / norm(sub(B, A)));
    const cen = f.pts.reduce((m, p) => [m[0] + (p[0] - h) / 4, m[1] + (p[1] - h) / 4], [0, 0]);
    const sgn = Math.sign(u[0] * (cen[1] - A[1]) - u[1] * (cen[0] - A[0])) || 1, parent = T[f.parent];
    T[k] = (p) => parent(rotate(p, A, u, sgn * (Math.PI / 2) * fold));
  });
  return faces.map((f, k) => f.pts.map(([x, y]) => T[k]([x - s / 2, y - s / 2, 0])));
}
function net(b: Board, s: number): Result {
  b.clear();
  const draw = (fold: number, bb: Board) => cubeNet(s, fold).forEach((f, k) => bb.polygon(`f${k}`, { points: f, color: k ? "accent" : "active", opacity: 0.45 }));
  draw(1, b);
  b.fit([[-1.6 * s, -1.6 * s, 0], [1.6 * s, 2.6 * s, s]], "iso");
  return {
    facts: { solid: "cube", faces: 6, side: s, net: "cross (one of the 11 cube nets)", surface_area: 6 * s * s },
    steps: [
      { caption: "A cube has 6 square faces", apply: () => {} },
      { caption: "Unfold it: each face swings down about the edge it shares with its neighbour", apply: async (bb, o) => { await bb.tween(o.animate ? 2200 : 0, (t) => draw(1 - t, bb)); } },
      { caption: `Flat, it is a net of 6 squares; its area is the surface area, 6 × ${s}² = ${6 * s * s}`, apply: () => {} },
      { caption: "Fold it back up into the cube", apply: async (bb, o) => { await bb.tween(o.animate ? 2200 : 0, (t) => draw(t, bb)); } },
    ],
    summary: `A cube of side ${s} unfolding into its net (surface area ${6 * s * s}).`,
  };
}
export const netUnfoldTemplate = defineTemplate({
  id: "net_unfold", domain: "math", family: "geometry", title: "A cube unfolding to its net",
  topics: ["net", "net of a cube", "unfold", "fold up"], schema: z.object({ side: z.number().min(0.5).max(4).default(2) }), defaults: { side: 2 },
  narrationHints: ["A net is the solid opened out flat.", "Its area equals the solid's surface area."], run: (b, a) => net(b, a.side), actions: {},
});
