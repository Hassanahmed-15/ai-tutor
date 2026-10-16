import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, clamp, fmt, num, str, textW } from "./mathsKit";
import { autoY, drawAxes, drawCurve, dot, fn1, integrate, makePlot, prettyExpr, subscript, valueText, windowFrom } from "./calculusKit";

/**
 * A RIEMANN SUM UNDER A CURVE. The board gives f(x), the interval and n; the code computes every
 * rectangle (or trapezoid) height from f, the sum, and the exact integral (Simpson's rule), and
 * writes both — so L₄ for x² on [0, 2] really is 1.75 against 8/3.
 */

export type RiemannMethod = "left" | "right" | "midpoint" | "trapezoid";
export type RiemannStrip = { x0: number; x1: number; h0: number; h1: number; sx: number };

export function parseMethod(v: unknown): RiemannMethod {
  const s = String(v ?? "").toLowerCase();
  return /right/.test(s) ? "right" : /mid/.test(s) ? "midpoint" : /trap/.test(s) ? "trapezoid" : "left";
}

/** The strips and their total. h0/h1 are the heights at the strip's left and right sides (equal for rectangles); sx is the sample point. */
export function riemann(f: (x: number) => number, a: number, b: number, n: number, method: RiemannMethod): { strips: RiemannStrip[]; approx: number; dx: number } {
  const dx = (b - a) / n;
  const strips: RiemannStrip[] = [];
  let approx = 0;
  for (let i = 0; i < n; i++) {
    const x0 = a + i * dx, x1 = a + (i + 1) * dx;
    if (method === "trapezoid") {
      const h0 = f(x0), h1 = f(x1);
      strips.push({ x0, x1, h0, h1, sx: NaN });
      approx += ((h0 + h1) / 2) * dx;
    } else {
      const sx = method === "left" ? x0 : method === "right" ? x1 : (x0 + x1) / 2;
      const h = f(sx);
      strips.push({ x0, x1, h0: h, h1: h, sx });
      approx += h * dx;
    }
  }
  return { strips, approx, dx };
}

const SYMBOL: Record<RiemannMethod, string> = { left: "L", right: "R", midpoint: "M", trapezoid: "T" };
const SUM_NAME: Record<RiemannMethod, string> = { left: "Left Riemann sum", right: "Right Riemann sum", midpoint: "Midpoint sum", trapezoid: "Trapezoidal rule" };

const PARTS = [
  { id: "curve", name: "Curve y = f(x)" },
  { id: "rectangle", name: "One rectangle" },
  { id: "interval", name: "Interval [a, b]" },
  { id: "approximation", name: "Riemann sum (approximation)" },
  { id: "exact-area", name: "Exact area (the integral)" },
];

