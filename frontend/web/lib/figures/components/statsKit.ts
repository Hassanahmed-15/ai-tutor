import type { Ink, Pt } from "../types";
import { Sketch, fmt, optNum, textBox, textW } from "./mathsKit";

/**
 * Shared kit for the code-drawn STATISTICS charts (scatterPlot, histogram, boxPlot, barChart,
 * pieChart, cumulativeFrequency). Parses the board's compact data lists, chooses "nice" axis scales
 * (1, 2, 2.5, 5 × 10ⁿ steps), and draws a textbook frame: light grid, axes with ticks, tick values
 * that never collide, the y-axis title above the axis and the x-axis title under the tick values.
 * Every statistic is computed here or in the component — the model only ever supplies data.
 */

/** Soft fills to pair with mathsKit's PALETTE (same order: blue, red, green, amber, violet). */
export const SOFT = { blue: "#bfdbfe", red: "#fecaca", green: "#bbf7d0", amber: "#fde68a", violet: "#ddd6fe" } as const;
export const SERIES: Array<{ stroke: Ink; fill: Ink }> = [
  { stroke: "#2563eb", fill: "#bfdbfe" },
  { stroke: "#dc2626", fill: "#fecaca" },
  { stroke: "#16a34a", fill: "#bbf7d0" },
  { stroke: "#d97706", fill: "#fde68a" },
  { stroke: "#7c3aed", fill: "#ddd6fe" },
];

/**
 * Dark ink for text and marks drawn ON a light fill (inside a sector or a bar): it is not one of the
 * colours the chalkboard swaps to chalk (lib/canvas/theme.ts), so it stays readable on both themes.
 */
export const ON_FILL: Ink = "#111827";

/* ── parsing ──────────────────────────────────────────────────────────────────────────────── */

/** A free-text param as a string (lists may be long), trimmed and capped. */
export function raw(v: unknown, max = 400): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
/** "3, 4.5; 7" → [3, 4.5, 7]; junk entries are dropped. */
export function numbers(v: unknown, max = 200): number[] {
  return raw(v, 2000)
    .split(/[,;\s]+/)
    .map((s) => optNum(s.replace(/[()[\]{}]/g, "")))
    .filter((n): n is number => n !== undefined)
    .slice(0, max);
}
/** "Red, Blue; Green" → ["Red", "Blue", "Green"] (each capped). */
export function names(v: unknown, max = 12, len = 18): string[] {
  return raw(v)
    .split(/[,;]/)
    .map((s) => s.trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max);
}
/** "1,2; 3,5" or "(1,2) (3,5)" → points. */
export function pairs(v: unknown, max = 60): Pt[] {
  const s = raw(v, 2000);
  const out: Pt[] = [];
  const groups = /[;()]/.test(s) ? s.split(/[;()]+/) : [];
  if (groups.filter((g) => g.trim()).length) {
    for (const g of groups) {
      const n = g.split(/[,\s]+/).map((t) => optNum(t)).filter((x): x is number => x !== undefined);
      if (n.length >= 2) out.push({ x: n[0], y: n[1] });
    }
  } else {
    const n = numbers(s, 2 * max);
    for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
  }
  return out.slice(0, max);
}
/** An axis/key title: short text, no newlines. */
export function title(v: unknown, fallback: string, max = 34): string {
  const s = raw(v).replace(/\s+/g, " ");
  return s ? s.slice(0, max) : fallback;
}

/* ── statistics ───────────────────────────────────────────────────────────────────────────── */

