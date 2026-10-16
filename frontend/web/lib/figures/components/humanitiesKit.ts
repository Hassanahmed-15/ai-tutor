import type { FigureShape, Ink, Pt } from "../types";
import { fitText, recordFigureCut } from "../cuts";
import { PALETTE, textW } from "./mathsKit";

/**
 * Shared kit for the HUMANITIES figures (timeline, causeConsequence, sourceCard, evaluationScale,
 * conceptTable). These figures carry short text inside boxes, so the kit's job is measuring and
 * wrapping text so it never leaves its box, and drawing soft-filled cards and arrows in absolute
 * figure coordinates (the components lay out everything themselves, then report w×h).
 */

export const COLOURS = [PALETTE.blue, PALETTE.red, PALETTE.green, PALETTE.amber, PALETTE.violet] as const;

/** Conservative text advance: the wider of the kit's glyph estimate and 0.55 em per character. */
export function measure(text: string, size: number): number {
  return Math.max(textW(text, size), [...text].length * size * 0.55);
}

/** Clean one piece of model text: collapse whitespace, cap the length. */
export function clean(v: unknown, max = 120): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return "";
  // Cut at a word, never mid-word, and recorded: the writer is asked to fit it next time.
  return fitText(v.replace(/\s+/g, " ").trim(), max);
}

/** Split a list param on ";" (or newlines); "|" is kept for cells. */
export function items(v: unknown, max: number, maxLen = 90, sep: RegExp = /\s*(?:;|\n)\s*/): string[] {
  const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  return s.split(sep).map((t) => clean(t, maxLen)).filter(Boolean).slice(0, max);
}

/**
 * Wrap text into lines no wider than maxW (words longer than a line are broken with a hyphen). When
 * maxLines is given, the last line ends in "…" if the text did not fit.
 */
export function wrap(text: string, size: number, maxW: number, maxLines = Infinity): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const pushWord = (w: string) => {
    // A word too long for a whole line is broken into pieces that fit.
    while (measure(w, size) > maxW && w.length > 1) {
      let k = w.length - 1;
      while (k > 1 && measure(w.slice(0, k) + "-", size) > maxW) k--;
      if (cur) lines.push(cur), (cur = "");
      lines.push(w.slice(0, k) + "-");
      w = w.slice(k);
    }
    return w;
  };
  for (const raw of words) {
    const next = cur ? `${cur} ${raw}` : raw;
    if (measure(next, size) <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = "";
    cur = pushWord(raw);
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    recordFigureCut(text, `${maxLines} line${maxLines === 1 ? "" : "s"}`);
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && measure(last + "…", size) > maxW) last = last.slice(0, -1).trimEnd();
    kept[maxLines - 1] = last + "…";
    return kept;
  }
  return lines.length ? lines : [""];
}

/** The widest line of a wrapped block. */
export const blockW = (lines: string[], size: number) => Math.max(0, ...lines.map((l) => measure(l, size)));

export type Rect = { x: number; y: number; w: number; h: number };
type Style = { part?: string; fill?: Ink | "none"; stroke?: Ink | "none"; width?: number; dash?: string; opacity?: number };

const r1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);

