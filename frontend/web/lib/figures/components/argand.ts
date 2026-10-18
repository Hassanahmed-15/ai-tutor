import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { fitText } from "../cuts";
import { PALETTE, Sketch, arrow, bool, fmt, list, mul, polar, unit } from "./mathsKit";
import { normalizeExpr } from "./calculusKit";
import { parseAngle } from "./unitCircle";
import { evalExpr } from "../../canvas/expr";

/**
 * THE ARGAND DIAGRAM. The board gives complex numbers in Cartesian or polar form ("z = 3 + 4i",
 * "w = 2(cos π/3 + i sin π/3)", "4∠60°", "2e^(iπ/4)"); the code works out each one's real and
 * imaginary parts, modulus and principal argument, and draws the point, its vector from O, |z| along
 * the vector and arg z as an arc from the positive real axis — so the picture cannot contradict the
 * numbers. Optionally the conjugate of the first, reflected in the real axis.
 */

export type ComplexPoint = { name: string; re: number; im: number; mod: number; arg: number; given: string; polarText?: string };

const value = (s: string): number => {
  const v = evalExpr(normalizeExpr(s.replace(/√(\d+(?:\.\d+)?)/g, "sqrt($1)")), {}, NaN);
  return Number.isFinite(v) ? v : NaN;
};

/** "3 + 4i", "-2i", "5", "1 - √3 i", "2(cos π/3 + i sin π/3)", "4∠60°", "2e^(iπ/4)" → re, im. */
export function parseComplex(raw: string): { re: number; im: number; polarText?: string } | null {
  const s = raw.replace(/−/g, "-").replace(/\s+/g, "").replace(/\*/g, "");
  const fromPolar = (rText: string, thetaText: string) => {
    const r = rText ? value(rText) : 1;
    const a = parseAngle(thetaText, /π|pi|rad/i.test(thetaText) ? "rad" : undefined);
    if (!Number.isFinite(r)) return null;
    const t = (a.deg * Math.PI) / 180;
    const thetaShown = a.text ?? (a.radians ? `${fmt(t, 3)}` : `${fmt(a.deg, 2)}°`);
    return { re: r * Math.cos(t), im: r * Math.sin(t), polarText: `${fmt(r, 3)}(cos ${thetaShown} + i sin ${thetaShown})` };
  };
  let m = /^([^()]*?)\(cos\(?(.+?)\)?\+isin\(?(.+?)\)?\)$/i.exec(s);
  if (m) return fromPolar(m[1], m[2]);
  m = /^([^e]*?)e\^\(?\{?i(.+?)\}?\)?$/i.exec(s) ?? /^([^e]*?)e\^\(?\{?(.+?)i\}?\)?$/i.exec(s);
  if (m) return fromPolar(m[1], m[2]);
  m = /^(.+?)∠(.+)$/.exec(s);
  if (m) return fromPolar(m[1], m[2]);
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms) return null;
  let re = 0, im = 0;
  for (const t of terms) {
    if (/i$/.test(t) || /^[+-]?i/.test(t)) {
      const coef = t.replace(/i/, "");
      const c = coef === "" || coef === "+" ? 1 : coef === "-" ? -1 : value(coef);
      if (!Number.isFinite(c)) return null;
      im += c;
    } else {
      const c = value(t);
      if (!Number.isFinite(c)) return null;
      re += c;
    }
  }
  return { re, im };
}

const clean = (n: number) => (Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1e9) / 1e9);

/** |v| as written: a whole number, a half, a multiple of √2 or √3 (√3, 2√2, √3/2), else 2 d.p. */
function magnitude(v: number): string {
  const a = Math.abs(v);
  for (const [root, sym] of [[1, ""], [Math.SQRT2, "√2"], [Math.sqrt(3), "√3"]] as const) {
    for (const den of [1, 2]) {
      const k = (a / root) * den;
      if (Math.abs(k - Math.round(k)) < 1e-6 && Math.round(k) > 0) {
        const n = Math.round(k);
        const body = sym ? `${n === 1 ? "" : n}${sym}` : String(n);
        return den === 1 ? body : `${body}/${den}`;
      }
    }
  }
  return fmt(a, 2);
}

