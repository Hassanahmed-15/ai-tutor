import { fitText } from "../cuts";
import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { PALETTE, Sketch, bool, clamp, dist, fmt, optNum, str, textW } from "./mathsKit";
import {
  autoY, coordText, normalizeExpr, piFmt, derivative, dot, drawAxes, drawCurve, fn1, horizontalAsymptote, integrate, makePlot, prettyExpr, snap, valueText, verticalAsymptotes, windowFrom, zeros, type Plot,
} from "./calculusKit";

/**
 * THE GRAPH OF A FUNCTION (one or two), with its features found by code: roots, turning points,
 * the y-intercept, vertical and horizontal asymptotes, intersections, a tangent with its gradient,
 * and a shaded region (under a curve, between two curves, or above/below for an inequality) with
 * its area. The model writes only the formulas and what to mark — every number is computed.
 */

export type GraphFeatures = {
  roots: number[];
  turning: Array<{ x: number; y: number; kind: "max" | "min" }>;
  yIntercept?: number;
  vertical: number[];
  horizontal: number[];
  intersections: Array<{ x: number; y: number }>;
};

/** Every feature of f (and of f against g) on [a, b]. */
export function graphFeatures(f: (x: number) => number, a: number, b: number, g?: ((x: number) => number) | null): GraphFeatures {
  const span = b - a;
  const vertical = verticalAsymptotes(f, a, b);
  const nearPole = (x: number) => vertical.some((v) => Math.abs(v - x) < span * 1e-3);
  const roots = zeros(f, a, b).filter((x) => !nearPole(x));
  const d = (x: number) => derivative(f, x, span / 10);
  const turning = zeros(d, a, b, 1200, 1e-5, false)
    .filter((x) => !nearPole(x) && Number.isFinite(f(x)))
    .map((x) => {
      const h = span * 1e-3;
      const kind: "max" | "min" = f(x - h) + f(x + h) - 2 * f(x) < 0 ? "max" : "min";
      return { x: snap(x), y: snap(f(x)), kind };
    })
    .filter((t) => Number.isFinite(t.y) && Math.abs(f(t.x - span * 1e-3) - t.y) > 1e-12);
  const y0 = a <= 0 && b >= 0 ? f(0) : NaN;
  const horizontal: number[] = [];
  // A constant function has no asymptote; nor does one that never settles.
  const varies = Math.abs(f(a + span * 0.31) - f(a + span * 0.73)) > 1e-9;
  if (varies) for (const dir of [1, -1] as const) {
    const L = horizontalAsymptote(f, dir);
    if (L !== undefined && !horizontal.includes(L)) horizontal.push(L);
  }
  const intersections = g
    ? zeros((x) => f(x) - g(x), a, b).filter((x) => !nearPole(x) && Number.isFinite(g(x))).map((x) => ({ x: snap(x), y: snap(f(x)) }))
    : [];
  if (g) {
    for (const v of verticalAsymptotes(g, a, b)) if (!vertical.some((w) => Math.abs(w - v) < span * 1e-3)) vertical.push(v);
    const gVaries = Math.abs(g(a + span * 0.31) - g(a + span * 0.73)) > 1e-9;
    if (gVaries) for (const dir of [1, -1] as const) {
      const L = horizontalAsymptote(g, dir);
      if (L !== undefined && !horizontal.includes(L)) horizontal.push(L);
    }
    vertical.sort((p, q) => p - q);
  }
  return { roots, turning, yIntercept: Number.isFinite(y0) ? snap(y0) : undefined, vertical, horizontal, intersections };
}

const PARTS = [
  { id: "curve", name: "Curve y = f(x)" },
  { id: "second-curve", name: "Curve y = g(x)" },
  { id: "root", name: "Root (x-intercept)" },
  { id: "turning-point", name: "Turning point" },
  { id: "y-intercept", name: "y-intercept" },
  { id: "asymptote", name: "Asymptote" },
  { id: "intersection", name: "Point of intersection" },
  { id: "shaded-region", name: "Shaded region" },
  { id: "tangent", name: "Tangent" },
];

