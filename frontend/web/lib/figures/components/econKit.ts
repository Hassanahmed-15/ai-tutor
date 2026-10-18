import type { FigureDrawing, FigurePart, Ink, Pt } from "../types";
import { fitText } from "../cuts";
import { PALETTE, Sketch, arrow, boxesOverlap, textBox, textW } from "./mathsKit";

/**
 * Shared kit for the code-drawn ECONOMICS graphs (supplyDemand, adAs, costRevenue, ppf). A graph has
 * its own model plane (quantity/output across, price/cost up, both from 0) mapped onto a fixed plot
 * box; curves are sampled functions clipped to the plot; axis values (P*, Q₁ …) are collected and
 * spread so no two collide, then written beside the axes. Geometry is computed by the components —
 * this file only draws it.
 */

export { PALETTE };
export const SUBS = ["", "₁", "₂", "₃", "₄"];

export type MPt = { q: number; p: number };
/** A straight curve P = a + b·Q. */
export type Lin = { a: number; b: number };
export const at = (l: Lin, q: number) => l.a + l.b * q;
/** Q where the line has price p (b ≠ 0). */
export const qAt = (l: Lin, p: number) => (p - l.a) / l.b;
/** Where two lines cross (null when parallel). */
export function cross(l1: Lin, l2: Lin): MPt | null {
  if (Math.abs(l1.b - l2.b) < 1e-12) return null;
  const q = (l2.a - l1.a) / (l1.b - l2.b);
  return { q, p: at(l1, q) };
}
/** Bisection root of f on [lo, hi] (f(lo), f(hi) of opposite signs); else the end nearer zero. */
export function root(f: (x: number) => number, lo: number, hi: number): number {
  let flo = f(lo);
  const fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return (lo + hi) / 2;
  if (flo * fhi > 0) return Math.abs(flo) < Math.abs(fhi) ? lo : hi;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2, fm = f(m);
    if (flo * fm <= 0) hi = m;
    else (lo = m), (flo = fm);
  }
  return (lo + hi) / 2;
}

type Tick = { v: number; text: string; colour: Ink };

export class EconGraph {
  sk = new Sketch();
  private yTicks: Tick[] = [];
  private xTicks: Tick[] = [];
  constructor(public xMax = 10, public yMax = 10, public W = 470, public H = 330) {}
  X = (q: number) => (q / this.xMax) * this.W;
  Y = (p: number) => -(p / this.yMax) * this.H;
  P = (m: MPt): Pt => ({ x: this.X(m.q), y: this.Y(m.p) });
  pt = (q: number, p: number): Pt => ({ x: this.X(q), y: this.Y(p) });
  inside = (m: MPt) => m.q >= -1e-9 && m.q <= this.xMax + 1e-9 && m.p >= -1e-9 && m.p <= this.yMax + 1e-9;

  /** Axes with arrowheads and titles (vertical title above its arrow, horizontal under the far end). */
  axes(yTitle: string, xTitle: string) {
    const top = -this.H - 26, right = this.W + 26;
    this.sk.line([{ x: 0, y: top + 8 }, { x: 0, y: 0 }, { x: right - 8, y: 0 }], { stroke: "ink", width: 2.4 });
    this.sk.polygon([{ x: 0, y: top }, { x: -6, y: top + 12 }, { x: 6, y: top + 12 }], { fill: "ink", stroke: "ink", width: 1 });
    this.sk.polygon([{ x: right, y: 0 }, { x: right - 12, y: -6 }, { x: right - 12, y: 6 }], { fill: "ink", stroke: "ink", width: 1 });
    const ty = 19;
    this.sk.text({ x: -12 + textW(yTitle, ty) / 2, y: top - 16 }, yTitle, ty, "ink");
    this.xTitle = xTitle;
    this.sk.text({ x: -12, y: 16 }, "0", 16, "muted");
  }
  private xTitle = "";

