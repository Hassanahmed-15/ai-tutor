import type { FigureComponent, FigureParams, FigureShape } from "../types";
import { PALETTE, clamp, num } from "./mathsKit";

/**
 * THE OTHER PYTHAGORAS PROOFS (owner, 2026-10-25: "it only generates right angle triangle and what it was
 * deriving had no relation with the diagram — it did derivation of trapezoid but there was no trapezoid
 * drawn"). The catalogue had the rearrangement proof and a plain triangle, so Garfield's trapezoid was
 * taught over a bare triangle and the similar-triangles proof over a triangle with no altitude (the
 * triangle figure has none). Each proof now has its own figure, every vertex computed by code, the
 * same colours by quantity as the rearrangement proof: a blue, b amber, c green.
 */

type Pts = Array<[number, number]>;
const poly = (pts: Pts) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} Z`;
const letterList = (params: FigureParams, fallback: string, n: number) => {
  const got = String(params.letters ?? fallback).split(/[,\s]+/).map((l) => l.trim().slice(0, 2)).filter(Boolean);
  const base = fallback.split(",");
  return Array.from({ length: n }, (_, i) => got[i] ?? base[i]);
};
/** A small square in the corner at `p`, along the unit directions u and v. */
const rightMark = (p: [number, number], u: [number, number], v: [number, number], s = 13) =>
  `M${(p[0] + u[0] * s).toFixed(1)} ${(p[1] + u[1] * s).toFixed(1)} L${(p[0] + u[0] * s + v[0] * s).toFixed(1)} ${(p[1] + u[1] * s + v[1] * s).toFixed(1)} L${(p[0] + v[0] * s).toFixed(1)} ${(p[1] + v[1] * s).toFixed(1)}`;
const unit = (from: [number, number], to: [number, number]): [number, number] => {
  const dx = to[0] - from[0], dy = to[1] - from[1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
};
/** A label beside the middle of a segment, pushed `off` units away on the side away from `inside`. */
function sideLabel(p: [number, number], q: [number, number], inside: [number, number], off: number): [number, number] {
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  const [ux, uy] = unit(p, q);
  let nx = -uy, ny = ux;
  if ((inside[0] - mx) * nx + (inside[1] - my) * ny > 0) { nx = -nx; ny = -ny; }
  return [mx + nx * off, my + ny * off + 7];
}

const PROOF_WORDS = String.raw`proofs?|prov(?:e|es|ed|ing)|derivation|deriv(?:e|es|ed|ing)|show(?:s|ing)? that`;
const PYTH_WORDS = String.raw`pythagora|hypotenuse|right[- ]angled|right triangles?|a\s*(?:²|\^\s*2)\s*\+\s*b\s*(?:²|\^\s*2)|a squared plus b squared`;

// ── Garfield's trapezoid ─────────────────────────────────────────────────────────────────────────

const GARFIELD_PARTS = [
  { id: "trapezoid", name: "Trapezoid, parallel sides a and b" },
  { id: "triangle-1", name: "Right triangle (legs a, b)" },
  { id: "triangle-2", name: "Copy of the right triangle" },
  { id: "triangle-c", name: "Middle triangle (legs c, c)" },
  { id: "height", name: "Height a + b" },
];

export const pythagorasGarfield: FigureComponent = {
  name: "pythagorasGarfield",
  title: "Garfield's proof of Pythagoras' theorem: a trapezoid with parallel sides a and b and height a + b, cut into two copies of the right triangle (legs a, b) and a middle right triangle with legs c and c",
  params: `a, b (the triangle's two shorter sides, relative sizes 1..9; default a 3, b 4 — they only set the shape); letters ("a,b,c" default). Reveal the parts in teaching order: trapezoid, triangle-1, triangle-2, triangle-c, height.`,
  // Garfield by name, or a trapezoid (trapezium) on a Pythagoras board. Every matching word counts, so it
  // outranks the general triangle and the rearrangement proof on a trapezoid board.
  match: new RegExp(String.raw`(?<=^(?=[\s\S]*\b(?:garfield|trapez(?:oid|ium)s?)\b)(?=[\s\S]*(?:\bgarfield|\b(?:${PYTH_WORDS})))[\s\S]*)\b(?:garfield\w*|trapez(?:oid|ium)s?|pythagora\w*|hypotenuses?|right[- ]angled|triangles?|parallel sides?|${PROOF_WORDS})\b`, "i"),
  parts: GARFIELD_PARTS,
  selfLabelled: true,
  timeFromScript(sentences) {
    const find = (re: RegExp, from = 0) => {
      for (let i = Math.max(0, from); i < sentences.length; i++) if (re.test(sentences[i])) return i;
      return -1;
    };
    const out: Record<string, number> = {};
    const trap = Math.max(0, find(/\btrapez(?:oid|ium)\b/i));
    out.trapezoid = trap;
    const pieces = find(/\b(?:triangles?|pieces?|split|cut|partition\w*|divid\w*)\b/i, trap);
    out["triangle-1"] = pieces >= 0 ? pieces : trap;
    out["triangle-2"] = out["triangle-1"];
    const mid = find(/\b(?:middle|third|isosceles|c\s*(?:squared|²|\^\s*2)|½\s*c|half c|legs? c|c and c)\b/i, out["triangle-1"]);
    out["triangle-c"] = mid >= 0 ? mid : out["triangle-1"];
    const h = find(/\bheight\b|\ba\s*\+\s*b\b/i, trap);
    out.height = h >= 0 ? h : trap;
    return out;
  },
  build(params: FigureParams) {
    const a0 = clamp(num(params.a, 3, 1, 9), 1, 9);
    const b0 = clamp(num(params.b, 4, 1, 9), 1, 9);
    const [la, lb, lc] = letterList(params, "a,b,c", 3);
    const u = 330 / (a0 + b0);
    const a = a0 * u, b = b0 * u;
    const PADX = 44, PADT = 30;
    const H = Math.max(a, b);
    const base = PADT + H;
    // Bottom-left, the point between the triangles, bottom-right; the tops of the two parallel sides.
    const B0: [number, number] = [PADX, base];
    const M: [number, number] = [PADX + b, base];
    const B1: [number, number] = [PADX + a + b, base];
    const L: [number, number] = [PADX, base - a];
    const R: [number, number] = [PADX + a + b, base - b];
    const shapes: FigureShape[] = [];
    const text = (p: [number, number], t: string, size: number, fill: string, extra: Partial<FigureShape> = {}) => shapes.push({ t: "text", x: p[0], y: p[1], text: t, size, anchor: "middle", fill: fill as `#${string}`, ...extra } as FigureShape);
    const inside1: [number, number] = [(B0[0] + M[0] + L[0]) / 3, (B0[1] + M[1] + L[1]) / 3];
    const inside2: [number, number] = [(M[0] + B1[0] + R[0]) / 3, (M[1] + B1[1] + R[1]) / 3];
    const insideC: [number, number] = [(L[0] + M[0] + R[0]) / 3, (L[1] + M[1] + R[1]) / 3];

    shapes.push({ t: "path", d: poly([B0, M, L]), fill: PALETTE.violet, opacity: 0.28, stroke: PALETTE.violet, width: 2.5, part: "triangle-1", show: "triangle-1" });
    shapes.push({ t: "path", d: poly([M, B1, R]), fill: PALETTE.violet, opacity: 0.28, stroke: PALETTE.violet, width: 2.5, part: "triangle-2", show: "triangle-2" });
    shapes.push({ t: "path", d: poly([L, M, R]), fill: PALETTE.green, opacity: 0.22, stroke: PALETTE.green, width: 2.5, part: "triangle-c", show: "triangle-c" });
    // The trapezoid's outline, drawn first.
    shapes.push({ t: "path", d: poly([B0, B1, R, L]), fill: "none", stroke: "ink", width: 3, part: "trapezoid", show: "trapezoid" });
    // Right angles: the two triangles' corners and the middle triangle's corner at M.
    shapes.push({ t: "path", d: rightMark(B0, [1, 0], [0, -1]), fill: "none", stroke: "ink", width: 2, show: "triangle-1" });
    shapes.push({ t: "path", d: rightMark(B1, [-1, 0], [0, -1]), fill: "none", stroke: "ink", width: 2, show: "triangle-2" });
    shapes.push({ t: "path", d: rightMark(M, unit(M, L), unit(M, R)), fill: "none", stroke: "ink", width: 2, show: "triangle-c" });
    // Side letters: a and b on each triangle, c on each hypotenuse.
    text(sideLabel(B0, L, inside1, 16), la, 22, PALETTE.blue, { show: "triangle-1" });
    text(sideLabel(B0, M, inside1, 14), lb, 22, PALETTE.amber, { show: "triangle-1" });
    text(sideLabel(L, M, insideC, -16), lc, 22, PALETTE.green, { show: "triangle-1" });
    text(sideLabel(M, B1, inside2, 14), la, 22, PALETTE.blue, { show: "triangle-2" });
    text(sideLabel(B1, R, inside2, 16), lb, 22, PALETTE.amber, { show: "triangle-2" });
    text(sideLabel(M, R, insideC, -16), lc, 22, PALETTE.green, { show: "triangle-2" });
    // The height a + b along the bottom, under the side letters.
    const hy = base + 40;
    shapes.push({ t: "path", d: `M${B0[0]} ${hy} H ${B1[0]} M${B0[0]} ${hy - 7} V ${hy + 7} M${B1[0]} ${hy - 7} V ${hy + 7}`, stroke: "muted", width: 2, part: "height", show: "height" });
    text([(B0[0] + B1[0]) / 2, hy + 24], `height ${la} + ${lb}`, 18, "#64748b", { part: "height", show: "height" });

    const w = B1[0] + PADX;
    const h = hy + 34;
    return {
      w,
      h,
      shapes,
      parts: [
        { id: "trapezoid", name: GARFIELD_PARTS[0].name, anchor: { x: (L[0] + R[0]) / 2, y: Math.min(L[1], R[1]) } },
        { id: "triangle-1", name: GARFIELD_PARTS[1].name, anchor: { x: inside1[0], y: inside1[1] } },
        { id: "triangle-2", name: GARFIELD_PARTS[2].name, anchor: { x: inside2[0], y: inside2[1] } },
        { id: "triangle-c", name: GARFIELD_PARTS[3].name, anchor: { x: insideC[0], y: insideC[1] } },
        { id: "height", name: GARFIELD_PARTS[4].name, anchor: { x: (B0[0] + B1[0]) / 2, y: hy } },
      ],
    };
  },
};

