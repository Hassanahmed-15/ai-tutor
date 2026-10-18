import type { FigureComponent, FigureParams, FigurePart, FigureShape } from "../types";
import { fitText } from "../cuts";
import { BIO, arrowShapes, capital, cleanName, r2, roundedPoly, softShape } from "./bioDraw";
import { textW } from "./mathsKit";

type PyramidType = "numbers" | "biomass" | "energy";
export type PyramidLevel = { name: string; value: number };
export type Pyramid = {
  type: PyramidType;
  levels: PyramidLevel[];
  log: boolean;
  unit: string;
  /** Bar widths, bottom (producers) first, in figure units. */
  widths: number[];
  /** Transfer efficiency (%) from each level to the next; empty for a pyramid of numbers. */
  efficiency: number[];
  /** Energy lost between each level and the next (energy pyramids only). */
  loss: number[];
};

const PART = ["producers", "primary", "secondary", "tertiary", "quaternary"];
const NAME = ["Producers", "Primary consumers", "Secondary consumers", "Tertiary consumers", "Quaternary consumers"];
const INK = [BIO.green, BIO.blue, BIO.violet, BIO.red, BIO.amber] as const;
const UNIT: Record<PyramidType, string> = { numbers: "", biomass: "g/m²", energy: "kJ/m²/year" };
const MAX_W = 440;

const DEFAULTS: Record<PyramidType, string> = {
  energy: "grass:20000; grasshopper:2000; frog:200; snake:20",
  biomass: "phytoplankton:800; zooplankton:120; small fish:20; large fish:4",
  numbers: "grass:5000; rabbit:400; fox:12",
};

function parseValue(s: string): number | undefined {
  const t = s.trim().replace(/[\s,_]/g, "").replace(/[×x]10\^?(-?\d+)/i, "e$1");
  if (!t) return undefined;
  const v = Number(t.replace(/[^0-9.eE+-]/g, ""));
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** "%", to at most 2 significant figures below 1% and 1 decimal place above. */
export function percent(p: number): string {
  if (!Number.isFinite(p)) return "?";
  const v = p < 1 ? Number(p.toPrecision(2)) : Number(p.toFixed(1));
  return `${v}%`;
}
/** 20000 → "20,000"; 0.5 → "0.5". */
export function grouped(v: number): string {
  if (!Number.isFinite(v)) return "?";
  const r = v >= 100 ? Math.round(v) : Number(v.toPrecision(3));
  const [i, d] = String(r).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d ? `.${d}` : "");
}

/**
 * The pyramid's numbers, from the board's levels: bar widths proportional to the values (or to their
 * logarithms when log is on — energy figures span powers of ten), the transfer efficiency between
 * each level and the next (next ÷ this × 100%) and, for energy, the energy lost at each step.
 */
