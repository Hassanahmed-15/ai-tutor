import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, bool, textW } from "./mathsKit";
import { SERIES, dimension, drawFrame, medianSorted, niceScale, numbers, raw, title, val } from "./statsKit";

/**
 * BOX PLOT (box-and-whisker diagram). The board gives raw data — the code sorts it and computes the
 * minimum, lower quartile, median, upper quartile and maximum, and marks as outliers any values
 * more than 1.5 × IQR beyond the quartiles (whiskers then stop at the most extreme non-outliers) —
 * or a ready five-number summary. A second plot can share the same scale for comparison.
 */

export type FiveNumber = { min: number; q1: number; median: number; q3: number; max: number; iqr: number; outliers: number[]; lowFence: number; highFence: number; n: number };
export type QuartileMethod = "halves" | "position";

/** Quartiles of a sorted list: medians of the lower/upper halves (median excluded), or the (n+1)/4 positions. */
export function quartiles(a: number[], method: QuartileMethod = "halves"): { q1: number; median: number; q3: number } {
  const n = a.length;
  if (!n) return { q1: 0, median: 0, q3: 0 };
  if (n === 1) return { q1: a[0], median: a[0], q3: a[0] };
  if (method === "position") {
    const at = (p: number) => {
      const q = Math.max(1, Math.min(n, p));
      const i = Math.floor(q), t = q - i;
      return i >= n ? a[n - 1] : a[i - 1] + t * (a[i] - a[i - 1]);
    };
    return { q1: at((n + 1) / 4), median: at((n + 1) / 2), q3: at((3 * (n + 1)) / 4) };
  }
  const lower = a.slice(0, Math.floor(n / 2)), upper = a.slice(Math.ceil(n / 2));
  return { q1: medianSorted(lower), median: medianSorted(a), q3: medianSorted(upper) };
}

/** The five-number summary of raw data, with 1.5 × IQR outliers removed from the whiskers. */
export function fiveNumber(data: number[], method: QuartileMethod = "halves", fences = true): FiveNumber {
  const a = [...data].filter(Number.isFinite).sort((x, y) => x - y);
  const { q1, median, q3 } = quartiles(a, method);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr, highFence = q3 + 1.5 * iqr;
  const inside = fences ? a.filter((v) => v >= lowFence - 1e-9 && v <= highFence + 1e-9) : a;
  const outliers = fences ? a.filter((v) => v < lowFence - 1e-9 || v > highFence + 1e-9) : [];
  return { min: inside[0] ?? q1, q1, median, q3, max: inside[inside.length - 1] ?? q3, iqr, outliers, lowFence, highFence, n: a.length };
}

/** "min, Q1, median, Q3, max" → a summary (sorted, so it is always a valid box plot). */
export function fromSummary(v: unknown): FiveNumber | null {
  const s = numbers(v, 5);
  if (s.length !== 5) return null;
  s.sort((x, y) => x - y);
  return { min: s[0], q1: s[1], median: s[2], q3: s[3], max: s[4], iqr: s[3] - s[1], outliers: [], lowFence: -Infinity, highFence: Infinity, n: 0 };
}

const DEFAULT_DATA = [12, 15, 17, 18, 19, 21, 22, 22, 24, 25, 27, 28, 30, 33, 47];

function summaryFor(params: FigureParams, dataKey: string, sumKey: string, method: QuartileMethod, fallback?: number[]): FiveNumber | null {
  const data = numbers(params[dataKey], 200);
  if (data.length >= 2) return fiveNumber(data, method, bool(params.outliers, true));
  const s = fromSummary(params[sumKey]);
  if (s) return s;
  return fallback ? fiveNumber(fallback, method, bool(params.outliers, true)) : null;
}

