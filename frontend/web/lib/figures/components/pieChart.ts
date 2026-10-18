import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { fitWithin } from "../cuts";
import { Sketch, polar, rad, textW } from "./mathsKit";
import { ON_FILL, names, numbers, raw, sum, title, val } from "./statsKit";

/**
 * PIE CHART. The board gives categories and their values (frequencies, amounts — anything that
 * adds up to a whole); the code computes each sector's angle (value ÷ total × 360°, drawn exactly,
 * clockwise from 12 o'clock) and its percentage (rounded so they total 100%), writes them in the
 * sectors, draws a key, and marks the largest sector.
 */

export const PIE_FILLS: Ink[] = ["#93c5fd", "#fca5a5", "#86efac", "#fcd34d", "#c4b5fd", "#67e8f9", "#f9a8d4", "#d6d3d1"];
const MAX = 8;
const DEFAULT_CATS = ["Bus", "Car", "Walk", "Cycle", "Train"];
const DEFAULT_VALS = [12, 9, 6, 2, 1];

/** Sector angles in degrees (sum exactly 360) for non-negative values. */
export function pieAngles(values: number[]): number[] {
  const v = values.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const total = sum(v);
  return total > 0 ? v.map((x) => (x / total) * 360) : v.map(() => 360 / Math.max(1, v.length));
}

/** Whole-number percentages that total exactly 100 (largest-remainder rounding). */
export function piePercents(values: number[], dp = 0): number[] {
  const v = values.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const total = sum(v) || 1;
  const k = 10 ** dp;
  const exact = v.map((x) => (x / total) * 100 * k);
  const floors = exact.map(Math.floor);
  let left = Math.round(100 * k - sum(floors));
  const order = exact.map((e, i) => ({ i, r: e - floors[i] })).sort((a, b) => b.r - a.r);
  for (const { i } of order) if (left-- > 0 && v[i] > 0) floors[i] += 1;
  return floors.map((f) => f / k);
}

