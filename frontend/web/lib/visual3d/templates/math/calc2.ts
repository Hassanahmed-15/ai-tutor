// More multivariable calculus: tangent_plane, double_integral_volume (Riemann boxes; n adjustable),
// parametric_curve_3d (r(t) with a moving point and its velocity) and vector_field_3d.
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract";
import type { Board, Vec3 } from "../../board3d/board";
import { compile, fmt } from "../../expr";
import { surfaceFunction } from "./surface_plot";
import { partials } from "./calculus";

const Expr = z.string().min(1).max(200);
const fnOf = (src: string, vars: string[]) => { try { return compile(src, vars); } catch (e) { throw new VisualError(`I can't use "${src}": ${(e as Error).message}`); } };

// ── tangent_plane ───────────────────────────────────────────────────────────────────────────────
const TPArgs = z.object({ expr: Expr, at: z.tuple([z.number(), z.number()]), range: z.number().min(1).max(5).default(2) });
function tangent(b: Board, a: z.infer<typeof TPArgs>): Result {
  const f = surfaceFunction(a.expr), [x0, y0] = a.at, z0 = f(x0, y0), [fx, fy] = partials(f, x0, y0);
  if (!Number.isFinite(z0)) throw new VisualError(`f is undefined at (${x0}, ${y0}).`);
  b.clear();
  b.surface("s", { f, x: [-a.range, a.range], y: [-a.range, a.range], n: 40, opacity: 0.6, zClip: a.range * 3 });
  b.axes("axes", { size: a.range * 1.2, negative: true });
  b.fit([[a.range, a.range, z0 + 1], [-a.range, -a.range, z0 - 2]], "iso");
  b.state.tp = a;
  const L = (x: number, y: number) => z0 + fx * (x - x0) + fy * (y - y0), h = 0.9;
  return {
    facts: { expr: a.expr, point: [x0, y0, fmt(z0)], df_dx: fmt(fx), df_dy: fmt(fy), plane: `z = ${fmt(z0)} + ${fmt(fx)}(x − ${fmt(x0)}) + ${fmt(fy)}(y − ${fmt(y0)})` },
    steps: [
      { caption: `The point (${fmt(x0)}, ${fmt(y0)}, ${fmt(z0)}) on the surface`, apply: (bb) => bb.node("P", { at: [x0, y0, z0], color: "warn", size: 0.08 }) },
      { caption: `The tangent plane uses both slopes: ∂f/∂x = ${fmt(fx)} and ∂f/∂y = ${fmt(fy)}`, apply: (bb) => bb.polygon("tp", { points: [[x0 - h, y0 - h, L(x0 - h, y0 - h)], [x0 + h, y0 - h, L(x0 + h, y0 - h)], [x0 + h, y0 + h, L(x0 + h, y0 + h)], [x0 - h, y0 + h, L(x0 - h, y0 + h)]], color: "active", opacity: 0.55 }) },
      { caption: "Close to the point, the plane and the surface are almost the same: a linear approximation", apply: async (bb, o) => { await bb.pulse("tp", o); } },
    ],
    summary: `Tangent plane at (${fmt(x0)}, ${fmt(y0)}): z = ${fmt(z0)} + ${fmt(fx)}(x − ${fmt(x0)}) + ${fmt(fy)}(y − ${fmt(y0)}).`,
  };
}
export const tangentPlaneTemplate = defineTemplate({
  id: "tangent_plane", domain: "math", family: "multivariable_calculus", title: "Tangent plane",
  topics: ["tangent plane", "linear approximation", "linearisation"], schema: TPArgs, defaults: { expr: "x^2 + y^2", at: [1, 0.5], range: 2 },
  narrationHints: ["The tangent plane touches the surface at one point.", "Its tilt comes from the two partial derivatives."], run: (b, a) => tangent(b, a),
  actions: { move_point: { description: "Touch at another point.", schema: z.object({ x: z.number(), y: z.number() }), run: (b, { x, y }) => tangent(b, { ...(b.state.tp as z.infer<typeof TPArgs>), at: [x, y] }) } },
});

