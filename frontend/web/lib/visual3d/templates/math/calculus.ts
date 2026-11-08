// Multivariable calculus templates on a surface z = f(x, y) (safe parser): surface_slices (partial
// derivatives as slices), gradient_on_surface (gradient arrows and level curves projected below)
// and gradient_descent_surface (an optimiser walking downhill; the learning rate can overshoot).
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract";
import type { Board, Vec3 } from "../../board3d/board";
import { fmt } from "../../expr";
import { surfaceFunction } from "./surface_plot";

type F = (x: number, y: number) => number;
const H = 1e-4;
export const partials = (f: F, x: number, y: number): [number, number] => [(f(x + H, y) - f(x - H, y)) / (2 * H), (f(x, y + H) - f(x, y - H)) / (2 * H)];
const Expr = z.string().min(1).max(200).describe('z as a function of x and y, e.g. "x^2 + y^2".');

/** Draw the surface; tall ones are squashed so the shape stays readable. Returns the height scale. */
function stage(b: Board, f: F, range: number, opacity: number): number {
  b.clear();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 30; i++) for (let j = 0; j <= 30; j++) { const v = f(-range + (2 * range * i) / 30, -range + (2 * range * j) / 30); if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v)); }
  const zr = Math.max(Math.abs(lo), Math.abs(hi), 1), k = Math.min(1, (range * 1.3) / zr);
  b.surface("s", { f: (x, y) => f(x, y) * k, x: [-range, range], y: [-range, range], n: 40, opacity, zClip: range * 3 });
  b.axes("axes", { size: range * 1.25, negative: true });
  if (k < 1) b.label("scale", { at: [-range, range, hi * k + 0.3], text: `heights shown × ${fmt(k, 2)}`, color: "muted", small: true });
  b.fit([[range, range, Math.max(hi * k, 0.5)], [-range, -range, Math.min(lo * k, -0.5)]], "iso");
  return k;
}

/** Level-curve segments of f at the given levels, by marching squares on a grid, drawn at height zf. */
export function levelSegments(f: F, range: number, levels: number[], zf: number, n = 48): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  const g = (i: number) => -range + (2 * range * i) / n;
  for (const L of levels) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const c = [[g(i), g(j)], [g(i + 1), g(j)], [g(i + 1), g(j + 1)], [g(i), g(j + 1)]];
    const v = c.map(([x, y]) => f(x, y) - L);
    const pts: Vec3[] = [];
    for (let k = 0; k < 4; k++) {
      const a = v[k], bq = v[(k + 1) % 4];
      if ((a > 0) !== (bq > 0) && Number.isFinite(a) && Number.isFinite(bq)) {
        const t = a / (a - bq), [x0, y0] = c[k], [x1, y1] = c[(k + 1) % 4];
        pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, zf]);
      }
    }
    if (pts.length >= 2) out.push([pts[0], pts[1]]);
    if (pts.length === 4) out.push([pts[2], pts[3]]);
  }
  return out;
}

// ── surface_slices ──────────────────────────────────────────────────────────────────────────────
const SliceArgs = z.object({ expr: Expr, at: z.tuple([z.number(), z.number()]).describe("The point (x0, y0) to slice through."), range: z.number().min(1).max(6).default(2) });
function slices(b: Board, a: z.infer<typeof SliceArgs>): Result {
  const f = surfaceFunction(a.expr), [x0, y0] = a.at;
  if (Math.abs(x0) > a.range || Math.abs(y0) > a.range) throw new VisualError(`(${x0}, ${y0}) is outside the plotted square (±${a.range}).`);
  const k = stage(b, f, a.range, 0.55);
  b.state.slices = a;
  const z0 = f(x0, y0), [fx, fy] = partials(f, x0, y0);
  const curve = (dir: "x" | "y"): Vec3[] => Array.from({ length: 61 }, (_, i) => { const s = -a.range + (2 * a.range * i) / 60; return dir === "x" ? [s, y0, f(s, y0) * k] : [x0, s, f(x0, s) * k]; });
  b.node("P", { at: [x0, y0, z0 * k], color: "warn", size: 0.09, label: `(${fmt(x0)}, ${fmt(y0)}, ${fmt(z0)})` });
  const t = 0.8;
  const steps: Step[] = [
    { caption: `Hold y = ${fmt(y0)} and slice: this curve shows how z changes with x`, apply: (bb) => bb.line("cx", { points: curve("x"), color: "x", width: 0.03 }) },
    { caption: `Its slope at the point is ∂f/∂x = ${fmt(fx)}`, apply: (bb) => bb.line("tx", { points: [[x0 - t, y0, (z0 - t * fx) * k], [x0 + t, y0, (z0 + t * fx) * k]], color: "x", width: 0.045 }) },
    { caption: `Now hold x = ${fmt(x0)}: the y-slice`, apply: (bb) => bb.line("cy", { points: curve("y"), color: "y", width: 0.03 }) },
    { caption: `Its slope is ∂f/∂y = ${fmt(fy)}`, apply: (bb) => bb.line("ty", { points: [[x0, y0 - t, (z0 - t * fy) * k], [x0, y0 + t, (z0 + t * fy) * k]], color: "y", width: 0.045 }) },
  ];
  return { facts: { expr: a.expr, point: [x0, y0], z: fmt(z0), df_dx: fmt(fx), df_dy: fmt(fy) }, steps, summary: `At (${fmt(x0)}, ${fmt(y0)}): ∂f/∂x = ${fmt(fx)}, ∂f/∂y = ${fmt(fy)}.` };
}
export const surfaceSlicesTemplate = defineTemplate({
  id: "surface_slices", domain: "math", family: "multivariable_calculus", title: "Partial derivatives as slices",
  topics: ["partial derivative", "partial derivatives", "slice", "holding y constant"], schema: SliceArgs,
  defaults: { expr: "x^2 + x y - y^2 / 2", at: [0.8, 0.5], range: 2 },
  narrationHints: ["A partial derivative is the slope of one slice.", "∂f/∂x holds y fixed."],
  run: (b, a) => slices(b, a),
  actions: { move_point: { description: "Slice through another point.", schema: z.object({ x: z.number(), y: z.number() }), run: (b, { x, y }) => slices(b, { ...(b.state.slices as z.infer<typeof SliceArgs>), at: [x, y] }) } },
});

