/**
 * THE CANVAS'S INK — pen strokes with pressure, and the hand-drawn frames around things.
 *
 * Pure geometry, no DOM, so it is unit-tested (lib/anim/lessonCanvas.test.ts) and used by the
 * renderer and the server alike.
 *
 * A pen stroke here is a FILLED outline whose width swells and tapers along its length, the way a
 * marker or fountain pen leaves ink (RSA Animate, MinutePhysics), rather than a constant-width SVG
 * stroke. It is revealed by a mask that draws along the centre line, so the stroke still "draws on"
 * in the order it was written. Graph curves and axes never use this: there, precision is the content.
 */

import { sketchRect } from "../../components/whiteboard/sketch";

export type Pt = { x: number; y: number };

/** Points along a quadratic Bézier. */
export function quadPoints(p0: Pt, c: Pt, p1: Pt, n = 24): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return {
      x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
      y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y,
    };
  });
}

/** The SVG path of a centre line through points (what the reveal mask draws along). */
export function centreLine(points: Pt[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

/**
 * How wide the ink is `t` of the way along a stroke: a quick press at the start, full in the middle,
 * a longer lift-off at the end — the asymmetry is what reads as handwriting rather than a sausage.
 */
export function inkWidth(t: number, width: number): number {
  const start = Math.min(1, t / 0.12);
  const end = Math.min(1, (1 - t) / 0.28);
  return width * (0.28 + 0.72 * Math.sqrt(Math.max(0, Math.min(start, end))));
}

/** A filled, pressure-tapered outline around a centre line. */
export function taperedStroke(points: Pt[], width: number): string {
  if (points.length < 2) return "";
  const left: Pt[] = [];
  const right: Pt[] = [];
  const last = points.length - 1;
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(last, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const half = inkWidth(i / last, width) / 2;
    left.push({ x: p.x - (dy / d) * half, y: p.y + (dx / d) * half });
    right.push({ x: p.x + (dy / d) * half, y: p.y - (dx / d) * half });
  });
  const fmt = (p: Pt) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  const tip = points[last];
  const head = points[0];
  return `M${fmt(left[0])} ${left.slice(1).map((p) => `L${fmt(p)}`).join(" ")} Q${fmt(tip)} ${fmt(right[last])} ${right.slice(0, -1).reverse().map((p) => `L${fmt(p)}`).join(" ")} Q${fmt(head)} ${fmt(left[0])} Z`;
}

/** A pen-drawn open arrowhead at the end of a curve: two short tapered strokes. */
export function arrowHead(tip: Pt, from: Pt, size = 15, width = 4): string[] {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  return [-1, 1].map((side) => {
    const back = { x: tip.x - ux * size + -uy * size * 0.62 * side, y: tip.y - uy * size + ux * size * 0.62 * side };
    return taperedStroke([back, { x: (back.x + tip.x) / 2, y: (back.y + tip.y) / 2 }, tip], width);
  });
}

/** A hand-drawn rectangle from its top-left corner (the shared sketch helpers are centred). */
export function roughRect(seed: string, x: number, y: number, w: number, h: number, radius = 12): string {
  return sketchRect(seed, x + w / 2, y + h / 2, w, h, radius);
}

/** Deterministic 0-1 numbers from a string (mulberry32), so a hand-drawn shape never re-jitters. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A hand-drawn ellipse: one pen loop that goes a little past where it started (so the ends overlap,
 * the tell of a real hand), with a gentle wobble in radius — still clearly a circle, never a box.
 */
export function roughEllipse(seed: string, cx: number, cy: number, rx: number, ry: number): string {
  const rand = seeded(seed);
  const start = rand() * Math.PI * 2;
  const turn = Math.PI * 2 * (1.06 + rand() * 0.06);
  const n = 26;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (turn * i) / n;
    const wobble = 1 + (rand() - 0.5) * 0.045 + (i / n) * 0.03;
    pts.push({ x: cx + Math.cos(a) * rx * wobble, y: cy + Math.sin(a) * ry * wobble });
  }
  // Smooth through the midpoints so the loop reads as one confident stroke.
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += ` Q${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mid.x.toFixed(1)} ${mid.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Keyframe positions for a token gliding along an arc from `a` to `b` (3Blue1Brown's path_arc):
 * the further it travels, the higher it lifts, so terms crossing the "=" visibly jump over it.
 */
export function arcKeyframes(a: Pt, b: Pt, steps = 8): Pt[] {
  const lift = Math.min(70, Math.hypot(b.x - a.x, b.y - a.y) * 0.32);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * lift };
  });
}
