import { fitText } from "../cuts";
import type { FigureDrawing, FigurePart, FigureShape, Ink, Pt } from "../types";

/**
 * Shared kit for the code-drawn MATHS figures (triangle, circleTheorem, vectors, probabilityTree,
 * venn). Geometry is built on a Sketch in free coordinates; intrinsic notation (angle values, side
 * lengths, probabilities, counts) is placed by placeText, which walks a text box outwards until it
 * touches no line and no other text; finish() then shifts everything so the drawing starts at a
 * margin and reports its exact size.
 */

export const PALETTE = { blue: "#2563eb", red: "#dc2626", green: "#16a34a", amber: "#d97706", violet: "#7c3aed" } as const;

/* ── parameter parsing: validate and default, never throw ─────────────────────────────────── */

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function num(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  const n = optNum(v);
  return n === undefined ? fallback : clamp(n, lo, hi);
}
export function optNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || !v.trim()) return undefined;
  const n = Number(v.trim().replace(/[°%]$/, ""));
  return Number.isFinite(n) ? n : undefined;
}
export function str(v: unknown, fallback: string, max = 40): string {
  return typeof v === "string" && v.trim() ? fitText(v.trim(), max) : typeof v === "number" && Number.isFinite(v) ? String(v) : fallback;
}
export function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    if (/^(true|yes|on|1|show)$/i.test(v.trim())) return true;
    if (/^(false|no|off|0|hide|none)$/i.test(v.trim())) return false;
  }
  return fallback;
}
/** "3, 1" / "3;1" / "(3,1)" → ["3","1"]. */
export function list(v: unknown, sep: RegExp = /[,;]/): string[] {
  if (typeof v === "number") return [String(v)];
  if (typeof v !== "string") return [];
  return v.replace(/^[\s([{]+|[\s)\]}]+$/g, "").split(sep).map((s) => s.trim()).filter(Boolean);
}

/* ── numbers ──────────────────────────────────────────────────────────────────────────────── */

/** 4.000 → "4", 4.25 → "4.25", 0.3333 → "0.333" (at most `dp` decimals). */
export function fmt(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return "?";
  const r = Number(n.toFixed(dp));
  return String(Object.is(r, -0) ? 0 : r).replace("-", "−");
}

/** An exact fraction (positive denominators), or null when a value is not rational-looking. */
export type Frac = { n: number; d: number };
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
export const frac = (n: number, d: number): Frac => {
  const g = gcd(Math.round(n), Math.round(d)) || 1;
  const s = d < 0 ? -1 : 1;
  return { n: (s * Math.round(n)) / g, d: (s * Math.round(d)) / g };
};
export const fracMul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);
export const fracAdd = (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const fracStr = (f: Frac) => (f.d === 1 ? String(f.n) : `${f.n}/${f.d}`);
/** "1/3" → {value, frac}; "0.25", "25%" → {value} (and a fraction when it is an exact short decimal). */
export function parseProb(s: string): { value: number; frac?: Frac } | null {
  const t = s.trim();
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) {
    const d = Number(m[2]);
    if (!d) return null;
    return { value: Number(m[1]) / d, frac: frac(Number(m[1]), d) };
  }
  const pct = /%$/.test(t);
  const v = Number(t.replace(/%$/, ""));
  if (!Number.isFinite(v)) return null;
  return { value: pct ? v / 100 : v };
}

