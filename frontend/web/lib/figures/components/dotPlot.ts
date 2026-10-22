import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, bool, textW } from "./mathsKit";
import { SERIES, dashed, dimension, drawFrame, mean, niceScale, numbers, title, val } from "./statsKit";

/**
 * DOT PLOT. Each value of a data set is a dot over its number on one scale; repeated values stack.
 * The code computes the mean (a dashed line, "x̄ = 5") and, when asked, the standard deviation
 * (a bracket one SD either side of the mean) — and can draw each value's distance to the mean, which
 * is what the standard deviation measures. A second set shares the scale, so two spreads compare at a
 * glance (maths benchmark, 2026-10-21: "A = 4, 5, 5, 6 has a smaller spread than B = 1, 5, 5, 9" was
 * drawn as two identical curves, rejected three times, and the board fell back to a sketch).
 */

export type Spread = { n: number; mean: number; sd: number; variance: number };

/** Mean and standard deviation; `sample` divides by n − 1 (s), otherwise by n (σ). */
export function spreadOf(data: number[], sample = false): Spread {
  const a = data.filter(Number.isFinite);
  const m = mean(a);
  const ss = a.reduce((t, v) => t + (v - m) ** 2, 0);
  const d = sample ? a.length - 1 : a.length;
  const variance = d > 0 ? ss / d : 0;
  return { n: a.length, mean: m, sd: Math.sqrt(variance), variance };
}

const DEFAULT_DATA = [4, 5, 5, 6];

