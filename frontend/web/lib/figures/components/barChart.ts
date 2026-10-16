import type { FigureComponent, FigureParams, Pt } from "../types";
import { Sketch, bool, textW } from "./mathsKit";
import { SERIES, TICK, betweenTicks, drawFrame, names, niceScale, numbers, raw, title, val } from "./statsKit";

/**
 * BAR CHART. The board gives the categories and their values (one series, or two for a grouped
 * bar chart with a key), vertical or horizontal. Bars are separated by gaps (the data is
 * categorical — contrast the histogram); the value axis starts at zero; the tallest bar is found by
 * the code. Category names are fitted under (or beside) their bars, shrinking and then shortening
 * so no two touch.
 */

const DEFAULT_CATS = ["Walk", "Bus", "Car", "Cycle", "Train"];
const DEFAULT_VALS = [12, 18, 9, 5, 6];

/** Fit a category name into `room` units: shrink to 11, then shorten with an ellipsis. */
export function fitName(t: string, room: number, size = TICK): { text: string; size: number } {
  let s = size;
  while (s > 11 && textW(t, s) > room) s -= 0.5;
  let out = t;
  while (out.length > 2 && textW(out, s) > room) out = out.slice(0, -2).trimEnd() + "…";
  return { text: out, size: s };
}

