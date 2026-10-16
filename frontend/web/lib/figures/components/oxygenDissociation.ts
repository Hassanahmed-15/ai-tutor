import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, fmt, num, optNum, bool } from "./mathsKit";
import { drawFrame, dashed, type Scale } from "./statsKit";
import { chemArrow } from "./glucoseRings";

/**
 * THE OXYGEN DISSOCIATION CURVE, COMPUTED. Haemoglobin's % saturation at each partial pressure of
 * oxygen follows the Hill equation S = 100·pⁿ / (pⁿ + P50ⁿ) — n ≈ 2.8 gives the sigmoid of
 * cooperative binding, P50 the pO₂ at half saturation. The Bohr shift is the same curve with a larger
 * P50 (more CO₂ → lower affinity → curve to the right); fetal haemoglobin has a smaller P50 (curve to
 * the left); myoglobin binds one O₂ (n = 1), a hyperbola far to the left. Every point, every value
 * written on the graph and every marker's saturation is read off these equations.
 */

export type DissociationCurve = { id: "hb-curve" | "bohr-curve" | "fetal-curve" | "myoglobin-curve"; n: number; p50: number };

/** % saturation at partial pressure p (kPa) for a curve with Hill coefficient n and half-saturation P50. */
export function saturation(p: number, n: number, p50: number): number {
  if (!(p > 0)) return 0;
  const r = Math.pow(p / p50, n);
  return Number.isFinite(r) ? (100 * r) / (1 + r) : 100;
}
/** The pO₂ (kPa) at which a curve reaches saturation s (%). */
export function pressureAt(s: number, n: number, p50: number): number {
  const f = Math.min(99.999, Math.max(0.001, s)) / 100;
  return p50 * Math.pow(f / (1 - f), 1 / n);
}

export type DissociationModel = {
  hb: DissociationCurve;
  bohr?: DissociationCurve;
  fetal?: DissociationCurve;
  myoglobin?: DissociationCurve;
  lungs?: number;
  tissues?: number;
  half: boolean;
};

/** A marker param: true → the default pressure, a number → that pressure, false/absent → none. */
function marker(v: unknown, fallback: number, on: boolean): number | undefined {
  const n = optNum(v);
  if (n !== undefined) return n > 0 && n <= 14 ? n : n > 14 ? 14 : undefined;
  return bool(v, on) ? fallback : undefined;
}

export function dissociationModel(params: FigureParams): DissociationModel {
  const n = num(params.n ?? params.hill, 2.8, 1, 4);
  const p50 = num(params.p50 ?? params.P50, 3.5, 1, 8);
  const bohr = bool(params.bohr ?? params.bohrShift ?? params.co2, false);
  const fetal = bool(params.fetal ?? params.foetal, false);
  const myo = bool(params.myoglobin, false);
  const comparing = bohr || fetal || myo;
  // Lungs and tissues are marked by default on a single curve; asked for explicitly on a comparison.
  return {
    hb: { id: "hb-curve", n, p50 },
    bohr: bohr ? { id: "bohr-curve", n, p50: Math.min(10, p50 + num(params.shift ?? params.bohrP50Shift, 1.6, 0.5, 4)) } : undefined,
    fetal: fetal ? { id: "fetal-curve", n, p50: Math.max(0.8, p50 - num(params.fetalShift, 1.0, 0.3, 2.5)) } : undefined,
    myoglobin: myo ? { id: "myoglobin-curve", n: 1, p50: num(params.myoglobinP50, 0.37, 0.1, 1.5) } : undefined,
    lungs: marker(params.lungs, 12, !comparing),
    tissues: marker(params.tissues ?? params.muscle, 3, !comparing),
    half: bool(params.p50Marker ?? params.half ?? params.halfSaturation, false),
  };
}

const COLOUR: Record<DissociationCurve["id"], Ink> = { "hb-curve": "ink", "bohr-curve": "#be123c", "fetal-curve": "#6d28d9", "myoglobin-curve": "#16a34a" };
const MARK: Ink = "#2563eb";

