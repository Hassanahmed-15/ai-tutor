import type { FigureComponent, FigureParams, FigurePart } from "../types";
import { num } from "./mathsKit";
import { EconGraph, PALETTE, SUBS, at, cross, qAt, root, txt, type Lin, type MPt } from "./econKit";

/**
 * AGGREGATE DEMAND AND AGGREGATE SUPPLY. Price level up, real GDP across. Classical (neoclassical)
 * model: straight AD and SRAS with a vertical LRAS at full-employment output Yf. Keynesian model: one
 * AS curve — horizontal at spare capacity, rising as bottlenecks appear, vertical at Yf. Shifts of
 * AD, SRAS, LRAS (or the Keynesian AS); an output gap between equilibrium output and Yf named
 * inflationary or deflationary. All equilibria are computed from the curves.
 */

type Dir = 1 | -1 | 0;
export type AsCurve = { y: (t: number) => MPt; yf: number; lin?: Lin };

const AD_SLOPE = 0.75, SRAS_SLOPE = 0.7;
const K = { p0: 2.6, y1: 3, p2: 6.6, yf: 7.4 };

/** The Keynesian AS: flat to Y1, a quarter-ellipse to (Yf, P2) — horizontal at its start, vertical at its end — then vertical. t ∈ [0, 3]. */
export function keynesianAs(shiftY = 0): AsCurve {
  const y1 = K.y1 + shiftY, yf = K.yf + shiftY;
  return {
    yf,
    y: (t) => {
      if (t <= 1) return { q: y1 * Math.max(0, t), p: K.p0 };
      if (t <= 2) {
        const th = ((t - 1) * Math.PI) / 2;
        return { q: y1 + (yf - y1) * Math.sin(th), p: K.p2 - (K.p2 - K.p0) * Math.cos(th) };
      }
      return { q: yf, p: K.p2 + (10.5 - K.p2) * Math.min(1, t - 2) };
    },
  };
}

function parseShifts(params: FigureParams): { ad: Dir; sras: Dir; lras: Dir } {
  const out = { ad: 0 as Dir, sras: 0 as Dir, lras: 0 as Dir };
  const all = `${txt(params.shift)} ${txt(params.shifts)}`.toLowerCase();
  const dir = (c: string): Dir => (/\b(right|increase[sd]?|rises?|outwards?|grows?|expands?)\b/.test(c) ? 1 : /\b(left|decrease[sd]?|falls?|inwards?|contracts?|reduc\w*)\b/.test(c) ? -1 : 0);
  for (const clause of all.split(/[,;&+]|\band\b/)) {
    const c = clause.trim();
    if (!c) continue;
    let v = dir(c);
    const isLras = /\blras\b|long[- ]run/.test(c), isSras = /\bsras\b|short[- ]run/.test(c), isAs = /\bas\b|aggregate supply/.test(c), isAd = /\bad\b|aggregate demand/.test(c);
    if ((isSras || isAs) && !isAd) v = /\bup(wards?)?\b/.test(c) ? -1 : /\bdown(wards?)?\b/.test(c) ? 1 : v;
    if (isAd && !out.ad) out.ad = v;
    if (isLras && !out.lras) out.lras = v;
    if ((isSras || (isAs && !isLras)) && !out.sras) out.sras = v;
  }
  return out;
}

export type AdAsModel = {
  keynesian: boolean;
  shifts: { ad: Dir; sras: Dir; lras: Dir };
  ad0: Lin; ad1: Lin;
  sras0?: Lin; sras1?: Lin;
  as0: AsCurve; as1: AsCurve;
  yf0: number; yf1: number;
  eq0: MPt; eq1: MPt;
  /** Equilibrium output minus full-employment output, at the final equilibrium (> 0: inflationary gap). */
  gap: number;
};

