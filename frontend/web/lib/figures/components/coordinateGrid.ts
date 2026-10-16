import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, add, arrow, bool, clamp, fmt, lerp, list, mul, optNum, polar, rad, sub, unit } from "./mathsKit";

/**
 * A COORDINATE GRID WITH EXACT TRANSFORMATIONS. The board gives points, a shape, an optional line
 * (a parsed linear or quadratic equation) and one transformation — reflection in a line, rotation
 * about a centre, translation by a vector, enlargement by any scale factor (negative and fractional
 * too) about a centre. The code computes the image itself, so A′ always lands on the right grid point,
 * and draws the object (blue) and the image (red, primed letters) distinctly on equal-scaled axes.
 */

export type Named = { name: string; p: Pt };
/** y = a·x² + b·x + c, or the vertical line x = k. */
export type Curve = { kind: "fn"; a: number; b: number; c: number } | { kind: "vertical"; x: number };
export type Transform =
  | { kind: "reflection"; mirror: Curve }
  | { kind: "rotation"; angle: number; centre: Pt }
  | { kind: "translation"; vector: Pt }
  | { kind: "enlargement"; k: number; centre: Pt };

const LIM = 20;
const NUM = String.raw`[-−]?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?`;

/** "3", "−2.5", "-1/2" → number. */
export function parseNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.replace(/−/g, "-").replace(/\s+/g, "");
  const m = /^([-+]?\d*\.?\d+)\/(\d*\.?\d+)$/.exec(s);
  if (m) {
    const d = Number(m[2]);
    return d ? Number(m[1]) / d : undefined;
  }
  return optNum(s);
}

/** "A(1,2); B(4,6)" / "(1,2) (4,6)" → named points (unnamed ones lettered from `first`). */
export function parsePoints(v: unknown, first = "A", max = 10): Named[] {
  const s = String(v ?? "").slice(0, 400);
  const re = new RegExp(String.raw`([A-Za-z][′'’]*\d?)?\s*[=:]?\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)`, "g");
  const out: Named[] = [];
  let next = first.charCodeAt(0);
  for (const m of s.matchAll(re)) {
    const x = parseNum(m[2]), y = parseNum(m[3]);
    if (x === undefined || y === undefined) continue;
    let name = (m[1] ?? "").replace(/['’]/g, "′");
    if (!name) {
      while (out.some((o) => o.name === String.fromCharCode(next))) next++;
      name = String.fromCharCode(Math.min(next++, 90));
    }
    out.push({ name: name.slice(0, 3), p: { x: clamp(x, -LIM, LIM), y: clamp(y, -LIM, LIM) } });
    if (out.length >= max) break;
  }
  return out;
}

/** One side of an equation as coefficients of x², x, y and 1 ("2x+1", "x^2-3x", "1/2x"). */
function sideTerms(raw: string): { x2: number; x: number; y: number; c: number } | null {
  let s = raw.replace(/\s+/g, "").replace(/−/g, "-").replace(/²/g, "^2").replace(/[*×·]/g, "");
  if (!s) return null;
  if (!/^[+-]/.test(s)) s = "+" + s;
  const re = /([+-])(\d*\.?\d*(?:\/\d*\.?\d+)?)(x\^2|x|y)?/y;
  const t = { x2: 0, x: 0, y: 0, c: 0 };
  let at = 0;
  while (at < s.length) {
    re.lastIndex = at;
    const m = re.exec(s);
    if (!m || m[0].length <= 1 && !m[3]) return null;
    const coef = m[2] === "" ? (m[3] ? 1 : NaN) : parseNum(m[2]) ?? NaN;
    if (!Number.isFinite(coef)) return null;
    const v = (m[1] === "-" ? -1 : 1) * coef;
    if (m[3] === "x^2") t.x2 += v;
    else if (m[3] === "x") t.x += v;
    else if (m[3] === "y") t.y += v;
    else t.c += v;
    at = re.lastIndex;
  }
  return t;
}

/** "y = 2x + 1", "y = x² − 4", "x = 3", "2x + 3y = 6", "the y-axis" → a curve (null if unreadable). */
export function parseCurve(v: unknown, linearOnly = false): Curve | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.toLowerCase().replace(/\b(the|line|mirror|of)\b/g, " ").trim();
  if (/^y[- ]?axis$/.test(s.trim())) return { kind: "vertical", x: 0 };
  if (/^x[- ]?axis$/.test(s.trim())) return { kind: "fn", a: 0, b: 0, c: 0 };
  const sides = s.split("=");
  if (sides.length > 2) return null;
  const L = sideTerms(sides.length === 2 ? sides[0] : "y"), R = sideTerms(sides.length === 2 ? sides[1] : sides[0]);
  if (!L || !R) return null;
  const k = { x2: L.x2 - R.x2, x: L.x - R.x, y: L.y - R.y, c: L.c - R.c };
  if (linearOnly && Math.abs(k.x2) > 1e-12) return null;
  if (Math.abs(k.y) > 1e-12) {
    const curve = { kind: "fn" as const, a: -k.x2 / k.y + 0, b: -k.x / k.y + 0, c: -k.c / k.y + 0 };
    return [curve.a, curve.b, curve.c].every((n) => Number.isFinite(n) && Math.abs(n) < 1e4) ? curve : null;
  }
  if (Math.abs(k.x2) < 1e-12 && Math.abs(k.x) > 1e-12) return { kind: "vertical", x: clamp(-k.c / k.x, -LIM, LIM) };
  return null;
}

/** The curve written the textbook way: "y = 2x + 1", "y = x² − 4", "x = 3". */
export function curveText(c: Curve): string {
  if (c.kind === "vertical") return `x = ${fmt(c.x, 2)}`;
  const terms: string[] = [];
  const coef = (n: number, v: string) => (v && Math.abs(Math.abs(n) - 1) < 1e-9 ? "" : fmtFrac(Math.abs(n))) + v;
  for (const [n, v] of [[c.a, "x²"], [c.b, "x"], [c.c, ""]] as Array<[number, string]>) {
    if (Math.abs(n) < 1e-9) continue;
    terms.push(`${terms.length ? (n < 0 ? " − " : " + ") : n < 0 ? "−" : ""}${coef(n, v)}`);
  }
  return `y = ${terms.join("") || "0"}`;
}
function fmtFrac(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-9) return fmt(n, 0);
  for (let d = 2; d <= 12; d++) if (Math.abs(n * d - Math.round(n * d)) < 1e-9) return `${Math.round(n * d)}/${d}`;
  return fmt(n, 2);
}

