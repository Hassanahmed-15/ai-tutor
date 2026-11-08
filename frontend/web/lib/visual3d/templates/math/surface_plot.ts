// Surface z = f(x, y): the expression is parsed by the safe parser (never eval), sampled on a grid,
// coloured by height, with axes; follow-ups change the function, probe a point or show the mesh.
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result } from "../../contract.ts";
import type { Board } from "../../board3d/board.ts";
import { compile, fmt, ALLOWED_FUNCTIONS } from "../../expr.ts";

const Expr = z.string().min(1).max(200).describe(`z as a function of x and y, e.g. "x^2 - y^2" or "sin(x)*cos(y)". Functions: ${ALLOWED_FUNCTIONS.join(", ")}; constants pi, e.`);
const Args = z.object({
  expr: Expr,
  range: z.number().min(0.5).max(10).default(3).describe("x and y both run from -range to range."),
  resolution: z.number().int().min(10).max(80).default(48).describe("Grid lines each way."),
  wireframe: z.boolean().default(false),
});
type A = z.infer<typeof Args>;

export function surfaceFunction(expr: string): (x: number, y: number) => number {
  try {
    return compile(expr, ["x", "y"]) as (x: number, y: number) => number;
  } catch (err) {
    throw new VisualError(`I can't plot "${expr}": ${(err as Error).message}`);
  }
}

/** Sample the function and report what a student would notice. */
export function surfaceFacts(f: (x: number, y: number) => number, range: number, n = 60) {
  let lo = Infinity, hi = -Infinity, bad = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const v = f(-range + (2 * range * i) / n, -range + (2 * range * j) / n);
    if (!Number.isFinite(v)) bad++;
    else (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  }
  const o = f(0, 0);
  return { z_min: fmt(lo), z_max: fmt(hi), value_at_origin: Number.isFinite(o) ? fmt(o) : null, undefined_points: bad };
}

function draw(b: Board, a: A): Result {
  const f = surfaceFunction(a.expr);
  const facts = surfaceFacts(f, a.range);
  if (facts.undefined_points > (61 * 61) / 2) throw new VisualError(`"${a.expr}" is undefined over most of this region; try a smaller range.`);
  b.clear();
  const zr = Math.max(Math.abs(facts.z_min), Math.abs(facts.z_max), 1);
  // Tall surfaces are squashed so the shape stays readable; the axes say the true heights.
  const squash = zr > a.range * 1.6 ? (a.range * 1.6) / zr : 1;
  b.surface("s", { f: (x, y) => f(x, y) * squash, x: [-a.range, a.range], y: [-a.range, a.range], n: a.resolution, wireframe: a.wireframe, zClip: a.range * 3 });
  b.axes("axes", { size: a.range * 1.25, negative: true });
  b.label("title", { at: [-a.range, a.range, zr * squash + 0.4], text: `z = ${a.expr}`, color: "active" });
  if (squash < 1) b.label("scale", { at: [-a.range, a.range, zr * squash + 0.05], text: `heights shown × ${fmt(squash, 2)}`, color: "muted", small: true });
  b.fit([[a.range, a.range, zr * squash], [-a.range, -a.range, -zr * squash]], "iso");
  b.state.surface = { ...a, squash };
  return { facts: { expr: a.expr, ...facts, range: a.range }, steps: [], summary: `The surface z = ${a.expr} for x and y from −${a.range} to ${a.range}; z runs from ${facts.z_min} to ${facts.z_max}.` };
}

export const surfacePlotTemplate = defineTemplate({
  id: "surface_plot",
  domain: "math",
  family: "multivariable_calculus",
  title: "Surface z = f(x, y)",
  topics: ["surface", "z = f(x,y)", "function of two variables", "3d graph", "saddle", "paraboloid", "plot z", "multivariable function", "graph of f(x,y)"],
  schema: Args,
  defaults: { expr: "x^2 - y^2", range: 2, resolution: 48, wireframe: false },
  narrationHints: ["Colour shows height: blue low, yellow high.", "Turn the board to see the shape from the side."],
  run(b, args) { return draw(b, args); },
  actions: {
    set_expr: {
      description: "Plot a different function.",
      schema: z.object({ expr: Expr }),
      run(b, { expr }) { return draw(b, { ...(b.state.surface as A), expr }); },
    },
    toggle_wireframe: {
      description: "Show or hide the grid lines on the surface.",
      schema: z.object({}),
      run(b) { const s = b.state.surface as A; return draw(b, { ...s, wireframe: !s.wireframe }); },
    },
    probe: {
      description: "Mark the point above (x, y) and give its height.",
      schema: z.object({ x: z.number(), y: z.number() }),
      run(b, { x, y }) {
        const s = b.state.surface as A & { squash: number };
        if (Math.abs(x) > s.range || Math.abs(y) > s.range) throw new VisualError(`(${x}, ${y}) is outside the plotted square (±${s.range}).`);
        const v = surfaceFunction(s.expr)(x, y);
        if (!Number.isFinite(v)) throw new VisualError(`The function is undefined at (${x}, ${y}).`);
        return {
          facts: { x, y, z: fmt(v) },
          steps: [{ caption: `At (${x}, ${y}), z = ${fmt(v)}`, apply: async (bb, o) => {
            bb.line("drop", { points: [[x, y, 0], [x, y, v * s.squash]], color: "muted", dashed: true });
            bb.node("probe", { at: [x, y, v * s.squash], color: "warn", size: 0.09, label: `z = ${fmt(v)}` });
            await bb.pulse("probe", o);
          } }],
          summary: `At (${x}, ${y}) the height is ${fmt(v)}.`,
        };
      },
    },
  },
});