export function adAsModel(params: FigureParams): AdAsModel {
  const keynesian = /keynes/i.test(txt(params.model ?? params.as ?? params.type));
  const shifts = parseShifts(params);
  const size = num(params.shiftSize, 1.8, 0.6, 2.6);
  const gapWord = txt(params.gap).toLowerCase();
  const wantGap: Dir = /inflation|positive|boom/.test(gapWord) ? 1 : /deflation|recession|negative|spare/.test(gapWord) ? -1 : 0;
  let ad0: Lin, as0: AsCurve, as1: AsCurve, sras0: Lin | undefined, sras1: Lin | undefined;
  let yf0: number, yf1: number;
  if (keynesian) {
    // Default AD crosses the rising stretch; a deflationary gap puts it on the flat stretch.
    const target: MPt = wantGap < 0 ? { q: 2.2, p: K.p0 } : wantGap > 0 ? keynesianAs().y(1.8) : keynesianAs().y(1.5);
    ad0 = { a: target.p + AD_SLOPE * target.q, b: -AD_SLOPE };
    as0 = keynesianAs();
    // A Keynesian AS shift moves the whole curve (capacity), right or left.
    const asDir = shifts.sras || shifts.lras;
    as1 = keynesianAs(asDir * size);
    shifts.sras = asDir;
    shifts.lras = 0;
    yf0 = as0.yf;
    yf1 = as1.yf;
  } else {
    yf0 = 6;
    yf1 = yf0 + shifts.lras * size;
    sras0 = { a: 5.2 - SRAS_SLOPE * yf0, b: SRAS_SLOPE };
    sras1 = { a: sras0.a - SRAS_SLOPE * size * shifts.sras, b: SRAS_SLOPE };
    const yE = yf0 + wantGap * 1.3;
    ad0 = { a: at(sras0, yE) + AD_SLOPE * yE, b: -AD_SLOPE };
    as0 = { y: (t) => ({ q: t * 10.5, p: at(sras0!, t * 10.5) }), yf: yf0, lin: sras0 };
    as1 = { y: (t) => ({ q: t * 10.5, p: at(sras1!, t * 10.5) }), yf: yf1, lin: sras1 };
  }
  const ad1: Lin = { a: ad0.a + AD_SLOPE * size * shifts.ad, b: -AD_SLOPE };
  const meet = (ad: Lin, as: AsCurve): MPt => {
    if (as.lin) return cross(ad, as.lin)!;
    const t = root((t) => as.y(t).p - at(ad, as.y(t).q), 0, 3);
    return as.y(t);
  };
  const eq0 = meet(ad0, as0), eq1 = meet(ad1, as1);
  return { keynesian, shifts, ad0, ad1, sras0, sras1, as0, as1, yf0, yf1, eq0, eq1, gap: eq1.q - yf1 };
}

