// Vector templates: vectors_3d (plot with components and magnitudes), vector_add (head-to-tail or
// parallelogram, and subtraction) and vector_dot_projection (angle and projection onto b).
import { z } from "zod/v4";
import { defineTemplate, type Result, type Step } from "../../contract.ts";
import { add, dot, norm, scale, sub, type Board, type Vec3 } from "../../board3d/board.ts";
import { vecLabel, vectorStage } from "../../board3d/helpers.ts";
import { fmt } from "../../expr.ts";
import { Vec3S } from "../shared.ts";
import type { ColorToken } from "../../theme.ts";

const COLORS: ColorToken[] = ["accent", "active", "done", "warn", "x", "z"];
const O: Vec3 = [0, 0, 0];

// ── vectors_3d ──────────────────────────────────────────────────────────────────────────────────
const PlotArgs = z.object({ vectors: z.array(Vec3S).min(1).max(6).describe("1 to 6 vectors, drawn from the origin."), names: z.array(z.string().max(6)).max(6).optional() });

function plot(b: Board, vs: Vec3[], names: string[]): Result {
  b.clear();
  vectorStage(b, vs);
  vs.forEach((v, k) => b.arrow(`v${k}`, { from: O, to: v, color: COLORS[k], label: `${names[k]} ${vecLabel(v)}` }));
  b.state.vecs = { vs, names };
  const steps: Step[] = vs.map((v, k) => ({
    caption: `${names[k]} = ${vecLabel(v)}: go ${fmt(v[0])} along x, ${fmt(v[1])} along y, ${fmt(v[2])} up. Length √(${v.map((c) => `${fmt(c)}²`).join(" + ")}) = ${fmt(norm(v))}`,
    apply: async (bb, o) => {
      bb.line(`c${k}`, { points: [O, [v[0], 0, 0], [v[0], v[1], 0], v], color: "muted", dashed: true });
      await bb.pulse(`v${k}`, o);
    },
  }));
  return { facts: { vectors: vs, magnitudes: vs.map((v) => fmt(norm(v))) }, steps, summary: `${vs.length} vector${vs.length > 1 ? "s" : ""} from the origin: ${vs.map((v, k) => `${names[k]} = ${vecLabel(v)}`).join(", ")}.` };
}

export const vectors3dTemplate = defineTemplate({
  id: "vectors_3d", domain: "math", family: "linear_algebra", title: "Vectors in 3D",
  topics: ["vector in 3d", "3d vector", "components", "magnitude", "position vector", "r3"],
  schema: PlotArgs, defaults: { vectors: [[2, 1, 3], [-1, 2, 1]] },
  narrationHints: ["A vector's components say how far to go along each axis.", "Its length comes from Pythagoras in 3D."],
  run: (b, a) => plot(b, a.vectors as Vec3[], a.names ?? a.vectors.map((_, k) => "uvwpqr"[k])),
  actions: {
    add_vector: { description: "Draw one more vector.", schema: z.object({ v: Vec3S, name: z.string().max(6).optional() }), run(b, { v, name }) {
      const s = b.state.vecs as { vs: Vec3[]; names: string[] };
      return plot(b, [...s.vs, v as Vec3].slice(0, 6), [...s.names, name ?? "uvwpqr"[s.vs.length]].slice(0, 6));
    } },
  },
});

// ── vector_add ──────────────────────────────────────────────────────────────────────────────────
const AddArgs = z.object({ a: Vec3S, b: Vec3S, mode: z.enum(["head_to_tail", "parallelogram"]).default("head_to_tail"), subtract: z.boolean().default(false).describe("Show a − b instead of a + b.") });

function addScene(b: Board, x: z.infer<typeof AddArgs>): Result {
  const a = x.a as Vec3, v = (x.subtract ? scale(x.b as Vec3, -1) : x.b) as Vec3;
  const r = add(a, v), op = x.subtract ? "−" : "+";
  b.clear();
  vectorStage(b, [a, x.b as Vec3, r, v]);
  b.arrow("a", { from: O, to: a, color: "accent", label: `a ${vecLabel(a)}` });
  b.arrow("b", { from: O, to: x.b as Vec3, color: "active", label: `b ${vecLabel(x.b)}` });
  b.state.add = x;
  const steps: Step[] = [];
  if (x.subtract) steps.push({ caption: "a − b is a + (−b): flip b around", apply: (bb) => bb.arrow("nb", { from: O, to: v, color: "warn", label: "−b" }) });
  if (x.mode === "head_to_tail") steps.push({ caption: `Slide ${x.subtract ? "−b" : "b"} so its tail sits on the head of a`, apply: async (bb, o) => {
    await bb.tween(o.animate ? 700 : 0, (t) => bb.arrow("b2", { from: scale(a, t), to: add(scale(a, t), v), color: x.subtract ? "warn" : "active" }));
  } });
  else steps.push({ caption: "Complete the parallelogram on a and b", apply: (bb) => {
    bb.line("p1", { points: [a, r], color: "muted", dashed: true });
    bb.line("p2", { points: [v, r], color: "muted", dashed: true });
    bb.polygon("pg", { points: [O, a, r, v], color: "muted", opacity: 0.25 });
  } });
  steps.push({ caption: `a ${op} b = ${vecLabel(r)}: add the components`, apply: async (bb, o) => {
    bb.arrow("r", { from: O, to: r, color: "done", label: `a ${op} b ${vecLabel(r)}` });
    await bb.pulse("r", o);
  } });
  return { facts: { a, b: x.b, result: r, operation: x.subtract ? "a - b" : "a + b", magnitude: fmt(norm(r)) }, steps, summary: `a ${op} b = ${vecLabel(r)}, length ${fmt(norm(r))}.` };
}