// ── double_integral_volume ──────────────────────────────────────────────────────────────────────
const DIArgs = z.object({ expr: Expr, x: z.tuple([z.number(), z.number()]).default([0, 2]), y: z.tuple([z.number(), z.number()]).default([0, 2]), n: z.number().int().min(1).max(12).default(4).describe("Boxes along each side.") });
export function riemann(f: (x: number, y: number) => number, X: [number, number], Y: [number, number], n: number) {
  const dx = (X[1] - X[0]) / n, dy = (Y[1] - Y[0]) / n, boxes: { x: number; y: number; h: number }[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = X[0] + (i + 0.5) * dx, y = Y[0] + (j + 0.5) * dy, h = f(x, y); boxes.push({ x, y, h }); sum += h * dx * dy; }
  // A fine Simpson grid as the reference value.
  const m = 60, hx = (X[1] - X[0]) / m, hy = (Y[1] - Y[0]) / m, w = (k: number) => (k === 0 || k === m ? 1 : k % 2 ? 4 : 2);
  let exact = 0;
  for (let i = 0; i <= m; i++) for (let j = 0; j <= m; j++) exact += w(i) * w(j) * f(X[0] + i * hx, Y[0] + j * hy);
  return { boxes, dx, dy, estimate: sum, exact: (exact * hx * hy) / 9 };
}
function volume(b: Board, a: z.infer<typeof DIArgs>): Result {
  const f = surfaceFunction(a.expr), r = riemann(f, a.x, a.y, a.n);
  b.clear();
  b.surface("s", { f, x: a.x, y: a.y, n: 30, opacity: 0.45 });
  b.axes("axes", { size: Math.max(...a.x.map(Math.abs), ...a.y.map(Math.abs)) * 1.3 });
  const top = Math.max(...r.boxes.map((q) => q.h), 1);
  b.fit([[a.x[0], a.y[0], 0], [a.x[1], a.y[1], top]], "iso");
  b.state.di = a;
  return {
    facts: { expr: a.expr, region: `${a.x[0]} ≤ x ≤ ${a.x[1]}, ${a.y[0]} ≤ y ≤ ${a.y[1]}`, boxes: a.n * a.n, estimate: fmt(r.estimate, 4), volume: fmt(r.exact, 4), error: fmt(Math.abs(r.estimate - r.exact), 3) },
    steps: [
      { caption: `Split the base into ${a.n * a.n} squares; each box is as tall as f at its centre`, apply: (bb) => r.boxes.forEach((q, k) => bb.box(`b${k}`, { at: [q.x, q.y, q.h / 2], size: [r.dx * 0.96, r.dy * 0.96, Math.max(Math.abs(q.h), 0.01)], color: q.h >= 0 ? "accent" : "warn", opacity: 0.6 })) },
      { caption: `Adding the boxes gives ${fmt(r.estimate, 4)}; the true volume is ${fmt(r.exact, 4)}`, apply: () => {} },
      { caption: "More, thinner boxes get closer: that limit is the double integral", apply: () => {} },
    ],
    summary: `With ${a.n}×${a.n} boxes the volume is about ${fmt(r.estimate, 4)} (true value ${fmt(r.exact, 4)}).`,
  };
}
export const doubleIntegralTemplate = defineTemplate({
  id: "double_integral_volume", domain: "math", family: "multivariable_calculus", title: "Double integral as volume",
  topics: ["double integral", "volume under a surface", "riemann boxes", "iterated integral"], schema: DIArgs, defaults: { expr: "4 - x^2/2 - y^2/2", x: [0, 2], y: [0, 2], n: 4 },
  narrationHints: ["Each box is base area × height.", "As the boxes get thinner, their total tends to the integral."], run: (b, a) => volume(b, a),
  actions: { set_n: { description: "Use more or fewer boxes.", schema: z.object({ n: z.number().int().min(1).max(12) }), run: (b, { n }) => volume(b, { ...(b.state.di as z.infer<typeof DIArgs>), n }) } },
});