// ── Similar triangles: the altitude to the hypotenuse ────────────────────────────────────────────

const SIMILAR_PARTS = [
  { id: "triangle", name: "Right triangle (legs a, b; hypotenuse c)" },
  { id: "altitude", name: "Altitude to the hypotenuse" },
  { id: "small-a", name: "Small triangle on side a" },
  { id: "small-b", name: "Small triangle on side b" },
  { id: "segment-x", name: "Hypotenuse segment x (beside a)" },
  { id: "segment-y", name: "Hypotenuse segment y (beside b)" },
];

export const pythagorasSimilar: FigureComponent = {
  name: "pythagorasSimilar",
  title: "The similar-triangles proof of Pythagoras' theorem: a right triangle (legs a, b, hypotenuse c) with the altitude from the right angle to the hypotenuse, which cuts c into segments x (beside a) and y (beside b) and makes two smaller triangles similar to the whole, so a² = cx and b² = cy",
  params: `a, b (the triangle's two shorter sides, relative sizes 1..9; default a 3, b 4); letters ("a,b,c,x,y" default: x is the hypotenuse segment beside a, y the one beside b). Reveal the parts in teaching order: triangle, altitude, small-a and small-b, segment-x and segment-y.`,
  // The altitude to the hypotenuse, or similar triangles, on a Pythagoras board. Every matching word counts,
  // so it outranks the general triangle (which draws no altitude).
  match: new RegExp(String.raw`(?<=^(?=[\s\S]*\b(?:altitudes?|similar(?:ity)?|similar[- ]triangles?|perpendicular to the hypotenuse|hypotenuse segments?|a\s*(?:²|\^\s*2)\s*=\s*c\s*x|a squared equals c x)\b)(?=[\s\S]*(?:\b(?:${PYTH_WORDS})|\bcx\b|\bcy\b))[\s\S]*)\b(?:altitudes?|similar(?:ity)?|segments?|pythagora\w*|hypotenuses?|right[- ]angled|triangles?|ratios?|${PROOF_WORDS})\b`, "i"),
  parts: SIMILAR_PARTS,
  selfLabelled: true,
  timeFromScript(sentences) {
    const find = (re: RegExp, from = 0) => {
      for (let i = Math.max(0, from); i < sentences.length; i++) if (re.test(sentences[i])) return i;
      return -1;
    };
    const out: Record<string, number> = { triangle: 0 };
    const alt = find(/\b(?:altitude|perpendicular|drop\w*)\b/i);
    out.altitude = alt >= 0 ? alt : 0;
    const sim = find(/\b(?:similar\w*|smaller triangles?|two (?:small(?:er)? )?(?:right[- ]angled )?triangles?)\b/i, out.altitude);
    out["small-a"] = sim >= 0 ? sim : out.altitude;
    out["small-b"] = out["small-a"];
    const seg = find(/\b(?:segments?|x and y|\bx\b|pieces? of the hypotenuse)\b/i, out.altitude);
    out["segment-x"] = seg >= 0 ? seg : out.altitude;
    out["segment-y"] = out["segment-x"];
    return out;
  },
  build(params: FigureParams) {
    const a0 = clamp(num(params.a, 3, 1, 9), 1, 9);
    const b0 = clamp(num(params.b, 4, 1, 9), 1, 9);
    const [la, lb, lc, lx, ly] = letterList(params, "a,b,c,x,y", 5);
    const c0 = Math.hypot(a0, b0);
    const u = 360 / c0;
    // Hypotenuse along the bottom: A left, B right; C above, the right angle. BC = a, AC = b.
    const yLen = (b0 * b0) / c0, xLen = (a0 * a0) / c0, h0 = (a0 * b0) / c0;
    const PADX = 40, PADT = 40;
    const base = PADT + h0 * u;
    const A: [number, number] = [PADX, base];
    const B: [number, number] = [PADX + c0 * u, base];
    const D: [number, number] = [PADX + yLen * u, base];
    const C: [number, number] = [D[0], base - h0 * u];
    const shapes: FigureShape[] = [];
    const text = (p: [number, number], t: string, size: number, fill: string, extra: Partial<FigureShape> = {}) => shapes.push({ t: "text", x: p[0], y: p[1], text: t, size, anchor: "middle", fill: fill as `#${string}`, ...extra } as FigureShape);
    const inA: [number, number] = [(B[0] + C[0] + D[0]) / 3, (B[1] + C[1] + D[1]) / 3];
    const inB: [number, number] = [(A[0] + C[0] + D[0]) / 3, (A[1] + C[1] + D[1]) / 3];
    const whole: [number, number] = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];

    // The two smaller triangles, shaded when the altitude makes them: the one on side a blue, on side b amber.
    shapes.push({ t: "path", d: poly([B, C, D]), fill: PALETTE.blue, opacity: 0.2, stroke: "none", part: "small-a", show: "small-a" });
    shapes.push({ t: "path", d: poly([A, C, D]), fill: PALETTE.amber, opacity: 0.2, stroke: "none", part: "small-b", show: "small-b" });
    // The whole triangle, its sides in their quantity's colour.
    shapes.push({ t: "path", d: `M${B[0]} ${B[1]} L${C[0]} ${C[1]}`, stroke: PALETTE.blue, width: 3, part: "triangle", show: "triangle" });
    shapes.push({ t: "path", d: `M${A[0]} ${A[1]} L${C[0]} ${C[1]}`, stroke: PALETTE.amber, width: 3, part: "triangle", show: "triangle" });
    shapes.push({ t: "path", d: `M${A[0]} ${A[1]} L${B[0]} ${B[1]}`, stroke: "ink", width: 3, part: "triangle", show: "triangle" });
    shapes.push({ t: "path", d: rightMark(C, unit(C, A), unit(C, B)), fill: "none", stroke: "ink", width: 2, show: "triangle" });
    text(sideLabel(B, C, whole, 16), la, 22, PALETTE.blue, { show: "triangle" });
    text(sideLabel(A, C, whole, 16), lb, 22, PALETTE.amber, { show: "triangle" });
    // c, under the whole hypotenuse, below the segment letters.
    const cy = base + 52;
    shapes.push({ t: "path", d: `M${A[0]} ${cy} H ${B[0]} M${A[0]} ${cy - 7} V ${cy + 7} M${B[0]} ${cy - 7} V ${cy + 7}`, stroke: PALETTE.green, width: 2, show: "triangle" });
    text([(A[0] + B[0]) / 2, cy + 24], `${lc} = ${lx} + ${ly}`, 19, PALETTE.green, { show: "segment-x" });
    text([(A[0] + B[0]) / 2, cy + 24], lc, 22, PALETTE.green, { show: "triangle", hide: "segment-x" });
    // The altitude from the right angle, dashed, with its right angle at D.
    shapes.push({ t: "path", d: `M${C[0]} ${C[1]} L${D[0]} ${D[1]}`, stroke: "ink", width: 2.5, dash: "7 6", part: "altitude", show: "altitude" });
    shapes.push({ t: "path", d: rightMark(D, [1, 0], [0, -1], 11), fill: "none", stroke: "ink", width: 2, show: "altitude" });
    // The hypotenuse segments: x beside a (D to B), y beside b (A to D).
    text([(D[0] + B[0]) / 2, base + 26], lx, 21, PALETTE.blue, { part: "segment-x", show: "segment-x" });
    text([(A[0] + D[0]) / 2, base + 26], ly, 21, PALETTE.amber, { part: "segment-y", show: "segment-y" });
    shapes.push({ t: "path", d: `M${D[0]} ${base - 8} V ${base + 8}`, stroke: "ink", width: 2.5, show: "segment-x" });

    const w = B[0] + PADX;
    const h = cy + 34;
    return {
      w,
      h,
      shapes,
      parts: [
        { id: "triangle", name: SIMILAR_PARTS[0].name, anchor: { x: whole[0], y: whole[1] } },
        { id: "altitude", name: SIMILAR_PARTS[1].name, anchor: { x: C[0], y: (C[1] + D[1]) / 2 } },
        { id: "small-a", name: SIMILAR_PARTS[2].name, anchor: { x: inA[0], y: inA[1] } },
        { id: "small-b", name: SIMILAR_PARTS[3].name, anchor: { x: inB[0], y: inB[1] } },
        { id: "segment-x", name: SIMILAR_PARTS[4].name, anchor: { x: (D[0] + B[0]) / 2, y: base } },
        { id: "segment-y", name: SIMILAR_PARTS[5].name, anchor: { x: (A[0] + D[0]) / 2, y: base } },
      ],
    };
  },
};

