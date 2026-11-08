// Solids: cube, cuboid, triangular prism, square pyramid, cylinder, cone, sphere, hemisphere and the
// platonic solids, with volume, surface area and (for polyhedra) faces/edges/vertices from formulas.
import { z } from "zod/v4";
import { defineTemplate, type Result, type Step } from "../../contract.ts";
import type { Board, SolidShape } from "../../board3d/board.ts";
import { fmt } from "../../expr.ts";

export const SOLID_TYPES = ["cube", "cuboid", "prism", "pyramid", "cylinder", "cone", "sphere", "hemisphere", "tetrahedron", "octahedron", "dodecahedron", "icosahedron"] as const;
type T = (typeof SOLID_TYPES)[number];
const Len = z.number().min(0.1).max(1000);
const Args = z.object({
  type: z.enum(SOLID_TYPES).describe("Which solid. prism = triangular prism (equilateral ends); pyramid = square-based."),
  side: Len.optional().describe("Edge length (cube, prism ends, pyramid base, platonic solids)."),
  length: Len.optional(), width: Len.optional(), height: Len.optional(), radius: Len.optional(),
  diagonals: z.boolean().optional().describe("Cube or cuboid: also draw the base's diagonal and the space diagonal, each found by Pythagoras."),
  unit: z.string().max(6).optional().describe("The unit of the measurements, e.g. cm."),
});
type A = z.infer<typeof Args>;
const PI = Math.PI, S3 = Math.sqrt(3), S5 = Math.sqrt(5);

/** Volume, surface area, F/E/V and what to draw, all from the textbook formulas. */
export function solidFacts(a: A) {
  const s = a.side ?? 2, l = a.length ?? 3, w = a.width ?? 2, h = a.height ?? 3, r = a.radius ?? 1.5;
  const fev = (f: number, e: number, v: number) => ({ faces: f, edges: e, vertices: v });
  const table: Record<T, { volume: number; surface: number; vf: string; sf: string; shape: SolidShape; dims: number[]; fev?: ReturnType<typeof fev>; size: number }> = {
    cube: { volume: s ** 3, surface: 6 * s * s, vf: "V = s³", sf: "A = 6s²", shape: "box", dims: [s, s, s], fev: fev(6, 12, 8), size: s },
    cuboid: { volume: l * w * h, surface: 2 * (l * w + l * h + w * h), vf: "V = lwh", sf: "A = 2(lw + lh + wh)", shape: "box", dims: [l, w, h], fev: fev(6, 12, 8), size: Math.max(l, w, h) },
    prism: { volume: (S3 / 4) * s * s * (a.length ?? 4), surface: 2 * (S3 / 4) * s * s + 3 * s * (a.length ?? 4), vf: "V = (√3/4)s² × length", sf: "A = 2 × (√3/4)s² + 3 × s × length", shape: "prism3", dims: [s / S3, a.length ?? 4], fev: fev(5, 9, 6), size: Math.max(s, a.length ?? 4) },
    pyramid: { volume: (s * s * h) / 3, surface: s * s + 2 * s * Math.hypot(h, s / 2), vf: "V = ⅓ × s² × h", sf: "A = s² + 2 × s × slant", shape: "pyramid4", dims: [s / Math.SQRT2, h], fev: fev(5, 8, 5), size: Math.max(s, h) },
    cylinder: { volume: PI * r * r * h, surface: 2 * PI * r * r + 2 * PI * r * h, vf: "V = πr²h", sf: "A = 2πr² + 2πrh", shape: "cylinder", dims: [r, h], size: Math.max(2 * r, h) },
    cone: { volume: (PI * r * r * h) / 3, surface: PI * r * r + PI * r * Math.hypot(r, h), vf: "V = ⅓πr²h", sf: "A = πr² + πrl", shape: "cone", dims: [r, h], size: Math.max(2 * r, h) },
    sphere: { volume: (4 / 3) * PI * r ** 3, surface: 4 * PI * r * r, vf: "V = ⁴⁄₃πr³", sf: "A = 4πr²", shape: "sphere", dims: [r], size: 2 * r },
    hemisphere: { volume: (2 / 3) * PI * r ** 3, surface: 3 * PI * r * r, vf: "V = ⅔πr³", sf: "A = 2πr² + πr² = 3πr²", shape: "hemisphere", dims: [r], size: 2 * r },
    tetrahedron: { volume: s ** 3 / (6 * Math.SQRT2), surface: S3 * s * s, vf: "V = a³ / (6√2)", sf: "A = √3 a²", shape: "tetrahedron", dims: [(s * Math.sqrt(6)) / 4], fev: fev(4, 6, 4), size: s },
    octahedron: { volume: (Math.SQRT2 / 3) * s ** 3, surface: 2 * S3 * s * s, vf: "V = (√2/3) a³", sf: "A = 2√3 a²", shape: "octahedron", dims: [s / Math.SQRT2], fev: fev(8, 12, 6), size: s * 1.4 },
    dodecahedron: { volume: ((15 + 7 * S5) / 4) * s ** 3, surface: 3 * Math.sqrt(25 + 10 * S5) * s * s, vf: "V = (15 + 7√5)/4 × a³", sf: "A = 3√(25 + 10√5) a²", shape: "dodecahedron", dims: [(s * S3 * (1 + S5)) / 4], fev: fev(12, 30, 20), size: s * 2.8 },
    icosahedron: { volume: ((5 * (3 + S5)) / 12) * s ** 3, surface: 5 * S3 * s * s, vf: "V = 5(3 + √5)/12 × a³", sf: "A = 5√3 a²", shape: "icosahedron", dims: [(s * Math.sqrt(10 + 2 * S5)) / 4], fev: fev(20, 30, 12), size: s * 1.9 },
  };
  const t = table[a.type];
  return { ...t, euler: t.fev ? t.fev.faces - t.fev.edges + t.fev.vertices : null };
}

