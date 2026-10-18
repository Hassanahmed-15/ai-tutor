import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { fitText } from "../cuts";
import { Sketch, bool, optNum, textW } from "./mathsKit";
import { betweenTicks, dimension, drawFrame, niceScale, numbers, placeFirst, title, val } from "./statsKit";
import { parseClasses } from "./histogram";

/**
 * CUMULATIVE FREQUENCY GRAPH (ogive). The board gives the classes' upper bounds (or the classes)
 * and their frequencies; the code adds up the running totals, plots each at its class's UPPER
 * bound (with 0 at the first class's lower bound), joins them with a smooth curve that can never
 * turn back down (monotone cubic interpolation), and reads the median (n/2), lower quartile (n/4)
 * and upper quartile (3n/4) off the curve with dashed reading lines, writing each value and the
 * IQR. Every number on the figure is computed, none is given.
 */

export type Ogive = { xs: number[]; cfs: number[]; n: number; at: (x: number) => number; inverse: (cf: number) => number };

/** Running totals of the frequencies. */
export function cumulative(freqs: number[]): number[] {
  let t = 0;
  return freqs.map((f) => (t += Math.max(0, Number.isFinite(f) ? f : 0)));
}

/** A monotone (Fritsch–Carlson) cubic through the points, and its inverse for reading values off. */
export function ogive(xs: number[], cfs: number[]): Ogive {
  const k = xs.length;
  const d = xs.slice(0, -1).map((x, i) => (cfs[i + 1] - cfs[i]) / (xs[i + 1] - x || 1));
  const m: number[] = xs.map((_, i) => (i === 0 ? d[0] : i === k - 1 ? d[k - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < k - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const at = (x: number) => {
    if (x <= xs[0]) return cfs[0];
    if (x >= xs[k - 1]) return cfs[k - 1];
    let i = 0;
    while (i < k - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    return h00 * cfs[i] + h10 * h * m[i] + h01 * cfs[i + 1] + h11 * h * m[i + 1];
  };
  const inverse = (cf: number) => {
    if (cf <= cfs[0]) return xs[0];
    if (cf >= cfs[k - 1]) return xs[cfs.findIndex((c) => c >= cfs[k - 1])];
    let i = 0;
    while (i < k - 2 && cfs[i + 1] < cf) i++;
    let lo = xs[i], hi = xs[i + 1];
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < cf) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { xs, cfs, n: cfs[k - 1], at, inverse };
}

const DEFAULT_BOUNDS = [10, 20, 30, 40, 50, 60];
const DEFAULT_F = [4, 9, 15, 20, 8, 4];

/** Readings to 3 significant figures-ish: whole numbers for big scales, 1 dp otherwise. */
const reading = (v: number, span: number) => val(v, span >= 200 ? 0 : span >= 20 ? 1 : 2);

export const cumulativeFrequency: FigureComponent = {
  name: "cumulativeFrequency",
  title: "Cumulative frequency graph (ogive): running totals plotted at upper class bounds, a smooth rising curve, median (n/2) and quartiles (n/4, 3n/4) read off with dashed lines, IQR marked",
  params: `bounds (the classes' UPPER bounds "10, 20, 30, …", up to 16) OR classes ("0-10, 10-20, …"), frequencies ("4, 9, 15, …" one per class — NOT cumulative; the code adds them up), start (the first class's lower bound; default from the classes, or one class width below the first bound), xLabel (the variable with units, e.g. "Mass (g)"), showMedian (default true), showQuartiles (default true: lower and upper quartiles and the IQR), readAt (optional x value: also read the cumulative frequency there, e.g. "how many are under 45"). Every reading is computed by the code.`,
  match: /\bcumulative frequency\b|\bogive\b/i,
  parts: [
    { id: "curve", name: "Cumulative frequency curve" },
    { id: "points", name: "Plotted at upper class bounds" },
    { id: "median", name: "Median" },
    { id: "lower-quartile", name: "Lower quartile" },
    { id: "upper-quartile", name: "Upper quartile" },
    { id: "iqr", name: "Interquartile range" },
    { id: "cf-axis", name: "Cumulative frequency" },
    { id: "reading", name: "Reading" },
  ],
  build(params: FigureParams) {
    const classes = parseClasses(params.classes);
    let bounds = classes.length ? classes.map((c) => c[1]) : numbers(params.bounds, 16);
    let freqs = numbers(params.frequencies, 16);
    let start = optNum(params.start) ?? (classes.length ? classes[0][0] : undefined);
    // Upper bounds must rise; drop any that do not.
    const ok = bounds.every((b, i) => i === 0 || b > bounds[i - 1]);
    if (bounds.length < 2 || freqs.length < 2 || !ok || freqs.slice(0, bounds.length).reduce((t, f) => t + Math.max(0, f), 0) <= 0) {
      bounds = DEFAULT_BOUNDS;
      freqs = DEFAULT_F;
      start = 0;
    }
    bounds = bounds.slice(0, 16);
    freqs = bounds.map((_, i) => Math.max(0, freqs[i] ?? 0));
    if (start === undefined || start >= bounds[0]) start = bounds[0] - (bounds[1] - bounds[0]);
    const cf = cumulative(freqs);
    const xs = [start, ...bounds], cfs = [0, ...cf];
    const og = ogive(xs, cfs);
    const n = og.n;
    const span = xs[xs.length - 1] - xs[0];
    const sx = niceScale(xs[0], xs[xs.length - 1], 7, "auto");
    const sy = niceScale(0, n, 6, "force", Number.isInteger(n));
    const sk = new Sketch();
    const W = 440, H = 300;
    const f = drawFrame(sk, { w: W, h: H, x: sx, y: sy, xTitle: title(params.xLabel, "x"), yTitle: "Cumulative frequency", xTitleGap: 60, yPart: "cf-axis" });
    const P = (x: number, y: number): Pt => ({ x: f.X(x), y: f.Y(y) });
    // The curve.
    const curve: Pt[] = [];
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < 24; j++) {
      const x = xs[i] + ((xs[i + 1] - xs[i]) * j) / 24;
      curve.push(P(x, og.at(x)));
    }
    curve.push(P(xs[xs.length - 1], n));
    sk.line(curve, { stroke: "#2563eb", width: 2.6, part: "curve" });
    // Plotted points: crosses at the upper bounds (and the start at 0).
    xs.forEach((x, i) => {
      const p = P(x, cfs[i]), s = 4.5;
      sk.line([{ x: p.x - s, y: p.y - s }, { x: p.x + s, y: p.y + s }], { stroke: "ink", width: 2.2, part: "points" });
      sk.line([{ x: p.x - s, y: p.y + s }, { x: p.x + s, y: p.y - s }], { stroke: "ink", width: 2.2, part: "points" });
    });
    // Reading lines.
    const reads: Array<{ id: string; target: number; colour: Ink; tag: string }> = [];
    const showQ = bool(params.showQuartiles, true), showM = bool(params.showMedian, true);
    if (showQ) reads.push({ id: "lower-quartile", target: n / 4, colour: "#7c3aed", tag: "LQ" });
    if (showM) reads.push({ id: "median", target: n / 2, colour: "#dc2626", tag: "M" });
    if (showQ) reads.push({ id: "upper-quartile", target: (3 * n) / 4, colour: "#7c3aed", tag: "UQ" });
    const values: Record<string, number> = {};
    const corners: Record<string, Pt> = {};
    for (const r of reads) {
      const x = og.inverse(r.target);
      values[r.id] = x;
      const c = P(x, r.target);
      corners[r.id] = c;
      sk.line([{ x: 0, y: c.y }, c, { x: c.x, y: H }], { stroke: r.colour, width: 1.8, dash: "6 4", part: r.id }, true);
    }
    const readAt = optNum(params.readAt);
    let readCorner: Pt | undefined, readValue = 0;
    if (readAt !== undefined && readAt > xs[0] && readAt < xs[xs.length - 1]) {
      readValue = og.at(readAt);
      readCorner = P(readAt, readValue);
      sk.line([{ x: readCorner.x, y: H }, readCorner, { x: 0, y: readCorner.y }], { stroke: "#16a34a", width: 1.8, dash: "6 4", part: "reading" }, true);
    }
    // Values. Each reading's x value is written under the axis at the foot of its line (a row of its
    // own between the tick values and the axis title); its target cumulative frequency beside the y
    // axis on its line. A value with no clear spot is left to the label rather than drawn over text.
    const footY = H + 36;
    const foot = (full: string, short: string, x: number, colour: Ink, part: string) => {
      const spots = (t: string) => {
        const w = textW(t, 13);
        return [0, 0.5, -0.5, 0.9, -0.9].map((k) => ({ x: x + k * (w + 4), y: footY }));
      };
      return placeFirst(sk, full, 13, spots(full), colour, part, 2) ?? placeFirst(sk, short, 13, spots(short), colour, part, 2);
    };
    for (const r of reads) foot(`${r.tag} = ${reading(values[r.id], span)}`, reading(values[r.id], span), corners[r.id].x, r.colour, r.id);
    const yValue = (t: string, y: number, colour: Ink, part: string) => {
      const w = textW(t, 13);
      placeFirst(sk, t, 13, [{ x: 5 + w / 2, y: y - 9 }, { x: 5 + w / 2, y: y + 9 }, { x: 30 + w / 2, y: y - 9 }, { x: 30 + w / 2, y: y + 9 }], colour, part);
    };
    for (const r of reads) yValue(reading(r.target, n), corners[r.id].y, r.colour, r.id);
    if (readCorner) {
      yValue(reading(readValue, n), readCorner.y, "#16a34a", "reading");
      foot(val(readAt!, 2), val(readAt!, 2), readCorner.x, "#16a34a", "reading");
    }
    // IQR: a double arrow between the quartile lines, in the lowest band clear of the values.
    let iqrAnchor: Pt | undefined;
    if (showQ) {
      const a = corners["lower-quartile"], b = corners["upper-quartile"];
      if (b.x - a.x > 30) {
        const boxes = sk.textBoxes();
        let y = H - 14;
        const hits = (yy: number) => boxes.some((t) => t.y < yy + 8 && yy - 8 < t.y + t.h && t.x < b.x && a.x < t.x + t.w);
        while (y > Math.max(b.y, 0) + 16 && hits(y)) y -= 4;
        dimension(sk, { x: a.x, y }, { x: b.x, y }, "#7c3aed", "iqr");
        const t = `IQR = ${reading(values["upper-quartile"] - values["lower-quartile"], span)}`;
        const m = corners.median?.x ?? (a.x + b.x) / 2;
        // Centred in the wider gap beside the median line, above the arrow, else below it.
        const gapMid = m - a.x >= b.x - m ? (a.x + m) / 2 : (m + b.x) / 2;
        placeFirst(sk, t, 13, [{ x: gapMid, y: y - 12 }, { x: (a.x + b.x) / 2, y: y - 12 }, { x: gapMid, y: y + 13 }, { x: gapMid, y: y - 26 }], "#7c3aed", "iqr");
        iqrAnchor = { x: a.x + Math.min(18, (b.x - a.x) * 0.25), y };
      }
    }

    // Anchors.
    const ca = og.inverse(n * 0.9);
    sk.part("curve", "Cumulative frequency curve", P(ca, og.at(ca)));
    const pi = Math.min(xs.length - 1, Math.max(1, Math.round(xs.length * 0.75)));
    sk.part("points", "Plotted at upper class bounds", P(xs[pi], cfs[pi]));
    if (corners.median) sk.part("median", `Median ≈ ${reading(values.median, span)}`, corners.median);
    if (corners["lower-quartile"]) sk.part("lower-quartile", `Lower quartile ≈ ${reading(values["lower-quartile"], span)}`, corners["lower-quartile"]);
    if (corners["upper-quartile"]) sk.part("upper-quartile", `Upper quartile ≈ ${reading(values["upper-quartile"], span)}`, corners["upper-quartile"]);
    if (iqrAnchor) sk.part("iqr", `IQR ≈ ${reading(values["upper-quartile"] - values["lower-quartile"], span)}`, iqrAnchor);
    sk.part("cf-axis", fitText(`Cumulative frequency (n = ${val(n, 2)})`, 34), { x: 0, y: f.Y(betweenTicks(sy, 0.85)) });
    if (readCorner) sk.part("reading", fitText(`${reading(readValue, n)} below ${val(readAt!, 2)}`, 34), readCorner);
    return sk.finish(14);
  },
};