export function pyramidData(params: FigureParams): Pyramid {
  const t = String(params.type ?? params.pyramid ?? "energy").toLowerCase();
  const type: PyramidType = /number|count|individual/.test(t) ? "numbers" : /biomass|mass|dry/.test(t) ? "biomass" : "energy";
  let text = typeof params.levels === "string" && params.levels.trim() ? params.levels : DEFAULTS[type];
  // "a:1,000, b:100" (no semicolons): commas that are followed by a new "name:" split the levels.
  let items = text.split(/[;\n|]+/);
  if (items.length === 1) items = text.split(/,\s*(?=[^,:\d][^,:]*[:=])/);
  if (items.length === 1 && !/[:=]/.test(text)) items = text.split(/,\s*/);
  let levels: PyramidLevel[] = items.map((it, i) => {
    const [a, b] = /[:=]/.test(it) ? it.split(/[:=]/) : ["", it];
    const v = parseValue(b ?? "");
    return { name: cleanName(a, 16) || NAME[i] || `Level ${i + 1}`, value: v ?? NaN };
  }).filter((l) => Number.isFinite(l.value)).slice(0, 5);
  if (levels.length < 2) {
    text = DEFAULTS[type];
    levels = text.split(";").map((it) => { const [a, b] = it.split(":"); return { name: a.trim(), value: Number(b) }; });
  }
  // Top level first given? Producers are the largest energy store — and a list that ends with
  // "producer"/a plant name was written top-down. Only the explicit word flips it.
  if (/producer|plant|grass|phytoplankton|tree/i.test(levels[levels.length - 1].name) && !/producer|plant|grass|phytoplankton|tree/i.test(levels[0].name)) levels.reverse();
  const values = levels.map((l) => l.value);
  const max = Math.max(...values);
  const positive = values.filter((v) => v > 0);
  const min = positive.length ? Math.min(...positive) : 1;
  const logWord = params.log ?? params.scale;
  // Log scale when asked; unasked, an energy pyramid spanning more than a hundredfold is drawn on one
  // (on a linear scale its top bars would be slivers).
  const explicit = logWord === undefined || logWord === "" ? undefined : logWord === true || /^(true|yes|1|log)/i.test(String(logWord));
  const log = explicit ?? (type === "energy" && max > 0 && max / min >= 100);
  const widths = values.map((v) => {
    if (max <= 0 || v <= 0) return 0;
    if (!log) return (MAX_W * v) / max;
    const span = Math.log10(max / min) + 1;
    return (MAX_W * (Math.log10(v / min) + 1)) / span;
  });
  const efficiency = type === "numbers" ? [] : values.slice(1).map((v, i) => (values[i] > 0 ? (v / values[i]) * 100 : NaN));
  const loss = type === "energy" ? values.slice(1).map((v, i) => values[i] - v) : [];
  const unit = typeof params.unit === "string" && params.unit.trim() ? fitText(params.unit.trim(), 16) : UNIT[type];
  return { type, levels, log, unit, widths, efficiency, loss };
}

/**
 * An ecological pyramid of numbers, biomass or energy: one bar per trophic level, producers at the
 * bottom, each bar's width proportional to its value (an inverted or odd-shaped pyramid of numbers or
 * biomass is drawn as the data say). Between levels the code writes the transfer efficiency it
 * computes, and for energy an arrow at each level for the energy lost (respiration, heat, waste).
 */