export const barChart: FigureComponent = {
  name: "barChart",
  title: "Bar chart: separate bars for categories on a value axis from zero; one series, or two series as grouped bars with a key; vertical or horizontal; the tallest bar found by the code",
  params: `categories ("Walk, Bus, Car, …", up to 12), values ("12, 18, 9, …" one per category), values2 (a second series, same order → grouped bars with a key), series1 and series2 (the series' names for the key, e.g. "Year 7", "Year 8"), yLabel (the value axis title, e.g. "Frequency" or "Rainfall (mm)"), xLabel (the category axis title, e.g. "Way of travelling"), horizontal (true: bars run left to right; good for long category names), showValues (true: write each bar's value at its end; default false).`,
  match: /\b(bar (chart|graph)s?|grouped bars?|dual bar|compound bar|column (chart|graph))\b/i,
  parts: [
    { id: "bars", name: "Bars" },
    { id: "tallest", name: "Tallest bar" },
    { id: "series-2", name: "Second series" },
    { id: "value-axis", name: "Value axis" },
    { id: "category-axis", name: "Categories" },
    { id: "key", name: "Key" },
  ],
  build(params: FigureParams) {
    let cats = names(params.categories, 12, 22);
    let v1 = numbers(params.values, 12);
    if (!cats.length && v1.length) cats = v1.map((_, i) => String.fromCharCode(65 + i));
    if (!cats.length || !v1.length) (cats = DEFAULT_CATS), (v1 = DEFAULT_VALS);
    const n = cats.length;
    v1 = cats.map((_, i) => v1[i] ?? 0);
    const raw2 = numbers(params.values2, 12);
    const two = raw2.length > 0;
    const v2 = two ? cats.map((_, i) => raw2[i] ?? 0) : [];
    const horizontal = bool(params.horizontal, false);
    const showValues = bool(params.showValues, false);
    const all = [...v1, ...v2];
    const sv = niceScale(Math.min(0, ...all), Math.max(0, ...all), 6, "force", all.every(Number.isInteger));
    const sk = new Sketch();
    const W = horizontal ? 400 : 440, H = horizontal ? Math.max(200, Math.min(320, n * (two ? 44 : 32))) : 290;
    const along = horizontal ? H : W; // the category direction's length
    const slot = along / n;
    const barW = two ? slot * 0.36 : slot * 0.58;
    const valueTitle = title(params.yLabel, "Frequency");
    const catTitle = title(params.xLabel, "");
    const f = horizontal
      ? drawFrame(sk, { w: W, h: H, x: sv, xTitle: valueTitle, xPart: "value-axis", yPart: "category-axis" })
      : drawFrame(sk, { w: W, h: H, y: sv, yTitle: valueTitle, xTitle: catTitle, xTitleGap: 42, xPart: "category-axis", yPart: "value-axis" });
    // In a horizontal chart the y axis has no scale, so drawFrame drew it; the grid is vertical only.
    const zero = horizontal ? f.X(0) : f.Y(0);
    const V = (v: number) => (horizontal ? f.X(v) : f.Y(v));
    if (sv.lo < 0) sk.line(horizontal ? [{ x: zero, y: 0 }, { x: zero, y: H }] : [{ x: 0, y: zero }, { x: W, y: zero }], { stroke: "ink", width: 1.8, part: "value-axis" });
    let tallest = 0;
    v1.forEach((v, i) => (v > v1[tallest] ? (tallest = i) : 0));
    const tallestTies = v1.filter((v) => v === v1[tallest]).length;
    const series = two ? [v1, v2] : [v1];
    const rect = (c: number, k: number) => {
      const mid = (c + 0.5) * slot;
      const a = two ? mid - barW + k * barW : mid - barW / 2;
      return { a, b: a + barW };
    };
    const ends: Pt[][] = [[], []];
    const tips: Pt[][] = [[], []];
    series.forEach((vals, k) => {
      vals.forEach((v, c) => {
        const { a, b } = rect(c, k);
        const e = V(v);
        const pts: Pt[] = horizontal
          ? [{ x: zero, y: a }, { x: e, y: a }, { x: e, y: b }, { x: zero, y: b }]
          : [{ x: a, y: zero }, { x: a, y: e }, { x: b, y: e }, { x: b, y: zero }];
        const part = k === 1 ? "series-2" : c === tallest && tallestTies === 1 && v > 0 ? "tallest" : "bars";
        sk.polygon(pts, { fill: SERIES[k].fill, stroke: SERIES[k].stroke, width: 2, part });
        // The anchor: on the bar's outline just short of its end, clear of a value written there.
        const len = Math.abs(e - zero), back = Math.min(14, len / 2) * (v < 0 ? -1 : 1);
        ends[k][c] = horizontal ? { x: e - back, y: a } : { x: k === 0 ? a : b, y: e + back };
        tips[k][c] = horizontal ? { x: e, y: (a + b) / 2 } : { x: (a + b) / 2, y: e };
      });
    });
    // Category names, centred on their slots.
    cats.forEach((name, c) => {
      const mid = (c + 0.5) * slot;
      if (horizontal) {
        const fit = fitName(name, 130);
        sk.text({ x: -11 - textW(fit.text, fit.size) / 2, y: mid }, fit.text, fit.size, "ink");
      } else {
        const fit = fitName(name, slot - 6);
        sk.text({ x: mid, y: H + 19 }, fit.text, fit.size, "ink");
      }
      sk.line(horizontal ? [{ x: -6, y: mid }, { x: 0, y: mid }] : [{ x: mid, y: H }, { x: mid, y: H + 6 }], { stroke: "ink", width: 1.6, part: "category-axis" }, false);
    });
    if (horizontal && catTitle) sk.text({ x: textW(catTitle, 15) / 2 - 10, y: -24 }, catTitle, 15, "ink");
    if (showValues) {
      series.forEach((vals, k) => vals.forEach((v, c) => {
        const e = tips[k][c];
        const t = val(v, 2);
        const neg = v < 0;
        const at = horizontal ? { x: e.x + (neg ? -1 : 1) * (textW(t, 13) / 2 + 6), y: e.y } : { x: e.x, y: e.y + (neg ? 12 : -11) };
        sk.text(at, t, 13, "muted");
      }));
    }
    // Key: above the plot, at the right.
    let keyAnchor: Pt | undefined;
    if (two) {
      const labels = [title(params.series1, "Series 1", 20), title(params.series2, "Series 2", 20)];
      let x = W;
      const y = horizontal ? -24 : -24;
      const items = labels.map((t) => ({ t, w: 16 + 6 + textW(t, 14) }));
      const total = items.reduce((s, it) => s + it.w, 0) + 14;
      x = W - total;
      items.forEach((it, k) => {
        sk.polygon([{ x, y: y - 7 }, { x: x + 14, y: y - 7 }, { x: x + 14, y: y + 7 }, { x, y: y + 7 }], { fill: SERIES[k].fill, stroke: SERIES[k].stroke, width: 2, part: "key" });
        sk.text({ x: x + 20 + textW(it.t, 14) / 2, y }, it.t, 14, "ink", "key");
        if (k === 1) keyAnchor = { x: x + it.w + 2, y };
        x += it.w + 14;
      });
    }

    // Anchors.
    // "Bars" points at the tallest of the other bars: its leader then passes over the shorter ones.
    const plainIdx = v1.map((_, i) => i).filter((i) => !(i === tallest && tallestTies === 1 && v1[i] > 0));
    const pick = plainIdx.sort((a, b) => v1[b] - v1[a])[0] ?? -1;
    if (pick >= 0) sk.part("bars", two ? title(params.series1, "Bars", 30) : "Bars", ends[0][pick]);
    if (tallestTies === 1 && v1[tallest] > 0) sk.part("tallest", `Tallest bar: ${cats[tallest]} (${val(v1[tallest], 2)})`.slice(0, 34), ends[0][tallest]);
    if (two) {
      let j = 0;
      v2.forEach((v, i) => (v > v2[j] ? (j = i) : 0));
      sk.part("series-2", title(params.series2, "Second series", 30), ends[1][j]);
      if (keyAnchor) sk.part("key", "Key", keyAnchor);
    }
    const valueAxisAt = horizontal ? { x: f.X(betweenTicks(sv, 0.6)), y: H } : { x: 0, y: f.Y(betweenTicks(sv, 0.6)) };
    sk.part("value-axis", valueTitle.slice(0, 34), valueAxisAt);
    sk.part("category-axis", catTitle || "Categories", horizontal ? { x: 0, y: (n - 0.5) * slot + Math.min(slot / 2, 14) } : { x: (n - 0.5) * slot + Math.min(slot / 2 - 2, 20), y: H });
    return sk.finish(14);
  },
};