/** "3 + 4i", "−2i", "5", "1 − √3i". */
export function cartesianText(re: number, im: number): string {
  const r = clean(re), i = clean(im);
  const imText = (v: number) => (Math.abs(v) === 1 ? "i" : `${magnitude(v)}i`);
  const reText = `${r < 0 ? "−" : ""}${magnitude(r)}`;
  if (i === 0) return r === 0 ? "0" : reText;
  if (r === 0) return `${i < 0 ? "−" : ""}${imText(i)}`;
  return `${reText} ${i < 0 ? "−" : "+"} ${imText(i)}`;
}

/** "For z = −3 + 4i, …" → "z = −3 + 4i" — the first two named complex numbers a script states, if any. */
export function complexNumbersIn(script: string): string | undefined {
  const found: string[] = [];
  const re = /\b([a-zA-Z](?:[₀-₉\d])?)\s*=\s*([-−]?\s*(?:\d+(?:\.\d+)?|√\d+)?\s*[+−-]\s*(?:\d+(?:\.\d+)?|√\d+)?\s*i\b|[-−]?\s*\d+(?:\.\d+)?\s*\(\s*cos[^)]*\)|[-−]?\s*\d+(?:\.\d+)?\s*cis\s*\(?[^,.;)]*\)?)/g;
  for (const m of script.matchAll(re)) {
    const value = m[2].replace(/\bcis\s*\(?([^)]*)\)?/, (_, t) => `(cos ${t} + i sin ${t})`);
    if (parseComplex(value) && !found.some((f) => f.startsWith(`${m[1]} `))) found.push(`${m[1]} = ${value.trim()}`);
    if (found.length === 2) break;
  }
  return found.length ? found.join("; ") : undefined;
}

export function argandData(params: FigureParams): ComplexPoint[] {
  const raw = list(params.points ?? params.numbers ?? params.z, /;/).slice(0, 4);
  const out: ComplexPoint[] = [];
  raw.forEach((item, k) => {
    // The name is everything before the last "=" ("2iz = −4 + 2i", "z + (3 − i) = 4 + i").
    const eq = item.lastIndexOf("=");
    const m = eq > 0 && eq < item.length - 1 ? ["", fitText(item.slice(0, eq).trim(), 16), item.slice(eq + 1)] : null;
    const name = m ? m[1] : raw.length === 1 ? "z" : `z${"₁₂₃₄"[k]}`;
    const c = parseComplex(m ? m[2] : item);
    if (!c) return;
    const re = clean(c.re), im = clean(c.im);
    out.push({ name, re, im, mod: Math.hypot(re, im), arg: Math.atan2(im, re), given: (m ? m[2] : item).trim(), polarText: c.polarText });
  });
  return out.length ? out : [{ name: "z", re: 3, im: 4, mod: 5, arg: Math.atan2(4, 3), given: "3 + 4i" }];
}

/** The argument in the board's units: radians as a multiple of π where exact, else 3 s.f.; or degrees. */
function argText(arg: number, degrees: boolean): string {
  if (degrees) return `${fmt((arg * 180) / Math.PI, 1)}°`;
  const k = (arg / Math.PI) * 12;
  if (Math.abs(k - Math.round(k)) < 1e-6) {
    const n = Math.round(k), g = gcd(Math.abs(n), 12), num = n / g, den = 12 / g;
    if (num === 0) return "0";
    return `${num < 0 ? "−" : ""}${Math.abs(num) === 1 ? "" : Math.abs(num)}π${den === 1 ? "" : `/${den}`}`;
  }
  return `${fmt(arg, 3).replace("-", "−")} rad`;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a || 1);

/** |z| as an exact root where it is one (√13), else 3 s.f. */
function modText(mod: number): string {
  const sq = Math.round(mod * mod);
  if (Math.abs(mod - Math.round(mod)) < 1e-9) return String(Math.round(mod));
  if (Math.abs(mod * mod - sq) < 1e-9) return `√${sq}`;
  return fmt(mod, 3);
}

/**
 * A locus or region on the Argand diagram, from the board's own notation:
 *   |z − a| = r (circle), |z − a| = |z − b| (perpendicular bisector), arg(z − a) = θ (half-line),
 *   α ≤ arg(z − a) ≤ β (wedge), Re z = c, Im z = c — each with =, <, ≤, >, ≥.
 */