function scene(b: Board, a: A): Result {
  b.clear();
  const f = solidFacts(a);
  // Drawn at a size the view holds (a 3 × 4 × 12 cuboid is drawn 1.5 × 2 × 6); every label keeps the real measurements.
  const k = f.size > 6 ? 6 / f.size : 1;
  const dims = f.dims.map((d) => d * k), size = f.size * k, u = a.unit ? ` ${a.unit}` : "";
  const lift = a.type === "sphere" || a.type === "hemisphere" || f.shape.endsWith("hedron") ? (a.type === "hemisphere" ? 0 : dims[0]) : f.shape === "box" ? dims[2] / 2 : dims[1] / 2;
  b.grid("grid", { size: Math.ceil(size) + 1, step: 1 });
  b.solid("solid", { shape: f.shape, dims, at: [0, 0, lift], color: "accent", opacity: a.diagonals ? 0.22 : 0.5 });
  b.fit([[-size, -size, 0], [size, size, size * 1.2]], "iso");
  const dimText = Object.entries({ side: a.side, length: a.length, width: a.width, height: a.height, radius: a.radius }).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} = ${v}${u}`).join("   ");
  if (dimText) b.label("dims", { at: [size * 0.9, -size * 0.9, 0], text: dimText, color: "active" });
  b.state.solid = a;
  const named = Object.entries({ side: a.side, length: a.length, width: a.width, height: a.height, radius: a.radius }).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${v}${u}`).join(", ") || "default size";
  if (a.diagonals && f.shape === "box") return diagonalScene(b, a, f.dims, dims, named, u);
  const steps: Step[] = [
    { caption: `A ${a.type} (${named})`, apply: async (bb, o) => { await bb.pulse("solid", o); } },
    { caption: `Volume: ${f.vf} = ${fmt(f.volume)}`, apply: () => {} },
    { caption: `Surface area: ${f.sf} = ${fmt(f.surface)}`, apply: () => {} },
  ];
  if (f.fev) steps.push({ caption: `${f.fev.faces} faces, ${f.fev.edges} edges, ${f.fev.vertices} vertices: F − E + V = ${f.euler}`, apply: () => {} });
  return { facts: { type: a.type, volume: fmt(f.volume), surface_area: fmt(f.surface), volume_formula: f.vf, area_formula: f.sf, ...(f.fev ?? {}) }, steps, summary: `A ${a.type}: volume ${fmt(f.volume)}, surface area ${fmt(f.surface)}.` };
}

