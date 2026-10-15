import { evalExpr } from "./expr";
import type { GraphStage } from "./types";

/**
 * GRAPH LABELS, CHECKED AGAINST THE CURVE. The model writes a curve as a formula and its labels as
 * free text, so the two can disagree: "2 + 0.004x" with a guide "$500 billion at 3%" where the
 * curve gives 4% (AP Macro audit 2026-10-15). A number in a marker's or guide's label must be the
 * point's x or the curve's height there (within 3% of the axis); anything else is sent back.
 */
const numbersIn = (label: string): number[] => {
  // A label naming a span (period, amplitude, wavelength, an interval) gives a length, not a point.
  if (/(^|\s)(T|Δ\w*|λ|A)\s*=|\b(period|amplitude|wavelength|interval|half[- ]life|range)\b/i.test(label)) return [];
  const plain = label.replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, (_, a, b) => String(Number(a) / Number(b)));
  return (plain.match(/(?<![A-Za-z₀-₉_])\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
};

export function graphIssues(stage: GraphStage, vars: Record<string, number> = {}, wrongIds: Set<string> = new Set()): string[] {
  const issues: string[] = [];
  const tolX = Math.abs(stage.x.max - stage.x.min) * 0.03;
  const tolY = Math.abs(stage.y.max - stage.y.min) * 0.03;
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.02);
  const fmt = (n: number) => String(Number(n.toPrecision(3)));
  for (const m of stage.markers ?? []) {
    if (!m.label) continue;
    const curve = stage.curves.find((c) => c.id === m.curve);
    const x = evalExpr(m.x, vars, NaN);
    const y = curve ? evalExpr(curve.expr, { ...vars, x }, NaN) : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const wrong = numbersIn(m.label).filter((n) => !near(n, x, tolX) && !near(n, y, tolY));
    if (wrong.length) wrongIds.add(m.id);
    if (wrong.length) issues.push(`marker "${m.label}" sits at x = ${fmt(x)}, where the curve is at ${fmt(y)} — its label says ${wrong.join(", ")}; move the marker or fix the curve so they agree`);
  }
  for (const g of stage.guides ?? []) {
    const heights = stage.curves.map((c) => evalExpr(c.expr, { ...vars, x: g.x }, NaN)).filter(Number.isFinite);
    const wrong = numbersIn(g.label).filter((n) => !near(n, g.x, tolX) && !heights.some((h) => near(n, h, tolY)));
    if (wrong.length) wrongIds.add(g.id);
    if (wrong.length) issues.push(`guide "${g.label}" is at x = ${fmt(g.x)}, where the curve${heights.length > 1 ? "s are" : " is"} at ${heights.map(fmt).join(" and ")} — its label says ${wrong.join(", ")}`);
  }
  // A curve that leaves the plot is drawn flattened against its edge.
  for (const c of stage.curves) {
    let outside = 0;
    for (let i = 0; i <= 40; i++) {
      const v = evalExpr(c.expr, { ...vars, x: stage.x.min + ((stage.x.max - stage.x.min) * i) / 40 }, NaN);
      if (Number.isFinite(v) && (v < stage.y.min - tolY * 3 || v > stage.y.max + tolY * 3)) outside++;
    }
    if (outside > 20) issues.push(`curve "${c.label ?? c.id}" is mostly outside the y axis range ${stage.y.min} to ${stage.y.max}`);
  }
  return issues;
}

/** Where two curves cross inside the plot (bisection on their difference), or null. */
export function intersection(stage: GraphStage, a: string, b: string, vars: Record<string, number> = {}): number | null {
  const ca = stage.curves.find((c) => c.id === a), cb = stage.curves.find((c) => c.id === b);
  if (!ca || !cb) return null;
  const d = (x: number) => evalExpr(ca.expr, { ...vars, x }, NaN) - evalExpr(cb.expr, { ...vars, x }, NaN);
  const n = 200;
  for (let i = 0; i < n; i++) {
    let lo = stage.x.min + ((stage.x.max - stage.x.min) * i) / n, hi = stage.x.min + ((stage.x.max - stage.x.min) * (i + 1)) / n;
    if (!(d(lo) * d(hi) <= 0) || !Number.isFinite(d(lo))) continue;
    for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (d(lo) * d(mid) <= 0) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
  }
  return null;
}

/**
 * An equilibrium marker sits exactly where the two curves cross. The model placed "Market
 * relationship" on one curve at a guessed x; code puts it on the crossing and names it.
 */
export function snapEquilibrium(stage: GraphStage): GraphStage {
  if (stage.curves.length !== 2 || !stage.markers?.length) return stage;
  const xi = intersection(stage, stage.curves[0].id, stage.curves[1].id);
  if (xi === null) return stage;
  const markers = stage.markers.map((m) =>
    /equilibri|intersect|market (?:relationship|clearing)|\bE\b|crossing/i.test(`${m.id} ${m.label ?? ""}`) || (stage.markers!.length === 1 && Math.abs(evalExpr(m.x, {}, NaN) - xi) <= (stage.x.max - stage.x.min) * 0.05)
      ? { ...m, x: String(Number(xi.toPrecision(6))), label: /equilibri/i.test(m.label ?? "") ? m.label : "Equilibrium" }
      : m,
  );
  return { ...stage, markers };
}

/** The last attempt's repair: a marker or guide whose label contradicts the curve is removed, not shipped. */
export function dropContradictingPoints(stage: GraphStage, vars: Record<string, number> = {}): GraphStage {
  const wrong = new Set<string>();
  graphIssues(stage, vars, wrong);
  if (!wrong.size) return stage;
  const markers = stage.markers?.filter((m) => !wrong.has(m.id));
  const guides = stage.guides?.filter((g) => !wrong.has(g.id));
  return { ...stage, markers: markers?.length ? markers : undefined, guides: guides?.length ? guides : undefined };
}