export const dotPlot: FigureComponent = {
  name: "dotPlot",
  title: "Dot plot: every value of a data set as a dot over a number scale, repeated values stacked, with the mean marked and optionally the standard deviation (a bracket one SD either side of the mean) and each value's distance to the mean; an optional second set on the same scale to compare spreads",
  params: `data (the values, e.g. "4, 5, 5, 6", up to 60); data2 (an optional second set on the same scale, e.g. "1, 5, 5, 9"); group1, group2 (the sets' names, e.g. "A", "B"); xLabel (the scale's title with units); mean (true default: a dashed line at the mean, "x̄ = 5"); sd (false default | true: σ, dividing by n | "sample": s, dividing by n − 1 — a bracket one SD either side of the mean and its value); deviations (true: a line from each dot to the mean — the distances the standard deviation squares and averages; default false). The code computes the mean and SD — never give them.`,
  // Showing or comparing a spread, never a board that only calculates one ("the mean is 68 ÷ 10").
  match: /\bdot ?plots?\b|\bline plots?\b|\b(compar\w*|contrast\w*)\b[^.]{0,40}\b(spreads?|standard deviations?|variabilit\w*|dispersion)\b|\b(spreads?|standard deviations?) of (the |two |both )?(data|data sets?|sets?|values|groups?)\b|\b(more|less|wider|narrower|smaller|larger|bigger|greater) spread\b|\bspread (out )?(more|less)\b/i,
  parts: [
    { id: "dots", name: "Data values" },
    { id: "mean", name: "Mean" },
    { id: "sd", name: "One standard deviation" },
    { id: "deviation", name: "Distance from the mean" },
    { id: "scale", name: "Scale" },
    { id: "second-set", name: "Second data set" },
  ],
  build(params: FigureParams) {
    const A = numbers(params.data, 60);
    const B = numbers(params.data2, 60);
    const sets = [A.length ? A : DEFAULT_DATA, ...(B.length ? [B] : [])];
    const sdMode = String(params.sd ?? "").trim().toLowerCase();
    const showSd = /^(true|yes|1|sample|s|population|σ)$/.test(sdMode);
    const sample = /^(sample|s)$/.test(sdMode);
    const showMean = bool(params.mean, true) || showSd;
    const deviations = bool(params.deviations, false);
    const stats = sets.map((s) => spreadOf(s, sample));

    const all = sets.flat();
    const lo = Math.min(...all, ...stats.map((s) => s.mean - (showSd ? s.sd : 0)));
    const hi = Math.max(...all, ...stats.map((s) => s.mean + (showSd ? s.sd : 0)));
    const sx = niceScale(lo, hi === lo ? lo + 1 : hi, 10, "never", all.every(Number.isInteger));
    const W = 460, dot = 7, step = 17;
    // Each set's tallest stack sets its row height.
    const stackOf = (s: number[]) => {
      const counts = new Map<number, number>();
      for (const v of s) counts.set(v, (counts.get(v) ?? 0) + 1);
      return counts;
    };
    const stacks = sets.map(stackOf);
    // With deviations each value has its own row, so its line to the mean crosses no other dot.
    const tallest = (k: number) => (deviations ? sets[k].length : Math.max(...stacks[k].values()));
    const rowH = sets.map((_, k) => tallest(k) * step + 70);
    const H = rowH.reduce((t, h) => t + h, 0) + 10;
    const sk = new Sketch();
    const f = drawFrame(sk, { w: W, h: H, x: sx, xTitle: title(params.xLabel, ""), xPart: "scale", yAxis: false, grid: true });
    const names = [title(params.group1, "", 14), title(params.group2, "", 14)];
    const anchors: Record<string, Pt> = {};

    let base = H; // each set sits on its own baseline, the first one lowest (on the scale)
    sets.forEach((s, k) => {
      const c = SERIES[k === 0 ? 0 : 1];
      const st = stats[k];
      const y0 = base - 14; // the centre of the bottom dot
      const top = y0 - (tallest(k) - 1) * step;
      if (k > 0) sk.line([{ x: 0, y: base }, { x: W, y: base }], { stroke: "muted", width: 1.2, opacity: 0.6, part: "second-set" });
      const tag = k === 0 ? "dots" : "second-set";
      const placed = new Map<number, number>();
      const sorted = [...s].sort((a, b) => a - b);
      // The mean line first, so the dots sit on top of it.
      const mx = f.X(st.mean);
      if (showMean) dashed(sk, [{ x: mx, y: base }, { x: mx, y: top - 26 }], c.stroke, k === 0 ? "mean" : tag, 2);
      sorted.forEach((v, n) => {
        const i = deviations ? n : placed.get(v) ?? 0;
        placed.set(v, (placed.get(v) ?? 0) + 1);
        const p = { x: f.X(v), y: y0 - i * step };
        if (deviations && Math.abs(v - st.mean) > 1e-9) sk.line([p, { x: mx, y: p.y }], { stroke: c.stroke, width: 1.8, opacity: 0.75, part: k === 0 ? "deviation" : tag }, false);
        sk.circle(p, dot, { fill: c.fill as Ink, stroke: c.stroke, width: 2, part: tag }, false);
        if (k === 0 && !anchors.dots) anchors.dots = { x: p.x, y: p.y + dot };
      });
      if (showMean) {
        const label = `x̄ = ${val(st.mean, 2)}`;
        sk.placeText(label, 14, { x: mx, y: top - 36 }, { x: 0, y: -1 }, { max: 24, fill: c.stroke, part: k === 0 ? "mean" : tag });
        if (k === 0) anchors.mean = { x: mx, y: top - 26 };
      }
      if (showSd && st.sd > 0) {
        const y = top - 52;
        dimension(sk, { x: f.X(st.mean - st.sd), y }, { x: f.X(st.mean + st.sd), y }, c.stroke, k === 0 ? "sd" : tag);
        const sym = sample ? "s" : "σ";
        sk.placeText(`${sym} = ${val(st.sd, 2)}`, 14, { x: f.X(st.mean + st.sd) + 8 + textW(`${sym} = ${val(st.sd, 2)}`, 14) / 2, y }, { x: 1, y: 0 }, { max: 40, fill: c.stroke, part: k === 0 ? "sd" : tag });
        if (k === 0) anchors.sd = { x: f.X(st.mean - st.sd * 0.5), y };
      }
      if (deviations && k === 0) {
        const far = sorted.reduce((b, v) => (Math.abs(v - st.mean) > Math.abs(b - st.mean) ? v : b), sorted[0]);
        anchors.deviation = { x: (f.X(far) + f.X(st.mean)) / 2, y: y0 };
      }
      if (names[k]) {
        const tw = textW(names[k], 15);
        sk.placeText(names[k], 15, { x: -16 - tw / 2, y: y0 }, { x: -1, y: 0 }, { max: 40, fill: c.stroke, part: tag });
      }
      if (k > 0) anchors["second-set"] = { x: f.X(st.mean), y: y0 + dot };
      base -= rowH[k];
    });

    const s0 = stats[0];
    sk.part("dots", names[0] ? `Set ${names[0]}: ${sets[0].length} values` : "Data values", anchors.dots);
    if (anchors.mean) sk.part("mean", `Mean = ${val(s0.mean, 2)}`, anchors.mean);
    if (anchors.sd) sk.part("sd", `Standard deviation = ${val(s0.sd, 2)}`, anchors.sd);
    if (anchors.deviation) sk.part("deviation", "Distance from the mean", anchors.deviation);
    sk.part("scale", title(params.xLabel, "Scale", 30), { x: f.X(sx.ticks[Math.floor(sx.ticks.length * 0.7)] ?? sx.hi), y: H });
    if (anchors["second-set"]) sk.part("second-set", names[1] ? `Set ${names[1]}` : "Second data set", anchors["second-set"]);
    return sk.finish(14);
  },
};