export const boxPlot: FigureComponent = {
  name: "boxPlot",
  title: "Box plot (box-and-whisker): median, quartiles and box, whiskers to the extremes, 1.5×IQR outliers as crosses, IQR marked, on a scale; optional second plot on the same scale to compare",
  params: `data (raw values "12, 15, 17, …", up to 200 — the code computes min, Q1, median, Q3, max and outliers) OR summary ("min, Q1, median, Q3, max" when only the summary is known), data2 / summary2 (a second plot on the same scale), group1 and group2 (the plots' names, e.g. "Boys", "Girls"), xLabel (the scale's title with units, e.g. "Time (s)"), showValues (default true: write the five values above each plot), showIQR (default true: mark the IQR under the first box), outliers (default true: values beyond 1.5×IQR from the quartiles are drawn as crosses), method ("halves" — default: quartiles are medians of each half — or "position": the (n+1)/4 and 3(n+1)/4 positions). Never compute the quartiles yourself — give the data.`,
  match: /\bbox[- ]?(and[- ]whiskers?|plot|plots|diagram)s?\b|\binter[- ]?quartile\b|\b(lower|upper) quartile\b|\bfive[- ]number summary\b/i,
  parts: [
    { id: "median", name: "Median" },
    { id: "box", name: "Box (middle 50%)" },
    { id: "lower-quartile", name: "Lower quartile (Q1)" },
    { id: "upper-quartile", name: "Upper quartile (Q3)" },
    { id: "whisker", name: "Whisker" },
    { id: "minimum", name: "Minimum" },
    { id: "maximum", name: "Maximum" },
    { id: "outlier", name: "Outlier" },
    { id: "iqr", name: "Interquartile range" },
    { id: "scale", name: "Scale" },
    { id: "second-plot", name: "Second plot" },
  ],
  build(params: FigureParams) {
    const method: QuartileMethod = /pos|n\s*\+\s*1/i.test(raw(params.method)) ? "position" : "halves";
    const A = summaryFor(params, "data", "summary", method, DEFAULT_DATA)!;
    const B = summaryFor(params, "data2", "summary2", method);
    const plots = B ? [A, B] : [A];
    const lo = Math.min(...plots.flatMap((p) => [p.min, ...p.outliers])), hi = Math.max(...plots.flatMap((p) => [p.max, ...p.outliers]));
    const sx = niceScale(lo, hi, 8, "never");
    const showValues = bool(params.showValues, true);
    const showIQR = bool(params.showIQR, true);
    const sk = new Sketch();
    const W = 440;
    const gap = 150, boxH = 46;
    const rowY = plots.map((_, i) => 80 + i * gap);
    const H = rowY[rowY.length - 1] + boxH / 2 + (B ? 44 : 140);
    const f = drawFrame(sk, { w: W, h: H, x: sx, xTitle: title(params.xLabel, ""), xPart: "scale", yAxis: false, grid: true });
    const groupNames = [title(params.group1, "", 16), title(params.group2, "", 16)];
    const colours: Array<{ stroke: Ink; fill: Ink }> = [SERIES[0], SERIES[4]];
    const anchors: Record<string, Pt> = {};

    plots.forEach((p, k) => {
      const cy = rowY[k], top = cy - boxH / 2, bot = cy + boxH / 2;
      const c = colours[k];
      const X = f.X;
      const tag = (id: string) => (k === 0 ? id : "second-plot");
      // Whiskers and end caps.
      sk.line([{ x: X(p.min), y: cy }, { x: X(p.q1), y: cy }], { stroke: "ink", width: 2.2, part: tag("whisker") });
      sk.line([{ x: X(p.q3), y: cy }, { x: X(p.max), y: cy }], { stroke: "ink", width: 2.2, part: tag("whisker") });
      sk.line([{ x: X(p.min), y: cy - 12 }, { x: X(p.min), y: cy + 12 }], { stroke: "ink", width: 2.2, part: tag("minimum") });
      sk.line([{ x: X(p.max), y: cy - 12 }, { x: X(p.max), y: cy + 12 }], { stroke: "ink", width: 2.2, part: tag("maximum") });
      // Box: Q1 and Q3 edges are their own parts so each quartile can be pointed at.
      sk.polygon([{ x: X(p.q1), y: top }, { x: X(p.q3), y: top }, { x: X(p.q3), y: bot }, { x: X(p.q1), y: bot }], { fill: c.fill, stroke: c.stroke, width: 2.2, part: tag("box") });
      sk.line([{ x: X(p.q1), y: top }, { x: X(p.q1), y: bot }], { stroke: c.stroke, width: 2.6, part: tag("lower-quartile") });
      sk.line([{ x: X(p.q3), y: top }, { x: X(p.q3), y: bot }], { stroke: c.stroke, width: 2.6, part: tag("upper-quartile") });
      sk.line([{ x: X(p.median), y: top }, { x: X(p.median), y: bot }], { stroke: "#dc2626", width: 3.2, part: tag("median") });
      // Outliers: crosses.
      for (const o of p.outliers) {
        const q = { x: X(o), y: cy }, s = 5;
        sk.line([{ x: q.x - s, y: q.y - s }, { x: q.x + s, y: q.y + s }], { stroke: "#d97706", width: 2.4, part: tag("outlier") });
        sk.line([{ x: q.x - s, y: q.y + s }, { x: q.x + s, y: q.y - s }], { stroke: "#d97706", width: 2.4, part: tag("outlier") });
      }
      // The five values above the plot, nudged apart when two are close.
      if (showValues) {
        const vals = [p.min, p.q1, p.median, p.q3, p.max];
        const dp = vals.every((v) => Number.isInteger(v)) ? 0 : 2;
        const texts = vals.map((v) => val(v, dp));
        const xs = vals.map(X);
        const wid = texts.map((t) => textW(t, 13));
        const ys = vals.map((_, i) => (i === 0 || i === 4 ? cy - 22 : top - 11));
        // Rows: identical neighbours are written once; overlapping ones are pushed up a row.
        const placed: Array<{ x0: number; x1: number; y: number }> = [];
        vals.forEach((v, i) => {
          if (i > 0 && Math.abs(v - vals[i - 1]) < 1e-12) return;
          let y = ys[i];
          const x0 = xs[i] - wid[i] / 2 - 3, x1 = xs[i] + wid[i] / 2 + 3;
          while (placed.some((q) => q.x0 < x1 && x0 < q.x1 && Math.abs(q.y - y) < 14)) y -= 15;
          placed.push({ x0, x1, y });
          sk.text({ x: xs[i], y }, texts[i], 13, i === 2 ? "#dc2626" : "ink", tag(["minimum", "lower-quartile", "median", "upper-quartile", "maximum"][i]));
        });
      }
      if (B && groupNames[k]) {
        // The plot's name to the left of the scale, level with its box.
        const tw = textW(groupNames[k], 15);
        sk.placeText(groupNames[k], 15, { x: -14 - tw / 2, y: cy - 5 }, { x: -1, y: 0 }, { max: 40, fill: c.stroke, part: k === 0 ? "box" : "second-plot" });
      }
      if (k === 0 && showIQR && p.iqr > 0) {
        // Above the box and its values, so the space under the box stays free for leaders.
        const y = top - 30;
        dimension(sk, { x: X(p.q1), y }, { x: X(p.q3), y }, c.stroke, "iqr");
        sk.placeText(`IQR = ${val(p.iqr, 2)}`, 13, { x: (X(p.q1) + X(p.q3)) / 2, y: y - 13 }, { x: 0, y: -1 }, { max: 30, fill: c.stroke, part: "iqr" });
        anchors.iqr = { x: X(p.q1) + (X(p.q3) - X(p.q1)) * 0.2, y };
      }
      if (k === 0) {
        const wideLeft = p.median - p.q1 >= p.q3 - p.median;
        anchors.median = { x: X(p.median), y: bot };
        anchors.box = { x: wideLeft ? (X(p.q1) + X(p.median)) / 2 : (X(p.median) + X(p.q3)) / 2, y: bot };
        anchors["lower-quartile"] = { x: X(p.q1), y: bot };
        anchors["upper-quartile"] = { x: X(p.q3), y: bot };
        const right = X(p.max) - X(p.q3), left = X(p.q1) - X(p.min);
        if (right > 4 || left > 4) anchors.whisker = right >= left ? { x: X(p.q3) + right * 0.55, y: cy } : { x: X(p.min) + left * 0.45, y: cy };
        else anchors.whisker = { x: X(p.q3), y: cy };
        anchors.minimum = { x: X(p.min), y: cy + 12 };
        anchors.maximum = { x: X(p.max), y: cy + 12 };
        if (p.outliers.length) anchors.outlier = { x: X(p.outliers[p.outliers.length - 1]), y: cy };
      } else anchors["second-plot"] = { x: X(p.q1) + (X(p.q3) - X(p.q1)) * 0.5, y: bot };
    });

    const hasOut = A.outliers.length > 0;
    sk.part("median", `Median = ${val(A.median, 2)}`, anchors.median);
    sk.part("box", "Box (middle 50%)", anchors.box);
    sk.part("lower-quartile", `Lower quartile = ${val(A.q1, 2)}`, anchors["lower-quartile"]);
    sk.part("upper-quartile", `Upper quartile = ${val(A.q3, 2)}`, anchors["upper-quartile"]);
    sk.part("whisker", "Whisker", anchors.whisker);
    sk.part("minimum", hasOut && A.outliers[0] < A.q1 ? "Lowest value (not outlier)" : `Minimum = ${val(A.min, 2)}`, anchors.minimum);
    sk.part("maximum", hasOut && A.outliers[A.outliers.length - 1] > A.q3 ? "Highest value (not outlier)" : `Maximum = ${val(A.max, 2)}`, anchors.maximum);
    if (anchors.outlier) sk.part("outlier", `Outlier (beyond 1.5 × IQR)`, anchors.outlier);
    if (anchors.iqr) sk.part("iqr", `IQR = Q3 − Q1 = ${val(A.iqr, 2)}`, anchors.iqr);
    sk.part("scale", title(params.xLabel, "Scale", 30), { x: f.X(sx.ticks[Math.floor(sx.ticks.length * 0.7)] ?? sx.hi), y: H });
    if (B && anchors["second-plot"]) sk.part("second-plot", groupNames[1] || "Second plot", anchors["second-plot"]);
    return sk.finish(14);
  },
};