/**
 * 3-D PYTHAGORAS IN A CUBOID: the base's diagonal from two edges, then the space diagonal from that
 * diagonal and the height — two right-angled triangles, each drawn as it is used.
 */
function diagonalScene(b: Board, a: A, real: number[], drawn: number[], named: string, u: string): Result {
  const [l, w, h] = real, [L, W, H] = drawn;
  const P0: [number, number, number] = [-L / 2, -W / 2, 0], Pb: [number, number, number] = [L / 2, W / 2, 0], Pt: [number, number, number] = [L / 2, W / 2, H];
  const d = Math.hypot(l, w), s = Math.hypot(l, w, h);
  // Framed on the cuboid itself, with room for the labels round it.
  const m = Math.max(L, W, H) * 0.25;
  b.fit([[-L / 2 - m, -W / 2 - m, 0], [L / 2 + m, W / 2 + m, H + m * 0.5]], "iso");
  const steps: Step[] = [
    { caption: `A ${a.type} (${named})`, apply: async (bb, o) => { await bb.pulse("solid", o); } },
    { caption: `The base's diagonal: d² = ${fmt(l)}² + ${fmt(w)}² = ${fmt(l * l + w * w)}, so d = ${fmt(d)}${u}`, apply: async (bb, o) => {
      bb.line("faceDiag", { points: [P0, Pb], color: "active", width: 0.03 });
      bb.label("faceLab", { at: [L * 0.15, -W / 2 - m * 0.6, 0], text: `d = ${fmt(d)}${u}`, color: "active" });
      await bb.pulse("faceDiag", o);
    } },
    { caption: `Up the height: a right angle between d and the ${fmt(h)}${u} edge`, apply: async (bb, o) => {
      bb.line("edgeUp", { points: [Pb, Pt], color: "warn", width: 0.03 });
      bb.label("edgeLab", { at: [L / 2 + m * 0.6, W / 2 + m * 0.6, H * 0.7], text: `${fmt(h)}${u}`, color: "warn" });
      await bb.pulse("edgeUp", o);
    } },
    { caption: `The space diagonal: s² = ${fmt(d)}² + ${fmt(h)}² = ${fmt(d * d + h * h)}, so s = ${fmt(s)}${u}`, apply: async (bb, o) => {
      bb.line("spaceDiag", { points: [P0, Pt], color: "done", width: 0.045 });
      bb.label("spaceLab", { at: [-L / 2 - m * 0.7, -W / 2, H * 0.45], text: `s = ${fmt(s)}${u}`, color: "done" });
      await bb.pulse("spaceDiag", o);
    } },
  ];
  return { facts: { type: a.type, base_diagonal: fmt(d), space_diagonal: fmt(s), working: `d² = ${l}² + ${w}², s² = d² + ${h}²` }, steps, summary: `A ${named} ${a.type}: base diagonal ${fmt(d)}${u}, space diagonal ${fmt(s)}${u}.` };
}

export const solidTemplate = defineTemplate({
  id: "solid", domain: "math", family: "geometry", title: "3D solids: volume and surface area",
  topics: ["space diagonal", "3d pythagoras", "diagonal of a cuboid", ...SOLID_TYPES, "platonic solid", "volume", "surface area", "faces edges vertices"],
  schema: Args, defaults: { type: "cylinder", radius: 1.5, height: 3 },
  narrationHints: ["Volume is the space inside; surface area is the outside.", "For any polyhedron, F − E + V = 2."],
  run: (b, a) => scene(b, a),
  actions: {
    set_type: { description: "Show a different solid.", schema: z.object({ type: z.enum(SOLID_TYPES) }), run: (b, { type }) => scene(b, { type }) },
    set_dims: { description: "Change its measurements.", schema: Args.omit({ type: true }), run: (b, d) => scene(b, { ...(b.state.solid as A), ...d }) },
  },
});