export const ecologicalPyramid: FigureComponent = {
  name: "ecologicalPyramid",
  title: "Ecological pyramid (numbers, biomass or energy): bars proportional to each trophic level's value, transfer efficiency and energy lost computed",
  params: `type ("energy" — default —, "biomass" or "numbers"); levels (producers first, each "name:value", separated by ";", e.g. "grass:20000; grasshopper:2000; frog:200; snake:20" — 2 to 5 levels); unit (e.g. "kJ/m²/year", "g/m²"; defaults by type); log (true draws bar widths on a log scale, for energy values that span powers of ten). Widths, transfer efficiencies (next ÷ this × 100%) and energy losses are computed; a pyramid of numbers or biomass may be inverted when the values say so.`,
  match: /\b(pyramids? of (numbers|biomass|energy)|(ecological|energy|biomass|trophic) pyramids?|inverted pyramid|(energy|ecological) transfer efficiency|efficiency of (energy )?transfer|(10|ten) ?% rule)\b/i,
  parts: [
    { id: "producers", name: "Producers" },
    { id: "primary", name: "Primary consumers" },
    { id: "secondary", name: "Secondary consumers" },
    { id: "tertiary", name: "Tertiary consumers" },
    { id: "quaternary", name: "Quaternary consumers" },
    { id: "energy-loss", name: "Energy lost (respiration, heat)" },
    { id: "efficiency", name: "Transfer efficiency" },
  ],
  build(params: FigureParams) {
    const py = pyramidData(params);
    const n = py.levels.length;
    const BAR_H = n >= 5 ? 50 : 58;
    const lossW = py.type === "energy" ? 120 : 16;
    const effW = py.efficiency.length ? 104 : 16;
    const cx = lossW + MAX_W / 2;
    const W = lossW + MAX_W + effW;
    const top = 14;
    const H = top + n * BAR_H + (py.unit ? 34 : 12);
    const yOf = (i: number) => top + (n - 1 - i) * BAR_H; // a level's top edge; producers at the bottom
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const size = 17;

    py.levels.forEach((lv, i) => {
      const w = Math.max(py.widths[i], lv.value > 0 ? 3 : 0), y = yOf(i), part = PART[i];
      if (w > 0) {
        const d = roundedPoly([{ x: cx - w / 2, y }, { x: cx + w / 2, y }, { x: cx + w / 2, y: y + BAR_H }, { x: cx - w / 2, y: y + BAR_H }], Math.min(4, w / 2));
        shapes.push(...softShape(d, INK[i], part, { fillOpacity: 0.3, width: 2 }));
      } else shapes.push({ t: "path", part, d: `M${r2(cx)} ${r2(y + 8)} V${r2(y + BAR_H - 8)}`, stroke: "ink", width: 2, fill: "none" });
      // The value: inside the bar when it fits, else just beyond its right end.
      const full = py.unit && py.type !== "numbers" ? `${grouped(lv.value)} ${py.unit}` : grouped(lv.value);
      const label = textW(full, size) + 18 <= w ? full : grouped(lv.value);
      const inside = textW(label, size) + 18 <= w;
      shapes.push({ t: "text", part, x: r2(inside ? cx : cx + w / 2 + 8), y: r2(inside ? y + BAR_H / 2 + size * 0.36 : y + BAR_H / 2 - 2), text: label, size, anchor: inside ? "middle" : "start" });
      // The level's label points at the bar's right end (or its middle when the bar is a sliver),
      // below the value so the dot never sits on the digits.
      const ax = inside ? cx + w / 2 - 7 : cx + w / 2;
      const ay = inside ? y + BAR_H / 2 : y + BAR_H / 2 + 8;
      const who = lv.name && lv.name.toLowerCase() !== NAME[i].toLowerCase() ? `${NAME[i]} (${lv.name.toLowerCase()})` : NAME[i];
      parts.push({ id: part, name: who.length <= 34 ? who : NAME[i], anchor: { x: r2(ax), y: r2(ay) } });
    });

    // Transfer efficiency between each level and the next: an upward arrow with the percentage, in a
    // column right of the widest bar, centred on the boundary between the two bars.
    py.efficiency.forEach((e, i) => {
      const yb = yOf(i); // boundary between level i and i+1
      const x = W - 12;
      // Only the lowest one carries the part, so the column is not one tall obstacle to other leaders.
      const tag = i === 0 ? "efficiency" : undefined;
      shapes.push(...arrowShapes({ x, y: yb + 15 }, { x, y: yb - 15 }, "muted", 2, tag, { head: 9 }));
      shapes.push({ t: "text", ...(tag ? { part: tag } : {}), x: x - 8, y: r2(yb + 6), text: percent(e), size: 16, anchor: "end", fill: BIO.green });
    });
    if (py.efficiency.length) parts.push({ id: "efficiency", name: py.type === "energy" ? "Energy transfer efficiency" : "Biomass transfer efficiency", anchor: { x: W - 12, y: r2(yOf(0) + 8) } });

    // Energy lost at each step: an arrow out of the bar's left end, with the amount lost.
    const firstLoss = py.loss.findIndex((l) => l > 0);
    py.loss.forEach((l, i) => {
      if (!(l > 0)) return;
      const tag = i === firstLoss ? "energy-loss" : undefined;
      const w = Math.max(py.widths[i], 3), y = yOf(i) + BAR_H / 2;
      const from = { x: cx - w / 2 - 4, y }, to = { x: cx - w / 2 - 54, y: y - 16 };
      shapes.push(...arrowShapes(from, to, BIO.red, 2.4, tag, { head: 11, bend: -6 }));
      shapes.push({ t: "text", ...(tag ? { part: tag } : {}), x: r2(to.x + 4), y: r2(to.y - 9), text: grouped(l), size: 15, anchor: "middle", fill: BIO.red });
    });
    if (py.loss.some((l) => l > 0)) {
      const i = py.loss.findIndex((l) => l > 0);
      const w = Math.max(py.widths[i], 3);
      parts.push({ id: "energy-loss", name: "Energy lost (respiration, heat)", anchor: { x: r2(cx - w / 2 - 30), y: r2(yOf(i) + BAR_H / 2 - 8) } });
    }
    if (py.unit) shapes.push({ t: "text", x: r2(cx), y: r2(top + n * BAR_H + 26), text: `${capital(py.type === "numbers" ? "number of organisms" : py.type)} (${py.unit})${py.log ? ", log scale" : ""}`, size: 15, anchor: "middle", fill: "muted" });
    return { w: r2(W), h: r2(H), shapes, parts };
  },
};
