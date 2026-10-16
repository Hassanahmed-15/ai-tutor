import type { FigureComponent, FigureParams, Pt } from "../types";
import { Sketch, bool, textW } from "./mathsKit";
import { ON_FILL, SERIES, TICK, betweenTicks, dimension, drawFrame, niceScale, numbers, raw, title, val } from "./statsKit";

/**
 * HISTOGRAM. The board gives the classes and their frequencies. Bars touch (the data is
 * continuous); with unequal class widths the code plots FREQUENCY DENSITY = frequency ÷ class width
 * (so each bar's AREA is its frequency), and with equal widths plain frequency unless told
 * otherwise. The modal class (highest frequency density) is found by the code, as is the width
 * marked on the widest class.
 */

export type HistClass = { lo: number; hi: number; f: number; width: number; fd: number };

/** "0-10, 10-20, 20-40" (or "0≤x<10", "10–20", "0 to 10") → [lo, hi] pairs. */
export function parseClasses(v: unknown): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const part of raw(v, 1200).split(/[,;]/)) {
    const nums = (part.replace(/(\d)\s*[-–—]\s*(?=\d)/g, "$1 ").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (nums.length >= 2 && nums[1] > nums[0]) out.push([nums[0], nums[1]]);
  }
  return out.slice(0, 16);
}

/** Classes sorted, frequencies attached, densities computed. Overlapping classes are dropped. */
export function histogramClasses(classes: Array<[number, number]>, freqs: number[]): HistClass[] {
  const rows = classes.map(([lo, hi], i) => ({ lo, hi, f: Math.max(0, freqs[i] ?? 0) })).sort((a, b) => a.lo - b.lo);
  const kept: typeof rows = [];
  for (const r of rows) if (!kept.length || r.lo >= kept[kept.length - 1].hi - 1e-9) kept.push(r);
  return kept.map((r) => ({ ...r, width: r.hi - r.lo, fd: r.f / (r.hi - r.lo) }));
}

const DEFAULT: Array<[number, number]> = [[0, 10], [10, 20], [20, 30], [30, 50], [50, 80]];
const DEFAULT_F = [4, 12, 18, 16, 6];

