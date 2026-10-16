import type { FigureComponent, FigureParams, FigurePart, Ink } from "../types";
import { bool, fmt, optNum } from "./mathsKit";
import { EconGraph, PALETTE, SUBS, txt, type MPt } from "./econKit";

/**
 * PRODUCTION POSSIBILITY FRONTIER. One good up, the other across; the frontier bowed out from the
 * origin (increasing opportunity cost — a quarter ellipse) or straight (constant cost). Points on it
 * (efficient), inside it (unemployed or inefficiently used resources) and outside it (unattainable
 * now); an outward/inward shift of both intercepts or one; the opportunity cost of moving from A
 * to B measured on the vertical axis. Every point and amount is computed from the curve.
 */

export type PpfModel = {
  concave: boolean;
  X: number; Y: number;
  shift: { dir: 1 | -1 | 0; axis: "both" | "x" | "y"; X2: number; Y2: number };
  A: MPt; B: MPt; C: MPt; D: MPt;
  /** Y given up to gain (B.q − A.q) more X. */
  opportunityCost: number;
  /** Is a point attainable (on or inside) on the frontier with intercepts X, Y? */
  onOrInside: (m: MPt, X?: number, Y?: number) => boolean;
};

export function ppfModel(params: FigureParams): PpfModel {
  const shape = txt(params.shape ?? params.curve).toLowerCase();
  const concave = !/straight|linear|constant/.test(shape);
  const X = clampPos(optNum(params.maxX ?? params.xMax), 100), Y = clampPos(optNum(params.maxY ?? params.yMax), 100);
  const s = txt(params.shift).toLowerCase();
  const xGood = txt(params.xGood ?? params.goodX, 24).toLowerCase(), yGood = txt(params.yGood ?? params.goodY, 24).toLowerCase();
  const dir: 1 | -1 | 0 = !s || /^(none|no|false)$/.test(s) ? 0 : /\b(in(ward)?s?|left|contract|shrink|decrease|fall|down)\b/.test(s) ? -1 : 1;
  const mentionsX = /\b(x|horizontal)\b/.test(s) || (xGood && s.includes(xGood.split(/\s+/)[0]));
  const mentionsY = /\b(y|vertical)\b/.test(s) || (yGood && s.includes(yGood.split(/\s+/)[0]));
  const axis: "both" | "x" | "y" = /\bboth\b/.test(s) || (mentionsX && mentionsY) ? "both" : mentionsX ? "x" : mentionsY ? "y" : "both";
  const k = dir > 0 ? 1.3 : dir < 0 ? 0.72 : 1;
  const X2 = axis === "y" ? X : X * k, Y2 = axis === "x" ? Y : Y * k;
  const yOn = (x: number, XX = X, YY = Y) => (concave ? YY * Math.sqrt(Math.max(0, 1 - (x / XX) ** 2)) : YY * Math.max(0, 1 - x / XX));
  const xa = Math.round(X * 0.35 * 10) / 10, xb = Math.round(X * 0.72 * 10) / 10;
  const A = { q: xa, p: yOn(xa) }, B = { q: xb, p: yOn(xb) };
  const C = { q: X * 0.38, p: Y * 0.36 };
  const D = { q: X * 0.78, p: Y * 0.8 };
  const onOrInside = (m: MPt, XX = X, YY = Y) => (concave ? (m.q / XX) ** 2 + (m.p / YY) ** 2 : m.q / XX + m.p / YY) <= 1 + 1e-9;
  return { concave, X, Y, shift: { dir, axis, X2, Y2 }, A, B, C, D, opportunityCost: A.p - B.p, onOrInside };
}
const clampPos = (n: number | undefined, d: number) => (n !== undefined && n > 0 ? Math.min(n, 1e7) : d);

