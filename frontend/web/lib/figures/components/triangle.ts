import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, add, angleMark, clamp, deg, dist, fmt, lerp, list, mul, optNum, perp, rad, str, sub, textBox, unit } from "./mathsKit";

/**
 * A TRIANGLE DRAWN TO SCALE. The board gives any sufficient set of sides and angles (SSS, SAS, ASA,
 * AAS, SSA — the acute case — or angles only); the code solves the triangle with the sine and cosine
 * rules and draws exactly that triangle, so a 3-4-5 triangle really has its right angle and a 40°
 * angle really is 40°. Side a is opposite vertex A (a = BC, b = CA, c = AB).
 */

export type TriangleSolution = { sides: [number, number, number]; angles: [number, number, number]; scaled: boolean };
type Maybe = Array<number | undefined>;

const sinD = (d: number) => Math.sin(rad(d));
const cosD = (d: number) => Math.cos(rad(d));

/** Solve from the given values (undefined = unknown). Null when they do not fix a triangle. */
export function solveTriangle(sIn: Maybe, aIn: Maybe): TriangleSolution | null {
  const s = sIn.map((v) => (v !== undefined && v > 0 ? v : undefined));
  let a = aIn.map((v) => (v !== undefined && v > 0 && v < 180 ? v : undefined));
  const nA = a.filter((v) => v !== undefined).length;
  const nS = s.filter((v) => v !== undefined).length;
  const done = (sides: number[], angles: number[], scaled = true): TriangleSolution | null =>
    sides.every((x) => Number.isFinite(x) && x > 0) && angles.every((x) => Number.isFinite(x) && x > 0)
      ? { sides: sides as [number, number, number], angles: angles as [number, number, number], scaled }
      : null;
  if (nA >= 2) {
    if (nA === 3 && Math.abs(a[0]! + a[1]! + a[2]! - 180) > 0.5) a = [a[0], a[1], undefined];
    const known = a.filter((v): v is number => v !== undefined);
    const third = 180 - known[0] - known[1];
    if (third <= 0) return null;
    const angles = a.map((v) => v ?? third);
    const k = s.findIndex((v) => v !== undefined);
    if (k < 0) return done(angles.map((x) => sinD(x) * 6), angles, false);
    const R = s[k]! / sinD(angles[k]);
    return done(angles.map((x) => R * sinD(x)), angles);
  }
  if (nS === 3) {
    const [x, y, z] = s as number[];
    if (x + y <= z || y + z <= x || x + z <= y) return null;
    const A = deg(Math.acos(clamp((y * y + z * z - x * x) / (2 * y * z), -1, 1)));
    const B = deg(Math.acos(clamp((x * x + z * z - y * y) / (2 * x * z), -1, 1)));
    return done([x, y, z], [A, B, 180 - A - B]);
  }
  if (nS === 2 && nA === 1) {
    const k = a.findIndex((v) => v !== undefined);
    const missing = s.findIndex((v) => v === undefined);
    if (k === missing) {
      // SAS: the angle is between the two known sides.
      const [p, q] = s.filter((v): v is number => v !== undefined);
      const third = Math.sqrt(p * p + q * q - 2 * p * q * cosD(a[k]!));
      const all = s.map((v) => v ?? third);
      return solveTriangle(all, [undefined, undefined, undefined]);
    }
    // SSA: the angle at k faces a known side; take the acute solution for the other known side.
    const j = [0, 1, 2].find((i) => i !== k && i !== missing)!;
    const sinJ = (s[j]! * sinD(a[k]!)) / s[k]!;
    if (sinJ > 1 + 1e-9) return null;
    const Aj = deg(Math.asin(Math.min(1, sinJ)));
    const angles = [0, 0, 0];
    angles[k] = a[k]!;
    angles[j] = Aj;
    angles[missing] = 180 - a[k]! - Aj;
    if (angles[missing] <= 0) return null;
    const R = s[k]! / sinD(a[k]!);
    return done(angles.map((x) => R * sinD(x)), angles);
  }
  return null;
}

/** Solve, filling in as few default values as needed when the board gave too little. */
function solveWithDefaults(s: Maybe, a: Maybe): TriangleSolution {
  const direct = solveTriangle(s, a);
  if (direct) return direct;
  const givenSides = s.filter((v): v is number => v !== undefined && v > 0);
  const sideDefault = givenSides.length ? givenSides.reduce((t, v) => t + v, 0) / givenSides.length : 6;
  const candidates: Array<() => [Maybe, Maybe]> = [];
  const angleDefaults = [58, 72, 50, 40, 65];
  for (let i = 2; i >= 0; i--) if (a[i] === undefined) for (const v of angleDefaults) candidates.push(() => [s, a.map((x, j) => (j === i ? v : x))]);
  for (let i = 2; i >= 0; i--) if (s[i] === undefined) for (const f of [1.15, 0.9, 1.3]) candidates.push(() => [s.map((x, j) => (j === i ? sideDefault * f : x)), a]);
  for (const c of candidates) {
    const [s1, a1] = c();
    const one = solveTriangle(s1, a1);
    if (one) return one;
    for (const d of candidates) {
      const [s2, a2] = d();
      const two = solveTriangle(s1.map((x, i) => x ?? s2[i]), a1.map((x, i) => x ?? a2[i]));
      if (two) return two;
    }
  }
  return solveTriangle([7, 8, 6], [undefined, undefined, undefined])!;
}