export type Locus =
  | { kind: "circle"; a: Pt; r: number; op: string; text: string }
  | { kind: "bisector"; a: Pt; b: Pt; op: string; text: string }
  | { kind: "ray"; a: Pt; from: number; to?: number; op: string; text: string }
  | { kind: "line"; axis: "re" | "im"; c: number; op: string; text: string };

/** "z − (2 + i)", "z + 1 − 2i", "z", "z − 2" → the fixed point a in |z − a|. */
function centreOf(inner: string): Pt | null {
  const s = inner.replace(/−/g, "-").replace(/\s+/g, "");
  const m = /^z(.*)$/i.exec(s);
  if (!m) return null;
  if (!m[1]) return { x: 0, y: 0 };
  const g = /^([+-])\((.+)\)$/.exec(m[1]);
  const c = g ? parseComplex(g[2]) : parseComplex(m[1]);
  if (!c) return null;
  const k = g && g[1] === "+" ? 1 : g ? -1 : 1;
  // |z + c| = |z − (−c)|: the centre is −c.
  return { x: g ? (k === -1 ? c.re : -c.re) : -c.re, y: g ? (k === -1 ? c.im : -c.im) : -c.im };
}

const OPS = /(<=|>=|≤|≥|<|>|=)/;
const normOp = (op: string) => op.replace("<=", "≤").replace(">=", "≥");

export function parseLocus(raw: string): Locus | null {
  const text = raw.trim().replace(/\s+/g, " ");
  const s = text.replace(/−/g, "-").replace(/\s+/g, "");
  let m = /^\|(z[^|]*)\|(<=|>=|≤|≥|<|>|=)\|(z[^|]*)\|$/i.exec(s);
  if (m) {
    const a = centreOf(m[1]), b = centreOf(m[3]);
    return a && b ? { kind: "bisector", a, b, op: normOp(m[2]), text } : null;
  }
  m = /^\|(z[^|]*)\|(<=|>=|≤|≥|<|>|=)(.+)$/i.exec(s);
  if (m) {
    const a = centreOf(m[1]), r = value(m[3]);
    return a && Number.isFinite(r) && r > 0 ? { kind: "circle", a, r, op: normOp(m[2]), text } : null;
  }
  m = /^(.+?)(<=|≤|<)arg\((z[^)]*)\)(<=|≤|<)(.+)$/i.exec(s);
  if (m) {
    const a = centreOf(m[3]);
    const lo = parseAngle(m[1], /π|pi|rad/i.test(m[1]) ? "rad" : undefined), hi = parseAngle(m[5], /π|pi|rad/i.test(m[5]) ? "rad" : undefined);
    return a ? { kind: "ray", a, from: (lo.deg * Math.PI) / 180, to: (hi.deg * Math.PI) / 180, op: "≤", text } : null;
  }
  m = /^arg\((z[^)]*)\)(<=|>=|≤|≥|<|>|=)(.+)$/i.exec(s);
  if (m) {
    const a = centreOf(m[1]);
    const t = parseAngle(m[3], /π|pi|rad/i.test(m[3]) ? "rad" : undefined);
    return a ? { kind: "ray", a, from: (t.deg * Math.PI) / 180, op: normOp(m[2]), text } : null;
  }
  m = /^(Re|Im)\(?z\)?(<=|>=|≤|≥|<|>|=)(.+)$/i.exec(s);
  if (m) {
    const c = value(m[3]);
    return Number.isFinite(c) ? { kind: "line", axis: m[1].toLowerCase() === "re" ? "re" : "im", c, op: normOp(m[2]), text } : null;
  }
  void OPS;
  return null;
}

/** Sutherland–Hodgman: a polygon clipped to an axis-aligned box. */
function clipToBox(poly: Pt[], x0: number, y0: number, x1: number, y1: number): Pt[] {
  const edges: Array<[(p: Pt) => boolean, (a: Pt, b: Pt) => Pt]> = [
    [(p) => p.x >= x0, (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= x1, (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= y0, (a, b) => ({ x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y), y: y0 })],
    [(p) => p.y <= y1, (a, b) => ({ x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y), y: y1 })],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    input.forEach((cur, i) => {
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cut(prev, cur));
    });
    if (!out.length) break;
  }
  return out;
}

