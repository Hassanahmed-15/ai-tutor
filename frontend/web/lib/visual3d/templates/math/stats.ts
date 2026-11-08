// Statistics in 3D: bivariate_normal (the density surface; correlation tilts the ellipses) and
// scatter_3d (points with a least-squares regression plane z = a + b x + c y).
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result } from "../../contract";
import type { Board, Vec3 } from "../../board3d/board";
import { fmt } from "../../expr";
import { det3 } from "./linear_transform";

const BNArgs = z.object({ mu: z.tuple([z.number().min(-3).max(3), z.number().min(-3).max(3)]).default([0, 0]), sigma: z.tuple([z.number().min(0.3).max(3), z.number().min(0.3).max(3)]).default([1, 1]), rho: z.number().min(-0.95).max(0.95).default(0.6) });
export const bvn = (mx: number, my: number, sx: number, sy: number, r: number) => (x: number, y: number) => {
  const u = (x - mx) / sx, v = (y - my) / sy, q = (u * u - 2 * r * u * v + v * v) / (1 - r * r);
  return Math.exp(-q / 2) / (2 * Math.PI * sx * sy * Math.sqrt(1 - r * r));
};
function bivar(b: Board, a: z.infer<typeof BNArgs>): Result {
  b.clear();
  const f = bvn(a.mu[0], a.mu[1], a.sigma[0], a.sigma[1], a.rho), peak = f(a.mu[0], a.mu[1]), k = 2.5 / peak, R = 3.2;
  b.surface("s", { f: (x, y) => f(x, y) * k, x: [a.mu[0] - R * a.sigma[0], a.mu[0] + R * a.sigma[0]], y: [a.mu[1] - R * a.sigma[1], a.mu[1] + R * a.sigma[1]], n: 48 });
  b.axes("axes", { size: 4, negative: true });
  b.label("k", { at: [a.mu[0] - 3, a.mu[1] + 3, 2.9], text: `density shown × ${fmt(k, 2)}`, color: "muted", small: true });
  b.fit([[-4, -4, 0], [4, 4, 2.8]], "iso");
  b.state.bn = a;
  return { facts: { means: a.mu, std_devs: a.sigma, correlation: a.rho, peak_density: fmt(peak), shape: a.rho === 0 ? "round hill (no correlation)" : a.rho > 0 ? "ridge along y = x direction (positive correlation)" : "ridge along y = −x direction (negative correlation)" }, steps: [], summary: `A bivariate normal hill centred at (${a.mu.join(", ")}) with correlation ${a.rho}.` };
}
export const bivariateTemplate = defineTemplate({
  id: "bivariate_normal", domain: "math", family: "statistics", title: "Bivariate normal distribution",
  topics: ["bivariate normal", "joint distribution", "joint density", "correlation surface"], schema: BNArgs, defaults: { mu: [0, 0], sigma: [1, 1], rho: 0.6 },
  narrationHints: ["The total volume under the hill is 1.", "Correlation stretches the hill along a diagonal."], run: (b, a) => bivar(b, a),
  actions: { set_rho: { description: "Change the correlation.", schema: z.object({ rho: z.number().min(-0.95).max(0.95) }), run: (b, { rho }) => bivar(b, { ...(b.state.bn as z.infer<typeof BNArgs>), rho }) } },
});

const ScArgs = z.object({ points: z.array(z.tuple([z.number(), z.number(), z.number()])).min(3).max(2000), plane: z.boolean().default(true) });
/** Least squares z = a + b x + c y by the normal equations (Cramer's rule). */
export function regressionPlane(P: Vec3[]): { a: number; b: number; c: number } | null {
  const n = P.length, S = (f: (p: Vec3) => number) => P.reduce((s, p) => s + f(p), 0);
  const M = [[n, S((p) => p[0]), S((p) => p[1])], [S((p) => p[0]), S((p) => p[0] ** 2), S((p) => p[0] * p[1])], [S((p) => p[1]), S((p) => p[0] * p[1]), S((p) => p[1] ** 2)]];
  const v = [S((p) => p[2]), S((p) => p[0] * p[2]), S((p) => p[1] * p[2])], D = det3(M);
  if (Math.abs(D) < 1e-9) return null;
  const col = (k: number) => det3(M.map((r, i) => r.map((x, j) => (j === k ? v[i] : x))));
  return { a: col(0) / D, b: col(1) / D, c: col(2) / D };
}
function scatter(b: Board, a: z.infer<typeof ScArgs>): Result {
  const P = a.points as Vec3[];
  b.clear();
  const span = Math.max(...P.flat().map(Math.abs), 1);
  b.axes("axes", { size: span * 1.15, negative: true });
  b.points("pts", { points: P, color: "accent", size: 0.06 * Math.max(1, span / 4) });
  b.fit(P, "iso");
  const fit = a.plane ? regressionPlane(P) : null;
  if (a.plane && !fit) throw new VisualError("These points do not pin down a plane (they lie on a line); add more spread.");
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const steps = fit ? [{ caption: `The best-fit plane: z = ${fmt(fit.a)} + ${fmt(fit.b)}x + ${fmt(fit.c)}y`, apply: (bb: Board) => {
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], z = (x: number, y: number) => fit.a + fit.b * x + fit.c * y;
    bb.polygon("plane", { points: [[x0, y0, z(x0, y0)], [x1, y0, z(x1, y0)], [x1, y1, z(x1, y1)], [x0, y1, z(x0, y1)]], color: "active", opacity: 0.35 });
  } }] : [];
  let ssr = 0;
  if (fit) for (const p of P) ssr += (p[2] - (fit.a + fit.b * p[0] + fit.c * p[1])) ** 2;
  return { facts: { points: P.length, ...(fit ? { plane: `z = ${fmt(fit.a)} + ${fmt(fit.b)}x + ${fmt(fit.c)}y`, residual_sum_of_squares: fmt(ssr) } : {}) }, steps, summary: `${P.length} points in 3D${fit ? ` with the best-fit plane z = ${fmt(fit.a)} + ${fmt(fit.b)}x + ${fmt(fit.c)}y` : ""}.` };
}
export const scatterTemplate = defineTemplate({
  id: "scatter_3d", domain: "math", family: "statistics", title: "3D scatter and regression plane",
  topics: ["3d scatter", "regression plane", "multiple regression", "least squares plane"], schema: ScArgs,
  defaults: { points: [[1, 1, 3.1], [2, 1, 4.2], [3, 2, 6.8], [1, 3, 5.9], [2, 3, 7.2], [3, 3, 8.1], [0, 2, 3.9], [2, 0, 2.8], [3, 1, 5.2], [1, 2, 4.8]], plane: true },
  narrationHints: ["The plane makes the squared vertical misses as small as possible."], run: (b, a) => scatter(b, a), actions: {},
});