type Feat = "roots" | "turning" | "intercept" | "asymptotes" | "intersections";

function parseFeatures(v: unknown): Set<Feat> {
  const s = String(v ?? "auto").toLowerCase();
  const all: Feat[] = ["roots", "turning", "intercept", "asymptotes", "intersections"];
  if (/^\s*(auto|all|default)?\s*$/.test(s)) return new Set(all);
  if (/^\s*(none|no|false|off)\s*$/.test(s)) return new Set();
  const out = new Set<Feat>();
  if (/root|zero|x[- ]?int/.test(s)) out.add("roots");
  if (/turn|stationary|max|min|vertex|critical/.test(s)) out.add("turning");
  if (/y[- ]?int/.test(s)) out.add("intercept");
  if (/asym/.test(s)) out.add("asymptotes");
  if (/inters|meet/.test(s)) out.add("intersections");
  if (/^\s*intercepts?\s*$/.test(s)) (out.add("roots"), out.add("intercept"));
  return out;
}

export const functionGraph: FigureComponent = {
  name: "functionGraph",
  title: "The graph of a function y = f(x) (polynomial, exponential, logarithmic, trigonometric, reciprocal), optionally with a second curve, with roots, turning points, intercepts, asymptotes, intersections, a tangent and a shaded area all computed",
  params: `f (the function of x, e.g. "x^2 - 2x - 3", "e^x", "ln(x)", "sin(x)", "1/(x-2) + 1"; default "x^2 - 2x - 3"); g (an optional second function, e.g. "x + 1"); xmin, xmax, ymin, ymax (window; default fits the features); features (what to mark, e.g. "roots, turning points, y-intercept, asymptotes, intersections"; default all that exist; "none"); coordinates (true default: write each marked point's coordinates); shade ("none" default | "under": between f and the x-axis | "between": between f and g | "above" / "below": the region y > f(x) or y < f(x), for inequalities); shadeFrom, shadeTo (the x-interval to shade; default between the roots or intersections); tangentAt (draw the tangent at x = this value, with its gradient); fName, gName (curve names, default "f", "g"). The code finds every value — never give coordinates.`,
  match: /\b(sketch|graph|plot|draw)\w*\b.{0,40}(\by\s*=|\bf\(x\)|\b(function|curve|parabola|cubic|quadratic|polynomial|exponential|logarithm\w*|reciprocal|hyperbola)s?\b)|\bturning points?\b(?=[\s\S]*\b(graphs?|curves?|functions?|derivatives?|stationary|maxim(um|a)|minim(um|a)|gradient|quadratic|cubic|y\s*=)\b)|\bstationary points?\b|\b(vertical|horizontal) asymptotes?\b|\bpoints? of intersection\b|\barea between (two |the )?curves\b|\btangent (to|at) (the curve|x\s*=)\b|\b(roots|zeros) of (the|a) (function|polynomial|graph|curve|quadratic|cubic)\b|\bgraphical(ly)? solv\w*\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const fSrc = str(params.f, "x^2 - 2x - 3", 200);
    const fParsed = fn1(fSrc);
    const f = fParsed ?? ((x: number) => x * x - 2 * x - 3);
    const fShown = fParsed ? fSrc : "x^2 - 2x - 3";
    const g = params.g !== undefined ? fn1(params.g) : null;
    const gShown = g ? String(params.g) : "";
    // A curve the writer NAMES in words ("Primary response") is labelled by that name; the maths text
    // keeps the symbol. Cutting the words to a 6-letter symbol drew "Curve y = Primar(x)" (2026-10-17).
    // A formula keeps its case ("m = 6l³" is not "M = 6l³": a capital is another variable); only a name
    // in words starts with a capital ("primary response" → "Primary response").
    const worded = (v: unknown) => {
      if (typeof v !== "string" || !(/\s/.test(v.trim()) || v.trim().length > 6)) return "";
      const t = v.trim();
      return /[=<>≤≥^/()]|\d/.test(t) || !/^[a-z]{3,}/i.test(t) ? t : t.replace(/^./, (c) => c.toUpperCase());
    };
    const fWords = worded(params.fName), gWords = worded(params.gName);
    const fName = fWords ? "f" : str(params.fName, "f", 6), gName = gWords ? "g" : str(params.gName, "g", 6);
    const feats = parseFeatures(params.features);
    const coords = bool(params.coordinates, true);
    const trig = /(sin|cos|tan)\s*\(/.test(normalizeExpr(fShown) + " " + normalizeExpr(gShown));

    // The window: the board's, or one that frames every feature found on a wide search.
    const search = trig ? { a: -2 * Math.PI, b: 2 * Math.PI } : { a: -10, b: 10 };
    let x0: number, x1: number;
    const given = windowFrom(params, { x0: search.a, x1: search.b, y0: -5, y1: 5 });
    if (given.given.x) [x0, x1] = [given.x0, given.x1];
    else if (trig) [x0, x1] = [search.a, search.b];
    else {
      const wide = graphFeatures(f, search.a, search.b, g);
      const xs = [0, ...wide.roots, ...wide.turning.map((t) => t.x), ...wide.vertical, ...wide.intersections.map((p) => p.x)];
      const ta = optNum(params.tangentAt);
      if (ta !== undefined && Math.abs(ta) < 1e3) xs.push(ta);
      for (const k of ["shadeFrom", "shadeTo"]) { const v = optNum(params[k]); if (v !== undefined && Math.abs(v) < 1e3) xs.push(v); }
      const lo = Math.min(...xs), hi = Math.max(...xs);
      const pad = Math.max(wide.vertical.length ? 2.5 : 1.5, (hi - lo) * 0.3);
      [x0, x1] = [Math.max(-50, lo - pad), Math.min(50, hi + pad)];
      if (x1 - x0 < 5) [x0, x1] = [(x0 + x1) / 2 - 2.5, (x0 + x1) / 2 + 2.5];
      x0 = Math.floor(x0 * 2) / 2;
      x1 = Math.ceil(x1 * 2) / 2;
    }
    const F = graphFeatures(f, x0, x1, g);
    const tangentAt = optNum(params.tangentAt);
    const tanOk = tangentAt !== undefined && tangentAt > x0 && tangentAt < x1 && Number.isFinite(f(tangentAt)) && Number.isFinite(derivative(f, tangentAt, x1 - x0));
    const mustY = [
      ...(feats.has("roots") ? [0] : []),
      ...(feats.has("turning") ? F.turning.map((t) => t.y) : []),
      ...(feats.has("intercept") && F.yIntercept !== undefined ? [F.yIntercept] : []),
      ...(feats.has("intersections") ? F.intersections.map((p) => p.y) : []),
      ...(tanOk ? [f(tangentAt!)] : []),
    ].filter((y) => Math.abs(y) < 1e4);
    const yr = focusY(autoY(g ? [f, g] : [f], x0, x1, mustY, F.vertical.length > 0), mustY);
    if (feats.has("asymptotes")) for (const h of F.horizontal) if (h > yr.y0 - (yr.y1 - yr.y0) && h < yr.y1 + (yr.y1 - yr.y0)) (yr.y0 = Math.min(yr.y0, h - (yr.y1 - yr.y0) * 0.08)), (yr.y1 = Math.max(yr.y1, h + (yr.y1 - yr.y0) * 0.08));
    const win = given.given.y ? { x0, x1, y0: given.y0, y1: given.y1 } : { x0, x1, ...yr };
    const P = makePlot(win, 440, 320);
    const sk = new Sketch();
    drawAxes(sk, P, { grid: true, pi: trig && !given.given.x });
    const cy = (y: number) => clamp(P.Y(y), 0, P.H);

    // Shading first, under everything.
    const shade = String(params.shade ?? "none").toLowerCase();
    let shadeAnchor: Pt | undefined, areaText = "";
    const shadeMode = /betw/.test(shade) && g ? "between" : /under|area|axis/.test(shade) ? "under" : /above|>/.test(shade) ? "above" : /below|</.test(shade) ? "below" : "";
    if (shadeMode) {
      const ends = shadeMode === "between" ? F.intersections.map((p) => p.x) : shadeMode === "under" ? F.roots : [];
      let a = optNum(params.shadeFrom) ?? (ends.length >= 2 ? ends[0] : x0);
      let b = optNum(params.shadeTo) ?? (ends.length >= 2 ? ends[ends.length - 1] : x1);
      a = clamp(a, x0, x1);
      b = clamp(b, x0, x1);
      if (a > b) [a, b] = [b, a];
      if (b - a > 1e-9) {
        const lower = (x: number) => (shadeMode === "between" ? g!(x) : shadeMode === "under" ? 0 : shadeMode === "above" ? P.y1 : P.y0);
        const top: Pt[] = [], bottom: Pt[] = [];
        let any = false;
        for (let i = 0; i <= 200; i++) {
          const x = a + ((b - a) * i) / 200, yf = f(x), yl = lower(x);
          if (!Number.isFinite(yf) || !Number.isFinite(yl)) continue;
          any = true;
          top.push({ x: P.X(x), y: cy(yf) });
          bottom.push({ x: P.X(x), y: cy(yl) });
        }
        if (any) {
          sk.polygon([...top, ...bottom.reverse()], { fill: PALETTE.green, opacity: 0.22, stroke: "none", part: "shaded-region" }, false);
          // The anchor: where the band is thickest.
          let best = { h: -1, p: top[0] };
          bottom.reverse();
          top.forEach((t, i) => { const h = Math.abs(t.y - bottom[i].y); if (h > best.h) best = { h, p: { x: t.x, y: (t.y + bottom[i].y) / 2 } }; });
          shadeAnchor = best.p;
          if (shadeMode === "under" || shadeMode === "between") {
            const area = integrate((x) => Math.abs(f(x) - lower(x)), a, b, 2000);
            if (Number.isFinite(area)) areaText = `Area = ${valueText(area, 3)}`;
          }
        }
      }
    }

    // Asymptotes, dashed, with their equations.
    const asymOn = feats.has("asymptotes");
    let asymAnchor: Pt | undefined, asymName = "";
    if (asymOn) {
      for (const v of F.vertical.slice(0, 4)) {
        const X = P.X(v);
        sk.line([{ x: X, y: 0 }, { x: X, y: P.H }], { stroke: PALETTE.violet, width: 2, dash: "8 6", part: "asymptote" });
        const t = `x = ${fmt(v, 3)}`;
        sk.placeText(t, 16, { x: X, y: 10 }, { x: 1, y: 0 }, { min: textW(t, 16) / 2 + 6, max: 90, fill: PALETTE.violet, part: "asymptote", slide: { x: 0, y: 1 } });
        if (!asymAnchor) (asymAnchor = { x: X, y: P.H * 0.82 }), (asymName = `Asymptote x = ${fmt(v, 3)}`);
      }
      for (const h of F.horizontal) {
        if (h <= P.y0 || h >= P.y1) continue;
        const Y = P.Y(h);
        sk.line([{ x: 0, y: Y }, { x: P.W, y: Y }], { stroke: PALETTE.violet, width: 2, dash: "8 6", part: "asymptote" });
        sk.placeText(`y = ${fmt(h, 3)}`, 16, { x: P.W - 30, y: Y }, { x: 0, y: -1 }, { min: 11, max: 40, fill: PALETTE.violet, part: "asymptote" });
        if (!asymAnchor) (asymAnchor = { x: P.W * 0.9, y: Y }), (asymName = `Asymptote y = ${fmt(h, 3)}`);
      }
    }

    // The curves.
    const fLines = drawCurve(sk, P, f, { stroke: PALETTE.blue, width: 3, part: "curve" });
    const gLines = g ? drawCurve(sk, P, g, { stroke: PALETTE.red, width: 3, part: "second-curve" }) : [];

    // The tangent at x = a.
    let tanAnchor: Pt | undefined, tanName = "";
    if (tanOk) {
      const a = tangentAt!, ya = f(a), m = snap(derivative(f, a, x1 - x0));
      const L = (x: number) => ya + m * (x - a);
      const span = (x1 - x0) * 0.28;
      const lines = drawCurve(sk, P, L, { stroke: PALETTE.amber, width: 2.6, part: "tangent" }, Math.max(x0, a - span), Math.min(x1, a + span));
      const pa = P.S(a, ya);
      if (ya > P.y0 && ya < P.y1) dot(sk, pa, PALETTE.amber, "tangent", 5.5);
      const mText = valueText(m, 3).replace(/ ≈ .*/, "");
      const c = snap(ya - m * a);
      const eqn = `y = ${lineEq(m, c)}`;
      const far = lines.flat().sort((p, q) => dist(q, pa) - dist(p, pa))[0] ?? pa;
      sk.placeText(`gradient = ${mText}`, 17, far, { x: 0, y: m > 0 ? 1 : -1 }, { min: 14, max: 60, fill: PALETTE.amber, part: "tangent" });
      const pts = lines.flat();
      tanAnchor = sk.clearAnchor(pts.filter((p) => dist(p, pa) > 30 && dist(p, pa) < 90).concat(pts.slice(0, 1)));
      tanName = eqn.length <= 22 ? `Tangent ${eqn}` : `Tangent at x = ${fmt(a, 2)}`;
    }

    // The points, each with its coordinates.
    const inView = (x: number, y: number) => x >= P.x0 && x <= P.x1 && y >= P.y0 && y <= P.y1;
    const C = (x: number, y: number) => (trig ? `(${piFmt(x)}, ${fmt(y, 2)})` : coordText(x, y));
    type Mark = { part: string; x: number; y: number; colour: Ink; name: string };
    const marks: Mark[] = [];
    if (feats.has("roots")) for (const r of F.roots.slice(0, 6)) if (inView(r, 0)) marks.push({ part: "root", x: r, y: 0, colour: PALETTE.blue, name: `Root x = ${trig ? piFmt(r) : fmt(r, 2)}` });
    if (feats.has("turning")) for (const t of F.turning.slice(0, 6)) if (inView(t.x, t.y)) marks.push({ part: "turning-point", x: t.x, y: t.y, colour: "ink", name: `${t.kind === "max" ? "Maximum" : "Minimum"} point ${C(t.x, t.y)}` });
    if (feats.has("intercept") && F.yIntercept !== undefined && inView(0, F.yIntercept) && !marks.some((m) => Math.abs(m.x) < 1e-9 && Math.abs(m.y - F.yIntercept!) < 1e-9)) marks.push({ part: "y-intercept", x: 0, y: F.yIntercept, colour: "ink", name: `y-intercept ${coordText(0, F.yIntercept)}` });
    if (g && feats.has("intersections")) for (const p of F.intersections.slice(0, 5)) if (inView(p.x, p.y)) marks.push({ part: "intersection", x: p.x, y: p.y, colour: PALETTE.green, name: `Intersection ${C(p.x, p.y)}` });
    // A point that is two features at once (a root that is also an intersection) is drawn and written once.
    const seen: Mark[] = [];
    const firstAt = (m: Mark) => seen.find((k) => Math.abs(k.x - m.x) < 1e-6 && Math.abs(k.y - m.y) < 1e-6);
    const unique = marks.filter((m) => (firstAt(m) ? false : (seen.push(m), true)));
    for (const m of unique) dot(sk, P.S(m.x, m.y), m.colour, m.part, 5.5);
    const writeCoords = coords && unique.length <= 8;
    if (writeCoords) {
      const centre = { x: P.W / 2, y: P.H / 2 };
      for (const m of unique) {
        const p = P.S(m.x, m.y);
        const out = m.part === "turning-point" ? { x: 0, y: (F.turning.find((t) => t.x === m.x)?.kind ?? "min") === "max" ? -1 : 1 } : m.part === "root" ? { x: p.x < centre.x ? -0.6 : 0.6, y: 1 } : { x: p.x < centre.x ? -1 : 1, y: -0.5 };
        const text = trig && m.part === "root" ? piFmt(m.x) : C(m.x, m.y);
        const spot = sk.findText(text, 16, p, out, { min: 14, max: 70 });
        const alt = spot.ok ? spot : sk.findText(text, 16, p, { x: -out.x || 1, y: -out.y }, { min: 14, max: 70 });
        sk.text(alt.ok ? alt.c : spot.c, text, 16, m.colour === PALETTE.blue ? "ink" : m.colour, m.part);
      }
    }

    // Readouts above the graph: the curves' equations, the area.
    const heads: Array<{ t: string; c: Ink; part: string }> = [{ t: `y = ${short(fShown, 30)}`, c: PALETTE.blue, part: "curve" }];
    if (g) heads.push({ t: `y = ${short(gShown, 30)}`, c: PALETTE.red, part: "second-curve" });
    if (areaText) heads.push({ t: areaText, c: PALETTE.green, part: "shaded-region" });
    let hx = 0;
    for (const h of heads) {
      const w = h.t.length * 9.6;
      sk.text({ x: hx + w / 2, y: -44 }, h.t, 18, h.c, h.part);
      hx += w + 26;
    }

    // Anchors.
    const curveAnchor = pickOnCurve(sk, P, fLines, [0.85, 0.15, 0.75, 0.25, 0.65]);
    if (curveAnchor) sk.part("curve", fWords ? fitText(fWords, 34) : `Curve y = ${short(fShown, 20, `${fName}(x)`)}`, curveAnchor);
    const gAnchor = g ? pickOnCurve(sk, P, gLines, [0.12, 0.88, 0.3, 0.7]) : undefined;
    if (gAnchor) sk.part("second-curve", gWords ? fitText(gWords, 34) : `Curve y = ${short(gShown, 20, `${gName}(x)`)}`, gAnchor);
    for (const id of ["root", "turning-point", "y-intercept", "intersection"]) {
      const m = marks.find((k) => k.part === id);
      if (m) sk.part(id, m.name.length <= 34 ? m.name : PARTS.find((p) => p.id === id)!.name, P.S(m.x, m.y));
    }
    if (asymAnchor) sk.part("asymptote", asymName, asymAnchor);
    if (shadeAnchor) sk.part("shaded-region", shadeMode === "above" ? `Region y > ${fName}(x)` : shadeMode === "below" ? `Region y < ${fName}(x)` : "Shaded area", shadeAnchor);
    if (tanAnchor) sk.part("tangent", tanName, tanAnchor);
    return sk.finish(12);
  },
};

