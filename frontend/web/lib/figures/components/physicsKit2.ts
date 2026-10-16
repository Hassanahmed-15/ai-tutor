import type { Ink, Pt } from "../types";
import { Sketch, add, mul, perp, sub, unit, dist } from "./mathsKit";

/**
 * Small shared pieces for the second physics set (reflectionRefraction, motionGraph, moments,
 * electromagnetism, sankey): a ray with its direction arrow at the middle, a straight arrow with a
 * filled head, vector refraction (Snell's law in vector form) and a few number helpers.
 */

export const INK = { blue: "#2563eb", red: "#dc2626", green: "#16a34a", amber: "#d97706", violet: "#7c3aed" } as const;

/** A light ray from a to b with a small filled arrowhead at its middle (pointing a→b). */
export function ray(sk: Sketch, a: Pt, b: Pt, colour: Ink, part: string, opts: { width?: number; dash?: string; opacity?: number; arrow?: boolean; at?: number } = {}) {
  sk.line([a, b], { stroke: colour, width: opts.width ?? 2.6, part, ...(opts.dash ? { dash: opts.dash } : {}), ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}) });
  if (opts.arrow === false || dist(a, b) < 26) return;
  const u = unit(sub(b, a)), n = perp(u);
  const m = add(a, mul(sub(b, a), opts.at ?? 0.5));
  const s = 11;
  sk.polygon([add(m, mul(u, s * 0.6)), add(add(m, mul(u, -s * 0.5)), mul(n, s * 0.5)), add(add(m, mul(u, -s * 0.5)), mul(n, -s * 0.5))], { fill: colour, stroke: colour, width: 1, part, ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}) }, false);
}

/** A straight arrow from → to with a filled head whose tip is exactly at `to`. */
export function arrowTo(sk: Sketch, from: Pt, to: Pt, colour: Ink, part: string, width = 3, head = 13) {
  const u = unit(sub(to, from)), n = perp(u);
  const L = Math.min(head, dist(from, to) * 0.5);
  const base = sub(to, mul(u, L));
  sk.line([from, add(base, mul(u, L * 0.3))], { stroke: colour, width, part });
  sk.polygon([to, add(base, mul(n, L * 0.45)), add(base, mul(n, -L * 0.45))], { fill: colour, stroke: colour, width: 1, part });
}

/**
 * Refraction of unit direction d at a surface with unit normal nrm (either orientation), from index
 * n1 into n2 (Snell's law, n1 sin θ1 = n2 sin θ2). Returns the refracted unit direction, or null for
 * total internal reflection. reflect() gives the mirror direction (angle of reflection = incidence).
 */
export function refract(d: Pt, nrm: Pt, n1: number, n2: number): Pt | null {
  let N = unit(nrm);
  let cosi = -(N.x * d.x + N.y * d.y);
  if (cosi < 0) { N = mul(N, -1); cosi = -cosi; }
  const eta = n1 / n2;
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  return unit(add(mul(d, eta), mul(N, eta * cosi - Math.sqrt(k))));
}
export function reflect(d: Pt, nrm: Pt): Pt {
  const N = unit(nrm);
  const k = 2 * (N.x * d.x + N.y * d.y);
  return unit(sub(d, mul(N, k)));
}

/** "3 N", "0.5", "-2.4e1" → number (first number found), else undefined. */
export function firstNumber(s: string): number | undefined {
  const m = s.replace(/−/g, "-").match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/i);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/** Round for display: 41.81 → "41.8", 2 → "2", −0 → "0" (minus as a true minus sign). */
export function show(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return "?";
  const r = Number(n.toFixed(dp));
  return String(Object.is(r, -0) ? 0 : r).replace("-", "−");
}