  /** A sampled curve, clipped to the plot; returns its on-screen points (empty when it misses). */
  curve(fn: (t: number) => MPt, style: { stroke: Ink; width?: number; dash?: string; part?: string }, n = 80, t0 = 0, t1 = 1): Pt[] {
    const ms: MPt[] = [];
    for (let i = 0; i <= n; i++) ms.push(fn(t0 + ((t1 - t0) * i) / n));
    return this.polyline(ms, style);
  }
  /** A model-space polyline clipped to the plot (the longest run inside). */
  polyline(ms: MPt[], style: { stroke: Ink; width?: number; dash?: string; part?: string }): Pt[] {
    const runs: MPt[][] = [];
    let run: MPt[] = [];
    for (let i = 0; i < ms.length - 1; i++) {
      const c = clipSeg(ms[i], ms[i + 1], this.xMax, this.yMax);
      if (!c) {
        if (run.length) runs.push(run), (run = []);
        continue;
      }
      if (!run.length) run.push(c[0]);
      run.push(c[1]);
      if (c[1] !== ms[i + 1]) runs.push(run), (run = []);
    }
    if (run.length) runs.push(run);
    const best = runs.sort((a, b) => b.length - a.length)[0] ?? [];
    const pts = best.filter((m) => Number.isFinite(m.q) && Number.isFinite(m.p)).map(this.P);
    if (pts.length >= 2) this.sk.line(pts, { stroke: style.stroke, width: style.width ?? 3, part: style.part, ...(style.dash ? { dash: style.dash } : {}) });
    return pts.length >= 2 ? pts : [];
  }
  line(a: MPt, b: MPt, style: { stroke: Ink; width?: number; dash?: string; part?: string }) {
    return this.polyline([a, b], style);
  }
  /** A shaded region (under everything drawn after it); not an obstacle for text. */
  shade(ms: MPt[], colour: Ink, part?: string, opacity = 0.28) {
    const pts = ms.filter((m) => Number.isFinite(m.q) && Number.isFinite(m.p)).map((m) => this.P({ q: clampN(m.q, 0, this.xMax), p: clampN(m.p, 0, this.yMax) }));
    if (pts.length >= 3) this.sk.polygon(pts, { fill: colour, stroke: "none", opacity, ...(part ? { part } : {}) }, false);
  }
  dot(m: MPt, colour: Ink = "ink", part?: string, r = 5) {
    this.sk.circle(this.P(m), r, { fill: colour, stroke: colour, width: 1, ...(part ? { part } : {}) });
  }
  /** Dashed lines from a point to both axes, with the values written on the axes. */
  drop(m: MPt, yText: string | null, xText: string | null, colour: Ink = "muted", part?: string) {
    const p = this.P(m);
    if (yText !== null) this.sk.line([p, { x: 0, y: p.y }], { stroke: colour, width: 1.6, dash: "6 5", ...(part ? { part } : {}) }, false);
    if (xText !== null) this.sk.line([p, { x: p.x, y: 0 }], { stroke: colour, width: 1.6, dash: "6 5", ...(part ? { part } : {}) }, false);
    if (yText) this.yTick(m.p, yText);
    if (xText) this.xTick(m.q, xText);
  }
  yTick(p: number, text: string, colour: Ink = "ink") {
    if (!this.yTicks.some((t) => t.text === text && Math.abs(t.v - p) < 1e-6)) this.yTicks.push({ v: p, text, colour });
  }
  xTick(q: number, text: string, colour: Ink = "ink") {
    if (!this.xTicks.some((t) => t.text === text && Math.abs(t.v - q) < 1e-6)) this.xTicks.push({ v: q, text, colour });
  }
  /** A curve's letter beside the end of its drawn points, clear of every line. */
  curveLabel(pts: Pt[], text: string, colour: Ink, end: "start" | "end" = "end", dir?: Pt, part?: string) {
    if (pts.length < 2) return;
    const tip = end === "end" ? pts[pts.length - 1] : pts[0];
    const prev = end === "end" ? pts[Math.max(0, pts.length - 4)] : pts[Math.min(pts.length - 1, 3)];
    const d = dir ?? { x: tip.x - prev.x, y: tip.y - prev.y };
    // Start the search with the whole box beyond the tip (a centred box would sit on the curve's end).
    const L = Math.hypot(d.x, d.y) || 1, w = textW(text, 20), h = 20 * 0.82;
    const half = Math.abs(d.x / L) * (w / 2) + Math.abs(d.y / L) * (h / 2);
    this.sk.placeText(text, 20, tip, d, { fill: colour, min: half + 6, max: half + 70, part });
  }
  /** A thick shift arrow between two points (on the old and new curve). */
  shiftArrow(from: MPt, to: MPt, colour: Ink = "ink", part?: string) {
    const a = this.P(from), b = this.P(to);
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 14) return;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const s = { x: a.x + ux * Math.min(10, L * 0.15), y: a.y + uy * Math.min(10, L * 0.15) };
    const e = { x: b.x - ux * Math.min(10, L * 0.15), y: b.y - uy * Math.min(10, L * 0.15) };
    arrow(this.sk, s, e, colour, 2.6, part, 12);
  }
  /** A double-headed measuring arrow (shortage, surplus, a gap) between two model points. */
  span(a: MPt, b: MPt, colour: Ink, part?: string, offset: Pt = { x: 0, y: 0 }) {
    const pa = this.P(a), pb = this.P(b);
    const A = { x: pa.x + offset.x, y: pa.y + offset.y }, B = { x: pb.x + offset.x, y: pb.y + offset.y };
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    arrow(this.sk, mid, A, colour, 2.6, part, 11);
    arrow(this.sk, mid, B, colour, 2.6, part, 11);
    return mid;
  }

  /** Write the axis values (spread so none collide) and the horizontal title; return the drawing. */
  finish(parts: FigurePart[] = []): FigureDrawing {
    const seen = new Set<string>();
    for (const p of parts) if (!seen.has(p.id) && Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y)) seen.add(p.id), this.sk.part(p.id, fitText(p.name, 34), p.anchor);
    const size = 18;
    // Vertical axis values: right-aligned left of the axis, spread apart vertically.
    const ys = [...this.yTicks].sort((a, b) => a.v - b.v).map((t) => ({ ...t, y: this.Y(t.v) }));
    spread(ys, size * 1.05, -this.H - 4, -8);
    for (const t of ys) {
      this.sk.line([{ x: -5, y: this.Y(t.v) }, { x: 0, y: this.Y(t.v) }], { stroke: "ink", width: 2 }, false);
      this.sk.text({ x: -10 - textW(t.text, size) / 2, y: t.y }, t.text, size, t.colour);
    }
    // Horizontal axis values: centred under their points, spread apart horizontally.
    const xs = [...this.xTicks].sort((a, b) => a.v - b.v).map((t) => ({ ...t, y: this.X(t.v), w: textW(t.text, size) }));
    spreadX(xs, 8, 10, this.W + 20);
    for (const t of xs) {
      this.sk.line([{ x: this.X(t.v), y: 0 }, { x: this.X(t.v), y: 5 }], { stroke: "ink", width: 2 }, false);
      this.sk.text({ x: t.y, y: 20 }, t.text, size, t.colour);
    }
    if (this.xTitle) {
      const ts = 19, w = textW(this.xTitle, ts);
      // Under the far end of the axis, on its own row below the values when they would collide.
      let c = { x: this.W + 30 - w / 2, y: 22 };
      const box = textBox(c, this.xTitle, ts);
      if (this.sk.textBoxes().some((b) => boxesOverlap(b, { x: box.x - 6, y: box.y, w: box.w + 12, h: box.h }))) c = { x: this.W + 30 - w / 2, y: 46 };
      this.sk.text(c, this.xTitle, ts, "ink");
    }
    return this.sk.finish(16);
  }
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Spread centre positions (field y) so neighbours are at least `gap` apart, within [lo, hi]. */
function spread(items: Array<{ y: number }>, gap: number, lo: number, hi: number) {
  // items sorted by value ascending → screen y descending (up the axis is negative y).
  items.sort((a, b) => b.y - a.y);
  for (let i = 0; i < items.length; i++) items[i].y = Math.min(items[i].y, hi, i ? items[i - 1].y - gap : Infinity);
  for (let i = items.length - 1; i >= 0; i--) items[i].y = Math.max(items[i].y, lo, i < items.length - 1 ? items[i + 1].y + gap : -Infinity);
}
function spreadX(items: Array<{ y: number; w: number }>, pad: number, lo: number, hi: number) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 0; i < items.length; i++) {
    const minC = i ? items[i - 1].y + items[i - 1].w / 2 + pad + items[i].w / 2 : lo;
    items[i].y = Math.max(items[i].y, minC);
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const maxC = i < items.length - 1 ? items[i + 1].y - items[i + 1].w / 2 - pad - items[i].w / 2 : hi;
    items[i].y = Math.min(items[i].y, maxC);
  }
}