/** Keep the y-window on the features: a curve that runs far off (a parabola's arms) is cut, not squashed. */
function focusY(full: { y0: number; y1: number }, must: number[]): { y0: number; y1: number } {
  const m = must.filter(Number.isFinite);
  if (!m.length) return full;
  const lo = Math.min(...m), hi = Math.max(...m);
  const ext = Math.max(1 + 0.8 * (hi - lo), 0.25 * (full.y1 - full.y0));
  return { y0: Math.max(full.y0, lo - ext), y1: Math.min(full.y1, hi + ext) };
}

function pickOnCurve(sk: Sketch, P: Plot, lines: Pt[][], ts: number[]): Pt | undefined {
  const pts = lines.flat().filter((p) => p.y > 8 && p.y < P.H - 8 && p.x > 4 && p.x < P.W - 4);
  if (!pts.length) return lines.flat()[0];
  return sk.clearAnchor(ts.map((t) => pts[Math.floor(t * (pts.length - 1))]));
}

function short(src: string, max: number, fallback = "f(x)"): string {
  const p = prettyExpr(src);
  return p.length <= max ? p : fallback;
}

/** y = mx + c, written the textbook way. */
function lineEq(m: number, c: number): string {
  const mt = valueText(m, 2).replace(/ ≈ .*/, "");
  const head = m === 0 ? "" : m === 1 ? "x" : m === -1 ? "−x" : `${mt}x`;
  const ct = valueText(Math.abs(c), 2).replace(/ ≈ .*/, "");
  if (!head) return valueText(c, 2).replace(/ ≈ .*/, "");
  return c === 0 ? head : `${head} ${c < 0 ? "−" : "+"} ${ct}`;
}