// ── gradient_on_surface ─────────────────────────────────────────────────────────────────────────
const GradArgs = z.object({ expr: Expr, range: z.number().min(1).max(6).default(2), at: z.tuple([z.number(), z.number()]).optional() });
function gradient(b: Board, a: z.infer<typeof GradArgs>): Result {
  const f = surfaceFunction(a.expr);
  const k = stage(b, f, a.range, 0.7);
  b.state.grad = a;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 30; i++) for (let j = 0; j <= 30; j++) { const v = f(-a.range + (2 * a.range * i) / 30, -a.range + (2 * a.range * j) / 30); if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v)); }
  const floor = lo * k - 0.8, levels = Array.from({ length: 7 }, (_, k) => lo + ((hi - lo) * (k + 0.5)) / 7);
  const arrows: [Vec3, Vec3][] = [];
  const step = a.range / 3;
  for (let x = -a.range + step / 2; x < a.range; x += step) for (let y = -a.range + step / 2; y < a.range; y += step) {
    const [gx, gy] = partials(f, x, y), m = Math.hypot(gx, gy) || 1, s = Math.min(step * 0.8, 0.25 * m) / m;
    arrows.push([[x, y, floor], [x + gx * s, y + gy * s, floor]]);
  }
  const [px, py] = a.at ?? [a.range * 0.4, a.range * 0.3];
  const [gx, gy] = partials(f, px, py);
  const steps: Step[] = [
    { caption: "Level curves: every point on one curve has the same height", apply: (bb) => bb.segments("lv", { pairs: levelSegments(f, a.range, levels, floor), color: "accent" }) },
    { caption: "The gradient arrows point uphill, at right angles to the level curves", apply: (bb) => bb.segments("ga", { pairs: arrows, color: "active" }) },
    { caption: `At (${fmt(px)}, ${fmt(py)}), ∇f = (${fmt(gx)}, ${fmt(gy)}): the steepest way up`, apply: async (bb, o) => {
      const z0 = f(px, py) * k, m = Math.hypot(gx, gy) || 1, len = Math.min(1.2, m * 0.4) / m;
      bb.node("P", { at: [px, py, z0], color: "warn", size: 0.08 });
      bb.arrow("g", { from: [px, py, z0], to: [px + gx * len, py + gy * len, z0], color: "done", label: "∇f (uphill)" });
      await bb.pulse("g", o);
    } },
  ];
  return { facts: { expr: a.expr, point: [px, py], gradient: [fmt(gx), fmt(gy)], steepest_slope: fmt(Math.hypot(gx, gy)) }, steps, summary: `∇f at (${fmt(px)}, ${fmt(py)}) is (${fmt(gx)}, ${fmt(gy)}).` };
}
export const gradientTemplate = defineTemplate({
  id: "gradient_on_surface", domain: "math", family: "multivariable_calculus", title: "Gradient and level curves",
  topics: ["gradient", "level curves", "contour", "steepest ascent", "directional derivative"], schema: GradArgs,
  defaults: { expr: "x^2 + 2y^2", range: 2 }, narrationHints: ["The gradient is perpendicular to the level curves.", "Its length is the steepest slope."],
  run: (b, a) => gradient(b, a),
  actions: { move_point: { description: "Show the gradient at another point.", schema: z.object({ x: z.number(), y: z.number() }), run: (b, { x, y }) => gradient(b, { ...(b.state.grad as z.infer<typeof GradArgs>), at: [x, y] }) } },
});