/** A shapes list in absolute figure coordinates. */
export class Board {
  shapes: FigureShape[] = [];
  path(d: string, style: Style) {
    this.shapes.push({ t: "path", d, ...style });
  }
  line(pts: Pt[], style: Style) {
    if (pts.length < 2) return;
    this.path(pts.map((p, i) => `${i ? "L" : "M"}${r1(p.x)} ${r1(p.y)}`).join(" "), { fill: "none", ...style });
  }
  rect(b: Rect, r: number, style: Style) {
    this.path(roundRect(b, r), style);
  }
  /** A card: a soft wash of `colour` with an outline in the same colour (or ink). */
  card(b: Rect, colour: Ink, part?: string, opts: { r?: number; wash?: number; stroke?: Ink; width?: number; dash?: string } = {}) {
    const r = opts.r ?? 10;
    this.rect(b, r, { fill: colour, stroke: "none", opacity: opts.wash ?? 0.13, part });
    this.rect(b, r, { fill: "none", stroke: opts.stroke ?? colour, width: opts.width ?? 2, dash: opts.dash, part });
  }
  circle(c: Pt, r: number, style: Style) {
    this.shapes.push({ t: "circle", cx: r1(c.x), cy: r1(c.y), r: r1(r), ...style });
  }
  text(x: number, y: number, text: string, size: number, opts: { fill?: Ink; anchor?: "start" | "middle" | "end"; part?: string } = {}) {
    if (!text) return;
    this.shapes.push({ t: "text", x: r1(x), y: r1(y), text, size, anchor: opts.anchor ?? "middle", fill: opts.fill ?? "ink", ...(opts.part ? { part: opts.part } : {}) });
  }
  /** Lines of text whose block starts at `top` (the first line's cap height sits at top). */
  lines(lines: string[], x: number, top: number, size: number, opts: { fill?: Ink; anchor?: "start" | "middle" | "end"; part?: string; lineH?: number } = {}) {
    const lh = opts.lineH ?? size * 1.25;
    lines.forEach((l, i) => this.text(x, top + size * 0.8 + i * lh, l, size, opts));
  }
  /** An arrow whose filled head ends exactly at `to`. */
  arrow(from: Pt, to: Pt, colour: Ink, width = 2.2, part?: string, head = 12, dash?: string) {
    const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1;
    const u = { x: dx / L, y: dy / L }, n = { x: -u.y, y: u.x };
    const h = Math.min(head, L * 0.5);
    const base = { x: to.x - u.x * h, y: to.y - u.y * h };
    this.line([from, { x: base.x + u.x * h * 0.3, y: base.y + u.y * h * 0.3 }], { stroke: colour, width, part, dash });
    this.path(`M${r1(to.x)} ${r1(to.y)} L${r1(base.x + n.x * h * 0.42)} ${r1(base.y + n.y * h * 0.42)} L${r1(base.x - n.x * h * 0.42)} ${r1(base.y - n.y * h * 0.42)} Z`, { fill: colour, stroke: colour, width: 1, part });
  }
  /** A curved arrow along a cubic Bézier (sampled), head at p3. */
  curveArrow(p0: Pt, p1: Pt, p2: Pt, p3: Pt, colour: Ink, width = 2, part?: string, dash?: string) {
    const pts = bezier(p0, p1, p2, p3, 24);
    this.line(pts.slice(0, -2), { stroke: colour, width, part, dash });
    this.arrow(pts[pts.length - 3], p3, colour, width, part, 11);
  }
}

export function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
    return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
  });
}

export function roundRect(b: Rect, r: number): string {
  const rr = Math.max(0, Math.min(r, b.w / 2, b.h / 2));
  const { x, y, w, h } = { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) };
  if (!rr) return `M${x} ${y} H${r1(x + w)} V${r1(y + h)} H${x} Z`;
  return `M${r1(x + rr)} ${y} H${r1(x + w - rr)} A${rr} ${rr} 0 0 1 ${r1(x + w)} ${r1(y + rr)} V${r1(y + h - rr)} A${rr} ${rr} 0 0 1 ${r1(x + w - rr)} ${r1(y + h)} H${r1(x + rr)} A${rr} ${rr} 0 0 1 ${x} ${r1(y + h - rr)} V${r1(y + rr)} A${rr} ${rr} 0 0 1 ${r1(x + rr)} ${y} Z`;
}

/** A part name that fits a margin label (≤34 characters). */
export function partName(text: string, fallback: string): string {
  const t = clean(text, 200) || fallback;
  return t.length <= 34 ? t : t.slice(0, 33).replace(/\s+\S*$/, "").trimEnd() + "…";
}