export const vectorAddTemplate = defineTemplate({
  id: "vector_add", domain: "math", family: "linear_algebra", title: "Adding and subtracting vectors",
  topics: ["vector addition", "add vectors", "subtract vectors", "head to tail", "parallelogram rule", "resultant"],
  schema: AddArgs, defaults: { a: [3, 1, 0], b: [1, 2, 2], mode: "head_to_tail", subtract: false },
  narrationHints: ["Adding vectors adds their components.", "Head-to-tail and the parallelogram give the same answer."],
  run: (b, a) => addScene(b, a),
  actions: {
    set_mode: { description: "Switch between head_to_tail and parallelogram.", schema: z.object({ mode: z.enum(["head_to_tail", "parallelogram"]) }), run: (b, { mode }) => addScene(b, { ...(b.state.add as z.infer<typeof AddArgs>), mode }) },
    subtract: { description: "Show a − b (or back to a + b).", schema: z.object({ on: z.boolean().default(true) }), run: (b, { on }) => addScene(b, { ...(b.state.add as z.infer<typeof AddArgs>), subtract: on }) },
  },
});

// ── vector_dot_projection ───────────────────────────────────────────────────────────────────────
const DotArgs = z.object({ a: Vec3S, b: Vec3S });

export function dotFacts(a: Vec3, b: Vec3) {
  const d = dot(a, b), nb = norm(b);
  const proj = nb ? scale(b, d / (nb * nb)) : ([0, 0, 0] as Vec3);
  const cos = norm(a) && nb ? d / (norm(a) * nb) : NaN;
  return { dot: fmt(d, 6), angle_deg: Number.isFinite(cos) ? fmt((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI) : null, scalar_projection: nb ? fmt(d / nb) : null, projection: proj.map((v) => fmt(v)) as Vec3, perpendicular: Math.abs(d) < 1e-9, proj };
}

function dotScene(b: Board, a: Vec3, v: Vec3): Result {
  b.clear();
  const f = dotFacts(a, v);
  vectorStage(b, [a, v]);
  b.arrow("a", { from: O, to: a, color: "accent", label: `a ${vecLabel(a)}` });
  b.arrow("b", { from: O, to: v, color: "active", label: `b ${vecLabel(v)}` });
  b.state.dot = { a, b: v };
  const nb = norm(v), ua = scale(a, 1 / (norm(a) || 1)), ub = scale(v, 1 / (nb || 1));
  const arc: Vec3[] = Array.from({ length: 21 }, (_, k) => { const t = k / 20; const m = add(scale(ua, 1 - t), scale(ub, t)); return scale(m, 0.8 / (norm(m) || 1)); });
  const steps: Step[] = [
    { caption: `The angle between a and b is ${f.angle_deg}°`, apply: (bb) => bb.line("arc", { points: arc, color: "warn" }) },
    { caption: "Drop a perpendicular from the tip of a onto the line of b", apply: (bb) => {
      bb.line("bline", { points: [scale(v, -0.4), scale(v, 1.4)], color: "muted", dashed: true });
      bb.line("perp", { points: [a, f.proj], color: "muted", dashed: true });
    } },
    { caption: `The shadow of a on b is the projection ${vecLabel(f.projection)}`, apply: async (bb, o) => { bb.arrow("proj", { from: O, to: f.proj, color: "done", label: "proj of a on b" }); await bb.pulse("proj", o); } },
    { caption: `a · b = |a||b| cos θ = ${f.dot}${f.perpendicular ? ": zero, so a and b are perpendicular" : ""}`, apply: () => {} },
  ];
  const { proj: _p, ...facts } = f;
  void _p;
  return { facts: { a, b: v, ...facts }, steps, summary: `a · b = ${f.dot}; the angle is ${f.angle_deg}° and the projection of a onto b is ${vecLabel(f.projection)}.` };
}

export const vectorDotTemplate = defineTemplate({
  id: "vector_dot_projection", domain: "math", family: "linear_algebra", title: "Dot product and projection",
  topics: ["dot product", "scalar product", "projection", "angle between vectors", "orthogonal"],
  schema: DotArgs, defaults: { a: [3, 2, 1], b: [2, 0, 0] },
  narrationHints: ["a · b = |a||b| cos θ.", "A dot product of zero means the vectors are perpendicular.", "The projection is a's shadow on the line of b."],
  run: (b, a) => dotScene(b, a.a as Vec3, a.b as Vec3),
  actions: {
    swap: { description: "Project b onto a instead.", schema: z.object({}), run(b) { const s = b.state.dot as { a: Vec3; b: Vec3 }; return dotScene(b, s.b, s.a); } },
    set_vectors: { description: "Use new vectors.", schema: DotArgs, run: (b, a) => dotScene(b, a.a as Vec3, a.b as Vec3) },
  },
});
void sub;