const tidy = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/** The image of a point under the transformation (math coordinates, y up). */
export function transformPoint(t: Transform, p: Pt): Pt {
  let q: Pt;
  switch (t.kind) {
    case "reflection": {
      // The mirror as A·x + B·y + C = 0.
      const [A, B, C] = t.mirror.kind === "vertical" ? [1, 0, -t.mirror.x] : [t.mirror.b, -1, t.mirror.c];
      const d = (A * p.x + B * p.y + C) / (A * A + B * B);
      q = { x: p.x - 2 * A * d, y: p.y - 2 * B * d };
      break;
    }
    case "rotation": {
      const a = rad(t.angle), c = Math.cos(a), s = Math.sin(a), v = sub(p, t.centre);
      q = { x: t.centre.x + v.x * c - v.y * s, y: t.centre.y + v.x * s + v.y * c };
      break;
    }
    case "translation":
      q = add(p, t.vector);
      break;
    case "enlargement":
      q = add(t.centre, mul(sub(p, t.centre), t.k));
      break;
  }
  return { x: tidy(q.x), y: tidy(q.y) };
}

/** Read the transformation from the params (the kind may carry the details: "reflect in y = x"). */
export function parseTransform(params: FigureParams): Transform | null {
  const kindRaw = String(params.transform ?? params.transformation ?? "").toLowerCase().slice(0, 200);
  const centre = parsePoints(params.centre ?? params.center)[0]?.p ?? parsePoints(kindRaw.replace(/[a-z]+\s*(?=\()/g, " "))[0]?.p ?? { x: 0, y: 0 };
  if (/reflect/.test(kindRaw) || (!kindRaw && params.mirror !== undefined)) {
    const fromKind = /\bin\s+(.+)$/.exec(kindRaw)?.[1];
    const mirror = parseCurve(params.mirror, true) ?? parseCurve(fromKind ?? "", true) ?? { kind: "vertical", x: 0 };
    return { kind: "reflection", mirror };
  }
  if (/rotat|turn/.test(kindRaw)) {
    const given = optNum(params.angle) ?? optNum(/(-?\d+(?:\.\d+)?)\s*°?/.exec(kindRaw)?.[1]) ?? (/half/.test(kindRaw) ? 180 : /quarter/.test(kindRaw) ? 90 : 90);
    const dirText = `${String(params.direction ?? "")} ${String(params.angle ?? "")} ${kindRaw}`.toLowerCase();
    const clockwise = /(?<!anti-?\s?)clockwise/.test(dirText) && !/anti-?\s?clockwise|counter/.test(dirText);
    const angle = clamp(given, -360, 360) * (clockwise ? -1 : 1);
    return { kind: "rotation", angle, centre };
  }
  if (/translat/.test(kindRaw)) {
    const raw = params.vector ?? kindRaw.replace(/^[^(\d-−]*/, "");
    const nums = list(raw, /[,;\s]+/).map((s) => parseNum(s));
    const vector = nums.length >= 2 && nums[0] !== undefined && nums[1] !== undefined ? { x: clamp(nums[0], -LIM, LIM), y: clamp(nums[1], -LIM, LIM) } : { x: 3, y: -2 };
    return { kind: "translation", vector };
  }
  if (/enlarg|dilat/.test(kindRaw)) {
    const k = parseNum(params.scaleFactor ?? params.scale) ?? parseNum(/(?:scale factor|sf|factor)\s*(-?\s*[\d./−-]+)/.exec(kindRaw)?.[1]?.replace(/\s/g, "")) ?? 2;
    return { kind: "enlargement", k: Math.abs(k) < 1e-6 ? 2 : clamp(k, -5, 5), centre };
  }
  return null;
}

const PARTS = [
  { id: "axes", name: "x- and y-axes" },
  { id: "object", name: "Object (the shape)" },
  { id: "vertex", name: "Vertex A" },
  { id: "image", name: "Image A′B′C′" },
  { id: "image-vertex", name: "Image vertex A′" },
  { id: "mirror-line", name: "Mirror line" },
  { id: "centre", name: "Centre of rotation/enlargement" },
  { id: "vector", name: "Translation vector" },
  { id: "line", name: "The plotted line/curve" },
  { id: "point", name: "The first plotted point" },
];

const SHAPE_NAME = ["Point", "Segment", "Triangle", "Quadrilateral", "Pentagon", "Hexagon", "Heptagon", "Octagon"];
const cap = (s: string, n = 34) => (s.length <= n ? s : s.slice(0, n - 1) + "…");
const coord = (p: Pt) => `(${fmt(p.x, 2)}, ${fmt(p.y, 2)})`;

export const coordinateGrid: FigureComponent = {
  name: "coordinateGrid",
  title: "A coordinate grid on equal-scaled axes: plotted points, a shape, a line or quadratic from its equation, and a transformation (reflection, rotation, translation, enlargement) whose image A′B′C′ the code computes and draws beside the object",
  params: `shape (the object's vertices, e.g. "A(1,1); B(4,1); C(1,3)"; 1-10 points; default that triangle when a transformation is asked for or nothing else is given); points (extra plotted points, e.g. "P(2,3); Q(-1,4)"); segments (joins between named points, e.g. "PQ; QR"); line (an equation to plot, linear or quadratic, e.g. "y = 2x + 1", "y = x^2 - 3", "x = 2", "2x + 3y = 6"); transform ("reflection" | "rotation" | "translation" | "enlargement", or in words like "reflect in y = x", "rotate 90° clockwise about (0,0)"); mirror (for reflection: "x = 2", "y = -1", "y = x", "y = -x", "the y-axis", any straight line); angle (rotation in degrees, positive anticlockwise; or "90 clockwise"); direction ("clockwise" | "anticlockwise"); centre (rotation/enlargement centre "(0,0)"); vector (translation "3,-2"); scaleFactor (enlargement, e.g. 2, -1, "1/2", -0.5); xRange, yRange (e.g. "-6,6"; widened to fit everything; coordinates limited to ±20); coords (true: write each object vertex's coordinates; default false; plotted points always show theirs); guides (true default: enlargement rays from the centre and the rotation arc). Parts exist only for what is drawn.`,
  match: /\bcoordinate (grid|plane|axes|geometry)\b|\bcartesian (plane|grid)\b|\bplot(ting)? (the )?(points?|coordinates)\b|\breflect(ed|ion|ing)?\b[^.]{0,30}\b(in|across) the (line|x-axis|y-axis|mirror line)|\bmirror line\b|\bline of reflection\b|\brotat(e|ed|ion|ing)\b[^.]{0,40}\babout (the )?(origin|point|centre|\()|\bcentre of (rotation|enlargement)\b|\benlarge(ment|d)?\b[^.]{0,30}\bscale factor\b|\bnegative (scale factor|enlargement)\b|\btranslat(ed|ion|e)\b[^.]{0,20}\bby (the )?(column )?vector\b|\b(combined|geometric|single) transformations?\b|\btransformations? (of|on) (a )?(shapes?|triangles?|polygons?)\b|\btransformations?\b(?=[\s\S]{0,160}\b(shape|triangle|polygon|object|image|column vector|mirror line|scale factor)\b)|\bmidpoint of (a|the) (line )?segment\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const transform = parseTransform(params);
    const pts = parsePoints(params.points, "P");
    const line = parseCurve(params.line ?? params.equation);
    let shape = parsePoints(params.shape ?? params.object ?? params.polygon);
    if (!shape.length && (transform || (!pts.length && !line))) shape = parsePoints("A(1,1); B(4,1); C(1,3)");
    // Letters must be unique across the figure.
    const used = new Set(shape.map((s) => s.name));
    const points = pts.filter((p) => !used.has(p.name));
    const named = new Map([...shape, ...points].map((n) => [n.name, n.p]));
    const image = transform ? shape.map((s) => ({ name: `${s.name.replace(/′+$/, "")}′`, p: transformPoint(transform, s.p) })) : [];
    const segs: Array<[Pt, Pt]> = [];
    for (const item of list(params.segments, /[;,]/)) {
      const m = /^([A-Z][′']?\d?)\s*[-–]?\s*([A-Z][′']?\d?)$/.exec(item.trim());
      if (m && named.has(m[1]) && named.has(m[2]) && m[1] !== m[2]) segs.push([named.get(m[1])!, named.get(m[2])!]);
    }
    const coords = bool(params.coords, false);
    const guides = bool(params.guides, true);

    // The window: everything drawn, the origin, any range asked for; equal scale on both axes.
    const all: Pt[] = [{ x: 0, y: 0 }, ...shape.map((s) => s.p), ...image.map((s) => s.p), ...points.map((s) => s.p)];
    if (transform && (transform.kind === "rotation" || transform.kind === "enlargement")) all.push(transform.centre);
    const range = (v: unknown): [number, number] | undefined => {
      const n = list(v, /[,;]|\bto\b|\.\./).map((s) => parseNum(s));
      return n.length >= 2 && n[0] !== undefined && n[1] !== undefined && n[0] !== n[1] ? [clamp(Math.min(n[0], n[1]), -LIM, LIM), clamp(Math.max(n[0], n[1]), -LIM, LIM)] : undefined;
    };
    const xr = range(params.xRange), yr = range(params.yRange);
    let x0 = Math.floor(Math.min(...all.map((p) => p.x), xr?.[0] ?? 0)) - 1, x1 = Math.ceil(Math.max(...all.map((p) => p.x), xr?.[1] ?? 0)) + 1;
    let y0 = Math.floor(Math.min(...all.map((p) => p.y), yr?.[0] ?? 0)) - 1, y1 = Math.ceil(Math.max(...all.map((p) => p.y), yr?.[1] ?? 0)) + 1;
    if (xr) (x0 = Math.min(x0 + 1, xr[0]), x1 = Math.max(x1 - 1, xr[1]));
    if (yr) (y0 = Math.min(y0 + 1, yr[0]), y1 = Math.max(y1 - 1, yr[1]));
    // A plotted line alone gets a sensible window; anything else at least 6 squares each way.
    const minSpan = shape.length || points.length ? 6 : 8;
    if (!xr && x1 - x0 < minSpan) (x0 = Math.min(x0, line ? -minSpan / 2 : x1 - minSpan), x1 = Math.max(x1, x0 + minSpan));
    if (!yr && y1 - y0 < minSpan) (y0 = Math.min(y0, line ? -minSpan / 2 : y1 - minSpan), y1 = Math.max(y1, y0 + minSpan));
    x0 = Math.floor(x0), x1 = Math.ceil(x1), y0 = Math.floor(y0), y1 = Math.ceil(y1);
    const cell = Math.min(560 / (x1 - x0), 420 / (y1 - y0));
    const S = (p: Pt): Pt => ({ x: p.x * cell, y: -p.y * cell });
    const step = cell >= 26 ? 1 : cell >= 13 ? 2 : 5;

    const sk = new Sketch();
    // Grid, then axes with arrowheads at the positive ends.
    for (let x = x0; x <= x1; x++) sk.line([S({ x, y: y0 }), S({ x, y: y1 })], { stroke: "muted", width: x % step ? 0.6 : 1, opacity: x % step ? 0.2 : 0.38 }, false);
    for (let y = y0; y <= y1; y++) sk.line([S({ x: x0, y }), S({ x: x1, y })], { stroke: "muted", width: y % step ? 0.6 : 1, opacity: y % step ? 0.2 : 0.38 }, false);
    arrow(sk, S({ x: x0, y: 0 }), add(S({ x: x1, y: 0 }), { x: 14, y: 0 }), "ink", 1.8, "axes", 11);
    arrow(sk, S({ x: 0, y: y0 }), add(S({ x: 0, y: y1 }), { x: 0, y: -14 }), "ink", 1.8, "axes", 11);

    // A curve clipped to the window: sampled, split where it leaves, ends cut exactly at the edge.
    const plot = (c: Curve, style: { stroke: string; width: number; dash?: string; part: string }): Pt[][] => {
      if (c.kind === "vertical") {
        if (c.x < x0 || c.x > x1) return [];
        const run = [{ x: c.x, y: y0 }, { x: c.x, y: y1 }];
        sk.line(run.map(S), { ...style, stroke: style.stroke as `#${string}` });
        return [run];
      }
      const f = (x: number) => c.a * x * x + c.b * x + c.c;
      const n = c.a ? 400 : 1;
      const runs: Pt[][] = [];
      let run: Pt[] = [];
      const inside = (y: number) => y >= y0 - 1e-9 && y <= y1 + 1e-9;
      const edge = (xa: number, xb: number) => {
        // Where between xa (inside) and xb (outside) the curve meets the window's top or bottom.
        let lo = xa, hi = xb;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (inside(f(mid))) lo = mid;
          else hi = mid;
        }
        return { x: lo, y: clamp(f(lo), y0, y1) };
      };
      if (!c.a) {
        // A straight line: clip exactly.
        let ta = x0, tb = x1;
        if (Math.abs(c.b) > 1e-12) {
          const xa = (y0 - c.c) / c.b, xb = (y1 - c.c) / c.b;
          ta = Math.max(x0, Math.min(xa, xb));
          tb = Math.min(x1, Math.max(xa, xb));
        } else if (!inside(c.c)) return [];
        if (tb - ta < 1e-9) return [];
        runs.push([{ x: ta, y: f(ta) }, { x: tb, y: f(tb) }]);
      } else {
        let prev: number | undefined;
        for (let i = 0; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n, y = f(x);
          if (inside(y)) {
            if (!run.length && prev !== undefined) run.push(edge(x, prev));
            run.push({ x, y });
          } else if (run.length) {
            run.push(edge(prev!, x));
            runs.push(run);
            run = [];
          }
          prev = x;
        }
        if (run.length > 1) runs.push(run);
      }
      for (const r of runs) sk.line(r.map(S), { ...style, stroke: style.stroke as `#${string}` });
      return runs;
    };

    let mirrorRuns: Pt[][] = [];
    if (transform?.kind === "reflection") mirrorRuns = plot(transform.mirror, { stroke: PALETTE.green, width: 2.6, dash: "9 6", part: "mirror-line" });
    const lineRuns = line ? plot(line, { stroke: PALETTE.amber, width: 2.8, part: "line" }) : [];

    // Guides under the shapes: enlargement rays through each vertex, the rotation arc of A.
    if (transform && guides && shape.length) {
      if (transform.kind === "enlargement") {
        for (let i = 0; i < shape.length; i++) {
          const far = [shape[i].p, image[i].p, transform.centre];
          const t = (p: Pt) => (p.x - transform.centre.x) * (shape[i].p.x - transform.centre.x) + (p.y - transform.centre.y) * (shape[i].p.y - transform.centre.y);
          const ends = far.sort((a, b) => t(a) - t(b));
          sk.line([S(ends[0]), S(ends[2])], { stroke: PALETTE.violet, width: 1.3, dash: "5 5", opacity: 0.8, part: "centre" }, false);
        }
      } else if (transform.kind === "rotation" && Math.abs(transform.angle) % 360 > 1e-6) {
        const c = S(transform.centre), a = S(shape[0].p), r = Math.hypot(a.x - c.x, a.y - c.y);
        if (r > 8) {
          const a0 = Math.atan2(a.y - c.y, a.x - c.x), sweep = -rad(transform.angle); // screen y is down
          const n = Math.max(6, Math.ceil(Math.abs(sweep) / 0.06));
          sk.line(Array.from({ length: n + 1 }, (_, i) => polar(c, r, a0 + (sweep * i) / n)), { stroke: PALETTE.violet, width: 1.5, dash: "5 5", opacity: 0.85, part: "centre" }, false);
        }
      }
    }

    // Object and image: filled tints with strong outlines; points and segments for 1-2 vertices.
    // The tint is a separate translucent fill so the outline stays strong.
    const tint = (s: Named[], colour: `#${string}`, part: string) => {
      if (s.length >= 3) sk.polygon(s.map((v) => S(v.p)), { fill: colour, opacity: 0.14, stroke: "none", part }, false);
    };
    tint(shape, PALETTE.blue, "object");
    if (image.length) tint(image, PALETTE.red, "image");
    for (const [p, q] of segs) sk.line([S(p), S(q)], { stroke: "ink", width: 2.4, ...(points.length ? { part: "point" } : shape.length ? { part: "object" } : {}) });
    const outline = (s: Named[], colour: `#${string}`, part: string) => {
      if (s.length >= 3) sk.polygon(s.map((v) => S(v.p)), { fill: "none", stroke: colour, width: 2.6, part });
      else if (s.length === 2) sk.line(s.map((v) => S(v.p)), { stroke: colour, width: 2.8, part });
      for (const v of s) sk.circle(S(v.p), 3.6, { fill: colour, stroke: colour, width: 1, part }, false);
    };
    outline(shape, PALETTE.blue, "object");
    if (image.length) outline(image, PALETTE.red, "image");
    if (transform?.kind === "translation" && shape.length) arrow(sk, S(shape[0].p), S(image[0].p), PALETTE.amber, 2.6, "vector", 12);
    if (transform && (transform.kind === "rotation" || transform.kind === "enlargement")) {
      const c = S(transform.centre);
      sk.circle(c, 5, { fill: PALETTE.violet, stroke: PALETTE.violet, width: 1, part: "centre" });
    }
    for (const p of points) sk.circle(S(p.p), 4.5, { fill: "ink", stroke: "ink", width: 1, part: "point" }, false);

    // Letters outside each shape, away from its centre; plotted points with their coordinates.
    const letters = (s: Named[], colour: `#${string}`, part: string, withCoords: boolean) => {
      if (!s.length) return;
      const g = mul(s.reduce((t, v) => add(t, S(v.p)), { x: 0, y: 0 }), 1 / s.length);
      for (const v of s) {
        const P = S(v.p);
        let out = unit(sub(P, g));
        if (s.length === 1 || Math.hypot(P.x - g.x, P.y - g.y) < 1) out = { x: 0.7, y: -0.7 };
        const rot = (d: Pt, a: number) => ({ x: d.x * Math.cos(a) - d.y * Math.sin(a), y: d.x * Math.sin(a) + d.y * Math.cos(a) });
        const dirs = [out, rot(out, 0.6), rot(out, -0.6), rot(out, 1.2), rot(out, -1.2), { x: 0, y: -1 }, { x: 0, y: 1 }];
        const text = withCoords ? `${v.name}${coord(v.p)}` : v.name;
        sk.placeLetter(text, withCoords ? 17 : 20, P, dirs, { fill: colour, part, min: withCoords ? 16 : 11, max: 60 });
      }
    };
    letters(shape, PALETTE.blue, "object", coords);
    letters(image, PALETTE.red, "image", coords);
    letters(points, "#1f2937", "point", true);
    if (transform?.kind === "rotation" && Math.abs(transform.angle) % 360 > 1e-6 && guides && shape.length) {
      const c = S(transform.centre), a = S(shape[0].p), r = Math.hypot(a.x - c.x, a.y - c.y);
      if (r > 8) {
        const mid = polar(c, r, Math.atan2(a.y - c.y, a.x - c.x) - rad(transform.angle) / 2);
        const text = `${fmt(Math.abs(transform.angle))}°${transform.angle < 0 ? " ↻" : " ↺"}`;
        sk.placeText(text, 17, mid, unit(sub(mid, c)), { min: 10, max: 60, fill: PALETTE.violet, part: "centre" });
      }
    }
    sk.placeLetter("O", 18, S({ x: 0, y: 0 }), [{ x: -0.75, y: 0.75 }, { x: 0.75, y: 0.75 }, { x: -0.75, y: -0.75 }, { x: 0.75, y: -0.75 }], { part: "axes", min: 9, max: 30 });
    sk.text(add(S({ x: x1, y: 0 }), { x: 24, y: 14 }), "x", 19, "ink", "axes");
    sk.text(add(S({ x: 0, y: y1 }), { x: 15, y: -16 }), "y", 19, "ink", "axes");

    // Axis numbers last, wherever they are clear of everything above.
    for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) if (x) {
      const t = fmt(x, 0);
      for (const dy of [13, -13]) {
        const at = add(S({ x, y: 0 }), { x: 0, y: dy });
        if (!sk.blocked({ x: at.x - t.length * 4.2, y: at.y - 6, w: t.length * 8.4, h: 12 }, 1)) {
          sk.text(at, t, 14, "muted");
          break;
        }
      }
    }
    for (let y = Math.ceil(y0 / step) * step; y < y1; y += step) if (y) {
      const t = fmt(y, 0);
      for (const dx of [-6 - t.length * 4.2, 6 + t.length * 4.2]) {
        const at = add(S({ x: 0, y }), { x: dx, y: 0 });
        if (!sk.blocked({ x: at.x - t.length * 4.2, y: at.y - 6, w: t.length * 8.4, h: 12 }, 1)) {
          sk.text(at, t, 14, "muted");
          break;
        }
      }
    }

    // Parts, each anchored exactly on what it names.
    sk.part("axes", "x- and y-axes", S({ x: 0, y: y1 - 0.5 * step }));
    const word = (n: number) => SHAPE_NAME[Math.min(n, 8) - 1] ?? "Shape";
    const nameOf = (s: Named[]) => s.map((v) => v.name).join("");
    const centroid = (s: Named[]) => S(mul(s.reduce((t, v) => add(t, v.p), { x: 0, y: 0 }), 1 / s.length));
    if (shape.length) {
      sk.part("object", cap(`${transform ? "Object" : word(shape.length)} ${nameOf(shape)}`), shape.length >= 3 ? centroid(shape) : shape.length === 2 ? lerp(S(shape[0].p), S(shape[1].p), 0.5) : S(shape[0].p));
      if (shape.length > 1) sk.part("vertex", cap(`Vertex ${shape[0].name}${coord(shape[0].p)}`), S(shape[0].p));
    }
    if (image.length) {
      sk.part("image", cap(`Image ${nameOf(image)}`), image.length >= 3 ? centroid(image) : image.length === 2 ? lerp(S(image[0].p), S(image[1].p), 0.5) : S(image[0].p));
      sk.part("image-vertex", cap(`Vertex ${image[0].name}${coord(image[0].p)}`), S(image[0].p));
    }
    const runAnchor = (runs: Pt[][]) => {
      const cands: Pt[] = [];
      for (const r of runs) for (const t of [0.85, 0.15, 0.7, 0.3, 0.5]) {
        const i = (r.length - 1) * t, j = Math.floor(i);
        cands.push(S(lerp(r[j], r[Math.min(j + 1, r.length - 1)], i - j)));
      }
      return cands.length ? sk.clearAnchor(cands) : undefined;
    };
    if (transform?.kind === "reflection") {
      const a = runAnchor(mirrorRuns);
      if (a) sk.part("mirror-line", cap(`Mirror line ${curveText(transform.mirror)}`), a);
    }
    if (transform && (transform.kind === "rotation" || transform.kind === "enlargement")) {
      sk.part("centre", cap(`Centre of ${transform.kind} ${coord(transform.centre)}`), S(transform.centre));
    }
    if (transform?.kind === "translation" && shape.length) sk.part("vector", cap(`Translation (${fmt(transform.vector.x, 2)}, ${fmt(transform.vector.y, 2)})`), lerp(S(shape[0].p), S(image[0].p), 0.5));
    if (line) {
      const a = runAnchor(lineRuns);
      if (a) sk.part("line", cap(`Line ${curveText(line)}`.replace(/^Line (y = .*x²)/, "Curve $1")), a);
    }
    if (points.length) sk.part("point", cap(`Point ${points[0].name}${coord(points[0].p)}`), S(points[0].p));
    return sk.finish(12);
  },
};
