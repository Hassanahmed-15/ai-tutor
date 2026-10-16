import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, bool } from "./mathsKit";
import { SERIES, drawFrame, mean, niceScale, pairs, raw, title, val } from "./statsKit";

/**
 * SCATTER GRAPH. The board gives the data points; the code scales the axes, plots every point,
 * and — when asked — computes the least-squares line of best fit (y = mx + c, drawn across the
 * data's x-range), Pearson's r, and the outlier (the point furthest from the line, if it is more
 * than 2.5 residual standard deviations away, or the point the board names). The line and r are
 * fitted WITHOUT the highlighted outlier unless fitOutlier is true (the textbook practice).
 */

export type Fit = { m: number; c: number; r: number; n: number };

/** Least-squares regression of y on x, and Pearson's product-moment correlation coefficient. */
export function leastSquares(pts: Pt[]): Fit | null {
  const n = pts.length;
  if (n < 2) return null;
  const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) (sxx += (p.x - mx) ** 2), (syy += (p.y - my) ** 2), (sxy += (p.x - mx) * (p.y - my));
  if (sxx < 1e-12) return null;
  const m = sxy / sxx;
  const r = syy < 1e-12 ? 0 : sxy / Math.sqrt(sxx * syy);
  return { m, c: my - m * mx, r: Math.max(-1, Math.min(1, r)), n };
}

/** The index of the point furthest from the fitted line, if it is an outlier (|residual| > k·s). */
export function findOutlier(pts: Pt[], k = 2.5): number {
  if (pts.length < 5) return -1;
  let best = -1, bestZ = 0;
  for (let i = 0; i < pts.length; i++) {
    // Leave-one-out: fit the rest, measure this point against that line.
    const rest = pts.filter((_, j) => j !== i);
    const f = leastSquares(rest);
    if (!f) continue;
    const res = rest.map((p) => p.y - (f.m * p.x + f.c));
    const s = Math.sqrt(res.reduce((t, e) => t + e * e, 0) / Math.max(1, rest.length - 2));
    const yr = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) || 1;
    const z = Math.abs(pts[i].y - (f.m * pts[i].x + f.c)) / Math.max(s, yr * 0.02);
    if (z > bestZ) (bestZ = z), (best = i);
  }
  return bestZ > k ? best : -1;
}

export function describeR(r: number): string {
  const a = Math.abs(r);
  if (a < 0.3) return "No correlation";
  const strength = a >= 0.9 ? "Strong" : a >= 0.6 ? "Moderate" : "Weak";
  return `${strength} ${r > 0 ? "positive" : "negative"} correlation`;
}

const DEFAULT_POINTS: Pt[] = [
  { x: 2, y: 22 }, { x: 3, y: 30 }, { x: 4, y: 33 }, { x: 5, y: 41 }, { x: 6, y: 44 }, { x: 7, y: 52 },
  { x: 8, y: 55 }, { x: 9, y: 63 }, { x: 10, y: 66 }, { x: 11, y: 72 }, { x: 6.5, y: 20 }, { x: 3.5, y: 26 },
];

function equation(f: Fit): string {
  const dp = Math.abs(f.m) >= 10 ? 1 : Math.abs(f.m) >= 1 ? 2 : 3;
  const m = val(f.m, dp);
  const cdp = Math.abs(f.c) >= 100 ? 0 : Math.abs(f.c) >= 10 ? 1 : 2;
  const c = Math.abs(Number(f.c.toFixed(cdp))) < 1e-12 ? "" : f.c < 0 ? ` − ${val(-f.c, cdp)}` : ` + ${val(f.c, cdp)}`;
  return `y = ${m}x${c}`;
}

function marker(sk: Sketch, p: Pt, shape: "dot" | "cross", colour: Ink, part: string) {
  if (shape === "dot") sk.circle(p, 4.6, { fill: colour, stroke: colour, width: 1, part });
  else {
    const s = 4.8;
    sk.line([{ x: p.x - s, y: p.y - s }, { x: p.x + s, y: p.y + s }], { stroke: colour, width: 2.4, part });
    sk.line([{ x: p.x - s, y: p.y + s }, { x: p.x + s, y: p.y - s }], { stroke: colour, width: 2.4, part });
  }
}