export const pieChart: FigureComponent = {
  name: "pieChart",
  title: "Pie chart: sectors with angles computed from the values (value ÷ total × 360°), percentages or angles written in each sector, a key, the largest sector marked",
  params: `categories ("Bus, Car, Walk, …", up to 8; more are merged into "Other"), values ("12, 9, 6, …" one per category: frequencies or amounts — the code computes every angle and percentage), show ("percent" — default —, "angle" (degrees, as when drawing a pie chart by hand), "value", or "none": what is written in each sector), key (default true: a key beside the pie), total (optional: a heading like "30 students" written under the pie).`,
  match: /\bpie (chart|graph|diagram)s?\b|\bsectors? angle\b|\bangle of (the |each )?sector\b/i,
  parts: [
    ...Array.from({ length: MAX }, (_, i) => ({ id: `sector-${i + 1}`, name: `Sector ${i + 1} (category ${i + 1})` })),
    { id: "largest", name: "Largest sector" },
    { id: "centre", name: "Centre" },
    { id: "key", name: "Key" },
  ],
  build(params: FigureParams) {
    let cats = names(params.categories, 20, 18);
    // The board's whole category names: a label that fits one is recorded with the board's own words.
    const fullCats = names(params.categories, 20, 400);
    let vals = numbers(params.values, 20).map((v) => Math.max(0, v));
    if (!cats.length && vals.length) cats = vals.map((_, i) => String.fromCharCode(65 + i));
    if (!cats.length || !vals.length || sum(vals.slice(0, cats.length)) <= 0) (cats = DEFAULT_CATS), (vals = DEFAULT_VALS);
    let rows = cats.map((c, i) => ({ c, v: vals[i] ?? 0, full: fullCats.length === cats.length ? fullCats[i] : c })).filter((r) => r.v > 0);
    if (!rows.length) rows = DEFAULT_CATS.map((c, i) => ({ c, v: DEFAULT_VALS[i], full: c }));
    if (rows.length > MAX) {
      const keep = [...rows].sort((a, b) => b.v - a.v).slice(0, MAX - 1);
      const other = rows.filter((r) => !keep.includes(r));
      rows = [...rows.filter((r) => keep.includes(r)), { c: "Other", v: sum(other.map((r) => r.v)), full: "Other" }];
    }
    const angles = pieAngles(rows.map((r) => r.v));
    const pct = piePercents(rows.map((r) => r.v));
    const show = /^ang|deg/i.test(raw(params.show)) ? "angle" : /^val|freq|num/i.test(raw(params.show)) ? "value" : /^(none|no|false|off|hide)$/i.test(raw(params.show)) ? "none" : "percent";
    const R = 132;
    const C: Pt = { x: 0, y: 0 };
    const sk = new Sketch();
    // Screen angle (y down): 12 o'clock is −90°, clockwise is increasing.
    let start = -90;
    const mids: number[] = [];
    rows.forEach((r, i) => {
      const a0 = start, a1 = start + angles[i];
      const part = `sector-${i + 1}`;
      if (angles[i] >= 359.999) sk.circle(C, R, { fill: PIE_FILLS[i], stroke: "ink", width: 2, part });
      else
        sk.path(
          [{ k: "M", p: C }, { k: "L", p: polar(C, R, rad(a0)) }, { k: "A", c: C, r: R, to: polar(C, R, rad(a1)), large: a1 - a0 > 180, sweep: true }, { k: "L", p: C }],
          true,
          { fill: PIE_FILLS[i], stroke: "ink", width: 2, part },
          true,
        );
      mids.push((a0 + a1) / 2);
      start = a1;
    });
    // What each sector says.
    rows.forEach((r, i) => {
      if (show === "none") return;
      const t = show === "angle" ? `${val(angles[i], 1)}°` : show === "value" ? val(r.v, 2) : `${val(pct[i], 1)}%`;
      const inside = angles[i] >= (textW(t, 15) > 34 ? 34 : 26);
      const m = rad(mids[i]);
      if (inside) sk.text(polar(C, R * (angles[i] > 60 ? 0.62 : 0.7), m), t, 15, ON_FILL);
      else {
        const u = { x: Math.cos(m), y: Math.sin(m) };
        const spot = sk.findText(t, 14, polar(C, R, m), u, { min: 10 + textW(t, 14) * Math.abs(u.x) * 0.5, max: 70 });
        sk.text(spot.c, t, 14, "ink");
      }
    });
    // The largest sector: an arc just outside its rim.
    let big = 0;
    rows.forEach((r, i) => (r.v > rows[big].v ? (big = i) : 0));
    const ties = rows.filter((r) => r.v === rows[big].v).length;
    const bigStart = -90 + sum(angles.slice(0, big));
    if (ties === 1 && rows.length > 1) {
      const a0 = rad(bigStart + 1.5), a1 = rad(bigStart + angles[big] - 1.5);
      const r2 = R + 7;
      sk.path([{ k: "M", p: polar(C, r2, a0) }, { k: "A", c: C, r: r2, to: polar(C, r2, a1), large: angles[big] > 183, sweep: true }], false, { stroke: "#d97706", width: 3.4, fill: "none", part: "largest" }, true);
    }
    sk.circle(C, 3.2, { fill: "ink", stroke: "ink", width: 1, part: "centre" });
    // Key, beside the pie.
    let keyAnchor: Pt | undefined;
    const keyOn = !/^(false|no|off|0|none|hide)$/i.test(raw(params.key));
    if (keyOn) {
      const x0 = R + 46, rowH = 26;
      const y0 = -((rows.length - 1) * rowH) / 2;
      let widest = 0;
      rows.forEach((r, i) => {
        const y = y0 + i * rowH;
        sk.polygon([{ x: x0, y: y - 8 }, { x: x0 + 16, y: y - 8 }, { x: x0 + 16, y: y + 8 }, { x: x0, y: y + 8 }], { fill: PIE_FILLS[i], stroke: "ink", width: 1.6, part: "key" });
        sk.text({ x: x0 + 24 + textW(r.c, 15) / 2, y }, r.c, 15, "ink", "key");
        widest = Math.max(widest, textW(r.c, 15));
      });
      keyAnchor = { x: x0 + 24 + widest + 6, y: y0 };
    }
    const heading = title(params.total, "", 30);
    if (heading) sk.text({ x: 0, y: R + 30 }, heading, 15, "muted");

    // Anchors: each sector on its rim's midpoint (a leader then needs to cross no other sector).
    rows.forEach((r, i) => {
      const m = rad(mids[i]);
      const onRim = polar(C, R * (angles[i] < 30 ? 0.86 : 0.9), m);
      sk.part(`sector-${i + 1}`, fitWithin("", r.full, ` (${val(pct[i], 1)}%)`, 34, 18), onRim);
    });
    if (ties === 1 && rows.length > 1) sk.part("largest", fitWithin("Largest: ", rows[big].full, ` (${val(pct[big], 1)}%)`, 34, 18), polar(C, R + 7, rad(bigStart + angles[big] * 0.3)));
    sk.part("centre", "Centre", C);
    if (keyAnchor) sk.part("key", "Key", keyAnchor);
    return sk.finish(14);
  },
};
