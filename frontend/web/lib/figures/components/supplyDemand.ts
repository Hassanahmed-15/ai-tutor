import type { FigureComponent, FigureParams, FigurePart } from "../types";
import { bool, num, optNum } from "./mathsKit";
import { EconGraph, PALETTE, SUBS, at, centroid, cross, qAt, txt, type Lin, type MPt } from "./econKit";

/**
 * SUPPLY AND DEMAND (Cambridge/AP conventions): price up, quantity across, straight D and S on an
 * abstract 0–10 scale with the free-market equilibrium at P = 5, Q = 5. The board chooses what
 * happens — a shift, an indirect tax or subsidy, a maximum or minimum price, which areas to shade —
 * and the code computes every intersection, quantity and area from the lines.
 */

type Dir = 1 | -1 | 0;
const SLOPE = { elastic: 0.45, normal: 0.8, inelastic: 1.6 };

function elasticity(v: unknown): number {
  const s = txt(v).toLowerCase();
  if (/inelastic|steep/.test(s)) return SLOPE.inelastic;
  if (/elastic|flat|gentle|shallow/.test(s)) return SLOPE.elastic;
  return SLOPE.normal;
}

/** "demand right", "increase in supply", "supply shifts left", "both right" → directions. */
export function parseShifts(params: FigureParams): { demand: Dir; supply: Dir } {
  const dir = (s: string): Dir => (/\b(right|increase[sd]?|rises?|up(wards?)?\b.*demand|outwards?|grows?|higher|more)\b/.test(s) ? 1 : /\b(left|decrease[sd]?|falls?|inwards?|lower|less|reduc)/.test(s) ? -1 : 0);
  const out: { demand: Dir; supply: Dir } = { demand: 0, supply: 0 };
  const d = txt(params.demandShift).toLowerCase(), s = txt(params.supplyShift).toLowerCase();
  if (d) out.demand = dir(d);
  if (s) out.supply = /\bup(wards?)?\b/.test(s) ? -1 : /\bdown(wards?)?\b/.test(s) ? 1 : dir(s);
  const all = `${txt(params.shift)} ${txt(params.shifts)}`.toLowerCase();
  if (all.trim()) {
    for (const clause of all.split(/[,;&+]|\band\b|\bwhile\b|\bwith\b/)) {
      const c = clause.trim();
      if (!c) continue;
      const mD = /demand|\bd\b|\bad\b/.test(c), mS = /supply|\bs\b/.test(c), both = /\bboth\b/.test(c);
      let v: Dir = dir(c);
      if (mS && !mD) v = /\bup(wards?)?\b/.test(c) ? -1 : /\bdown(wards?)?\b/.test(c) ? 1 : v;
      if ((mD || both) && !out.demand) out.demand = v;
      if ((mS || both) && !out.supply) out.supply = v;
    }
  }
  return out;
}

export type Market = {
  d0: Lin; s0: Lin; d1: Lin; s1: Lin;
  shifts: { demand: Dir; supply: Dir };
  eq0: MPt; eq1: MPt;
  tax?: { t: number; sTax: Lin; q: number; pc: number; pp: number; revenue: number };
  subsidy?: { s: number; sSub: Lin; q: number; pc: number; pp: number; cost: number };
  control?: { kind: "max" | "min"; price: number; binding: boolean; qd: number; qs: number; shortage: number; surplus: number };
  /** The quantity traded and the prices buyers pay and sellers receive, after every change. */
  traded: { q: number; pb: number; ps: number };
};