// ── gradient_descent_surface ────────────────────────────────────────────────────────────────────
const GDArgs = z.object({ expr: Expr.default("x^2 + 3y^2"), start: z.tuple([z.number(), z.number()]).default([1.8, 1.4]), learning_rate: z.number().min(0.001).max(2).default(0.1), steps: z.number().int().min(1).max(60).default(20), range: z.number().min(1).max(6).default(2) });
export function descend(f: F, start: [number, number], lr: number, n: number) {
  const path: [number, number, number][] = [[start[0], start[1], f(...start)]];
  for (let k = 0; k < n; k++) {
    const [x, y] = path[path.length - 1], [gx, gy] = partials(f, x, y);
    const nx = x - lr * gx, ny = y - lr * gy, v = f(nx, ny);
    if (!Number.isFinite(v) || Math.abs(nx) > 1e6) break;
    path.push([nx, ny, v]);
  }
  const loss = path.map((p) => p[2]);
  const rose = loss.some((v, k) => k > 0 && v > loss[k - 1] + 1e-12);
  return { path, final: path[path.length - 1], diverged: Math.abs(loss[loss.length - 1]) > Math.abs(loss[0]) * 2 || rose, converged: Math.hypot(...partials(f, path[path.length - 1][0], path[path.length - 1][1])) < 1e-3 };
}
function gd(b: Board, a: z.infer<typeof GDArgs>): Result {
  const f = surfaceFunction(a.expr);
  const k = stage(b, f, a.range, 0.6);
  b.state.gd = a;
  const r = descend(f, a.start, a.learning_rate, a.steps);
  const clip = (p: [number, number, number]): Vec3 => { const x = Math.max(-a.range, Math.min(a.range, p[0])), y = Math.max(-a.range, Math.min(a.range, p[1])); return [x, y, f(x, y) * k + 0.05]; };
  b.node("ball", { at: clip(r.path[0]), color: "warn", size: 0.11, label: "start" });
  const steps: Step[] = r.path.slice(1).map((p, k) => ({
    caption: `Step ${k + 1}: move against the gradient by ${a.learning_rate} × slope → loss ${fmt(p[2])}`,
    apply: async (bb, o) => {
      bb.line(`seg${k}`, { points: [clip(r.path[k]), clip(p)], color: "warn", width: 0.025 });
      await bb.move("ball", clip(p), { ...o, ms: 220 });
      bb.setLabel("ball", `loss ${fmt(p[2])}`);
    },
  }));
  return {
    facts: { expr: a.expr, learning_rate: a.learning_rate, steps: r.path.length - 1, start_loss: fmt(r.path[0][2]), final_loss: fmt(r.final[2]), final_point: [fmt(r.final[0]), fmt(r.final[1])], converged: r.converged, overshoot: r.diverged },
    steps, summary: r.diverged ? `With learning rate ${a.learning_rate} the steps overshoot and the loss grows.` : `Gradient descent goes from loss ${fmt(r.path[0][2])} to ${fmt(r.final[2])} in ${r.path.length - 1} steps.`,
  };
}
export const gradientDescentTemplate = defineTemplate({
  id: "gradient_descent_surface", domain: "cs", family: "machine_learning", title: "Gradient descent on a loss surface",
  topics: ["gradient descent", "learning rate", "loss surface", "optimizer", "overshoot"], schema: GDArgs,
  defaults: { expr: "x^2 + 3y^2", start: [1.8, 1.4], learning_rate: 0.1, steps: 20, range: 2 },
  narrationHints: ["Each step moves downhill, against the gradient.", "Too big a learning rate overshoots the valley."],
  run: (b, a) => gd(b, a),
  actions: {
    set_learning_rate: { description: "Run again with another learning rate.", schema: z.object({ learning_rate: z.number().min(0.001).max(2) }), run: (b, { learning_rate }) => gd(b, { ...(b.state.gd as z.infer<typeof GDArgs>), learning_rate }) },
    set_start: { description: "Start from another point.", schema: z.object({ x: z.number(), y: z.number() }), run: (b, { x, y }) => gd(b, { ...(b.state.gd as z.infer<typeof GDArgs>), start: [x, y] }) },
  },
});
