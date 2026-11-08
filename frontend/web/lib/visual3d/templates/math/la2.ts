// More linear algebra: eigenvectors_3d (real eigenpairs of a 3×3, checked Av = λv), span_basis
// (rank → line / plane / all of space) and planes_system (three planes: point, line or nothing).
import { z } from "zod/v4";
import { defineTemplate, type Result, type Step } from "../../contract.ts";
import { cross, norm, scale, sub, add, type Board, type Vec3 } from "../../board3d/board.ts";
import { vecLabel, vectorStage } from "../../board3d/helpers.ts";
import { fmt } from "../../expr.ts";
import { Matrix3S, Vec3S } from "../shared.ts";
import { apply3, det3, type M3 } from "./linear_transform.ts";

/** Real roots of x³ + a x² + b x + c by bracketing and bisection (robust for school matrices). */
function cubicRoots(a: number, b: number, c: number): number[] {
  const f = (x: number) => ((x + a) * x + b) * x + c;
  const R = 1 + Math.max(Math.abs(a), Math.abs(b), Math.abs(c)), out: number[] = [];
  const N = 4000;
  for (let k = 0; k < N; k++) {
    let lo = -R + (2 * R * k) / N, hi = lo + (2 * R) / N;
    const flo = f(lo), fhi = f(hi);
    if (Math.abs(flo) < 1e-10) { out.push(lo); continue; }
    if (flo * fhi < 0) { for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; } out.push((lo + hi) / 2); }
  }
  // Double roots touch zero without a sign change: also check where f' = 0.
  const disc = 4 * a * a - 12 * b;
  if (disc >= 0) for (const x of [(-2 * a + Math.sqrt(disc)) / 6, (-2 * a - Math.sqrt(disc)) / 6]) if (Math.abs(f(x)) < 1e-7) out.push(x);
  // Snap to a nearby whole or simple value when it is an exact root, then merge near-duplicates
  // (a flat triple root makes bisection report several points a hair apart).
  const snap = (x: number) => { for (const q of [1, 2, 3, 4, 5, 6, 8, 10]) { const r = Math.round(x * q) / q; if (Math.abs(r - x) < 1e-3 && Math.abs(f(r)) < 1e-9) return r; } return x; };
  const uniq: number[] = [];
  for (const x of out.map(snap).sort((p, q) => p - q)) if (!uniq.some((u) => Math.abs(u - x) < 1e-4)) uniq.push(Math.round(x * 1e9) / 1e9);
  return uniq;
}

/** Real eigenpairs of A; each eigenvector is a unit vector spanning the null space of A − λI. */
export function eigen3(A: M3): { value: number; vector: Vec3 }[] {
  const tr = A[0][0] + A[1][1] + A[2][2];
  const m2 = A[0][0] * A[1][1] - A[0][1] * A[1][0] + A[0][0] * A[2][2] - A[0][2] * A[2][0] + A[1][1] * A[2][2] - A[1][2] * A[2][1];
  const out: { value: number; vector: Vec3 }[] = [];
  for (const l of cubicRoots(-tr, m2, -det3(A))) {
    const B = A.map((r, i) => r.map((x, j) => x - (i === j ? l : 0))) as unknown as Vec3[];
    const cands = [cross(B[0], B[1]), cross(B[0], B[2]), cross(B[1], B[2])].sort((p, q) => norm(q) - norm(p));
    let v = cands[0];
    if (norm(v) < 1e-9) {
      // A repeated eigenvalue: B has rank ≤ 1, so pick vectors perpendicular to its non-zero row.
      const row = B.find((r) => norm(r) > 1e-9);
      if (!row) { for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) out.push({ value: l, vector: e }); continue; }
      const e = Math.abs(row[0]) < 0.9 ? [1, 0, 0] as Vec3 : [0, 1, 0] as Vec3;
      v = cross(row, e);
      out.push({ value: l, vector: scale(v, 1 / norm(v)) });
      v = cross(row, v);
    }
    out.push({ value: l, vector: scale(v, 1 / norm(v)) });
  }
  return out;
}