/** The market's numbers, all computed from straight lines (correct by construction). */
export function marketModel(params: FigureParams): Market {
  const bd = elasticity(params.demandElasticity ?? (/demand/i.test(txt(params.elasticity)) || !/supply/i.test(txt(params.elasticity)) ? params.elasticity : undefined));
  const bs = elasticity(params.supplyElasticity ?? (/supply/i.test(txt(params.elasticity)) ? params.elasticity : undefined));
  const d0: Lin = { a: 5 + bd * 5, b: -bd }, s0: Lin = { a: 5 - bs * 5, b: bs };
  const eq0 = cross(d0, s0)!;
  const taxN = taxAmount(params.tax ?? params.indirectTax);
  const subN = taxAmount(params.subsidy);
  const shifts = taxN || subN ? { demand: 0 as Dir, supply: 0 as Dir } : parseShifts(params);
  const size = num(params.shiftSize, 2, 0.8, 3);
  const move = (l: Lin, d: Dir): Lin => ({ a: l.a - l.b * size * d, b: l.b });
  const d1 = move(d0, shifts.demand), s1 = move(s0, shifts.supply);
  const eq1 = cross(d1, s1)!;
  const m: Market = { d0, s0, d1, s1, shifts, eq0, eq1, traded: { q: eq1.q, pb: eq1.p, ps: eq1.p } };
  if (taxN) {
    const t = Math.min(taxN, 3.5);
    const sTax: Lin = { a: s0.a + t, b: s0.b };
    const e = cross(d0, sTax)!;
    m.tax = { t, sTax, q: e.q, pc: e.p, pp: e.p - t, revenue: t * e.q };
    m.eq1 = e;
    m.traded = { q: e.q, pb: e.p, ps: e.p - t };
  } else if (subN) {
    const s = Math.min(subN, 3);
    const sSub: Lin = { a: s0.a - s, b: s0.b };
    const e = cross(d0, sSub)!;
    m.subsidy = { s, sSub, q: e.q, pc: e.p, pp: e.p + s, cost: s * e.q };
    m.eq1 = e;
    m.traded = { q: e.q, pb: e.p, ps: e.p + s };
  } else {
    const ctl = txt(params.priceControl ?? params.control).toLowerCase();
    const kind = /max|ceiling|cap/.test(ctl) ? "max" : /min|floor|wage/.test(ctl) ? "min" : optNum(params.maxPrice) !== undefined ? "max" : optNum(params.minPrice) !== undefined ? "min" : null;
    if (kind) {
      const given = optNum(params.controlPrice ?? (kind === "max" ? params.maxPrice : params.minPrice));
      const price = given !== undefined ? Math.max(0.4, Math.min(9.6, given)) : eq1.p + (kind === "max" ? -1.5 : 1.5);
      const qd = Math.max(0, qAt(d1, price)), qs = Math.max(0, qAt(s1, price));
      const binding = kind === "max" ? price < eq1.p - 1e-9 : price > eq1.p + 1e-9;
      m.control = { kind, price, binding, qd, qs, shortage: binding && kind === "max" ? qd - qs : 0, surplus: binding && kind === "min" ? qs - qd : 0 };
      if (binding) m.traded = { q: Math.min(qd, qs), pb: price, ps: price };
    }
  }
  return m;
}

function taxAmount(v: unknown): number {
  if (v === undefined || v === false) return 0;
  if (v === true) return 2;
  const n = optNum(typeof v === "string" ? v.replace(/^[$£€]/, "") : v);
  if (n !== undefined) return n > 0 ? Math.max(0.5, n) : 0;
  return bool(v, false) ? 2 : 0;
}