export const adAs: FigureComponent = {
  name: "adAs",
  title: "AD/AS diagram: price level against real GDP, aggregate demand, SRAS and LRAS (or Keynesian AS), equilibrium, shifts and output gaps",
  params: `model ("classical" — straight SRAS with vertical LRAS at full employment Yf, default — or "keynesian" — one AS curve: flat, rising, vertical at Yf), shift ("AD right", "SRAS left", "LRAS right", combined with commas, e.g. "AD right, SRAS right"; for the Keynesian model "AS right"), shiftSize (0.6–2.6, default 1.8), gap ("inflationary" or "deflationary"/"recessionary": places the starting equilibrium beyond or short of Yf), showGap (false hides the output gap). Code computes both equilibria and names the gap at the final equilibrium (output above Yf → inflationary gap, below → deflationary gap).`,
  match: /\b(aggregate (demand|supply)|AD\s*(\/|–|-|and)\s*AS|SRAS|LRAS|(inflationary|deflationary|recessionary|negative output|positive output|output) gaps?|macroeconomic equilibrium|demand[- ]pull inflation|cost[- ]push inflation|keynesian (AS|aggregate supply)|full[- ]employment (output|level of (real )?(GDP|output)))\b/i,
  parts: [
    { id: "ad", name: "Aggregate demand (AD)" },
    { id: "sras", name: "Short-run aggregate supply" },
    { id: "lras", name: "Long-run aggregate supply" },
    { id: "equilibrium", name: "Macroeconomic equilibrium" },
    { id: "new-curve", name: "New curve" },
    { id: "new-equilibrium", name: "New equilibrium" },
    { id: "output-gap", name: "Output gap" },
  ],
  build(params: FigureParams) {
    const m = adAsModel(params);
    const g = new EconGraph(10, 10, 470, 330);
    g.axes("Price level", txt(params.xLabel, 22) || "Real GDP");
    const parts: FigurePart[] = [];
    const blue = PALETTE.blue, red = PALETTE.red, green = PALETTE.green;
    const adLine = (l: Lin, part: string) => g.curve((t) => ({ q: t * 10.5, p: at(l, t * 10.5) }), { stroke: blue, width: 3, part }, 2);
    const shifted = m.shifts.ad !== 0 || m.shifts.sras !== 0 || m.shifts.lras !== 0;
    const sub = (on: boolean, n: number) => (on ? SUBS[n] : "");

    // LRAS (classical) first, so the curves are drawn over it.
    if (!m.keynesian) {
      const l0 = g.line({ q: m.yf0, p: 0 }, { q: m.yf0, p: 9.6 }, { stroke: green, width: 3, part: "lras" });
      g.curveLabel(l0, `LRAS${sub(!!m.shifts.lras, 1)}`, green, "end", { x: 0, y: -1 });
      parts.push({ id: "lras", name: m.shifts.lras ? "Original LRAS (LRAS₁)" : "Long-run aggregate supply", anchor: g.pt(m.yf0, 9.1) });
      g.xTick(m.yf0, `Yf${sub(!!m.shifts.lras, 1)}`, green);
      if (m.shifts.lras) {
        const l1 = g.line({ q: m.yf1, p: 0 }, { q: m.yf1, p: 9.6 }, { stroke: green, width: 3, part: "new-curve" });
        g.curveLabel(l1, `LRAS${SUBS[2]}`, green, "end", { x: 0, y: -1 });
        g.xTick(m.yf1, `Yf${SUBS[2]}`, green);
        g.shiftArrow({ q: m.yf0, p: 8.3 }, { q: m.yf1, p: 8.3 }, "ink", "new-curve");
      }
    }
    // AD.
    const a0 = adLine(m.ad0, "ad");
    g.curveLabel(a0, `AD${sub(!!m.shifts.ad, 1)}`, blue, "end", { x: 1, y: 0.3 });
    parts.push({ id: "ad", name: m.shifts.ad ? "Original AD (AD₁)" : "Aggregate demand (AD)", anchor: g.P({ q: Math.min(9.5, Math.max(0.3, qAt(m.ad0, 8.7))), p: at(m.ad0, Math.min(9.5, Math.max(0.3, qAt(m.ad0, 8.7)))) }) });
    if (m.shifts.ad) {
      const a1 = adLine(m.ad1, "new-curve");
      g.curveLabel(a1, `AD${SUBS[2]}`, blue, "end", { x: 1, y: 0.3 });
      // Between the two ADs, above and left of the first equilibrium (clear of AS and LRAS).
      const p = Math.min(9, at(m.ad0, Math.max(0.6, m.eq0.q - 2.4)));
      g.shiftArrow({ q: qAt(m.ad0, p) + 0.15 * m.shifts.ad, p }, { q: qAt(m.ad1, p) - 0.15 * m.shifts.ad, p }, "ink", "new-curve");
      const outward = m.shifts.ad > 0;
      // Low on the right when it moved out, high on the left when it moved in — and on the drawn stretch.
      const qA = Math.max(0.4, Math.min(9.5, qAt(m.ad1, outward ? 1.4 : 8.9)));
      parts.push({ id: "new-curve", name: outward ? "New AD (AD₂): increase" : "New AD (AD₂): decrease", anchor: g.P({ q: qA, p: at(m.ad1, qA) }) });
    }
    // Aggregate supply.
    const asName = m.keynesian ? "AS" : "SRAS";
    const s0 = g.curve(m.as0.y, { stroke: red, width: 3, part: "sras" }, m.keynesian ? 120 : 2, 0, m.keynesian ? 3 : 1);
    g.curveLabel(s0, `${asName}${sub(!!m.shifts.sras, 1)}`, red, "end", m.keynesian ? { x: 1, y: 0 } : { x: 1, y: -0.2 });
    const sAnchor = m.keynesian ? m.as0.y(1.22) : { q: Math.min(9.6, qAt(m.sras0!, 8.6)), p: at(m.sras0!, Math.min(9.6, qAt(m.sras0!, 8.6))) };
    const sLow = !m.keynesian && m.shifts.sras > 0 ? { q: 0.8, p: at(m.sras0!, 0.8) } : sAnchor;
    parts.push({ id: "sras", name: m.keynesian ? (m.shifts.sras ? "Original AS (AS₁)" : "Aggregate supply (AS)") : m.shifts.sras ? "Original SRAS (SRAS₁)" : "Short-run aggregate supply", anchor: g.P(sLow) });
    if (m.keynesian) {
      // The vertical stretch is full-employment output (the Keynesian LRAS).
      g.xTick(m.yf0, `Yf${sub(!!m.shifts.sras, 1)}`, green);
      parts.push({ id: "lras", name: "Full employment (vertical AS)", anchor: g.P(m.as0.y(2.75)) });
    }
    if (m.shifts.sras) {
      const s1 = g.curve(m.as1.y, { stroke: red, width: 3, part: "new-curve" }, m.keynesian ? 120 : 2, 0, m.keynesian ? 3 : 1);
      g.curveLabel(s1, `${asName}${SUBS[2]}`, red, "end", m.keynesian ? { x: 1, y: 0 } : { x: 1, y: -0.2 });
      if (m.keynesian) g.xTick(m.yf1, `Yf${SUBS[2]}`, green);
      const p = m.keynesian ? K.p0 + 0.01 : 7.2;
      const q0 = m.keynesian ? K.y1 * 0.7 : qAt(m.sras0!, p), q1 = m.keynesian ? q0 + m.shifts.sras * num(params.shiftSize, 1.8, 0.6, 2.6) : qAt(m.sras1!, p);
      g.shiftArrow({ q: q0 + 0.15 * m.shifts.sras, p: p + (m.keynesian ? 0.5 : 0) }, { q: q1 - 0.15 * m.shifts.sras, p: p + (m.keynesian ? 0.5 : 0) }, "ink", "new-curve");
      if (!m.shifts.ad) {
        const outward = m.shifts.sras > 0;
        const anchor = m.keynesian ? m.as1.y(1.3) : outward ? { q: Math.min(9.6, qAt(m.sras1!, 8.6)), p: at(m.sras1!, Math.min(9.6, qAt(m.sras1!, 8.6))) } : { q: 0.6, p: at(m.sras1!, 0.6) };
        parts.push({ id: "new-curve", name: `New ${asName} (${asName}₂): ${outward ? "increase" : "decrease"}`, anchor: g.P(anchor) });
      }
    }
    if (m.shifts.lras && !m.shifts.ad && !m.shifts.sras) parts.push({ id: "new-curve", name: `New LRAS (LRAS₂): ${m.shifts.lras > 0 ? "growth" : "decrease"}`, anchor: g.pt(m.yf1, 9.1) });

    // Equilibria (output ticks merge with Yf when they coincide).
    const near = (q: number, yf: number) => Math.abs(q - yf) < 0.06;
    const moved = Math.hypot(m.eq1.q - m.eq0.q, m.eq1.p - m.eq0.p) > 0.05;
    g.drop(m.eq0, moved ? `P${SUBS[1]}` : "Pe", near(m.eq0.q, m.yf0) ? "" : moved ? `Y${SUBS[1]}` : "Ye");
    g.dot(m.eq0, "ink", "equilibrium");
    parts.push({ id: "equilibrium", name: moved ? "Original equilibrium" : "Macroeconomic equilibrium", anchor: g.P(m.eq0) });
    if (moved) {
      g.drop(m.eq1, `P${SUBS[2]}`, near(m.eq1.q, m.yf1) || near(m.eq1.q, m.yf0) ? "" : `Y${SUBS[2]}`);
      g.dot(m.eq1, PALETTE.violet, "new-equilibrium");
      parts.push({ id: "new-equilibrium", name: "New equilibrium", anchor: g.P(m.eq1) });
    }
    // The output gap at the final equilibrium.
    const showGap = !/^(false|no|none|hide)$/i.test(txt(params.showGap ?? params.gap)) && params.showGap !== false;
    if (showGap && Math.abs(m.gap) > (m.keynesian ? 0.6 : 0.25) && !(m.keynesian && m.gap > 0)) {
      const word = m.gap > 0 ? "Inflationary gap" : /recession/i.test(txt(params.gap)) ? "Recessionary gap" : "Deflationary gap";
      const mid = g.span({ q: Math.min(m.eq1.q, m.yf1), p: 0 }, { q: Math.max(m.eq1.q, m.yf1), p: 0 }, PALETTE.amber, "output-gap", { x: 0, y: -16 });
      parts.push({ id: "output-gap", name: word, anchor: mid });
    }
    return g.finish(parts);
  },
};