export const histogram: FigureComponent = {
  name: "histogram",
  title: "Histogram: touching bars over class intervals; with unequal widths the code plots frequency density (frequency ÷ class width) so bar area = frequency; modal class and a class width marked",
  params: `classes (class intervals "0-10, 10-20, 20-40, …", up to 16; equal or unequal widths), frequencies ("4, 12, 18, …" one per class), xLabel (the variable with units, e.g. "Time (minutes)"), density ("auto" — default: frequency density when the widths are unequal —, true, or false), showValues (true: write each bar's plotted value above it; default false), showWidth (default true: mark the widest class's width). Give raw frequencies only — the code computes every density.`,
  match: /\bhistograms?\b|\bfrequency density\b|\bunequal (class )?widths?\b|\bclass width\b/i,
  parts: [
    { id: "bars", name: "Bars" },
    { id: "modal-class", name: "Modal class" },
    { id: "y-axis", name: "Frequency density" },
    { id: "class-width", name: "Class width" },
    { id: "x-axis", name: "Class boundaries" },
  ],
  build(params: FigureParams) {
    let classes = parseClasses(params.classes);
    let freqs = numbers(params.frequencies, 16);
    if (classes.length < 1 || freqs.length < 1) (classes = DEFAULT), (freqs = DEFAULT_F);
    let rows = histogramClasses(classes, freqs);
    if (!rows.length) rows = histogramClasses(DEFAULT, DEFAULT_F);
    const widths = rows.map((r) => r.width);
    const equal = widths.every((w) => Math.abs(w - widths[0]) < 1e-9);
    const dSpec = raw(params.density).toLowerCase();
    const density = /^(auto|)$/.test(dSpec) ? !equal : bool(params.density, !equal);
    const value = (r: HistClass) => (density ? r.fd : r.f);
    const top = Math.max(...rows.map(value));
    const sy = niceScale(0, top > 0 ? top : 1, 6, "force", !density && rows.every((r) => Number.isInteger(r.f)));
    const lo = rows[0].lo, hi = rows[rows.length - 1].hi;
    const span = hi - lo;
    const sx = { lo: lo, hi: hi + span * 0.04, step: 0, ticks: [], dp: 0 };
    const boundaries = [...new Set(rows.flatMap((r) => [r.lo, r.hi]))].sort((a, b) => a - b);
    const bdp = Math.max(0, ...boundaries.map((b) => (String(b).split(".")[1] ?? "").length));
    const sk = new Sketch();
    const W = 440, H = 290;
    const yTitle = density ? "Frequency density" : "Frequency";
    const f = drawFrame(sk, {
      w: W, h: H, x: sx, y: sy, xTicks: boundaries, xText: (v) => val(v, Math.min(bdp, 2)),
      xTitle: title(params.xLabel, "x"), yTitle, xPart: "x-axis", yPart: "y-axis",
    });
    // The modal class: highest frequency density (= highest bar).
    let modal = 0;
    rows.forEach((r, i) => (r.fd > rows[modal].fd ? (modal = i) : 0));
    const ties = rows.filter((r) => Math.abs(r.fd - rows[modal].fd) < 1e-12).length;
    const blue = SERIES[0];
    const barTop = (r: HistClass) => f.Y(value(r));
    rows.forEach((r, i) => {
      if (r.f <= 0) return;
      const x0 = f.X(r.lo), x1 = f.X(r.hi), y = barTop(r);
      const isModal = i === modal && ties === 1;
      sk.polygon([{ x: x0, y: H }, { x: x0, y }, { x: x1, y }, { x: x1, y: H }], { fill: isModal ? "#fde68a" : blue.fill, stroke: isModal ? "#d97706" : blue.stroke, width: 2, part: isModal ? "modal-class" : "bars" });
    });
    const valueLift: number[] = [];
    // The widest class's width: a dimension arrow inside its bar near the base, or above a short bar.
    let widest = -1;
    rows.forEach((r, i) => (r.f > 0 && (widest < 0 || r.width > rows[widest].width) ? (widest = i) : 0));
    let widthAnchor: Pt | undefined;
    if (bool(params.showWidth, true) && widest >= 0) {
      const r = rows[widest];
      const x0 = f.X(r.lo), x1 = f.X(r.hi);
      const t = `width ${val(r.width, 2)}`;
      if (x1 - x0 >= Math.max(34, textW(t, TICK - 1) * 0.6)) {
        const inside = H - barTop(r) >= 46 && textW(t, TICK - 1) < x1 - x0 - 8;
        const y = inside ? H - 14 : barTop(r) - 10;
        const ink = inside ? ON_FILL : "ink";
        dimension(sk, { x: x0 + 3, y }, { x: x1 - 3, y }, ink, "class-width");
        sk.text({ x: (x0 + x1) / 2, y: y - 14 }, t, TICK - 1, ink, "class-width");
        widthAnchor = { x: (x0 + x1) / 2 < W / 2 ? x0 + 3 : x1 - 3, y };
        valueLift[widest] = inside ? 0 : 30;
      }
    }
    if (bool(params.showValues, false)) {
      rows.forEach((r, i) => {
        if (r.f <= 0) return;
        const t = val(value(r), density ? 2 : 1);
        const x = (f.X(r.lo) + f.X(r.hi)) / 2;
        if (textW(t, 13) < f.X(r.hi) - f.X(r.lo) + 6) sk.text({ x, y: barTop(r) - 11 - (valueLift[i] ?? 0) }, t, 13, "muted");
      });
    }

    // Anchors.
    const others = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => r.f > 0 && !(i === modal && ties === 1));
    const pick = others.sort((a, b) => a.i - b.i)[0];
    if (pick) sk.part("bars", density ? "Bars (area = frequency)" : "Bars", { x: f.X(pick.r.lo) + Math.min(14, (f.X(pick.r.hi) - f.X(pick.r.lo)) / 2), y: barTop(pick.r) });
    if (ties === 1 && rows[modal].f > 0) {
      const r = rows[modal];
      sk.part("modal-class", `Modal class ${val(r.lo, 2)}–${val(r.hi, 2)}`, { x: (f.X(r.lo) + f.X(r.hi)) / 2, y: barTop(r) });
    }
    sk.part("y-axis", density ? "Frequency density (f ÷ width)" : "Frequency", { x: 0, y: f.Y(betweenTicks(sy, 0.6)) });
    if (widthAnchor) sk.part("class-width", `Class width = ${val(rows[widest].width, 2)}`, widthAnchor);
    sk.part("x-axis", "Class boundaries", { x: f.X(boundaries[Math.floor(boundaries.length / 2)]), y: H });
    return sk.finish(14);
  },
};