export const supplyDemand: FigureComponent = {
  name: "supplyDemand",
  title: "Supply and demand diagram: price against quantity, D and S, equilibrium P* Q*, with shifts, indirect tax or subsidy, maximum/minimum price, consumer/producer surplus",
  params: `All optional; abstract 0–10 scale, free-market equilibrium at price 5, quantity 5. shift ("demand right", "supply left", "demand right, supply right", "both left"; up = left for supply), shiftSize (0.8–3, default 2), tax (per-unit indirect tax, e.g. 2: supply shifts UP by the tax; shades tax revenue), subsidy (per-unit, e.g. 1.5: supply shifts down), incidence (true: split tax revenue into consumer and producer burden), priceControl ("max" / "min"), controlPrice (e.g. 3.5; default 1.5 below/above equilibrium), surplus ("consumer", "producer", "both"), deadweight (true: shade the deadweight loss), elasticity / demandElasticity / supplyElasticity ("elastic" = flat, "inelastic" = steep), good (names the quantity axis, e.g. "coffee"). A tax or subsidy replaces a shift. Code computes all equilibria, shortages and areas.`,
  match: /\b(supply and demand|demand and supply|market equilibrium|equilibrium (price|quantity)|price mechanism|excess (demand|supply)|maximum price|minimum price|price (ceiling|floor|control)s?|indirect tax(es|ation)?|specific tax|tax incidence|incidence of (a |an )?(tax|subsidy)|consumer surplus|producer surplus|deadweight (welfare )?loss|(demand|supply) curves?|shifts? (in|of) (the )?(demand|supply)|(increase|decrease|fall|rise) in (demand|supply)\b(?! of (oxygen|blood|water|energy|glucose))|subsid(y|ies) (on|to|for) (producers?|firms?|a good)|market for)\b/i,
  parts: [
    { id: "demand", name: "Demand curve (D)" },
    { id: "supply", name: "Supply curve (S)" },
    { id: "equilibrium", name: "Equilibrium" },
    { id: "new-curve", name: "New curve" },
    { id: "new-equilibrium", name: "New equilibrium" },
    { id: "price-control", name: "Maximum price" },
    { id: "shortage", name: "Shortage (excess demand)" },
    { id: "excess-supply", name: "Surplus (excess supply)" },
    { id: "tax-revenue", name: "Tax revenue" },
    { id: "consumer-burden", name: "Consumers' share of the tax" },
    { id: "producer-burden", name: "Producers' share of the tax" },
    { id: "subsidy-cost", name: "Cost of the subsidy" },
    { id: "consumer-surplus", name: "Consumer surplus" },
    { id: "producer-surplus", name: "Producer surplus" },
    { id: "deadweight-loss", name: "Deadweight loss" },
  ],
  build(params: FigureParams) {
    const m = marketModel(params);
    const g = new EconGraph(10, 10, 470, 330);
    const good = txt(params.good ?? params.market, 22).replace(/^the\s+/i, "");
    const parts: FigurePart[] = [];
    const sur = txt(params.surplus ?? params.surpluses).toLowerCase();
    const cs = /consumer|both|all|true|yes/.test(sur) || bool(params.consumerSurplus, false);
    const ps = /producer|both|all|true|yes/.test(sur) || bool(params.producerSurplus, false);
    const dwl = bool(params.deadweight ?? params.deadweightLoss ?? params.dwl, false);
    const incidence = bool(params.incidence, false);
    const shifted = m.shifts.demand !== 0 || m.shifts.supply !== 0;
    const qT = m.traded.q;

    // ── shaded areas first, so the curves are drawn over them ──────────────────────────────
    const along = (l: Lin, q0: number, q1: number, n = 12): MPt[] => Array.from({ length: n + 1 }, (_, i) => {
      const q = q0 + ((q1 - q0) * i) / n;
      return { q, p: Math.max(0, Math.min(10, at(l, q))) };
    });
    const dFin = m.tax || m.subsidy ? m.d0 : m.d1, sFin = m.tax || m.subsidy ? m.s0 : m.s1;
    if (cs) {
      const poly = [...along(dFin, 0, qT), { q: qT, p: m.traded.pb }, { q: 0, p: m.traded.pb }];
      g.shade(poly, PALETTE.blue, "consumer-surplus");
      parts.push({ id: "consumer-surplus", name: "Consumer surplus", anchor: g.P(centroid(poly)) });
    }
    if (ps) {
      const poly = [{ q: 0, p: m.traded.ps }, { q: qT, p: m.traded.ps }, ...along(sFin, qT, 0)];
      g.shade(poly, PALETTE.green, "producer-surplus");
      parts.push({ id: "producer-surplus", name: "Producer surplus", anchor: g.P(centroid(poly)) });
    }
    if (m.tax) {
      const { q, pc, pp } = m.tax;
      if (incidence) {
        const top = [{ q: 0, p: m.eq0.p }, { q, p: m.eq0.p }, { q, p: pc }, { q: 0, p: pc }];
        const bot = [{ q: 0, p: pp }, { q, p: pp }, { q, p: m.eq0.p }, { q: 0, p: m.eq0.p }];
        g.shade(top, PALETTE.amber, "consumer-burden", 0.42);
        g.shade(bot, PALETTE.violet, "producer-burden", 0.34);
        parts.push({ id: "consumer-burden", name: "Consumers' share of the tax", anchor: g.P(centroid(top)) });
        parts.push({ id: "producer-burden", name: "Producers' share of the tax", anchor: g.P(centroid(bot)) });
      } else {
        const rect = [{ q: 0, p: pp }, { q, p: pp }, { q, p: pc }, { q: 0, p: pc }];
        g.shade(rect, PALETTE.amber, "tax-revenue", 0.4);
        parts.push({ id: "tax-revenue", name: "Tax revenue", anchor: g.P({ q: q * 0.5, p: (pp + pc) / 2 }) });
      }
    }
    if (m.subsidy) {
      const { q, pc, pp } = m.subsidy;
      const rect = [{ q: 0, p: pc }, { q, p: pc }, { q, p: pp }, { q: 0, p: pp }];
      g.shade(rect, PALETTE.violet, "subsidy-cost", 0.3);
      parts.push({ id: "subsidy-cost", name: "Cost of the subsidy", anchor: g.P({ q: q * 0.5, p: (pp + pc) / 2 }) });
    }
    if (dwl) {
      // Between D and S (the curves without the tax/subsidy/control), from the traded quantity to the free-market one.
      const ref = m.tax || m.subsidy ? m.eq0 : m.eq1;
      if (Math.abs(ref.q - qT) > 0.05) {
        const poly = [...along(dFin, qT, ref.q, 8), ...along(sFin, ref.q, qT, 8)];
        g.shade(poly, PALETTE.red, "deadweight-loss", 0.36);
        parts.push({ id: "deadweight-loss", name: "Deadweight loss", anchor: g.P(centroid(poly)) });
      }
    }

    // ── axes and curves ────────────────────────────────────────────────────────────────────
    g.axes("Price", good ? `Quantity of ${good}` : "Quantity");
    const lineOf = (l: Lin, part: string, colour: `#${string}`, dash?: string) => g.curve((t) => ({ q: t * 10.5, p: at(l, t * 10.5) }), { stroke: colour, width: 3, part, dash }, 2);
    const blue = PALETTE.blue, red = PALETTE.red;
    // Demand: D (or D₁ → D₂).
    const dPts = lineOf(m.d0, "demand", blue);
    const dName = m.shifts.demand ? `D${SUBS[1]}` : "D";
    const sName = m.shifts.supply ? `S${SUBS[1]}` : "S";
    g.curveLabel(dPts, dName, blue, "end", { x: 1, y: 0.3 });
    const sPts = lineOf(m.s0, "supply", red);
    g.curveLabel(sPts, sName, red, "end", { x: 1, y: -0.2 });
    const onLine = (l: Lin, q: number): MPt => ({ q, p: at(l, q) });
    // The anchors sit on each curve away from the crossing (and inside the plot).
    const qOnScreen = (l: Lin, p: number) => Math.max(0.3, Math.min(9.7, qAt(l, p)));
    // A shifted-away original supply is pointed at low on the left, so its leader never crosses the new curve.
    const sAnchorP = m.shifts.supply > 0 ? Math.max(at(m.s0, 0.9), 0.6) : 8.2;
    parts.unshift(
      { id: "demand", name: m.shifts.demand ? "Original demand (D₁)" : "Demand curve (D)", anchor: g.P(onLine(m.d0, qOnScreen(m.d0, m.shifts.demand < 0 ? 8.6 : 8.6))) },
      { id: "supply", name: m.shifts.supply ? "Original supply (S₁)" : m.tax || m.subsidy ? "Original supply (S)" : "Supply curve (S)", anchor: g.P(onLine(m.s0, qOnScreen(m.s0, sAnchorP))) },
    );
    let newCurve: { l: Lin; name: string; text: string; colour: `#${string}` } | null = null;
    if (m.shifts.demand) {
      const pts = lineOf(m.d1, "new-curve", blue);
      g.curveLabel(pts, `D${SUBS[2]}`, blue, "end", { x: 1, y: 0.3 });
      newCurve = { l: m.d1, name: m.shifts.demand > 0 ? "New demand (D₂): increase" : "New demand (D₂): decrease", text: "", colour: blue };
      const p = 3.2;
      g.shiftArrow({ q: qAt(m.d0, p) + 0.15 * m.shifts.demand, p }, { q: qAt(m.d1, p) - 0.15 * m.shifts.demand, p }, "ink", "new-curve");
    }
    if (m.shifts.supply) {
      const pts = lineOf(m.s1, m.shifts.demand ? "new-curve" : "new-curve", red);
      g.curveLabel(pts, `S${SUBS[2]}`, red, "end", { x: 1, y: -0.2 });
      if (!newCurve) newCurve = { l: m.s1, name: m.shifts.supply > 0 ? "New supply (S₂): increase" : "New supply (S₂): decrease", text: "", colour: red };
      const p = 2.6;
      g.shiftArrow({ q: qAt(m.s0, p) + 0.15 * m.shifts.supply, p }, { q: qAt(m.s1, p) - 0.15 * m.shifts.supply, p }, "ink", "new-curve");
    }
    if (m.tax || m.subsidy) {
      const l = m.tax ? m.tax.sTax : m.subsidy!.sSub;
      const pts = lineOf(l, "new-curve", red);
      g.curveLabel(pts, m.tax ? "S + tax" : "S + subsidy", red, "end", { x: 1, y: -0.2 });
      newCurve = { l, name: m.tax ? "Supply with the tax" : "Supply with the subsidy", text: "", colour: red };
      const q = 7.6, up = m.tax ? m.tax.t : -m.subsidy!.s;
      if (q <= 10 && at(m.s0, q) + up < 9.8) g.shiftArrow({ q, p: at(m.s0, q) + 0.12 * Math.sign(up) }, { q, p: at(m.s0, q) + up - 0.12 * Math.sign(up) }, "ink", "new-curve");
    }
    if (newCurve) {
      // Where a leader reaches the new curve without crossing the old one: a new demand low on the
      // right (or high on the left when it moved left), a new supply high on the right (or low on the left).
      const l = newCurve.l;
      const isD = l.b < 0;
      const outward = isD ? m.shifts.demand > 0 : (m.shifts.supply > 0 || !!m.subsidy);
      const p = isD ? (outward ? 1.7 : 8.8) : outward ? 8.6 : Math.max(at(l, 1.1), 0.6);
      parts.push({ id: "new-curve", name: newCurve.name, anchor: g.P(onLine(l, qOnScreen(l, p))) });
    }

    // ── equilibria and axis values ─────────────────────────────────────────────────────────
    const changed = shifted || !!m.tax || !!m.subsidy;
    g.drop(m.eq0, changed ? `P${SUBS[1]}` : "P*", changed ? `Q${SUBS[1]}` : "Q*");
    g.dot(m.eq0, "ink", "equilibrium");
    parts.push({ id: "equilibrium", name: changed ? "Original equilibrium" : "Equilibrium", anchor: g.P(m.eq0) });
    if (shifted) {
      g.drop(m.eq1, `P${SUBS[2]}`, `Q${SUBS[2]}`);
      g.dot(m.eq1, PALETTE.violet, "new-equilibrium");
      parts.push({ id: "new-equilibrium", name: "New equilibrium", anchor: g.P(m.eq1) });
    }
    if (m.tax) {
      g.drop({ q: m.tax.q, p: m.tax.pc }, `P${SUBS[2]}`, `Q${SUBS[2]}`);
      g.drop({ q: m.tax.q, p: m.tax.pp }, `P${SUBS[3]}`, null);
      g.dot({ q: m.tax.q, p: m.tax.pc }, PALETTE.violet, "new-equilibrium");
      parts.push({ id: "new-equilibrium", name: "New equilibrium (with tax)", anchor: g.P({ q: m.tax.q, p: m.tax.pc }) });
    }
    if (m.subsidy) {
      g.drop({ q: m.subsidy.q, p: m.subsidy.pc }, `P${SUBS[2]}`, `Q${SUBS[2]}`);
      g.drop({ q: m.subsidy.q, p: m.subsidy.pp }, `P${SUBS[3]}`, null);
      g.dot({ q: m.subsidy.q, p: m.subsidy.pc }, PALETTE.violet, "new-equilibrium");
      parts.push({ id: "new-equilibrium", name: "New equilibrium (subsidy)", anchor: g.P({ q: m.subsidy.q, p: m.subsidy.pc }) });
    }

    // ── a price control ────────────────────────────────────────────────────────────────────
    if (m.control) {
      const c = m.control;
      g.line({ q: 0, p: c.price }, { q: 10.3, p: c.price }, { stroke: PALETTE.amber, width: 3, part: "price-control" });
      g.yTick(c.price, c.kind === "max" ? "Pmax" : "Pmin", PALETTE.amber);
      parts.push({ id: "price-control", name: `${c.kind === "max" ? "Maximum" : "Minimum"} price${c.binding ? "" : " (not binding)"}`, anchor: g.pt(9.6, c.price) });
      if (c.binding) {
        const qs = Math.min(10, c.qs), qd = Math.min(10, c.qd);
        g.drop({ q: qs, p: c.price }, null, "Qs");
        g.drop({ q: qd, p: c.price }, null, "Qd");
        const below = c.kind === "max";
        const mid = g.span({ q: Math.min(qs, qd), p: c.price }, { q: Math.max(qs, qd), p: c.price }, PALETTE.red, below ? "shortage" : "excess-supply", { x: 0, y: below ? 16 : -16 });
        parts.push(below ? { id: "shortage", name: "Shortage (excess demand)", anchor: mid } : { id: "excess-supply", name: "Surplus (excess supply)", anchor: mid });
      }
    }
    return g.finish(parts);
  },
};