function eigScene(b: Board, A: M3): Result {
  b.clear();
  const pairs = eigen3(A);
  const tips = pairs.map((p) => scale(p.vector, 2));
  vectorStage(b, [...tips, ...tips.map((t) => scale(t, -1)), [2, 2, 2]]);
  b.state.eig = A;
  const steps: Step[] = pairs.map((p, k) => ({
    caption: `λ = ${fmt(p.value)}: A sends v = ${vecLabel(p.vector)} to ${fmt(p.value)}v; it stays on its own line`,
    apply: async (bb, o) => {
      bb.line(`ln${k}`, { points: [scale(p.vector, -3), scale(p.vector, 3)], color: "muted", dashed: true });
      bb.arrow(`v${k}`, { from: [0, 0, 0], to: scale(p.vector, 1.5), color: (["accent", "active", "done"] as const)[k % 3], label: `v${k + 1}` });
      await bb.tween(o.animate ? 900 : 0, (t) => bb.arrow(`Av${k}`, { from: [0, 0, 0], to: scale(p.vector, 1.5 * (1 + (p.value - 1) * t)), color: "warn", label: t > 0.99 ? `Av${k + 1} = ${fmt(p.value)}v${k + 1}` : undefined, width: 0.02 }));
    },
  }));
  if (!pairs.length) steps.push({ caption: "This matrix has no real eigenvectors: every direction is turned", apply: () => {} });
  return { facts: { matrix: A, eigenvalues: pairs.map((p) => fmt(p.value)), eigenvectors: pairs.map((p) => p.vector.map((c) => fmt(c))), real_pairs: pairs.length }, steps, summary: pairs.length ? `Eigenvalues ${pairs.map((p) => fmt(p.value)).join(", ")}.` : "No real eigenvalues." };
}
export const eigenTemplate = defineTemplate({
  id: "eigenvectors_3d", domain: "math", family: "linear_algebra", title: "Eigenvectors of a 3×3 matrix",
  topics: ["eigenvector", "eigenvalue", "characteristic polynomial", "Av = λv"], schema: z.object({ matrix: Matrix3S }),
  defaults: { matrix: [[2, 1, 0], [1, 2, 0], [0, 0, 3]] }, narrationHints: ["An eigenvector only gets stretched, never turned.", "Its eigenvalue is the stretch factor."],
  run: (b, a) => eigScene(b, a.matrix), actions: { set_matrix: { description: "Use another matrix.", schema: z.object({ matrix: Matrix3S }), run: (b, a) => eigScene(b, a.matrix) } },
});