// ── Squares on the sides ─────────────────────────────────────────────────────────────────────────

const SQUARES_PARTS = [
  { id: "triangle", name: "Right triangle (legs a, b; hypotenuse c)" },
  { id: "square-a", name: "Square on side a (area a²)" },
  { id: "square-b", name: "Square on side b (area b²)" },
  { id: "square-c", name: "Square on the hypotenuse (area c²)" },
];

/**
 * THE SQUARES ON THE SIDES (owner, 2026-10-25: "yes plz add it"). The picture every Pythagoras lesson starts
 * from — a square built outward on each side, a² + b² = c² as areas — was drawn as a free sketch. Code builds
 * each square on its side; with whole-number sides (3, 4, 5) each square shows its unit grid, so 9 + 16 = 25
 * can be counted.
 */
export const pythagorasSquares: FigureComponent = {
  name: "pythagorasSquares",
  title: "Pythagoras' theorem as areas: a right triangle with a square built outward on each side — a² on one leg, b² on the other, c² on the hypotenuse — each square's unit grid shown when the sides are whole numbers",
  params: `a, b (the two shorter sides; default a 3, b 4; whole numbers up to 8 show the unit grid in every square); grid (true/false, default true when a, b and the hypotenuse are whole numbers); letters ("a,b,c" default). Reveal the parts in teaching order: triangle, then square-a, square-b, square-c.`,
  // Squares built on the sides, or the square on the hypotenuse, on a Pythagoras board. Every matching word
  // counts, so it outranks the general triangle; a rearrangement or proof board keeps its own figure.
  match: new RegExp(String.raw`(?<=^(?=[\s\S]*\b(?:squares? (?:built |drawn |constructed |placed )?on (?:each |the |its |every )?(?:three )?(?:sides?|legs?|hypotenuse)|squares? on the (?:two )?(?:shorter sides|legs)|area of the square on|areas? of the (?:three |two )?squares)\b)(?=[\s\S]*\b(?:${PYTH_WORDS}))[\s\S]*)\b(?:squares?|areas?|sides?|legs?|hypotenuses?|pythagora\w*|right[- ]angled|triangles?)\b`, "i"),
  parts: SQUARES_PARTS,
  selfLabelled: true,
  timeFromScript(sentences) {
    const find = (re: RegExp, from = 0) => {
      for (let i = Math.max(0, from); i < sentences.length; i++) if (re.test(sentences[i])) return i;
      return -1;
    };
    const out: Record<string, number> = { triangle: 0 };
    const sq = (letter: string, extra = "") => new RegExp(String.raw`\b(?:square on (?:side )?${letter}\b|${letter}\s*(?:squared|²|\^\s*2)${extra})`, "i");
    const a = find(sq("a"));
    const b = find(sq("b"));
    const c = find(sq("c", String.raw`|square on the hypotenuse`));
    out["square-a"] = a >= 0 ? a : 0;
    out["square-b"] = b >= 0 ? b : out["square-a"];
    out["square-c"] = c >= 0 ? c : out["square-b"];
    return out;
  },
  build(params: FigureParams) {
    const a0 = clamp(num(params.a, 3, 1, 12), 1, 12);
    const b0 = clamp(num(params.b, 4, 1, 12), 1, 12);
    const c0 = Math.hypot(a0, b0);
    const [la, lb, lc] = letterList(params, "a,b,c", 3);
    const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;
    const gridAsked = String(params.grid ?? "").trim();
    const grid = gridAsked ? /^(true|yes|1)$/i.test(gridAsked) : whole(a0) && whole(b0) && whole(c0) && Math.max(a0, b0) <= 8;
    // In units: C the right angle at the origin, A along x (side b), B up (side a); y grows downward.
    const C: [number, number] = [0, 0], A: [number, number] = [b0, 0], B: [number, number] = [0, -a0];
    const n: [number, number] = [a0, -b0]; // outward from AB, length c (away from C)
    const sqA: Pts = [C, B, [-a0, -a0], [-a0, 0]];
    const sqB: Pts = [C, A, [b0, b0], [0, b0]];
    const sqC: Pts = [A, B, [B[0] + n[0], B[1] + n[1]], [A[0] + n[0], A[1] + n[1]]];
    const all = [...sqA, ...sqB, ...sqC];
    const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
    const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
    const PAD = 30;
    const k = Math.min(380 / (maxX - minX), 380 / (maxY - minY));
    const T = (p: [number, number]): [number, number] => [PAD + (p[0] - minX) * k, PAD + (p[1] - minY) * k];
    const shapes: FigureShape[] = [];
    const text = (p: [number, number], t: string, size: number, fill: string, extra: Partial<FigureShape> = {}) => shapes.push({ t: "text", x: p[0], y: p[1], text: t, size, anchor: "middle", fill: fill as `#${string}`, ...extra } as FigureShape);
    const centre = (pts: Pts): [number, number] => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const squares: Array<[Pts, string, string, number, string]> = [[sqA, "square-a", PALETTE.blue, a0, la], [sqB, "square-b", PALETTE.amber, b0, lb], [sqC, "square-c", PALETTE.green, c0, lc]];
    for (const [pts, part, colour, side, letter] of squares) {
      const P = pts.map(T);
      shapes.push({ t: "path", d: poly(P), fill: colour as `#${string}`, opacity: 0.22, stroke: colour as `#${string}`, width: 2.5, part, show: part });
      // The unit grid: lines parallel to each pair of sides, one unit apart.
      if (grid && whole(side) && side > 1) {
        const [p0, p1, , p3] = pts;
        let d = "";
        for (let i = 1; i < side; i++) {
          const f = i / side;
          const u0 = T([p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f]);
          const u1 = T([p3[0] + (p1[0] - p0[0]) * f, p3[1] + (p1[1] - p0[1]) * f]);
          const v0 = T([p0[0] + (p3[0] - p0[0]) * f, p0[1] + (p3[1] - p0[1]) * f]);
          const v1 = T([p1[0] + (p3[0] - p0[0]) * f, p1[1] + (p3[1] - p0[1]) * f]);
          d += `M${u0[0].toFixed(1)} ${u0[1].toFixed(1)} L${u1[0].toFixed(1)} ${u1[1].toFixed(1)} M${v0[0].toFixed(1)} ${v0[1].toFixed(1)} L${v1[0].toFixed(1)} ${v1[1].toFixed(1)} `;
        }
        shapes.push({ t: "path", d, stroke: colour as `#${string}`, width: 1, opacity: 0.6, show: part });
      }
      const area = grid && whole(side) ? ` = ${Math.round(side * side)}` : "";
      text(centre(P), `${letter}²${area}`, side === c0 ? 28 : 24, colour, { part, show: part });
    }
    // The triangle on top, its right angle marked, its sides lettered just inside.
    const tC = T(C), tA = T(A), tB = T(B);
    shapes.push({ t: "path", d: poly([tC, tA, tB]), fill: "none", stroke: "ink", width: 3, part: "triangle", show: "triangle" });
    shapes.push({ t: "path", d: rightMark(tC, unit(tC, tA), unit(tC, tB), 12), fill: "none", stroke: "ink", width: 2, show: "triangle" });
    const inside: [number, number] = [(tC[0] + tA[0] + tB[0]) / 3, (tC[1] + tA[1] + tB[1]) / 3];
    text(sideLabel(tC, tB, inside, -17), la, 24, PALETTE.blue, { show: "triangle" });
    text(sideLabel(tC, tA, inside, -17), lb, 24, PALETTE.amber, { show: "triangle" });
    text(sideLabel(tA, tB, inside, -17), lc, 24, PALETTE.green, { show: "triangle" });
    const w = PAD * 2 + (maxX - minX) * k, h = PAD * 2 + (maxY - minY) * k;
    return {
      w,
      h,
      shapes,
      parts: [
        { id: "triangle", name: SQUARES_PARTS[0].name, anchor: { x: inside[0], y: inside[1] } },
        { id: "square-a", name: SQUARES_PARTS[1].name, anchor: { x: centre(sqA.map(T))[0], y: centre(sqA.map(T))[1] } },
        { id: "square-b", name: SQUARES_PARTS[2].name, anchor: { x: centre(sqB.map(T))[0], y: centre(sqB.map(T))[1] } },
        { id: "square-c", name: SQUARES_PARTS[3].name, anchor: { x: centre(sqC.map(T))[0], y: centre(sqC.map(T))[1] } },
      ],
    };
  },
};