export const ppf: FigureComponent = {
  name: "ppf",
  title: "Production possibility frontier (PPF/PPC): two goods, the frontier, points on, inside and outside it, shifts, opportunity cost",
  params: `xGood (horizontal axis, default "Consumer goods"), yGood (vertical axis, default "Capital goods"), shape ("concave" — bowed out, increasing opportunity cost, default — or "straight", constant cost), maxX / maxY (the frontier's intercepts, e.g. 100 and 50: axis values and the opportunity cost are then written), points (which to show, any of "A, B, C, D": A and B on the frontier, C inside — unemployment / inefficiency, D outside — unattainable; default all four), shift ("outward", "inward", "outward x" / "outward <good>" for one axis only; default none), opportunityCost (true: mark the vertical-axis amount given up moving from A to B).`,
  match: /\b(production possibilit(y|ies) (frontier|curve|boundary|diagram)s?|PPF|PPC|PPB|opportunity cost(s)? (of|between|curve)|economic growth.*\b(frontier|PPC|PPF)|scarcity and choice)\b/i,
  parts: [
    { id: "curve", name: "Production possibility frontier" },
    { id: "point-on", name: "Point A (efficient)" },
    { id: "point-on-b", name: "Point B (efficient)" },
    { id: "point-inside", name: "Point C (unemployed resources)" },
    { id: "point-outside", name: "Point D (unattainable)" },
    { id: "shift", name: "New frontier (PPF₂)" },
    { id: "opportunity-cost", name: "Opportunity cost" },
  ],
  build(params: FigureParams) {
    const m = ppfModel(params);
    const xGood = txt(params.xGood ?? params.goodX, 24) || "Consumer goods";
    const yGood = txt(params.yGood ?? params.goodY, 24) || "Capital goods";
    const pts = txt(params.points).toUpperCase();
    const want = (L: string) => !pts || /^ALL$/.test(pts) || new RegExp(`\\b${L}\\b`).test(pts) || (L === "C" && /INSIDE/.test(pts)) || (L === "D" && /OUTSIDE/.test(pts)) || ((L === "A" || L === "B") && /\bON\b/.test(pts));
    const valued = optNum(params.maxX ?? params.xMax) !== undefined || optNum(params.maxY ?? params.yMax) !== undefined;
    const oc = bool(params.opportunityCost ?? params.showOpportunityCost, false);
    const xMax = Math.max(m.X, m.shift.X2) * 1.12, yMax = Math.max(m.Y, m.shift.Y2) * 1.12;
    const g = new EconGraph(xMax, yMax, 430, 340);
    g.axes(yGood, xGood);
    const parts: FigurePart[] = [];
    const frontier = (X: number, Y: number, part: string, colour: `#${string}`, dash?: string) =>
      m.concave
        ? g.curve((t) => ({ q: X * Math.sin((t * Math.PI) / 2), p: Y * Math.cos((t * Math.PI) / 2) }), { stroke: colour, width: 3.2, part, dash }, 72)
        : g.line({ q: 0, p: Y }, { q: X, p: 0 }, { stroke: colour, width: 3.2, part, dash });
    const c1 = frontier(m.X, m.Y, "curve", PALETTE.blue);
    const shifted = m.shift.dir !== 0;
    const at = (X: number, Y: number, f: number): MPt => (m.concave ? { q: X * Math.sin(f * Math.PI / 2), p: Y * Math.cos(f * Math.PI / 2) } : { q: X * f, p: Y * (1 - f) });
    g.curveLabel(c1, shifted ? `PPF${SUBS[1]}` : "PPF", PALETTE.blue, "end", { x: 0.5, y: -1 });
    parts.push({ id: "curve", name: shifted ? "Original frontier (PPF₁)" : "Production possibility frontier", anchor: g.P(at(m.X, m.Y, shifted && m.shift.dir > 0 ? 0.13 : 0.78)) });
    if (shifted) {
      const c2 = frontier(m.shift.X2, m.shift.Y2, "shift", PALETTE.violet);
      g.curveLabel(c2, `PPF${SUBS[2]}`, PALETTE.violet, "end", { x: 0.5, y: -1 });
      const f = 0.5;
      const from = at(m.X, m.Y, f), to = at(m.shift.X2, m.shift.Y2, f);
      g.shiftArrow(from, to, "ink", "shift");
      const growth = m.shift.dir > 0;
      parts.push({ id: "shift", name: growth ? "New frontier (PPF₂): growth" : "New frontier (PPF₂): inward", anchor: g.P(at(m.shift.X2, m.shift.Y2, growth ? 0.82 : 0.2)) });
    }
    if (valued) {
      g.yTick(m.Y, fmt(m.Y, 1));
      g.xTick(m.X, fmt(m.X, 1));
    }
    // Points: A and B on the frontier, C inside, D outside.
    const point = (L: string, pt: MPt, colour: Ink, part: string, name: string, dirs: Array<{ x: number; y: number }>) => {
      g.dot(pt, colour, part, 5.5);
      g.sk.placeLetter(L, 21, g.P(pt), dirs, { fill: colour, min: 12, max: 40 });
      parts.push({ id: part, name, anchor: g.P(pt) });
    };
    const ne = [{ x: 1, y: -1 }, { x: 1, y: 0 }, { x: 0, y: -1 }], sw = [{ x: -1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
    if (oc && want("A") && want("B")) {
      g.drop(m.A, valued ? fmt(m.A.p, 1) : null, valued ? fmt(m.A.q, 1) : null);
      g.drop(m.B, valued ? fmt(m.B.p, 1) : null, valued ? fmt(m.B.q, 1) : null);
      // The amount of the vertical good given up: a bracket beside the vertical axis.
      const mid = g.span({ q: 0, p: m.A.p }, { q: 0, p: m.B.p }, PALETTE.red, "opportunity-cost", { x: 14, y: 0 });
      const gainMid = g.span({ q: m.A.q, p: 0 }, { q: m.B.q, p: 0 }, PALETTE.green, "opportunity-cost", { x: 0, y: -14 });
      void gainMid;
      const amount = valued ? `${fmt(m.opportunityCost, 1)} ${yGood.toLowerCase()}` : yGood.toLowerCase();
      parts.push({ id: "opportunity-cost", name: `Opportunity cost: ${amount}`.slice(0, 34), anchor: mid });
    } else if (valued) {
      // values for the points when the opportunity cost is not drawn are left off (keeps the axes clean)
    }
    if (want("A")) point("A", m.A, "ink", "point-on", "Point A (efficient)", ne);
    if (want("B")) point("B", m.B, "ink", "point-on-b", "Point B (efficient)", ne);
    if (want("C")) point("C", m.C, PALETTE.amber, "point-inside", "Point C (unemployed resources)", sw);
    if (want("D")) point("D", m.D, PALETTE.red, "point-outside", shifted && m.shift.dir > 0 && m.onOrInside(m.D, m.shift.X2, m.shift.Y2) ? "Point D (attainable after growth)" : "Point D (unattainable)", ne);
    return g.finish(parts);
  },
};