export const riemannSum: FigureComponent = {
  name: "riemannSum",
  title: "A Riemann sum under a curve: the function's graph over [a, b] cut into n equal strips (left, right, midpoint rectangles or trapezoids), with the computed approximation written beside the exact integral",
  params: `f (the function of x, e.g. "x^2", "sin(x)", "1/x", "e^(-x^2)"; default "x^2"); a, b (the interval, default 0 and 2); n (number of subintervals 1-40, default 4); method ("left" default | "right" | "midpoint" | "trapezoid"); exact (true default: shade and write the exact area ∫ f dx; false hides it); xmin, xmax, ymin, ymax (optional window; default fits the interval). The code computes each height, the sum and the integral — never give values.`,
  match: /\briemann\b(?!\s+(hypothesis|zeta|surfaces?|sphere|integrable))|\b(left|right|midpoint)[- ](endpoint |hand )?(riemann )?(sum|rectangles?)\b|\btrapezoid(al)? rule\b|\btrapezium rule\b|\barea under (a|the) curve\b.*\b(rectangles?|strips?|approximat\w*)\b|\b(rectangles?|strips?)\b.*\barea under\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const fSrc = str(params.f, "x^2", 200);
    const parsed = fn1(fSrc);
    const f = parsed ?? ((x: number) => x * x);
    const shownSrc = parsed ? fSrc : "x^2";
    let a = num(params.a, 0, -1000, 1000), b = num(params.b, 2, -1000, 1000);
    if (a > b) [a, b] = [b, a];
    if (b - a < 1e-6) b = a + 1;
    const n = Math.round(num(params.n, 4, 1, 40));
    const method = parseMethod(params.method);
    const showExact = params.exact === undefined ? true : !/^(false|no|0|off|hide|none)$/i.test(String(params.exact));

    const { strips, approx, dx } = riemann(f, a, b, n, method);
    const exact = integrate(f, a, b, 2000);
    const pad = (b - a) * 0.15;
    const near0 = a >= 0 && a < (b - a) * 0.6 ? 0 : a;
    const defX = { x0: Math.min(near0, a) - pad, x1: b + pad };
    const heights = strips.flatMap((s) => [s.h0, s.h1]);
    const yr = autoY([f], defX.x0, defX.x1, [0, ...heights.filter(Number.isFinite)]);
    const win = windowFrom(params, { x0: defX.x0, x1: defX.x1, y0: yr.y0, y1: yr.y1 });
    const P = makePlot(win, 430, 300);
    const sk = new Sketch();
    const { axY } = drawAxes(sk, P, { grid: true });
    const cy = (y: number) => clamp(P.Y(y), 0, P.H);

    // The exact area: the region between the curve and the axis on [a, b], drawn first, under the strips.
    const exactOn = showExact && Number.isFinite(exact);
    if (exactOn) {
      const pts: Pt[] = [{ x: P.X(a), y: cy(0) }];
      for (let i = 0; i <= 160; i++) {
        const x = a + ((b - a) * i) / 160, y = f(x);
        pts.push({ x: P.X(x), y: Number.isFinite(y) ? cy(y) : cy(0) });
      }
      pts.push({ x: P.X(b), y: cy(0) });
      sk.polygon(pts, { fill: PALETTE.green, opacity: 0.2, stroke: "none", part: "exact-area" }, false);
    }

    // The strips. The tallest drawn one is "the" rectangle a label points at; the rest are the sum.
    const valid = strips.map((s, i) => ({ s, i })).filter(({ s }) => Number.isFinite(s.h0) && Number.isFinite(s.h1));
    const rep = valid.length ? valid.reduce((best, cur) => (Math.abs(cur.s.h0 + cur.s.h1) > Math.abs(best.s.h0 + best.s.h1) ? cur : best)).i : -1;
    for (const { s, i } of valid) {
      const poly = [{ x: P.X(s.x0), y: cy(0) }, { x: P.X(s.x0), y: cy(s.h0) }, { x: P.X(s.x1), y: cy(s.h1) }, { x: P.X(s.x1), y: cy(0) }];
      sk.polygon(poly, { fill: PALETTE.blue, opacity: i === rep ? 0.34 : 0.22, stroke: "none", part: i === rep ? "rectangle" : "approximation" }, false);
      sk.polygon(poly, { fill: "none", stroke: PALETTE.blue, width: i === rep ? 2.6 : 1.8, part: i === rep ? "rectangle" : "approximation" });
    }
    drawCurve(sk, P, f, { stroke: "ink", width: 2.8, part: "curve" });
    for (const { s, i } of valid) if (Number.isFinite(s.sx) && n <= 24) dot(sk, P.S(s.sx, s.h0), PALETTE.blue, i === rep ? "rectangle" : "approximation", n > 12 ? 3 : 4);

    // The interval: a bracket under the axis numbers from a to b, with n and Δx.
    const by = Math.max(axY + 34, P.H + 22);
    const bx0 = P.X(a), bx1 = P.X(b);
    sk.line([{ x: bx0, y: by - 7 }, { x: bx0, y: by }, { x: bx1, y: by }, { x: bx1, y: by - 7 }], { stroke: PALETTE.amber, width: 2.4, part: "interval" });
    const intervalText = `n = ${n},  Δx = ${fmt(dx, 3)}`;
    sk.text({ x: (bx0 + bx1) / 2, y: by + 17 }, intervalText, 16, PALETTE.amber, "interval");

    // The two values, above the graph: the sum, then the integral.
    const sym = `${SYMBOL[method]}${subscript(String(n))}`;
    const lines: Array<{ text: string; fill: `#${string}`; part: string }> = [{ text: Number.isFinite(approx) ? `${sym} = ${valueText(approx, 4)}` : `${sym}: f is not defined on all of [a, b]`, fill: PALETTE.blue, part: "approximation" }];
    if (exactOn) lines.push({ text: `∫ₐᵇ f(x) dx = ${valueText(exact, 4)}`, fill: PALETTE.green, part: "exact-area" });
    lines.forEach((l, k) => sk.text({ x: textW(l.text, 19) / 2, y: -62 + k * 24 - (lines.length === 1 ? -24 : 0) }, l.text, 19, l.fill, l.part));

    // Anchors.
    const fx = (x: number) => f(x);
    const curveAt = [b + pad * 0.55, a - pad * 0.55, (a + b) / 2].find((x) => x > P.x0 && x < P.x1 && Number.isFinite(fx(x)) && fx(x) > P.y0 && fx(x) < P.y1) ?? (a + b) / 2;
    sk.part("curve", `Curve y = ${shortExpr(shownSrc)}`, { x: P.X(curveAt), y: cy(fx(curveAt)) });
    if (rep >= 0) {
      const s = strips[rep];
      const top = Math.min(cy(s.h0), cy(s.h1)), bottom = cy(0);
      const tall = Math.abs(bottom - top) > 16;
      sk.part("rectangle", method === "trapezoid" ? "One trapezoid" : `One rectangle (${method === "midpoint" ? "midpoint" : method + " endpoint"})`, { x: P.X((s.x0 + s.x1) / 2), y: tall ? (top + bottom) / 2 : bottom });
      const other = valid.filter(({ i }) => i !== rep);
      const o = other.length ? other.reduce((p, q) => (Math.abs(q.s.h0 + q.s.h1) > Math.abs(p.s.h0 + p.s.h1) ? q : p)).s : s;
      const oy = cy((o.h0 + o.h1) / 2);
      const ob = cy(0);
      sk.part("approximation", `${SUM_NAME[method]} ${sym}`, { x: P.X((o.x0 + o.x1) / 2), y: Math.abs(ob - oy) > 16 ? oy + (ob - oy) * 0.3 : oy });
    }
    sk.part("interval", `Interval [${fmt(a, 3)}, ${fmt(b, 3)}]`, { x: bx0 + (bx1 - bx0) * 0.25, y: by });
    if (exactOn) {
      // Where the green shows: the biggest gap between a strip's top and the curve.
      let best = { gap: 0, p: { x: P.X((a + b) / 2), y: (cy(0) + cy(f((a + b) / 2))) / 2 } };
      for (const { s } of valid) for (const t of [0.3, 0.5, 0.7]) {
        const x = s.x0 + (s.x1 - s.x0) * t, yc = cy(f(x)), ys = cy(s.h0 + (s.h1 - s.h0) * t);
        const above = Math.abs(yc - cy(0)) > Math.abs(ys - cy(0));
        if (above && Math.abs(yc - ys) > best.gap) best = { gap: Math.abs(yc - ys), p: { x: P.X(x), y: (yc + ys) / 2 } };
      }
      sk.part("exact-area", "Exact area (the integral)", best.p);
    }
    return sk.finish(12);
  },
};

function shortExpr(src: string): string {
  const p = prettyExpr(src);
  return p.length <= 20 ? p : "f(x)";
}
