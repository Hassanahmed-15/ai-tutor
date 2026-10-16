import type { FigureComponent, FigureParams, FigurePart } from "../types";
import { bool } from "./mathsKit";
import { EconGraph, PALETTE, root, txt, type MPt } from "./econKit";

/**
 * THE FIRM'S COST AND REVENUE CURVES. Costs come from one cubic total cost TC = F + aQ − bQ² + cQ³,
 * so MC = a − 2bQ + 3cQ² really does cut AVC and ATC at their minima. Revenue follows the market
 * structure: a perfectly competitive firm's AR = MR = D is horizontal at the price; a monopoly's (or
 * a monopolistic competitor's) AR is a falling line with MR = twice as steep. Output is where MC = MR
 * on MC's rising stretch; the price is read off AR at that output; the profit (or loss) rectangle is
 * (AR − ATC) × Q. Monopolistic competition in the long run has AR tangent to ATC, so MC = MR exactly
 * at the tangency and profit is normal — by construction.
 */

const F = 8, A = 6, B = 1.6, C = 0.16;
export const cost = {
  tc: (q: number) => F + A * q - B * q * q + C * q ** 3,
  avc: (q: number) => A - B * q + C * q * q,
  atc: (q: number) => F / Math.max(q, 1e-6) + A - B * q + C * q * q,
  mc: (q: number) => A - 2 * B * q + 3 * C * q * q,
  atcSlope: (q: number) => -F / Math.max(q, 1e-6) ** 2 - B + 2 * C * q,
};
/** Output at minimum ATC / AVC, and MC's own minimum (where its rising stretch begins). */
export const QMIN_ATC = root(cost.atcSlope, 1, 12);
export const QMIN_AVC = B / (2 * C);
export const QMIN_MC = (2 * B) / (6 * C);
/** The larger root of MC(q) = r(q) on MC's rising stretch (r a falling or flat line). */
function mcMeets(mr: (q: number) => number): number {
  return root((q) => cost.mc(q) - mr(q), QMIN_MC, 14);
}

export type Structure = "perfect" | "monopoly" | "monopolistic";
export type FirmModel = {
  structure: Structure;
  outcome: "supernormal" | "normal" | "loss";
  /** AR = d0 − d1·Q (d1 = 0: horizontal). MR = d0 − 2·d1·Q. */
  d0: number; d1: number;
  q: number; price: number; atc: number; profit: number;
};

export function firmModel(params: FigureParams): FirmModel {
  const s = txt(params.market ?? params.structure ?? params.marketStructure).toLowerCase();
  const structure: Structure = /monopolistic|monopolistically/.test(s) ? "monopolistic" : /perfect|competitive firm|price[- ]taker/.test(s) ? "perfect" : /monopol/.test(s) ? "monopoly" : "monopoly";
  const o = txt(params.outcome ?? params.profit).toLowerCase();
  const longRun = /long/.test(`${s} ${txt(params.run)}`.toLowerCase());
  const outcome: FirmModel["outcome"] = /loss|subnormal/.test(o) ? "loss" : /normal/.test(o) && !/super|abnormal/.test(o) ? "normal" : /super|abnormal|profit/.test(o) ? "supernormal"
    : structure === "monopolistic" || (structure === "perfect" && longRun) ? "normal" : "supernormal";
  let d0: number, d1: number;
  if (structure === "perfect") {
    const atcMin = cost.atc(QMIN_ATC), avcMin = cost.avc(QMIN_AVC);
    d0 = outcome === "supernormal" ? atcMin + 1.7 : outcome === "normal" ? atcMin : (atcMin + avcMin) / 2 + 0.1;
    d1 = 0;
  } else if (outcome === "normal") {
    // AR tangent to ATC to the left of its minimum: MC = MR there automatically.
    const qt = QMIN_ATC * (structure === "monopolistic" ? 0.72 : 0.62);
    d1 = -cost.atcSlope(qt);
    d0 = cost.atc(qt) + d1 * qt;
  } else {
    d1 = structure === "monopolistic" ? 0.5 : 0.75;
    // Choose the demand's height so the profit per unit at the chosen output is the target.
    const target = outcome === "supernormal" ? 2 : -0.6;
    const perUnit = (a: number) => {
      const q = mcMeets((x) => a - 2 * d1 * x);
      return a - d1 * q - cost.atc(q);
    };
    d0 = root((a) => perUnit(a) - target, 3, 20);
  }
  const q = d1 === 0 ? mcMeets(() => d0) : mcMeets((x) => d0 - 2 * d1 * x);
  const price = d0 - d1 * q;
  const atc = cost.atc(q);
  return { structure, outcome, d0, d1, q, price, atc, profit: (price - atc) * q };
}