// ── parametric_curve_3d ─────────────────────────────────────────────────────────────────────────
const PCArgs = z.object({ x: Expr, y: Expr, z: Expr, t: z.tuple([z.number(), z.number()]).default([0, 12.57]).describe("t from … to …") });
function curve(b: Board, a: z.infer<typeof PCArgs>): Result {
  const X = fnOf(a.x, ["t"]), Y = fnOf(a.y, ["t"]), Z = fnOf(a.z, ["t"]);
  const at = (t: number): Vec3 => [X(t), Y(t), Z(t)];
  const pts = Array.from({ length: 241 }, (_, k) => at(a.t[0] + ((a.t[1] - a.t[0]) * k) / 240));
  if (!pts.every((p) => p.every(Number.isFinite) && p.every((c) => Math.abs(c) < 50))) throw new VisualError("The curve leaves the board (or is undefined) somewhere on this t range.");
  b.clear();
  b.axes("axes", { size: Math.max(2, ...pts.flat().map(Math.abs)) * 1.1, negative: true });
  b.line("c", { points: pts, color: "accent", width: 0.03 });
  b.fit(pts, "iso");
  b.state.pc = a;
  const vel = (t: number): Vec3 => { const h = 1e-4, p = at(t + h), q = at(t - h); return [(p[0] - q[0]) / (2 * h), (p[1] - q[1]) / (2 * h), (p[2] - q[2]) / (2 * h)]; };
  const marks = [0.15, 0.45, 0.8].map((u) => a.t[0] + (a.t[1] - a.t[0]) * u);
  const steps: Step[] = marks.map((t, k) => ({ caption: `At t = ${fmt(t)}: the point ${fmt(at(t)[0])}, ${fmt(at(t)[1])}, ${fmt(at(t)[2])}; velocity r′(t) points along the curve`, apply: async (bb, o) => {
    if (bb.has("P")) await bb.move("P", at(t), o); else bb.node("P", { at: at(t), color: "warn", size: 0.1 });
    const v = vel(t), s = 0.8 / (Math.hypot(...v) || 1);
    bb.arrow("v", { from: at(t), to: [at(t)[0] + v[0] * s, at(t)[1] + v[1] * s, at(t)[2] + v[2] * s], color: "done", label: k === 0 ? "r′(t)" : undefined });
  } }));
  let length = 0;
  for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]);
  return { facts: { r: `(${a.x}, ${a.y}, ${a.z})`, t_range: a.t, start: at(a.t[0]).map((c) => fmt(c)), end: at(a.t[1]).map((c) => fmt(c)), arc_length: fmt(length) }, steps, summary: `The curve r(t) = (${a.x}, ${a.y}, ${a.z}) for t from ${a.t[0]} to ${a.t[1]}; length about ${fmt(length)}.` };
}
export const parametricTemplate = defineTemplate({
  id: "parametric_curve_3d", domain: "math", family: "multivariable_calculus", title: "A curve in space r(t)",
  topics: ["helix", "space curve", "parametric curve", "r(t)", "velocity vector"], schema: PCArgs, defaults: { x: "cos(t)", y: "sin(t)", z: "t/4", t: [0, 12.57] },
  narrationHints: ["Each value of t gives one point.", "r′(t) is the velocity: it is tangent to the curve."], run: (b, a) => curve(b, a), actions: {},
});

// ── vector_field_3d ─────────────────────────────────────────────────────────────────────────────
const VFArgs = z.object({ P: Expr, Q: Expr, R: Expr, range: z.number().min(1).max(4).default(2), step: z.number().min(0.4).max(2).default(1) });
function field(b: Board, a: z.infer<typeof VFArgs>): Result {
  const F = [a.P, a.Q, a.R].map((e) => fnOf(e, ["x", "y", "z"]));
  const pairs: [Vec3, Vec3][] = [];
  let maxLen = 0;
  const samples: { p: Vec3; v: Vec3 }[] = [];
  for (let x = -a.range; x <= a.range + 1e-9; x += a.step) for (let y = -a.range; y <= a.range + 1e-9; y += a.step) for (let z = -a.range; z <= a.range + 1e-9; z += a.step) {
    const v = F.map((f) => f(x, y, z)) as Vec3;
    if (!v.every(Number.isFinite)) continue;
    samples.push({ p: [x, y, z], v });
    maxLen = Math.max(maxLen, Math.hypot(...v));
  }
  if (samples.length > 400) throw new VisualError("Too many arrows: use a bigger step or a smaller range.");
  const k = (a.step * 0.8) / (maxLen || 1);
  for (const { p, v } of samples) pairs.push([p, [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k]]);
  b.clear();
  b.axes("axes", { size: a.range * 1.3, negative: true });
  b.segments("field", { pairs, color: "accent" });
  b.points("tails", { points: samples.map((s) => s.p), color: "muted", size: 0.03 });
  b.fit([[-a.range, -a.range, -a.range], [a.range, a.range, a.range]], "iso");
  return { facts: { F: `(${a.P}, ${a.Q}, ${a.R})`, arrows: samples.length, strongest: fmt(maxLen) }, steps: [], summary: `The field F = (${a.P}, ${a.Q}, ${a.R}) drawn as ${samples.length} arrows (scaled to fit).` };
}
export const vectorFieldTemplate = defineTemplate({
  id: "vector_field_3d", domain: "math", family: "multivariable_calculus", title: "A vector field in 3D",
  topics: ["vector field", "curl", "divergence", "flow"], schema: VFArgs, defaults: { P: "-y", Q: "x", R: "0.3", range: 2, step: 1 },
  narrationHints: ["At every point the field gives an arrow.", "Arrows are scaled so the longest fits the grid."], run: (b, a) => field(b, a), actions: {},
});