/* ── vectors ──────────────────────────────────────────────────────────────────────────────── */

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const unit = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const polar = (c: Pt, r: number, a: number): Pt => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
export const rad = (deg: number) => (deg * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

/* ── the sketch ───────────────────────────────────────────────────────────────────────────── */

export type Box = { x: number; y: number; w: number; h: number };
type Style = { part?: string; fill?: Ink | "none"; stroke?: Ink | "none"; width?: number; dash?: string; opacity?: number };
type Cmd = { k: "M" | "L"; p: Pt } | { k: "A"; c: Pt; r: number; to: Pt; large: boolean; sweep: boolean };
type Op =
  | { k: "path"; cmds: Cmd[]; close: boolean; style: Style; obstacle: boolean }
  | { k: "circle"; c: Pt; r: number; style: Style; obstacle: boolean }
  | { k: "text"; c: Pt; text: string; size: number; fill: Ink; part?: string };

/** Approximate advance of a figure label's characters (the board font is Nunito/Outfit, weight 600). */
export function textW(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += /[il.,'’:|!]/.test(ch) ? 0.3 : /[°]/.test(ch) ? 0.4 : /\s/.test(ch) ? 0.28 : /[mwMW]/.test(ch) ? 0.85 : /[A-Z]/.test(ch) ? 0.66 : /[0-9]/.test(ch) ? 0.58 : 0.56;
  return w * size;
}
export const textBox = (c: Pt, text: string, size: number): Box => {
  const w = textW(text, size), h = size * 0.82;
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
};

export class Sketch {
  ops: Op[] = [];
  parts: FigurePart[] = [];

  line(pts: Pt[], style: Style, obstacle = true) {
    if (pts.length < 2) return;
    this.ops.push({ k: "path", cmds: pts.map((p, i) => ({ k: i ? "L" : "M", p })), close: false, style: { fill: "none", ...style }, obstacle });
  }
  polygon(pts: Pt[], style: Style, obstacle = true) {
    this.ops.push({ k: "path", cmds: pts.map((p, i) => ({ k: i ? "L" : "M", p })), close: true, style, obstacle });
  }
  circle(c: Pt, r: number, style: Style, obstacle = true) {
    this.ops.push({ k: "circle", c, r, style, obstacle });
  }
  /** An arc of the circle (c, r) from screen angle a0 to a1 (radians, y down), turning the short way. */
  arc(c: Pt, r: number, a0: number, a1: number, style: Style, obstacle = true) {
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.ops.push({ k: "path", cmds: [{ k: "M", p: polar(c, r, a0) }, { k: "A", c, r, to: polar(c, r, a0 + d), large: false, sweep: d > 0 }], close: false, style: { fill: "none", ...style }, obstacle });
  }
  path(cmds: Cmd[], close: boolean, style: Style, obstacle = false) {
    this.ops.push({ k: "path", cmds, close, style, obstacle });
  }
  text(c: Pt, text: string, size: number, fill: Ink = "ink", part?: string) {
    this.ops.push({ k: "text", c, text, size, fill, part });
  }
  part(id: string, name: string, anchor: Pt) {
    this.parts.push({ id, name, anchor });
  }

  /** Every line as segments (curves sampled), for text placement. */
  segments(): Array<[Pt, Pt]> {
    const out: Array<[Pt, Pt]> = [];
    for (const op of this.ops) {
      if (op.k === "circle" && op.obstacle) {
        const n = 72;
        for (let i = 0; i < n; i++) out.push([polar(op.c, op.r, (i / n) * 2 * Math.PI), polar(op.c, op.r, ((i + 1) / n) * 2 * Math.PI)]);
      } else if (op.k === "path" && op.obstacle) {
        let at: Pt | undefined, first: Pt | undefined;
        for (const cmd of op.cmds) {
          if (cmd.k === "M") {
            at = cmd.p;
            first = cmd.p;
          } else if (cmd.k === "L") {
            if (at) out.push([at, cmd.p]);
            at = cmd.p;
          } else if (cmd.k === "A" && at) {
            const pts = sampleArc(at, cmd);
            for (let i = 0; i < pts.length - 1; i++) out.push([pts[i], pts[i + 1]]);
            at = cmd.to;
          }
        }
        if (op.close && at && first) out.push([at, first]);
      }
    }
    return out;
  }
  textBoxes(): Box[] {
    return this.ops.filter((o): o is Extract<Op, { k: "text" }> => o.k === "text").map((o) => textBox(o.c, o.text, o.size));
  }

  /** Does a box (grown by `pad`) touch any line or text already drawn, or the extra obstacles? */
  blocked(box: Box, pad = 2.5, extra: Box[] = [], segs = this.segments()): boolean {
    const b = { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
    if (segs.some(([p, q]) => segHitsBox(p, q, b))) return true;
    return [...this.textBoxes(), ...extra].some((o) => boxesOverlap(o, b));
  }

  /**
   * Where intrinsic text near `base` would go: pushed along `dir` (and, if it must, slid sideways
   * along `slide`) until it touches no line or text. `ok` is false when no clear spot was found.
   */
  findText(text: string, size: number, base: Pt, dir: Pt, opts: { min?: number; max?: number; slide?: Pt; avoid?: Box[] } = {}): { c: Pt; ok: boolean } {
    const u = unit(dir);
    const min = opts.min ?? 0, max = opts.max ?? 90;
    const segs = this.segments();
    const shifts = opts.slide ? [0, 4, -4, 8, -8, 12, -12, 18, -18, 26, -26] : [0];
    const s = opts.slide ? unit(opts.slide) : { x: 0, y: 0 };
    for (let d = min; d <= max; d += 1.5) {
      for (const sh of shifts) {
        const c = add(add(base, mul(u, d)), mul(s, sh));
        if (!this.blocked(textBox(c, text, size), 2.5, opts.avoid, segs)) return { c, ok: true };
      }
    }
    return { c: add(base, mul(u, min + (max - min) * 0.5)), ok: false };
  }
  /** findText, then write it. Returns the centre it chose. */
  placeText(text: string, size: number, base: Pt, dir: Pt, opts: { fill?: Ink; part?: string; min?: number; max?: number; slide?: Pt; avoid?: Box[] } = {}): Pt {
    const { c } = this.findText(text, size, base, dir, opts);
    this.text(c, text, size, opts.fill ?? "ink", opts.part);
    return c;
  }

  /**
   * A letter beside a point (a vertex, the origin, the centre): the first of `dirs` that is clear
   * of lines and also out of the lane a label's leader uses to reach `anchor`.
   */
  placeLetter(text: string, size: number, anchor: Pt, dirs: Pt[], opts: { fill?: Ink; part?: string; min?: number; max?: number } = {}): Pt {
    const spots = dirs.map((d) => this.findText(text, size, anchor, d, { min: opts.min ?? 10, max: opts.max ?? 50 }));
    const spot = spots.find((sp) => sp.ok && this.approachClear(anchor, 9, [textBox(sp.c, text, size)])) ?? spots.find((sp) => sp.ok) ?? spots[0];
    this.text(spot.c, text, size, opts.fill ?? "ink", opts.part);
    return spot.c;
  }

  /** The extent of everything drawn so far (lines, circles, text). */
  bounds(): Box {
    const segs = this.segments();
    const pts = [...segs.flat(), ...this.textBoxes().flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }])];
    for (const op of this.ops) if (op.k === "circle") pts.push({ x: op.c.x - op.r, y: op.c.y - op.r }, { x: op.c.x + op.r, y: op.c.y + op.r });
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  /**
   * A label's leader reaches its anchor from the margin on the anchor's side (left of the figure's
   * middle → from the left). Is that approach — a band `band` high, from the anchor out to the
   * figure's edge — free of intrinsic text? Used to choose anchors a leader can reach cleanly.
   */
  approachClear(anchor: Pt, band = 9, extra: Box[] = []): boolean {
    const b = this.bounds();
    const fromLeft = anchor.x < b.x + b.w / 2;
    const lane: Box = fromLeft ? { x: b.x - 40, y: anchor.y - band, w: anchor.x - 6 - (b.x - 40), h: 2 * band } : { x: anchor.x + 6, y: anchor.y - band, w: b.x + b.w + 40 - anchor.x - 6, h: 2 * band };
    return ![...this.textBoxes(), ...extra].some((t) => boxesOverlap(t, lane));
  }
  /** The first candidate whose leader approach is clear (else the first). */
  clearAnchor(candidates: Pt[], band = 9): Pt {
    return candidates.find((c) => this.approachClear(c, band)) ?? candidates[0];
  }

  /** Shift everything so the drawing (lines, text, anchors) sits `pad` inside (0,0)–(w,h). */
  finish(pad = 16, minSize: { w?: number; h?: number } = {}): FigureDrawing {
    const pts: Pt[] = [];
    for (const op of this.ops) {
      if (op.k === "circle") pts.push({ x: op.c.x - op.r, y: op.c.y - op.r }, { x: op.c.x + op.r, y: op.c.y + op.r });
      else if (op.k === "text") {
        const b = textBox(op.c, op.text, op.size);
        pts.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
      } else {
        let at: Pt | undefined;
        for (const cmd of op.cmds) {
          if (cmd.k === "A" && at) pts.push(...sampleArc(at, cmd));
          else pts.push(cmd.k === "A" ? cmd.to : cmd.p);
          at = cmd.k === "A" ? cmd.to : cmd.p;
        }
      }
    }
    pts.push(...this.parts.map((p) => p.anchor));
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    let w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
    let dx = pad - minX, dy = pad - minY;
    if (minSize.w && w < minSize.w) (dx += (minSize.w - w) / 2), (w = minSize.w);
    if (minSize.h && h < minSize.h) (dy += (minSize.h - h) / 2), (h = minSize.h);
    const P = (p: Pt) => `${r2(p.x + dx)} ${r2(p.y + dy)}`;
    const shapes: FigureShape[] = this.ops.map((op): FigureShape => {
      if (op.k === "circle") return { t: "circle", cx: r2(op.c.x + dx), cy: r2(op.c.y + dy), r: r2(op.r), ...op.style };
      if (op.k === "text") return { t: "text", x: r2(op.c.x + dx), y: r2(op.c.y + dy + op.size * 0.36), text: op.text, size: op.size, anchor: "middle", fill: op.fill, ...(op.part ? { part: op.part } : {}) };
      const d = op.cmds.map((c) => (c.k === "A" ? `A${r2(c.r)} ${r2(c.r)} 0 ${c.large ? 1 : 0} ${c.sweep ? 1 : 0} ${P(c.to)}` : `${c.k}${P(c.p)}`)).join(" ") + (op.close ? " Z" : "");
      return { t: "path", d, ...op.style };
    });
    return {
      w: Math.ceil(w),
      h: Math.ceil(h),
      shapes,
      parts: this.parts.map((p) => ({ ...p, anchor: { x: r2(p.anchor.x + dx), y: r2(p.anchor.y + dy) } })),
    };
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function sampleArc(from: Pt, cmd: Extract<Cmd, { k: "A" }>): Pt[] {
  const a0 = Math.atan2(from.y - cmd.c.y, from.x - cmd.c.x);
  let a1 = Math.atan2(cmd.to.y - cmd.c.y, cmd.to.x - cmd.c.x);
  if (cmd.sweep) while (a1 < a0) a1 += 2 * Math.PI;
  else while (a1 > a0) a1 -= 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.08));
  return Array.from({ length: n + 1 }, (_, i) => polar(cmd.c, cmd.r, a0 + ((a1 - a0) * i) / n));
}

export const boxesOverlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Liang–Barsky: does segment pq enter box b? */
export function segHitsBox(p: Pt, q: Pt, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const checks: Array<[number, number]> = [[-dx, p.x - b.x], [dx, b.x + b.w - p.x], [-dy, p.y - b.y], [dy, b.y + b.h - p.y]];
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return false;
    } else {
      const t = qq / pp;
      if (pp < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

/** An arrow from `from` to `to`: a shaft that stops inside a filled head, so the tip is exact. */
export function arrow(sk: Sketch, from: Pt, to: Pt, colour: Ink, width: number, part?: string, head = 13) {
  const u = unit(sub(to, from)), n = perp(u);
  const L = Math.min(head, dist(from, to) * 0.45);
  const base = sub(to, mul(u, L));
  sk.line([from, add(base, mul(u, L * 0.3))], { stroke: colour, width, part });
  sk.polygon([to, add(base, mul(n, L * 0.42)), add(base, mul(n, -L * 0.42))], { fill: colour, stroke: colour, width: 1, part });
}

/**
 * The mark for the angle at V between rays to P and Q (the interior angle): an arc (or a square
 * when it is a right angle), `extra` concentric arcs for "equal angle" marks, and its value placed
 * along the bisector clear of every line. Returns the anchor on the mark.
 */
export function angleMark(sk: Sketch, V: Pt, P: Pt, Q: Pt, opts: { r: number; text?: string; size?: number; colour?: Ink; part?: string; right?: boolean; extra?: number; textFill?: Ink }): Pt {
  const u1 = unit(sub(P, V)), u2 = unit(sub(Q, V));
  const bis = unit(add(u1, u2));
  const colour = opts.colour ?? "ink";
  let anchor: Pt;
  if (opts.right) {
    const s = opts.r * 0.62;
    sk.line([add(V, mul(u1, s)), add(V, add(mul(u1, s), mul(u2, s))), add(V, mul(u2, s))], { stroke: colour, width: 1.8, part: opts.part });
    anchor = add(V, add(mul(u1, s), mul(u2, s)));
  } else {
    const a0 = Math.atan2(u1.y, u1.x), a1 = Math.atan2(u2.y, u2.x);
    sk.arc(V, opts.r, a0, a1, { stroke: colour, width: 2, part: opts.part });
    for (let i = 1; i <= (opts.extra ?? 0); i++) sk.arc(V, opts.r + i * 5, a0, a1, { stroke: colour, width: 1.6, part: opts.part });
    anchor = add(V, mul(bis, opts.r));
  }
  if (opts.text) {
    const size = opts.size ?? 18;
    sk.placeText(opts.text, size, V, bis, { min: opts.r + 4 + (opts.extra ?? 0) * 5, max: opts.r + 140, fill: opts.textFill ?? colour, part: opts.part });
  }
  return anchor;
}