export const scatterPlot: FigureComponent = {
  name: "scatterPlot",
  title: "Scatter graph: plotted data points on scaled axes, optional least-squares line of best fit with its equation, Pearson's r, the outlier circled and a second group",
  params: `points ("x,y; x,y; …", up to 60 pairs — the data; default a positive-correlation set), xLabel and yLabel (axis titles with units, e.g. "Hours revised", "Score (%)"), showLine (default true: the code computes and draws the least-squares line and writes y = mx + c), showR (default true: the code computes and writes Pearson's r), outlier ("auto" — default: circle the point far off the trend, if any —, "none", or "x,y" of the point to circle), fitOutlier (default false: line and r ignore the circled outlier), points2 ("x,y; …" a second group drawn as red crosses), group1 and group2 (the groups' names, e.g. "Boys", "Girls"). Never give the line, r or the outlier's position as numbers to draw — the code computes them.`,
  match: /\bscatter\s*(graph|plot|diagram|chart)s?\b|\bline of best fit\b|\b(positive|negative|no)\s+correlation\b|\bcorrelation coefficient\b|\bpearson\b|\bleast[- ]squares\b|\bregression line\b/i,
  parts: [
    { id: "axes", name: "Axes" },
    { id: "points", name: "Data points" },
    { id: "group-2", name: "Second group" },
    { id: "line-of-best-fit", name: "Line of best fit" },
    { id: "outlier", name: "Outlier" },
    { id: "trend", name: "Trend" },
  ],
  build(params: FigureParams) {
    let pts = pairs(params.points, 60);
    if (pts.length < 2) pts = DEFAULT_POINTS;
    const pts2 = pairs(params.points2, 60);
    const showLine = bool(params.showLine, true);
    const showR = bool(params.showR, true);
    const fitOutlier = bool(params.fitOutlier, false);
    const outSpec = raw(params.outlier).toLowerCase();
    let outIdx = -1;
    if (!/^(none|no|false|off|hide)$/.test(outSpec)) {
      const named = pairs(outSpec, 1)[0];
      if (named) {
        const scaleX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) || 1;
        const scaleY = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) || 1;
        let best = Infinity;
        pts.forEach((p, i) => {
          const d = Math.hypot((p.x - named.x) / scaleX, (p.y - named.y) / scaleY);
          if (d < best) (best = d), (outIdx = i);
        });
        if (best > 0.02) {
          pts = [...pts, named].slice(0, 60);
          outIdx = pts.length - 1;
        }
      } else outIdx = findOutlier(pts);
    }
    const fitPts = fitOutlier || outIdx < 0 ? pts : pts.filter((_, i) => i !== outIdx);
    const fit = leastSquares(fitPts);

    const all = [...pts, ...pts2];
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (showLine && fit) for (const x of [xMin, xMax]) (yMin = Math.min(yMin, fit.m * x + fit.c)), (yMax = Math.max(yMax, fit.m * x + fit.c));
    const sx = niceScale(xMin, xMax, 7), sy = niceScale(yMin, yMax, 6);
    const sk = new Sketch();
    const W = 440, H = 300;
    const f = drawFrame(sk, { w: W, h: H, x: sx, y: sy, xTitle: title(params.xLabel, "x"), yTitle: title(params.yLabel, "y"), xPart: "axes", yPart: "axes" });
    const P = (p: Pt): Pt => ({ x: f.X(p.x), y: f.Y(p.y) });

    // Line of best fit, across the fitted data's x-range.
    let lineAnchor: Pt | undefined;
    if (showLine && fit) {
      const fx = fitPts.map((p) => p.x);
      const a = Math.min(...fx), b = Math.max(...fx);
      const A = P({ x: a, y: fit.m * a + fit.c }), B = P({ x: b, y: fit.m * b + fit.c });
      sk.line([A, B], { stroke: "#16a34a", width: 2.6, part: "line-of-best-fit" });
      lineAnchor = { x: A.x + (B.x - A.x) * 0.82, y: A.y + (B.y - A.y) * 0.82 };
    }
    // Points (drawn after the line so they sit on top).
    const blue = SERIES[0].stroke, red = SERIES[1].stroke;
    pts.forEach((p, i) => i !== outIdx && marker(sk, P(p), "dot", blue, "points"));
    pts2.forEach((p) => marker(sk, P(p), "cross", red, "group-2"));
    if (outIdx >= 0) {
      const O = P(pts[outIdx]);
      marker(sk, O, "dot", blue, "outlier");
      sk.circle(O, 11, { fill: "none", stroke: "#d97706", width: 2.2, part: "outlier" });
    }
    // Equation and r, top-left or bottom-right corner, whichever the data leaves empty.
    const notes: string[] = [];
    let rAt: Pt | undefined;
    if (showLine && fit) notes.push(equation(fit));
    if (showR && fit) notes.push(`r = ${val(fit.r, 2)}`);
    if (notes.length) {
      const corners: Pt[] = fit && fit.m < 0 ? [{ x: W - 6, y: 16 }, { x: 6, y: H - 40 }] : [{ x: 6, y: 16 }, { x: W - 6, y: H - 40 }];
      const used = corners.find((c) => {
        const box = { x: c.x < W / 2 ? c.x : c.x - 150, y: c.y - 10, w: 150, h: notes.length * 22 + 4 };
        return !sk.blocked(box, 2);
      }) ?? corners[0];
      notes.forEach((t, i) => {
        const tw = t.length * 8.4;
        const cx = used.x < W / 2 ? used.x + tw / 2 : used.x - tw / 2;
        const spot = sk.findText(t, 16, { x: cx, y: used.y + i * 22 }, { x: 0, y: 1 }, { max: 60, slide: { x: 1, y: 0 } });
        const isR = t.startsWith("r =");
        sk.text(spot.c, t, 16, isR ? "ink" : "#16a34a", isR ? undefined : "line-of-best-fit");
        if (isR) rAt = { x: spot.c.x + (used.x < W / 2 ? 1 : -1) * (tw / 2 + 4), y: spot.c.y };
      });
    }
    // Trend: an arrow beside the data, parallel to the trend, when there is one.
    let trendAnchor: Pt | undefined;
    if (fit && Math.abs(fit.r) >= 0.3) {
      const dir = { x: 1, y: -fit.m * (H / (sy.hi - sy.lo)) / (W / (sx.hi - sx.lo)) };
      const L = Math.hypot(dir.x, dir.y);
      const u = { x: dir.x / L, y: dir.y / L };
      const n = fit.m > 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x }; // the side above-left of the cloud
      const mid = P({ x: (xMin + xMax) / 2, y: fit.m * ((xMin + xMax) / 2) + fit.c });
      for (const off of [70, 90, 110, -70, -90]) {
        const c = { x: mid.x + n.x * off, y: mid.y + n.y * off };
        const a = { x: c.x - u.x * 55, y: c.y - u.y * 55 }, b = { x: c.x + u.x * 55, y: c.y + u.y * 55 };
        const inside = [a, b].every((p) => p.x > 10 && p.x < W - 10 && p.y > 10 && p.y < H - 10);
        const box = { x: Math.min(a.x, b.x) - 4, y: Math.min(a.y, b.y) - 4, w: Math.abs(a.x - b.x) + 8, h: Math.abs(a.y - b.y) + 8 };
        const clearOfPoints = all.every((p) => {
          const q = P(p);
          const t = Math.max(0, Math.min(1, ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (110 * 110)));
          return Math.hypot(q.x - (a.x + (b.x - a.x) * t), q.y - (a.y + (b.y - a.y) * t)) > 14;
        });
        if (inside && clearOfPoints && !sk.textBoxes().some((t) => t.x < box.x + box.w && box.x < t.x + t.w && t.y < box.y + box.h && box.y < t.y + t.h)) {
          sk.line([a, { x: b.x - u.x * 9, y: b.y - u.y * 9 }], { stroke: "muted", width: 2.2, part: "trend" });
          sk.polygon([b, { x: b.x - u.x * 12 + n.x * 5.5, y: b.y - u.y * 12 + n.y * 5.5 }, { x: b.x - u.x * 12 - n.x * 5.5, y: b.y - u.y * 12 - n.y * 5.5 }], { fill: "muted", stroke: "muted", width: 1, part: "trend" });
          trendAnchor = c;
          break;
        }
      }
    }

    // Anchors: a typical (non-extreme) point, the line, the circled point, the axis.
    const plain = pts.map((p, i) => ({ p, i })).filter(({ i }) => i !== outIdx);
    const order = [...plain].sort((a, b) => a.p.x - b.p.x);
    const typical = order[Math.min(order.length - 1, Math.floor(order.length * 0.25))];
    if (typical) sk.part("points", raw(params.group1) ? title(params.group1, "Data points", 30) : "Data points", P(typical.p));
    if (pts2.length) sk.part("group-2", title(params.group2, "Second group", 30), P([...pts2].sort((a, b) => b.x - a.x)[Math.floor(pts2.length / 4)]));
    if (lineAnchor) sk.part("line-of-best-fit", "Line of best fit", lineAnchor);
    if (outIdx >= 0) sk.part("outlier", "Outlier", { x: P(pts[outIdx]).x + 11, y: P(pts[outIdx]).y });
    if (fit) {
      const desc = describeR(fit.r);
      const anchor = trendAnchor ?? rAt;
      if (anchor) sk.part("trend", showR && trendAnchor ? desc : desc, anchor);
    }
    sk.part("axes", "Axes", { x: W * 0.62, y: H });
    return sk.finish(14);
  },
};