const VERTS = ["A", "B", "C"] as const;
const PARTS = [
  { id: "vertex-a", name: "Vertex A" },
  { id: "vertex-b", name: "Vertex B" },
  { id: "vertex-c", name: "Vertex C" },
  { id: "side-a", name: "Side BC (a)" },
  { id: "side-b", name: "Side CA (b)" },
  { id: "side-c", name: "Side AB (c)" },
  { id: "angle-a", name: "Angle A" },
  { id: "angle-b", name: "Angle B" },
  { id: "angle-c", name: "Angle C" },
];

export const triangle: FigureComponent = {
  name: "triangle",
  title: "A triangle drawn to scale from its sides and angles (solved by the sine/cosine rules): vertices, sides with lengths, angle arcs with values, right-angle square, equal-side ticks",
  params: `labels (vertex letters, default "A,B,C"); a, b, c (side lengths: a = BC opposite A, b = CA, c = AB; numbers > 0); angleA, angleB, angleC (degrees, 0-180). Give any set that fixes the triangle (3 sides, 2 sides + 1 angle, 1 side + 2 angles; angles only draws the shape); the code solves the rest. show ("given" default: values only for what was given; "all": every side and angle; "none"); unknown (what to mark as unknown, e.g. "c" or "C" or "c=x,B=θ"; default symbols x, y for sides, θ, α for angles); units (e.g. "cm", appended to lengths); equalSides (e.g. "AB,AC" or "a,b"; ";" separates a second group with double ticks); equalAngles (e.g. "B,C"); a right angle is marked with a square automatically.`,
  match: /(?<!pascal'?s\s)\btriangles?\b(?!\s+trade)|\bpythagora\w*|\bhypotenuse\b|\bsine rule\b|\bcosine rule\b|\bsohcahtoa\b|\bright[- ]angled\b|\b(isosceles|scalene|equilateral)\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const letters = list(params.labels);
    const L = VERTS.map((v, i) => str(letters[i], v, 3));
    const given = { s: [optNum(params.a), optNum(params.b), optNum(params.c)], a: [optNum(params.angleA), optNum(params.angleB), optNum(params.angleC)] };
    const sol = solveWithDefaults(given.s, given.a);
    const show = /^(all|none)$/i.test(String(params.show ?? "")) ? String(params.show).toLowerCase() : "given";
    const units = str(params.units, "", 6);

    // Unknowns: "c", "C", "BC", "c=x", "B=θ".
    const unknownSide = new Map<number, string>(), unknownAngle = new Map<number, string>();
    for (const item of list(params.unknown)) {
      const [key, sym] = item.split(/\s*[=:]\s*/);
      const si = sideIndex(key, L), ai = angleIndex(key, L);
      if (si >= 0 && !(ai >= 0 && key === L[ai])) unknownSide.set(si, sym?.slice(0, 4) || (unknownSide.size ? "y" : "x"));
      else if (ai >= 0) unknownAngle.set(ai, sym?.slice(0, 4) || (unknownAngle.size ? "α" : "θ"));
    }
    const sideTicks = new Map<number, number>();
    String(params.equalSides ?? "").split(";").forEach((group, g) => list(group, /,/).forEach((t) => {
      const i = sideIndex(t, L);
      if (i >= 0) sideTicks.set(i, g + 1);
    }));
    const angleArcs = new Map<number, number>();
    String(params.equalAngles ?? "").split(";").forEach((group, g) => list(group, /,/).forEach((t) => {
      const i = angleIndex(t, L);
      if (i >= 0) angleArcs.set(i, g + 1);
    }));

    // Place A at the origin, AB along the base, C above it; scale so the longest extent reads well.
    const [, sb, sc] = sol.sides;
    const A = sol.angles[0];
    const raw: Pt[] = [{ x: 0, y: 0 }, { x: sc, y: 0 }, { x: sb * cosD(A), y: -sb * sinD(A) }];
    const minX = Math.min(...raw.map((p) => p.x)), maxX = Math.max(...raw.map((p) => p.x)), minY = Math.min(...raw.map((p) => p.y));
    const k = Math.min(310 / (maxX - minX), 230 / (0 - minY));
    const V = raw.map((p) => ({ x: (p.x - minX) * k, y: p.y * k }));
    const centroid = mul(add(add(V[0], V[1]), V[2]), 1 / 3);

    const sk = new Sketch();
    // Each side is its own stroke (and part), so focusing "side-a" highlights just BC.
    const sideEnds = (i: number): [Pt, Pt] => [V[(i + 1) % 3], V[(i + 2) % 3]];
    for (let i = 0; i < 3; i++) sk.line(sideEnds(i), { stroke: "ink", width: 2.6, part: `side-${"abc"[i]}` });

    // Equal-side ticks across the middle of each side.
    for (const [i, n] of sideTicks) {
      const [p, q] = sideEnds(i);
      const u = unit(sub(q, p)), nrm = perp(u), m = lerp(p, q, 0.5);
      for (let t = 0; t < n; t++) {
        const c = add(m, mul(u, (t - (n - 1) / 2) * 6));
        sk.line([add(c, mul(nrm, 7)), add(c, mul(nrm, -7))], { stroke: "ink", width: 2, part: `side-${"abc"[i]}` });
      }
    }

    // Angle marks (squares for right angles), with values or unknown symbols.
    const angleAnchors: Pt[] = [];
    for (let i = 0; i < 3; i++) {
      const v = V[i], p = V[(i + 1) % 3], q = V[(i + 2) % 3];
      const right = Math.abs(sol.angles[i] - 90) < 0.05;
      const r = clamp(0.2 * Math.min(dist(v, p), dist(v, q)), 18, 34);
      const unknown = unknownAngle.get(i);
      const showVal = show === "all" || (show === "given" && given.a[i] !== undefined);
      // A right angle's square says 90° already.
      const text = unknown ?? (showVal && !right ? `${fmt(sol.angles[i])}°` : "");
      angleAnchors[i] = angleMark(sk, v, p, q, { r, right, text: text || undefined, size: 21, colour: unknown ? PALETTE.red : "ink", part: `angle-${"abc"[i]}`, extra: angleArcs.get(i) });
    }

    // Side values: outside the triangle, clear of its lines.
    for (let i = 0; i < 3; i++) {
      const [p, q] = sideEnds(i);
      const m = lerp(p, q, 0.5);
      let out = perp(unit(sub(q, p)));
      if ((m.x - centroid.x) * out.x + (m.y - centroid.y) * out.y < 0) out = mul(out, -1);
      const unknown = unknownSide.get(i);
      const showVal = show === "all" ? sol.scaled : show === "given" && given.s[i] !== undefined;
      const text = unknown ?? (showVal ? `${fmt(sol.sides[i], given.s[i] !== undefined ? 3 : 1)}${units ? ` ${units}` : ""}` : "");
      if (text) sk.placeText(text, 22, m, out, { min: 4, max: 70, fill: unknown ? PALETTE.red : "ink", part: `side-${"abc"[i]}`, slide: unit(sub(q, p)) });
    }

    // Vertex letters just outside each corner.
    for (let i = 0; i < 3; i++) {
      // Outside the corner, preferring a spot that a label's leader (arriving sideways) cannot cross.
      const out = unit(sub(V[i], centroid));
      const vertical = { x: 0, y: out.y >= 0 ? 1 : -1 };
      const dirs = [unit({ x: out.x * 0.55, y: vertical.y }), vertical, unit({ x: -out.x * 0.4, y: vertical.y }), out];
      const spots = dirs.map((d) => sk.findText(L[i], 26, V[i], d, { min: 8, max: 60 }));
      const clear = spots.find((sp) => sp.ok && sk.approachClear(V[i], 10, [textBox(sp.c, L[i], 26)])) ?? spots.find((sp) => sp.ok) ?? spots[0];
      sk.text(clear.c, L[i], 26, "ink", `vertex-${"abc"[i]}`);
    }

    for (let i = 0; i < 3; i++) sk.part(`vertex-${"abc"[i]}`, `Vertex ${L[i]}`, V[i]);
    for (let i = 0; i < 3; i++) {
      const [p, q] = sideEnds(i);
      sk.part(`side-${"abc"[i]}`, `Side ${L[(i + 1) % 3]}${L[(i + 2) % 3]}`, sk.clearAnchor([0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.5].map((t) => lerp(p, q, t))));
    }
    for (let i = 0; i < 3; i++) sk.part(`angle-${"abc"[i]}`, `Angle ${L[i]}`, angleAnchors[i]);
    return sk.finish(14);
  },
};

function sideIndex(t: string | undefined, L: string[]): number {
  if (!t) return -1;
  const s = t.trim();
  if (/^[abc]$/.test(s)) return "abc".indexOf(s);
  for (let i = 0; i < 3; i++) {
    const p = L[(i + 1) % 3], q = L[(i + 2) % 3];
    if (s === p + q || s === q + p) return i;
  }
  return -1;
}
function angleIndex(t: string | undefined, L: string[]): number {
  if (!t) return -1;
  const s = t.trim().replace(/^(angle\s*|∠)/i, "");
  return L.findIndex((l) => l === s) >= 0 ? L.findIndex((l) => l === s) : /^[ABC]$/.test(s) ? "ABC".indexOf(s) : -1;
}