export const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
export const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
/** The median of a SORTED list. */
export function medianSorted(a: number[]): number {
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* ── scales ───────────────────────────────────────────────────────────────────────────────── */

export type Scale = { lo: number; hi: number; step: number; ticks: number[]; dp: number };

/** A step of 1, 2, 2.5 or 5 × 10ⁿ giving about `target` intervals over `range`. */
export function niceStep(range: number, target: number, integer = false): number {
  const r = range > 0 && Number.isFinite(range) ? range : 1;
  const rough = r / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / mag;
  // Counts step in whole numbers, and never by 2.5 (a frequency axis reading 2.5, 5, 7.5 is odd).
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 && !integer ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return integer ? Math.max(1, Math.round(step)) : step;
}
export function decimals(step: number): number {
  for (let dp = 0; dp <= 6; dp++) if (Math.abs(Math.round(step * 10 ** dp) - step * 10 ** dp) < 1e-6) return dp;
  return 6;
}
/**
 * A nice scale covering [min, max]. `zero`: always start at 0 ("force"), start at 0 when the data
 * sits close enough to it ("auto"), or never. The scale always has room on both sides of the data.
 * `integer`: whole-number steps (counts).
 */
export function niceScale(min: number, max: number, target = 6, zero: "force" | "auto" | "never" = "auto", integer = false): Scale {
  let a = Number.isFinite(min) ? min : 0, b = Number.isFinite(max) ? max : 1;
  if (a > b) [a, b] = [b, a];
  if (zero === "force" || (zero === "auto" && a >= 0 && a <= 0.35 * b)) a = Math.min(0, a);
  if (zero === "force" || (zero === "auto" && b <= 0 && b >= 0.35 * a)) b = Math.max(0, b);
  if (b - a < 1e-9) (a -= a === 0 ? 0 : Math.abs(a) * 0.1 || 1), (b += Math.abs(b) * 0.1 || 1);
  const step = niceStep(b - a, target, integer);
  const lo = Math.floor(a / step + 1e-9) * step, hi = Math.ceil(b / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; lo + i * step <= hi + step * 1e-6 && i < 60; i++) ticks.push(Number((lo + i * step).toFixed(10)));
  return { lo, hi: hi > lo ? hi : lo + step, step, ticks, dp: decimals(step) };
}
export const tickText = (v: number, sc: Scale) => fmt(v, sc.dp);
/** A value as text with at most `dp` decimals ("−" for minus). */
export const val = (v: number, dp = 2) => fmt(v, dp);

/* ── the chart frame ──────────────────────────────────────────────────────────────────────── */

export const TICK = 14;
export const AXIS_TITLE = 15;

export type Frame = {
  w: number;
  h: number;
  /** Data → sketch coordinates (y down; the plot area is (0,0)–(w,h)). */
  X: (v: number) => number;
  Y: (v: number) => number;
};

/**
 * Draw the frame on the sketch: grid (no obstacle for text; each grid line belongs to its axis's
 * part, so an axis part spans the plot and never blocks a label's leader), axes (part `axisPart`, or separate
 * x/y parts), ticks and tick values, axis titles. `xTicks`/`yTicks` override the tick positions
 * (a histogram's class boundaries); `xText` turns a tick into its text ("" to skip it).
 */
export function drawFrame(
  sk: Sketch,
  o: {
    w: number;
    h: number;
    x?: Scale;
    y?: Scale;
    xTicks?: number[];
    xText?: (v: number) => string;
    yText?: (v: number) => string;
    xTitle?: string;
    yTitle?: string;
    xPart?: string;
    yPart?: string;
    grid?: boolean;
    /** Draw the x axis line itself (false: only the y axis, e.g. a horizontal bar chart's base). */
    xAxis?: boolean;
    yAxis?: boolean;
    /** The x-axis title's distance below the axis (default: under the tick values). */
    xTitleGap?: number;
  },
): Frame {
  const { w, h } = o;
  const xs = o.x, ys = o.y;
  const X = (v: number) => (xs ? ((v - xs.lo) / (xs.hi - xs.lo)) * w : 0);
  const Y = (v: number) => (ys ? h - ((v - ys.lo) / (ys.hi - ys.lo)) * h : h);
  const xTicks = o.xTicks ?? xs?.ticks ?? [];
  const yTicks = ys?.ticks ?? [];
  if (o.grid !== false) {
    for (const t of yTicks) if (Math.abs(Y(t) - h) > 0.5) sk.line([{ x: 0, y: Y(t) }, { x: w, y: Y(t) }], { stroke: "muted", width: 0.8, opacity: 0.35, part: o.yPart }, false);
    for (const t of xTicks) if (Math.abs(X(t)) > 0.5) sk.line([{ x: X(t), y: 0 }, { x: X(t), y: h }], { stroke: "muted", width: 0.8, opacity: 0.35, part: o.xPart }, false);
  }
  if (o.xAxis !== false) sk.line([{ x: 0, y: h }, { x: w + 8, y: h }], { stroke: "ink", width: 2.2, part: o.xPart });
  if (o.yAxis !== false) sk.line([{ x: 0, y: h }, { x: 0, y: -8 }], { stroke: "ink", width: 2.2, part: o.yPart });
  // x ticks and values: drop every other value until they no longer touch.
  if (xs || o.xTicks) {
    const texts = xTicks.map((t) => (o.xText ? o.xText(t) : xs ? tickText(t, xs) : String(t)));
    let every = 1;
    const fits = (k: number) => {
      let lastRight = -Infinity;
      for (let i = 0; i < xTicks.length; i += k) {
        const tw = textW(texts[i], TICK);
        if (!texts[i]) continue;
        if (X(xTicks[i]) - tw / 2 < lastRight + 6) return false;
        lastRight = X(xTicks[i]) + tw / 2;
      }
      return true;
    };
    while (every < 8 && !fits(every)) every++;
    xTicks.forEach((t, i) => {
      sk.line([{ x: X(t), y: h }, { x: X(t), y: h + 6 }], { stroke: "ink", width: 1.6, part: o.xPart }, false);
      if (i % every === 0 && texts[i]) sk.text({ x: X(t), y: h + 19 }, texts[i], TICK, "ink");
    });
  }
  let yTextW = 0;
  if (ys) {
    yTicks.forEach((t) => {
      const s = o.yText ? o.yText(t) : tickText(t, ys);
      const tw = textW(s, TICK);
      yTextW = Math.max(yTextW, tw);
      sk.line([{ x: -6, y: Y(t) }, { x: 0, y: Y(t) }], { stroke: "ink", width: 1.6, part: o.yPart }, false);
      sk.text({ x: -11 - tw / 2, y: Y(t) }, s, TICK, "ink");
    });
  }
  if (o.xTitle) sk.text({ x: w / 2, y: h + (o.xTitleGap ?? (xs || o.xTicks ? 42 : 20)) }, o.xTitle, AXIS_TITLE, "ink");
  if (o.yTitle) {
    // Above the y axis, left-aligned with the tick values (rotated text is not available).
    const tw = textW(o.yTitle, AXIS_TITLE);
    sk.text({ x: -11 - yTextW + tw / 2, y: -24 }, o.yTitle, AXIS_TITLE, "ink");
  }
  return { w, h, X, Y };
}

/** Dashed reading line (cumulative frequency, medians). */
export function dashed(sk: Sketch, pts: Pt[], colour: Ink, part?: string, width = 1.8) {
  sk.line(pts, { stroke: colour, width, dash: "6 4", part }, false);
}

/** A double-headed dimension arrow from a to b (horizontal or vertical), with small heads. */
export function dimension(sk: Sketch, a: Pt, b: Pt, colour: Ink, part?: string) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, hd = Math.min(8, L * 0.3);
  sk.line([a, b], { stroke: colour, width: 1.8, part });
  for (const [p, s] of [[a, 1], [b, -1]] as const) {
    const base = { x: p.x + ux * hd * s, y: p.y + uy * hd * s };
    sk.polygon([p, { x: base.x + nx * hd * 0.45, y: base.y + ny * hd * 0.45 }, { x: base.x - nx * hd * 0.45, y: base.y - ny * hd * 0.45 }], { fill: colour, stroke: colour, width: 1, part });
  }
  // End stops.
  for (const p of [a, b]) sk.line([{ x: p.x + nx * 6, y: p.y + ny * 6 }, { x: p.x - nx * 6, y: p.y - ny * 6 }], { stroke: colour, width: 1.6, part });
}

/**
 * Write `text` at the first candidate centre where it touches no line and no other text. When no
 * candidate is clear the text is NOT written (intrinsic text never overlaps) and null is returned.
 */
export function placeFirst(sk: Sketch, text: string, size: number, candidates: Pt[], fill: Ink = "ink", part?: string, pad = 2.5): Pt | null {
  const segs = sk.segments();
  for (const c of candidates) {
    if (!sk.blocked(textBox(c, text, size), pad, [], segs)) {
      sk.text(c, text, size, fill, part);
      return c;
    }
  }
  return null;
}

/** A value between two ticks (at about fraction `at` of the scale): where a leader can meet an axis without crossing a tick value. */
export function betweenTicks(sc: Scale, at = 0.6): number {
  const k = Math.max(0, Math.min(sc.ticks.length - 2, Math.floor((sc.ticks.length - 1) * at)));
  return sc.ticks.length >= 2 ? (sc.ticks[k] + sc.ticks[k + 1]) / 2 : (sc.lo + sc.hi) / 2;
}