export const costRevenue: FigureComponent = {
  name: "costRevenue",
  title: "Cost and revenue curves of a firm: MC, ATC, AVC, AR = D and MR, profit-maximising output where MC = MR, supernormal profit or loss shaded",
  params: `market ("monopoly" — default —, "perfect competition" (a price-taking firm: AR = MR = D horizontal), "monopolistic competition"; add "long run" for the long-run case), outcome ("supernormal" profit, "normal" profit, or "loss"; defaults: monopoly supernormal, perfect competition supernormal (normal in the long run), monopolistic competition normal — AR tangent to ATC), avc (true adds AVC; shown automatically for a loss, where it is the shutdown test). Code places output where MC = MR, reads the price from AR and shades (AR − ATC) × Q.`,
  match: /\b(marginal (cost|revenue)|MC\s*=\s*MR|MR\s*=\s*MC|profit[- ]maximi[sz](ing|ation|e)|supernormal profits?|abnormal profits?|normal profits?|subnormal profits?|average (total |variable )?cost curves?|cost and revenue (curves|diagram)|revenue curves?|monopolistic(ally)? competiti(on|ve)|perfect(ly)? competiti(on|ve) (firm|market)|monopoly (diagram|profit|pricing|power)|monopolists?|shut[- ]?down (point|price)|break[- ]even price)\b/i,
  parts: [
    { id: "mc", name: "Marginal cost (MC)" },
    { id: "atc", name: "Average total cost (ATC)" },
    { id: "avc", name: "Average variable cost (AVC)" },
    { id: "ar", name: "Average revenue = demand" },
    { id: "mr", name: "Marginal revenue (MR)" },
    { id: "mc-mr", name: "MC = MR" },
    { id: "profit-max-output", name: "Profit-maximising output" },
    { id: "supernormal-profit", name: "Supernormal profit" },
    { id: "loss", name: "Loss" },
  ],
  build(params: FigureParams) {
    const m = firmModel(params);
    const showAvc = bool(params.avc ?? params.showAvc, m.outcome === "loss");
    const g = new EconGraph(10, 11, 470, 340);
    const parts: FigurePart[] = [];
    const ar = (q: number) => m.d0 - m.d1 * q, mr = (q: number) => m.d0 - 2 * m.d1 * q;
    const atQ: MPt = { q: m.q, p: m.price }, atcQ: MPt = { q: m.q, p: m.atc };

    // The profit/loss rectangle first (under the curves).
    if (m.outcome !== "normal" && Math.abs(m.price - m.atc) > 0.05) {
      const rect = [{ q: 0, p: m.atc }, { q: m.q, p: m.atc }, { q: m.q, p: m.price }, { q: 0, p: m.price }];
      const sup = m.price > m.atc;
      g.shade(rect, sup ? PALETTE.green : PALETTE.red, sup ? "supernormal-profit" : "loss", 0.3);
      parts.push({ id: sup ? "supernormal-profit" : "loss", name: sup ? "Supernormal profit" : "Loss (subnormal profit)", anchor: g.P({ q: m.q * 0.42, p: (m.price + m.atc) / 2 }) });
    }
    g.axes("Costs, revenue", "Output");
    const sample = (f: (q: number) => number, q0: number, q1: number) => (t: number) => ({ q: q0 + (q1 - q0) * t, p: f(q0 + (q1 - q0) * t) });
    // Costs.
    const mcPts = g.curve(sample(cost.mc, 0.35, 10), { stroke: PALETTE.red, width: 3, part: "mc" }, 90);
    g.curveLabel(mcPts, "MC", PALETTE.red, "end", { x: 0.4, y: -1 });
    const atcPts = g.curve(sample(cost.atc, 0.9, 10), { stroke: PALETTE.blue, width: 3, part: "atc" }, 90);
    g.curveLabel(atcPts, "ATC", PALETTE.blue, "end", { x: 1, y: -0.4 });
    if (showAvc) {
      const avcPts = g.curve(sample(cost.avc, 0.3, 10), { stroke: PALETTE.violet, width: 2.6, part: "avc", dash: "10 6" }, 90);
      g.curveLabel(avcPts, "AVC", PALETTE.violet, "end", { x: 1, y: 0.2 });
    }
    // Revenue.
    const perfect = m.d1 === 0;
    const arPts = g.curve(sample(ar, 0, 10.2), { stroke: PALETTE.green, width: 3, part: "ar" }, 2);
    g.curveLabel(arPts, perfect ? "AR = MR = D" : "AR = D", PALETTE.green, "end", perfect ? { x: 0.25, y: 1 } : { x: 1, y: 0.3 });
    if (!perfect) {
      const qEnd = Math.min(10, m.d0 / (2 * m.d1));
      const mrPts = g.curve(sample(mr, 0, qEnd), { stroke: PALETTE.amber, width: 3, part: "mr" }, 2);
      g.curveLabel(mrPts, "MR", PALETTE.amber, "end", { x: 0.6, y: 1 });
    }

    // Output where MC = MR, the price off AR, the average cost off ATC.
    const mcmr: MPt = { q: m.q, p: cost.mc(m.q) };
    g.line(mcmr, { q: m.q, p: 0 }, { stroke: "muted", width: 1.6, dash: "6 5" });
    if (m.price > mcmr.p) g.line(mcmr, atQ, { stroke: "muted", width: 1.6, dash: "6 5" });
    g.xTick(m.q, "Q*");
    if (!perfect) g.drop(atQ, "P*", null);
    else g.yTick(m.price, "P*");
    if (Math.abs(m.price - m.atc) > 0.05) g.drop(atcQ, "C", null);
    g.dot(mcmr, "ink", "mc-mr");
    if (!perfect || Math.abs(m.price - m.atc) > 0.05) g.dot(atcQ, "ink");
    if (!perfect) g.dot(atQ, "ink");

    // Anchors on each curve, away from the crossings.
    const mcA = Math.min(9.6, root((q) => cost.mc(q) - 9.6, QMIN_MC, 10));
    parts.unshift(
      { id: "mc", name: "Marginal cost (MC)", anchor: g.P({ q: mcA, p: cost.mc(mcA) }) },
      { id: "atc", name: "Average total cost (ATC)", anchor: g.P({ q: 1.25, p: cost.atc(1.25) }) },
    );
    if (showAvc) parts.push({ id: "avc", name: "Average variable cost (AVC)", anchor: g.P({ q: 9.4, p: cost.avc(9.4) }) });
    const arA = perfect ? 9.6 : Math.min(9.2, (m.d0 - 1) / m.d1, Math.max(m.q + 3.2, 0.5));
    parts.push({ id: "ar", name: perfect ? "AR = MR = D (price)" : "Average revenue = demand", anchor: g.P({ q: arA, p: ar(arA) }) });
    if (!perfect) {
      const mrA = Math.max(0.4, Math.min(m.q * 0.35, m.d0 / (2 * m.d1) - 0.3));
      parts.push({ id: "mr", name: "Marginal revenue (MR)", anchor: g.P({ q: mrA, p: mr(mrA) }) });
    }
    parts.push({ id: "mc-mr", name: "MC = MR (profit maximised)", anchor: g.P(mcmr) });
    parts.push({ id: "profit-max-output", name: "Profit-maximising output", anchor: g.pt(m.q, 0) });
    return g.finish(parts);
  },
};