const COLOURS: Ink[] = [PALETTE.blue, PALETTE.red, PALETTE.green, PALETTE.violet];
const PARTS = [
  { id: "real-axis", name: "Real axis (Re)" },
  { id: "imaginary-axis", name: "Imaginary axis (Im)" },
  { id: "point-1", name: "z" },
  { id: "point-2", name: "Second number" },
  { id: "point-3", name: "Third number" },
  { id: "point-4", name: "Fourth number" },
  { id: "modulus", name: "Modulus |z|" },
  { id: "argument", name: "Argument arg z" },
  { id: "conjugate", name: "Conjugate z*" },
  { id: "locus-1", name: "Locus" },
  { id: "locus-2", name: "Second locus" },
  { id: "locus-3", name: "Third locus" },
];

export const argand: FigureComponent = {
  name: "argand",
  title: "Argand diagram: complex numbers plotted as points and vectors from O on real and imaginary axes, with the modulus |z|, the argument arg z as an arc from the positive real axis, and optionally the conjugate z*",
  params: `points (up to 4 complex numbers separated by ";", each optionally named, in Cartesian or polar form, e.g. "z = 3 + 4i; w = -2 + i", "z = 2(cos π/3 + i sin π/3)", "4∠150°", "2e^(iπ/4)"); modulus (true default: write |z| along the first number's vector); argument (true default: draw arg z of the first number as an arc); degrees (false default: the argument in radians, as a multiple of π where exact); conjugate (false default: also plot the first number's conjugate z*); loci (optional, up to 3, ";"-separated, in exam notation: "|z - (2 + i)| = 3" circle, "|z - 1| = |z + i|" perpendicular bisector, "arg(z - 1) = π/4" half-line, "0 ≤ arg(z) ≤ π/3" sector, "Re z > 1", "Im z ≤ 2"; with <, ≤, >, ≥ the region is shaded and a strict inequality has a dashed boundary). Real and imaginary parts, modulus and argument are computed — never give them.`,
  match: /\bargand( diagram)?\b|\bcomplex (number|plane)s?\b(?=[\s\S]*\b(modulus|argument|plot|polar|diagram|real axis|imaginary axis)\b)|\bmodulus[- ]argument\b|\b(modulus|moduli)\b(?=[\s\S]*\barguments?\b)|\b\d*\s*cis\s*\(|\bimaginary axis\b|\bpolar form\b(?=[\s\S]*\b(complex|modulus|argument)\b)|\|z\s*[-−+][^|]*\|\s*[=<>≤≥]|\barg\s*\(z\b|\bloci\b(?=[\s\S]*\bcomplex\b)/i,
  parts: PARTS,
  // Every point, |z| and arg z is written on the diagram itself; margin labels would repeat them.
  selfLabelled: true,
  build(params: FigureParams) {
    const pts = params.points || params.numbers || params.z || !params.loci ? argandData(params) : [];
    const loci = list(params.loci ?? params.locus ?? params.regions, /;/).slice(0, 3).map(parseLocus).filter((l): l is Locus => Boolean(l));
    const degrees = bool(params.degrees, false);
    // A loci board is about the loci: |z| and arg z of a marked point would only crowd it.
    const lociGiven = Boolean(params.loci ?? params.locus ?? params.regions);
    const showMod = bool(params.modulus, !lociGiven), showArg = bool(params.argument, !lociGiven), showConj = bool(params.conjugate, false);
    const first = pts[0];
    const all = showConj && first ? [...pts, { ...first, im: -first.im }] : pts;
    // One scale for both axes (angles must look right), large enough for every point, with whole-unit ticks.
    const locusReach = loci.flatMap((l) => l.kind === "circle" ? [Math.abs(l.a.x) + l.r, Math.abs(l.a.y) + l.r] : l.kind === "bisector" ? [Math.abs(l.a.x), Math.abs(l.a.y), Math.abs(l.b.x), Math.abs(l.b.y)] : l.kind === "ray" ? [Math.abs(l.a.x) + 2, Math.abs(l.a.y) + 2] : [Math.abs(l.c) + 1]);
    const extent = Math.max(1, ...all.flatMap((p) => [Math.abs(p.re), Math.abs(p.im)]), ...locusReach);
    const R = 170;
    const step = extent <= 6 ? 1 : extent <= 12 ? 2 : extent <= 30 ? 5 : Math.pow(10, Math.floor(Math.log10(extent)));
    const top = Math.ceil(extent / step) * step;
    const k = R / top;
    const S = (re: number, im: number): Pt => ({ x: re * k, y: -im * k });
    const O = { x: 0, y: 0 };
    const sk = new Sketch();

    // Axes, ticks and numbers every step.
    arrow(sk, { x: -R - 26, y: 0 }, { x: R + 36, y: 0 }, "ink", 1.8, "real-axis", 11);
    arrow(sk, { x: 0, y: R + 26 }, { x: 0, y: -R - 36 }, "ink", 1.8, "imaginary-axis", 11);
    sk.text({ x: R + 46, y: 16 }, "Re", 18, "ink", "real-axis");
    sk.text({ x: 22, y: -R - 44 }, "Im", 18, "ink", "imaginary-axis");
    for (let v = -top; v <= top + 1e-9; v += step) {
      if (Math.abs(v) < 1e-9) continue;
      const x = v * k;
      sk.line([{ x, y: -4 }, { x, y: 4 }], { stroke: "ink", width: 1.3 }, false);
      sk.line([{ x: -4, y: -x }, { x: 4, y: -x }], { stroke: "ink", width: 1.3 }, false);
      sk.text({ x, y: 18 }, fmt(v, 2).replace("-", "−"), 13, "muted");
      sk.text({ x: -16, y: -x + 5 }, `${fmt(v, 2).replace("-", "−")}i`, 13, "muted");
    }
    sk.text({ x: -12, y: 16 }, "O", 15, "muted");

    // Loci and regions: boundary solid (dashed when the inequality is strict), region shaded and clipped to the plot.
    const LOCUS_COLOURS: Ink[] = [PALETTE.green, PALETTE.violet, PALETTE.red];
    const lim = R + 8;
    const box = (poly: Pt[]) => clipToBox(poly, -lim, -lim, lim, lim);
    const locusAnchors: Pt[] = [];
    loci.forEach((l, i) => {
      const id = `locus-${i + 1}`;
      const col = LOCUS_COLOURS[i % LOCUS_COLOURS.length];
      const strict = l.op === "<" || l.op === ">";
      const dash = strict ? { dash: "7 6" } : {};
      const shade = (poly: Pt[]) => { const c = box(poly); if (c.length > 2) sk.polygon(c, { fill: col, stroke: "none", opacity: 0.14, part: id }, false); };
      let anchor: Pt;
      if (l.kind === "circle") {
        const c = S(l.a.x, l.a.y), r = l.r * k;
        if (l.op === "<" || l.op === "≤") shade(Array.from({ length: 72 }, (_, j) => polar(c, r, (j / 72) * 2 * Math.PI)));
        if (l.op === ">" || l.op === "≥") {
          // Outside the circle: the plot with the disc cut out, as four quarter-panels around it.
          const sq = [{ x: -lim, y: -lim }, { x: lim, y: -lim }, { x: lim, y: lim }, { x: -lim, y: lim }];
          void sq;
          for (let q = 0; q < 4; q++) {
            const a0 = (q * Math.PI) / 2, a1 = a0 + Math.PI / 2;
            const arc = Array.from({ length: 19 }, (_, j) => polar(c, r, a0 + ((a1 - a0) * j) / 18));
            const far = [polar(c, 4 * lim, a1), polar(c, 4 * lim, (a0 + a1) / 2), polar(c, 4 * lim, a0)];
            shade([...arc, ...far]);
          }
        }
        sk.circle(c, r, { fill: "none", stroke: col, width: 2.6, part: id, ...dash });
        sk.circle(c, 4, { fill: col, stroke: col, width: 1, part: id }, false);
        anchor = polar(c, r, -Math.PI / 4);
      } else if (l.kind === "bisector") {
        const A = S(l.a.x, l.a.y), B = S(l.b.x, l.b.y);
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, d = unit({ x: -(B.y - A.y), y: B.x - A.x });
        const p0 = { x: mid.x - d.x * 4 * lim, y: mid.y - d.y * 4 * lim }, p1 = { x: mid.x + d.x * 4 * lim, y: mid.y + d.y * 4 * lim };
        if (l.op !== "=") {
          // |z − a| < |z − b|: the side nearer a.
          const towards = l.op === "<" || l.op === "≤" ? A : B;
          const n = unit({ x: towards.x - mid.x, y: towards.y - mid.y });
          shade([p0, p1, { x: p1.x + n.x * 4 * lim, y: p1.y + n.y * 4 * lim }, { x: p0.x + n.x * 4 * lim, y: p0.y + n.y * 4 * lim }]);
        }
        const seg = box([p0, p1, p1, p0]);
        if (seg.length >= 2) sk.line([seg[0], seg[1]], { stroke: col, width: 2.6, part: id, ...dash });
        sk.line([A, B], { stroke: col, width: 1.2, dash: "3 5" }, false);
        for (const P of [A, B]) sk.circle(P, 4, { fill: col, stroke: col, width: 1, part: id }, false);
        anchor = { x: mid.x + d.x * Math.min(90, R * 0.5), y: mid.y + d.y * Math.min(90, R * 0.5) };
      } else if (l.kind === "ray") {
        const A = S(l.a.x, l.a.y);
        const end = (t: number) => polar(A, 4 * lim, -t);
        if (l.to !== undefined) {
          const n = 24, fan = Array.from({ length: n + 1 }, (_, j) => end(l.from + ((l.to! - l.from) * j) / n));
          shade([A, ...fan]);
          for (const t of [l.from, l.to]) { const seg = box([A, end(t), end(t), A]); if (seg.length >= 2) sk.line([A, seg.find((p) => Math.hypot(p.x - A.x, p.y - A.y) > 1) ?? end(t)], { stroke: col, width: 2.6, part: id }); }
        } else {
          const seg = box([A, end(l.from), end(l.from), A]);
          const far = seg.reduce((best, p) => (Math.hypot(p.x - A.x, p.y - A.y) > Math.hypot(best.x - A.x, best.y - A.y) ? p : best), A);
          sk.line([A, far], { stroke: col, width: 2.6, part: id, ...dash });
        }
        // The fixed point is excluded from a half-line: an open circle.
        sk.circle(A, 5, { fill: "paper" as Ink, stroke: col, width: 2, part: id }, false);
        anchor = polar(A, Math.min(80, R * 0.45), -(l.to !== undefined ? (l.from + l.to) / 2 : l.from));
      } else {
        const v = l.c * k;
        const pts2 = l.axis === "re" ? [{ x: v, y: -lim }, { x: v, y: lim }] : [{ x: -lim, y: -v }, { x: lim, y: -v }];
        if (l.op !== "=") {
          const greater = l.op === ">" || l.op === "≥";
          const poly = l.axis === "re"
            ? (greater ? [{ x: v, y: -lim }, { x: lim, y: -lim }, { x: lim, y: lim }, { x: v, y: lim }] : [{ x: -lim, y: -lim }, { x: v, y: -lim }, { x: v, y: lim }, { x: -lim, y: lim }])
            : (greater ? [{ x: -lim, y: -lim }, { x: lim, y: -lim }, { x: lim, y: -v }, { x: -lim, y: -v }] : [{ x: -lim, y: -v }, { x: lim, y: -v }, { x: lim, y: lim }, { x: -lim, y: lim }]);
          shade(poly);
        }
        sk.line(pts2, { stroke: col, width: 2.6, part: id, ...dash });
        anchor = l.axis === "re" ? { x: v, y: -R * 0.75 } : { x: R * 0.75, y: -v };
      }
      locusAnchors[i] = anchor;
      sk.placeText(l.text.replace(/-/g, "−"), 17, anchor, { x: 1, y: -1 }, { min: 10, max: 80, fill: col, part: id });
    });

    // The first number's argument: an arc from the positive real axis to its vector.
    const P1 = first ? S(first.re, first.im) : { x: 0, y: 0 };
    let argAnchor: Pt | undefined;
    if (first && showArg && first.mod > 0 && Math.abs(first.arg) > 1e-9) {
      const r = Math.min(46, Math.hypot(P1.x, P1.y) * 0.45);
      const a1 = -first.arg;
      // The principal argument turns the short way, anticlockwise for positive arg.
      const steps = 40, arc: Pt[] = [];
      for (let i = 0; i <= steps; i++) arc.push(polar(O, r, (a1 * i) / steps));
      sk.line(arc.slice(0, -1), { stroke: PALETTE.amber, width: 2.4, part: "argument" });
      const end = arc[arc.length - 1], before = arc[arc.length - 4];
      const u = unit({ x: end.x - before.x, y: end.y - before.y }), n = { x: -u.y, y: u.x };
      sk.polygon([end, { x: end.x - u.x * 9 + n.x * 4, y: end.y - u.y * 9 + n.y * 4 }, { x: end.x - u.x * 9 - n.x * 4, y: end.y - u.y * 9 - n.y * 4 }], { fill: PALETTE.amber, stroke: PALETTE.amber, width: 1, part: "argument" });
      argAnchor = polar(O, r, a1 / 2);
      sk.placeText(`arg ${first.name} = ${argText(first.arg, degrees)}`, 17, O, unit(polar(O, 1, a1 / 2)), { min: r + 12, max: r + 70, fill: PALETTE.amber, part: "argument" });
    }

    // Each number: vector from O, the point, its name and value.
    all.forEach((p, i) => {
      const conj = showConj && i === all.length - 1;
      const id = conj ? "conjugate" : `point-${i + 1}`;
      const col: Ink = conj ? "muted" : COLOURS[i % COLOURS.length];
      const P = S(p.re, p.im);
      if (p.mod > 0) sk.line([O, P], { stroke: col, width: 2.6, part: id, ...(conj ? { dash: "6 5" } : {}) });
      sk.circle(P, 5.5, { fill: col, stroke: col, width: 1, part: id }, false);
      const label = conj && first ? `${first.name}* = ${cartesianText(first.re, -first.im)}` : `${p.name} = ${cartesianText(p.re, p.im)}`;
      sk.placeText(label, 18, P, unit(P.x || P.y ? P : { x: 1, y: -1 }), { min: 14, max: 90, fill: col, part: id });
      // Dashed projections to the axes show the real and imaginary parts.
      if (p.re !== 0 && p.im !== 0 && !conj) {
        sk.line([P, { x: P.x, y: 0 }], { stroke: col, width: 1.1, dash: "4 5" }, false);
        sk.line([P, { x: 0, y: P.y }], { stroke: col, width: 1.1, dash: "4 5" }, false);
      }
    });

    // |z| along the first vector, on the side away from the argument arc.
    let modAnchor: Pt | undefined;
    if (first && showMod && first.mod > 0) {
      const mid = mul(P1, 0.55);
      const u = unit(P1), n = { x: -u.y, y: u.x };
      const side = first.arg >= 0 ? -1 : 1;
      modAnchor = mid;
      sk.placeText(`|${first.name}| = ${modText(first.mod)}`, 17, mid, mul(n, side), { min: 14, max: 60, fill: COLOURS[0], part: "modulus" });
    }

    sk.part("real-axis", "Real axis (Re)", { x: R + 20, y: 0 });
    sk.part("imaginary-axis", "Imaginary axis (Im)", { x: 0, y: -R - 20 });
    all.forEach((p, i) => {
      const conj = showConj && i === all.length - 1;
      const name = conj && first ? `Conjugate ${first.name}* = ${cartesianText(first.re, -first.im)}` : `${p.name} = ${cartesianText(p.re, p.im)}`;
      sk.part(conj ? "conjugate" : `point-${i + 1}`, name, S(p.re, p.im));
    });
    loci.forEach((l, i) => sk.part(`locus-${i + 1}`, l.text.replace(/-/g, "−"), locusAnchors[i]));
    if (modAnchor) sk.part("modulus", `Modulus |${first.name}| = ${modText(first.mod)}`, modAnchor);
    if (argAnchor) sk.part("argument", `Argument arg ${first.name} = ${argText(first.arg, degrees)}`, argAnchor);
    return sk.finish(14);
  },
};