/** Clip a model segment to [0,xMax]×[0,yMax] (Liang–Barsky). */
function clipSeg(a: MPt, b: MPt, xMax: number, yMax: number): [MPt, MPt] | null {
  if (![a.q, a.p, b.q, b.p].every(Number.isFinite)) return null;
  let t0 = 0, t1 = 1;
  const dq = b.q - a.q, dp = b.p - a.p;
  for (const [p, q] of [[-dq, a.q], [dq, xMax - a.q], [-dp, a.p], [dp, yMax - a.p]] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [t0 === 0 ? a : { q: a.q + dq * t0, p: a.p + dp * t0 }, t1 === 1 ? b : { q: a.q + dq * t1, p: a.p + dp * t1 }];
}

/** A string param, trimmed and capped. */
export function txt(v: unknown, max = 400): string {
  return typeof v === "string" ? fitText(v.trim(), max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}
/** The centroid of a model polygon (for an area's anchor). */
export function centroid(ms: MPt[]): MPt {
  let a = 0, cq = 0, cp = 0;
  for (let i = 0; i < ms.length; i++) {
    const p = ms[i], q = ms[(i + 1) % ms.length];
    const c = p.q * q.p - q.q * p.p;
    a += c;
    cq += (p.q + q.q) * c;
    cp += (p.p + q.p) * c;
  }
  if (Math.abs(a) < 1e-9) return { q: ms.reduce((t, m) => t + m.q, 0) / (ms.length || 1), p: ms.reduce((t, m) => t + m.p, 0) / (ms.length || 1) };
  return { q: cq / (3 * a), p: cp / (3 * a) };
}
/** Area of a model polygon (shoelace), positive. */
export function area(ms: MPt[]): number {
  let a = 0;
  for (let i = 0; i < ms.length; i++) a += ms[i].q * ms[(i + 1) % ms.length].p - ms[(i + 1) % ms.length].q * ms[i].p;
  return Math.abs(a) / 2;
}