export const oxygenDissociation: FigureComponent = {
  name: "oxygenDissociation",
  title: "Oxygen dissociation curve: % saturation of haemoglobin against partial pressure of oxygen (kPa), sigmoid, with the Bohr shift, fetal haemoglobin and myoglobin curves and the saturation in the lungs and tissues read off the curve",
  params: `bohr (true: adds the curve for higher pCO₂, shifted right, with the Bohr shift arrow; default false), fetal (true: adds fetal haemoglobin, shifted left; default false), myoglobin (true: adds myoglobin's hyperbolic curve; default false), lungs (pO₂ in the lungs, kPa — true means 12; marked by default when no comparison curve is asked for), tissues (pO₂ in respiring tissues, kPa — true means 3; marked likewise), p50Marker (true: marks 50% saturation and its pO₂), n (Hill coefficient, default 2.8), p50 (adult P50 in kPa, default 3.5). Every curve and every saturation written on the graph is computed from the Hill equation — never give values.`,
  match: /\b(oxygen|oxy-?ha?emoglobin|ha?emoglobin)[- ](dissociation|saturation|binding) curves?\b|\bdissociation curves?\b(?=[\s\S]{0,80}\b(oxygen|ha?emoglobin|O₂|O2|myoglobin)\b)|\boxygen dissociation\b|\bBohr (effect|shift)\b|\b(fetal|foetal) ha?emoglobin\b|\baffinity (of ha?emoglobin )?for oxygen\b|\bha?emoglobin'?s? affinity\b|\b(loading|unloading) (of )?oxygen\b|\bsaturation of ha?emoglobin\b|\bpercentage saturation\b(?=[\s\S]{0,60}\bha?emoglobin\b)|\bpartial pressure of oxygen\b(?=[\s\S]{0,80}\b(ha?emoglobin|saturation)\b)|\bcooperative binding\b(?=[\s\S]{0,60}\boxygen\b)/i,
  parts: [
    { id: "hb-curve", name: "Adult haemoglobin" },
    { id: "bohr-curve", name: "Higher pCO₂ (Bohr shift)" },
    { id: "bohr-shift", name: "Bohr shift: curve moves right" },
    { id: "fetal-curve", name: "Fetal haemoglobin" },
    { id: "myoglobin-curve", name: "Myoglobin" },
    { id: "lungs", name: "In the lungs" },
    { id: "tissues", name: "In respiring tissues" },
    { id: "p50", name: "50% saturation (P50)" },
    { id: "steep-part", name: "Steep part of the curve" },
  ],
  build(params: FigureParams) {
    const M = dissociationModel(params);
    const sk = new Sketch();
    const W = 470, H = 300;
    const xs: Scale = { lo: 0, hi: 14, step: 2, ticks: [0, 2, 4, 6, 8, 10, 12, 14], dp: 0 };
    const ys: Scale = { lo: 0, hi: 100, step: 20, ticks: [0, 20, 40, 60, 80, 100], dp: 0 };
    const fr = drawFrame(sk, { w: W, h: H, x: xs, y: ys, xTitle: "Partial pressure of oxygen / kPa", yTitle: M.myoglobin ? "Saturation with oxygen / %" : "Saturation of haemoglobin with oxygen / %" });
    const at = (p: number, c: DissociationCurve): Pt => ({ x: fr.X(p), y: fr.Y(saturation(p, c.n, c.p50)) });
    const curves = [M.myoglobin, M.fetal, M.hb, M.bohr].filter((c): c is DissociationCurve => Boolean(c));
    for (const c of curves) {
      const pts: Pt[] = [];
      for (let i = 0; i <= 280; i++) pts.push(at((i / 280) * 14, c));
      sk.line(pts, { stroke: COLOUR[c.id], width: c.id === "hb-curve" ? 3.4 : 3, part: c.id, dash: c.id === "myoglobin-curve" ? "10 6" : undefined });
    }
    // The steep part (20–80 % saturated): a soft band along the adult curve.
    if (bool(params.steep ?? params.steepPart, false)) {
      const p0 = pressureAt(20, M.hb.n, M.hb.p50), p1 = pressureAt(80, M.hb.n, M.hb.p50);
      const pts: Pt[] = [];
      for (let i = 0; i <= 60; i++) pts.push(at(p0 + ((p1 - p0) * i) / 60, M.hb));
      sk.line(pts, { stroke: "#d97706", width: 12, opacity: 0.3, part: "steep-part" }, false);
      sk.part("steep-part", "Steep part of the curve", at((p0 + p1) / 2, M.hb));
    }
    // Reading lines: from the pO₂ on the x-axis up to the curve, across to the saturation.
    // The saturation read off is written just inside the y-axis, on its reading line.
    const reading = (p: number, c: DissociationCurve, part: string, colour: Ink, vertical = true) => {
      const P = at(p, c);
      dashed(sk, vertical ? [{ x: P.x, y: H }, P, { x: 0, y: P.y }] : [P, { x: 0, y: P.y }], colour, part, 1.8);
      sk.circle(P, 5.5, { fill: colour, stroke: colour, width: 1, part }, false);
      const s = saturation(p, c.n, c.p50);
      sk.placeText(`${fmt(s, 0)}%`, 16, { x: 26, y: P.y - 11 }, { x: 0, y: -1 }, { fill: colour, part, min: 0, max: 14, slide: { x: 1, y: 0 } });
      return { P, s };
    };
    if (M.half) {
      const p = M.hb.p50;
      const { P } = reading(p, M.hb, "p50", "#d97706");
      sk.placeText(`${fmt(p, 1)} kPa`, 15, { x: P.x, y: H - 14 }, { x: 1, y: 0 }, { fill: "#d97706", part: "p50", min: 26, max: 80 });
      sk.part("p50", `P50 = ${fmt(p, 1)} kPa (50%)`, P);
    }
    if (M.lungs !== undefined) {
      const { P, s } = reading(M.lungs, M.hb, "lungs", MARK);
      sk.part("lungs", `Lungs: ${fmt(M.lungs, 1)} kPa, ${fmt(s, 0)}% saturated`, { x: P.x + 4, y: P.y - 4 });
    }
    if (M.tissues !== undefined) {
      const { P, s } = reading(M.tissues, M.hb, "tissues", "#d97706");
      if (M.tissues !== 2 * Math.round(M.tissues / 2)) sk.placeText(`${fmt(M.tissues, 1)}`, 14, { x: P.x, y: H + 19 }, { x: 0, y: 1 }, { fill: "#d97706", part: "tissues", min: 0, max: 20 });
      sk.part("tissues", `Tissues: ${fmt(M.tissues, 1)} kPa, ${fmt(s, 0)}% saturated`, { x: P.x - 4, y: P.y + 4 });
      // With the Bohr curve: how much less saturated haemoglobin is at the same pO₂ (more O₂ unloaded).
      if (M.bohr) {
        reading(M.tissues, M.bohr, "bohr-curve", "#be123c", false);
      }
    }
    // The Bohr shift: an arrow from the adult curve to the high-CO₂ curve at 60 % saturation.
    if (M.bohr) {
      const s = 60;
      const a = { x: fr.X(pressureAt(s, M.hb.n, M.hb.p50)) + 7, y: fr.Y(s) }, b = { x: fr.X(pressureAt(s, M.bohr.n, M.bohr.p50)) - 7, y: fr.Y(s) };
      chemArrow(sk, a, b, { stroke: "#be123c", width: 2.6, part: "bohr-shift", head: 11 });
      sk.part("bohr-shift", "Bohr shift: curve moves right", { x: (a.x + b.x) / 2, y: a.y });
    }
    // Curve anchors where each curve stands clear of the others: the left-shifted curves low down
    // (reached from the left), adult haemoglobin high on its right (nothing lies to its right there).
    const comparing = Boolean(M.fetal || M.myoglobin);
    for (const c of curves) {
      const p = c.id === "hb-curve" && comparing ? 7.5
        : Math.min(13.5, pressureAt(c.id === "myoglobin-curve" ? 55 : c.id === "fetal-curve" ? 30 : c.id === "bohr-curve" ? 35 : M.tissues !== undefined || M.bohr ? 76 : 30, c.n, c.p50));
      const name = c.id === "hb-curve" ? (comparing ? "Adult haemoglobin" : M.bohr ? "Haemoglobin (normal pCO₂)" : "Haemoglobin") : c.id === "bohr-curve" ? "Higher pCO₂ (Bohr shift)" : c.id === "fetal-curve" ? "Fetal haemoglobin" : "Myoglobin";
      sk.part(c.id, name, at(p, c));
    }
    return sk.finish(16, { w: 560, h: 260 });
  },
};