// ── span_basis ──────────────────────────────────────────────────────────────────────────────────
export function rank(vs: Vec3[]): number {
  const m = vs.map((v) => [...v]);
  let r = 0;
  for (let c = 0; c < 3 && r < m.length; c++) {
    const p = m.slice(r).findIndex((row) => Math.abs(row[c]) > 1e-9);
    if (p < 0) continue;
    [m[r], m[r + p]] = [m[r + p], m[r]];
    for (let i = 0; i < m.length; i++) if (i !== r) { const k = m[i][c] / m[r][c]; for (let j = 0; j < 3; j++) m[i][j] -= k * m[r][j]; }
    r++;
  }
  return r;
}
function spanScene(b: Board, vs: Vec3[]): Result {
  b.clear();
  vectorStage(b, vs.length ? [...vs, ...vs.map((v) => scale(v, -1))] : [[1, 1, 1]]);
  vs.forEach((v, k) => b.arrow(`v${k}`, { from: [0, 0, 0], to: v, color: (["accent", "active", "done"] as const)[k], label: `v${k + 1} ${vecLabel(v)}` }));
  const r = rank(vs);
  b.state.span = vs;
  const what = ["just the origin", "a line through the origin", "a plane through the origin", "all of 3D space"][r];
  const steps: Step[] = [{ caption: `Every combination a·v₁ + b·v₂${vs.length > 2 ? " + c·v₃" : ""} fills ${what}`, apply: (bb) => {
    if (r === 1) { const d = vs.find((v) => norm(v) > 1e-9)!; bb.line("span", { points: [scale(d, -4 / norm(d)), scale(d, 4 / norm(d))], color: "accent", width: 0.04 }); }
    if (r === 2) {
      const [p, q] = vs.filter((v) => norm(v) > 1e-9).reduce<Vec3[]>((acc, v) => (acc.length < 2 && (acc.length === 0 || norm(cross(acc[0], v)) > 1e-9) ? [...acc, v] : acc), []);
      const u = scale(p, 3 / norm(p)), w0 = sub(q, scale(p, (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / (norm(p) ** 2))), w = scale(w0, 3 / norm(w0));
      bb.polygon("span", { points: [add(u, w), sub(w, u), scale(add(u, w), -1), sub(u, w)], color: "accent", opacity: 0.25 });
    }
    if (r === 3) bb.box("span", { at: [0, 0, 0], size: [5, 5, 5], color: "accent", opacity: 0.08 });
  } }];
  if (r < vs.length) steps.push({ caption: `The vectors are linearly dependent: only ${r} of them are needed for a basis`, apply: () => {} });
  return { facts: { vectors: vs, rank: r, span: what, linearly_independent: r === vs.length }, steps, summary: `These ${vs.length} vectors span ${what} (rank ${r}).` };
}
export const spanTemplate = defineTemplate({
  id: "span_basis", domain: "math", family: "linear_algebra", title: "Span and basis",
  topics: ["span", "basis", "linear independence", "linear combination", "rank"], schema: z.object({ vectors: z.array(Vec3S).min(1).max(3) }),
  defaults: { vectors: [[1, 0, 1], [0, 1, 1]] }, narrationHints: ["The span is everything you can reach by adding stretched copies.", "Independent vectors each add a new direction."],
  run: (b, a) => spanScene(b, a.vectors as Vec3[]), actions: { set_vectors: { description: "Use other vectors.", schema: z.object({ vectors: z.array(Vec3S).min(1).max(3) }), run: (b, a) => spanScene(b, a.vectors as Vec3[]) } },
});

// ── planes_system ───────────────────────────────────────────────────────────────────────────────
const Eq = z.tuple([z.number(), z.number(), z.number(), z.number()]).describe("[a, b, c, d] for the plane ax + by + cz = d (entries -10 to 10).");
export function solve3(eqs: number[][]): { kind: "point" | "line" | "plane" | "none"; point?: Vec3 } {
  const A = eqs.map((e) => e.slice(0, 3)) as M3, d = eqs.map((e) => e[3]);
  const D = det3(A);
  if (Math.abs(D) > 1e-9) {
    const col = (k: number) => det3(A.map((r, i) => r.map((x, j) => (j === k ? d[i] : x))));
    return { kind: "point", point: [col(0) / D, col(1) / D, col(2) / D] };
  }
  const rA = rank(A as unknown as Vec3[]), rAug = rankN(eqs);
  return rA !== rAug ? { kind: "none" } : { kind: rA === 2 ? "line" : "plane" };
}
function rankN(m0: number[][]): number {
  const m = m0.map((r) => [...r]);
  let r = 0;
  for (let c = 0; c < m[0].length && r < m.length; c++) {
    const p = m.slice(r).findIndex((row) => Math.abs(row[c]) > 1e-9);
    if (p < 0) continue;
    [m[r], m[r + p]] = [m[r + p], m[r]];
    for (let i = 0; i < m.length; i++) if (i !== r) { const k = m[i][c] / m[r][c]; for (let j = 0; j < m[0].length; j++) m[i][j] -= k * m[r][j]; }
    r++;
  }
  return r;
}
function planePatch(e: number[], size = 3): Vec3[] {
  const n: Vec3 = [e[0], e[1], e[2]], nn = norm(n) || 1, p0 = scale(n, e[3] / (nn * nn));
  const h: Vec3 = Math.abs(n[2] / nn) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = scale(cross(h, n), size / norm(cross(h, n))), w = scale(cross(n, u), size / norm(cross(n, u)));
  return [add(p0, add(u, w)), add(p0, sub(u, w)), sub(p0, add(u, w)), add(p0, sub(w, u))];
}
function planesScene(b: Board, eqs: number[][]): Result {
  b.clear();
  const s = solve3(eqs);
  b.axes("axes", { size: 4, negative: true });
  b.fit([[-4, -4, -4], [4, 4, 4]], "iso");
  b.state.planes = eqs;
  const name = (e: number[]) => `${fmt(e[0])}x + ${fmt(e[1])}y + ${fmt(e[2])}z = ${fmt(e[3])}`.replace(/\+ -/g, "− ");
  const steps: Step[] = eqs.map((e, k) => ({ caption: `Plane ${k + 1}: ${name(e)}`, apply: (bb) => bb.polygon(`p${k}`, { points: planePatch(e), color: (["accent", "active", "done"] as const)[k], opacity: 0.32 }) }));
  steps.push({ caption: s.kind === "point" ? `They meet at one point ${vecLabel(s.point!)}: a unique solution` : s.kind === "line" ? "They share a whole line: infinitely many solutions" : s.kind === "plane" ? "They are the same plane: infinitely many solutions" : "They never all meet: no solution", apply: (bb) => { if (s.point) bb.node("X", { at: s.point, color: "warn", size: 0.12, label: vecLabel(s.point) }); } });
  return { facts: { equations: eqs.map(name), solution: s.kind, point: s.point?.map((c) => fmt(c)) ?? null }, steps, summary: s.kind === "point" ? `The three planes meet at ${vecLabel(s.point!)}.` : `The system has ${s.kind === "none" ? "no solution" : "infinitely many solutions"}.` };
}
export const planesTemplate = defineTemplate({
  id: "planes_system", domain: "math", family: "linear_algebra", title: "Three equations as three planes",
  topics: ["system of equations", "three planes", "intersecting planes", "simultaneous equations in three unknowns"], schema: z.object({ equations: z.array(Eq).length(3) }),
  defaults: { equations: [[1, 1, 1, 3], [1, -1, 0, 0], [0, 0, 1, 1]] }, narrationHints: ["Each equation in x, y, z is a plane.", "A solution is a point on all three planes."],
  run: (b, a) => planesScene(b, a.equations), actions: { set_equations: { description: "Use other equations.", schema: z.object({ equations: z.array(Eq).length(3) }), run: (b, a) => planesScene(b, a.equations) } },
});
void apply3;
