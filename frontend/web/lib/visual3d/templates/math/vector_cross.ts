// Cross product in 3D: a and b from the origin, the parallelogram they span, and a × b standing at
// right angles to both, its length equal to the parallelogram's area (right-hand rule).
import { z } from "zod/v4";
import { defineTemplate, type Result, type Step } from "../../contract";
import { cross, dot, norm, scale, add, type Board, type Vec3 } from "../../board3d/board";
import { fmt } from "../../expr";

const Vec = z.tuple([z.number(), z.number(), z.number()]).describe("A 3-D vector [x, y, z]; each component from -10 to 10.")
  .refine((v) => v.every((c) => Math.abs(c) <= 10), "each component must be between -10 and 10");
const Args = z.object({ a: Vec, b: Vec });

export function crossFacts(a: Vec3, b: Vec3) {
  const c = cross(a, b);
  const cos = norm(a) && norm(b) ? dot(a, b) / (norm(a) * norm(b)) : NaN;
  return {
    a, b, cross: c.map((v) => fmt(v, 6)) as Vec3, magnitude: fmt(norm(c)), area: fmt(norm(c)),
    angle_deg: Number.isFinite(cos) ? fmt((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI) : null,
    perpendicular_to_a: Math.abs(dot(c, a)) < 1e-9, perpendicular_to_b: Math.abs(dot(c, b)) < 1e-9,
    parallel: norm(c) < 1e-9,
  };
}

const lab = (v: Vec3) => `(${v.map((x) => fmt(x)).join(", ")})`;

function draw(b: Board, a: Vec3, v: Vec3, flipped: boolean): Result {
  b.clear();
  const c = flipped ? cross(v, a) : cross(a, v);
  const reach = Math.max(2, norm(a), norm(v), norm(c)) * 1.1;
  b.axes("axes", { size: reach, negative: true });
  b.grid("grid", { size: Math.ceil(Math.max(norm(a), norm(v)) + 1), step: 1 });
  b.arrow("a", { from: [0, 0, 0], to: a, color: "accent", label: `a ${lab(a)}` });
  b.arrow("b", { from: [0, 0, 0], to: v, color: "active", label: `b ${lab(v)}` });
  b.fit([[0, 0, 0], a, v, c, add(a, v)], "iso");
  const name = flipped ? "b × a" : "a × b";
  const f = crossFacts(flipped ? v : a, flipped ? a : v);
  const steps: Step[] = [
    { caption: "a and b span a parallelogram", apply: async (bb, o) => {
      bb.polygon("par", { points: [[0, 0, 0], a, add(a, v), v], color: "muted", opacity: 0.45 });
      if (o.animate) await bb.pulse("par", o);
    } },
    { caption: `${name} = ${lab(c)}: at right angles to both a and b`, apply: async (bb, o) => {
      await bb.tween(o.animate ? 700 : 0, (t) => bb.arrow("c", { from: [0, 0, 0], to: scale(c, Math.max(t, 0.001)), color: "done", label: t > 0.99 ? `${name} ${lab(c)}` : undefined }));
    } },
    { caption: `Its length is the parallelogram's area: |${name}| = ${f.magnitude}`, apply: async (bb, o) => { await bb.pulse("c", o); } },
    { caption: flipped ? "Swapping the order flips the direction: b × a = −(a × b)" : "Right-hand rule: curl your fingers from a to b; your thumb points along a × b", apply: () => {} },
  ];
  if (f.parallel) steps.splice(0, 3, { caption: "a and b are parallel, so there is no parallelogram: a × b = 0", apply: () => {} });
  return { facts: { ...f, order: name }, steps, summary: `${name} of ${lab(a)} and ${lab(v)} is ${lab(c)}, with magnitude ${f.magnitude}.` };
}

export const vectorCrossTemplate = defineTemplate({
  id: "vector_cross",
  domain: "math",
  family: "linear_algebra",
  title: "Cross product in 3D",
  topics: ["cross product", "vector product", "normal vector", "right-hand rule", "right hand rule", "a × b", "a x b", "perpendicular vector", "parallelogram area"],
  schema: Args,
  defaults: { a: [2, 1, 0], b: [0, 2, 1] },
  narrationHints: ["a × b is perpendicular to both a and b.", "|a × b| = |a||b| sin θ, the parallelogram's area.", "b × a points the opposite way."],
  run(b, args) {
    const r = draw(b, args.a as Vec3, args.b as Vec3, false);
    b.state.v = { a: args.a, b: args.b, flipped: false }; // after draw(), which clears the board
    return r;
  },
  actions: {
    swap_order: {
      description: "Show b × a instead of a × b (the vector flips).",
      schema: z.object({}),
      run(b) {
        const s = b.state.v as { a: Vec3; b: Vec3; flipped: boolean };
        const r = draw(b, s.a, s.b, !s.flipped);
        b.state.v = { ...s, flipped: !s.flipped };
        return r;
      },
    },
    set_vectors: {
      description: "Use new vectors a and b.",
      schema: Args,
      run(b, args) {
        const r = draw(b, args.a as Vec3, args.b as Vec3, false);
        b.state.v = { a: args.a, b: args.b, flipped: false };
        return r;
      },
    },
  },
});
