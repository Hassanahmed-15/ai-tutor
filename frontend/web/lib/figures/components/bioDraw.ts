import { fitText } from "../cuts";
import type { FigureShape, Ink, Pt } from "../types";

/**
 * Shared drawing kit for the code-drawn BIOLOGY figures (enzymeAction, membraneTransport,
 * cellDivision, foodWeb, ecologicalPyramid): smooth organic outlines as cubic Béziers, rounded
 * polygons whose corners are cubic curves, arrows with exact tips, and a deterministic generator.
 */

export const BIO = { blue: "#2563eb", red: "#dc2626", green: "#16a34a", amber: "#d97706", violet: "#7c3aed" } as const;

export const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
const P = (p: Pt) => `${r2(p.x)} ${r2(p.y)}`;

/** A closed smooth curve through every point (Catmull-Rom as cubic Béziers). */
export function smoothClosed(pts: Pt[], tension = 1): string {
  const n = pts.length;
  if (n < 3) return "";
  let d = `M${P(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * tension, y: p1.y + ((p2.y - p0.y) / 6) * tension };
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * tension, y: p2.y - ((p3.y - p1.y) / 6) * tension };
    d += ` C${P(c1)} ${P(c2)} ${P(p2)}`;
  }
  return d + " Z";
}

/** An open smooth curve through the points. */
export function smoothOpen(pts: Pt[], tension = 1): string {
  const n = pts.length;
  if (n < 2) return "";
  let d = `M${P(pts[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * tension, y: p1.y + ((p2.y - p0.y) / 6) * tension };
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * tension, y: p2.y - ((p3.y - p1.y) / 6) * tension };
    d += ` C${P(c1)} ${P(c2)} ${P(p2)}`;
  }
  return d;
}

/**
 * A closed polygon whose corners are rounded by cubic curves (radius per corner, clamped to half
 * of each edge): small radii keep a shape crisp (an active site), large radii make it organic.
 */
export function roundedPoly(pts: Pt[], radii: number | number[]): string {
  const n = pts.length;
  if (n < 3) return "";
  const rad = (i: number) => (Array.isArray(radii) ? radii[i] ?? radii[radii.length - 1] ?? 0 : radii);
  const corner = (i: number) => {
    const v = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a.x - v.x, a.y - v.y) || 1, lb = Math.hypot(b.x - v.x, b.y - v.y) || 1;
    const r = Math.max(0, Math.min(rad(i), la / 2, lb / 2));
    return { v, s: { x: v.x + ((a.x - v.x) / la) * r, y: v.y + ((a.y - v.y) / la) * r }, e: { x: v.x + ((b.x - v.x) / lb) * r, y: v.y + ((b.y - v.y) / lb) * r } };
  };
  const cs = pts.map((_, i) => corner(i));
  const k = 0.55;
  let d = `M${P(cs[0].e)}`;
  for (let j = 1; j <= n; j++) {
    const c = cs[j % n];
    d += ` L${P(c.s)} C${P({ x: c.s.x + (c.v.x - c.s.x) * k * 1.2, y: c.s.y + (c.v.y - c.s.y) * k * 1.2 })} ${P({ x: c.e.x + (c.v.x - c.e.x) * k * 1.2, y: c.e.y + (c.v.y - c.e.y) * k * 1.2 })} ${P(c.e)}`;
  }
  return d + " Z";
}

/** Points round an ellipse, each pushed in or out a little (a deterministic wobble), for organic blobs. */
export function blobPoints(c: Pt, rx: number, ry: number, n = 10, wobble = 0.06, seed = 1, rot = 0): Pt[] {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    const k = 1 + (rand() * 2 - 1) * wobble;
    return { x: c.x + rx * k * Math.cos(a), y: c.y + ry * k * Math.sin(a) };
  });
}

/** Rotate points about a centre (radians), then shift. */
export function transform(pts: Pt[], about: Pt, angle: number, shift: Pt = { x: 0, y: 0 }): Pt[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return pts.map((p) => ({ x: about.x + (p.x - about.x) * c - (p.y - about.y) * s + shift.x, y: about.y + (p.x - about.x) * s + (p.y - about.y) * c + shift.y }));
}

/** A filled triangular head whose tip is exactly `tip`. */
export function arrowHead(tip: Pt, from: Pt, size = 12, spread = 0.42): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const l = { x: tip.x - size * Math.cos(a - spread), y: tip.y - size * Math.sin(a - spread) };
  const r = { x: tip.x - size * Math.cos(a + spread), y: tip.y - size * Math.sin(a + spread) };
  return `M${P(tip)} L${P(l)} L${P(r)} Z`;
}

/** A straight or gently curved arrow (bend = sideways offset of the middle), shaft stopping inside the head. */
export function arrowShapes(from: Pt, to: Pt, colour: Ink, width: number, part?: string, opts: { head?: number; bend?: number; dash?: string; opacity?: number } = {}): FigureShape[] {
  const head = opts.head ?? Math.max(10, width * 3.6);
  const bend = opts.bend ?? 0;
  const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1;
  const ctl = { x: (from.x + to.x) / 2 - (dy / L) * bend, y: (from.y + to.y) / 2 + (dx / L) * bend };
  // The shaft ends a little inside the head's base, along the direction the curve arrives from.
  const ax = to.x - ctl.x, ay = to.y - ctl.y, aL = Math.hypot(ax, ay) || 1;
  const end = { x: to.x - (ax / aL) * head * 0.7, y: to.y - (ay / aL) * head * 0.7 };
  const shaft = bend ? `M${P(from)} Q${P(ctl)} ${P(end)}` : `M${P(from)} L${P(end)}`;
  const st = { ...(part ? { part } : {}), ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}) };
  return [
    { t: "path", d: shaft, stroke: colour, width, fill: "none", ...(opts.dash ? { dash: opts.dash } : {}), ...st },
    { t: "path", d: arrowHead(to, ctl, head), stroke: colour, width: 1, fill: colour, ...st },
  ];
}

/** The midpoint of the arrow drawn by arrowShapes (on the curve), for anchors. */
export function arrowMid(from: Pt, to: Pt, bend = 0): Pt {
  const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1;
  const ctl = { x: (from.x + to.x) / 2 - (dy / L) * bend, y: (from.y + to.y) / 2 + (dx / L) * bend };
  return { x: 0.25 * from.x + 0.5 * ctl.x + 0.25 * to.x, y: 0.25 * from.y + 0.5 * ctl.y + 0.25 * to.y };
}

/** A small deterministic generator (mulberry32), so the same board always draws the same picture. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A soft fill and a clear ink outline for one outline path (two shapes, the outline on top). */
export function softShape(d: string, colour: `#${string}`, part?: string, opts: { fillOpacity?: number; stroke?: Ink; width?: number; dash?: string } = {}): FigureShape[] {
  const p = part ? { part } : {};
  return [
    { t: "path", d, fill: colour, stroke: "none", opacity: opts.fillOpacity ?? 0.22, ...p },
    { t: "path", d, fill: "none", stroke: opts.stroke ?? "ink", width: opts.width ?? 2.2, ...(opts.dash ? { dash: opts.dash } : {}), ...p },
  ];
}

/** "Grass" → "Grass"; trims, strips odd characters, caps the length. */
export function cleanName(v: unknown, max = 18): string {
  return fitText(String(v ?? "").replace(/[^\p{L}\p{N} '\-()]/gu, "").replace(/\s+/g, " ").trim(), max);
}
export const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
