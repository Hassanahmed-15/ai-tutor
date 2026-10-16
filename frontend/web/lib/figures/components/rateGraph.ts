import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, PALETTE, num, optNum, str, bool, fmt } from "./mathsKit";

/**
 * RATE OF REACTION GRAPHS, computed. Each curve is first-order: product P(t) = F(1 − e^(−kt)), or
 * reactant R(t) = R₀e^(−kt). A faster condition (higher temperature, concentration, surface area, a
 * catalyst) has a larger k, so a steeper start and an earlier plateau; the final amount only changes
 * when the limiting reactant does (halved → half the product). A tangent's gradient is the exact
 * derivative, so the rate written on the board is the rate of the curve drawn.
 */

type Kind = "original" | "faster" | "slower";
export type RateCurve = { kind: Kind; label: string; k: number; final: number };
export type RateModel = {
  mode: "product" | "reactant";
  duration: number;
  amount: number;
  yMax: number;
  yMin: number;
  yStep: number;
  unit: string;
  timeUnit: string;
  quantity: string;
  curves: RateCurve[];
  end: number;
  value(c: RateCurve, t: number): number;
  gradient(c: RateCurve, t: number): number;
};

const FASTER = /\b(fast|faster|quick|steep|higher|increas|more|raise|hotter|warmer|catalys|powder|crushed|smaller (pieces|chips|lumps)|larger surface|greater surface|concentrated)/i;
const SLOWER = /\b(slow|slower|lower|decreas|less|cool|colder|larger (pieces|chips|lumps)|lumps|smaller surface|dilute)/i;

function parseCurves(v: unknown): Array<{ kind: Kind; label: string; scale: number }> {
  const text = typeof v === "string" && v.trim() ? v : "original; faster: higher temperature";
  const out: Array<{ kind: Kind; label: string; scale: number }> = [];
  for (const raw of text.split(/[;\n|]/).map((s) => s.trim()).filter(Boolean).slice(0, 3)) {
    const m = raw.match(/^(original|standard|control|first|reference|faster|steeper|quicker|slower)\s*[:=-]\s*(.*)$/i);
    const head = m ? m[1].toLowerCase() : "";
    const label = (m ? m[2] : raw).replace(/\((half|halved|double|doubled)\)/gi, "").trim().slice(0, 60);
    let kind: Kind = /fast|steep|quick/.test(head) ? "faster" : head === "slower" ? "slower" : m ? "original" : "original";
    if (!m) kind = /^(original|standard|control|reference|first)/i.test(label) ? "original" : SLOWER.test(label) && !/higher|increas|more/i.test(label) ? "slower" : FASTER.test(label) ? "faster" : "original";
    // The limiting reactant halved / doubled changes the final amount; nothing else does.
    const scale = /\b(half|halved|halve)\b/i.test(raw) ? 0.5 : /\b(double|doubled|twice)\b/i.test(raw) && /\b(amount|mass|moles?|volume|reactant|acid)\b/i.test(raw) ? 2 : 1;
    out.push({ kind, label: label || (kind === "original" ? "Original" : kind === "faster" ? "Faster" : "Slower"), scale });
  }
  if (!out.some((c) => c.kind === "original")) out.unshift({ kind: "original", label: "Original", scale: 1 });
  // One curve of each kind.
  return out.filter((c, i) => out.findIndex((o) => o.kind === c.kind) === i);
}

const nice = (x: number, quarter = true) => {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : quarter && f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};
const sig = (n: number, s = 2) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  const dp = Math.max(0, s - 1 - Math.floor(Math.log10(Math.abs(n))));
  return fmt(n, Math.min(dp, 4));
};

export function rateModel(params: FigureParams): RateModel {
  const what = String(params.y ?? params.measure ?? params.quantity ?? "").toLowerCase();
  const mode: "product" | "reactant" = /reactant|mass of (the )?(flask|reactant|marble|magnesium|calcium)|decrease|remaining|falls|concentration of (the )?(acid|reactant)/.test(what) && !/mass lost|loss/.test(what) ? "reactant" : "product";
  const duration = num(params.duration ?? params.time ?? params.tMax, 120, 5, 100000);
  const amount = num(params.final ?? params.amount ?? params.total, mode === "product" ? 60 : 50, 0.001, 1e7);
  const unit = str(params.unit ?? params.units, mode === "product" ? "cm³" : "g", 12).replace(/cm3/g, "cm³").replace(/dm3/g, "dm³");
  const timeUnit = str(params.timeUnit, "s", 6);
  const quantity = str(params.quantity, mode === "product" ? "Volume of gas" : "Mass of reactant", 40);
  // Reactant mode: falls from `final` (the start) towards `end` (0 for a reactant used up; the mass of
  // the flask and what is left when the y-axis is a flask's mass).
  const end = mode === "reactant" ? num(params.end ?? params.endValue, 0, 0, amount * 0.999) : 0;
  const k0 = Math.log(40) / (0.45 * duration);
  const curves = parseCurves(params.curves ?? params.conditions).map((c) => ({ kind: c.kind, label: c.label, k: c.kind === "faster" ? k0 * 2.2 : c.kind === "slower" ? k0 * 0.45 : k0, final: amount * c.scale }));
  // The y-axis: from 0, or (a flask's mass) from just below the lowest value reached.
  const lo = mode === "reactant" ? end : 0, hi = mode === "reactant" ? amount : Math.max(...curves.map((c) => c.final));
  const yStep = nice(((hi - lo) * 1.15) / 5, lo === 0);
  const yMin = lo > 0 && lo > (hi - lo) * 0.5 ? Math.max(0, Math.floor((lo - (hi - lo) * 0.15) / yStep) * yStep) : 0;
  const yMax = Math.ceil((yMin + (hi - yMin) * 1.12) / yStep) * yStep;
  return {
    mode, duration, amount, yMax, yMin, yStep, unit, timeUnit, quantity, curves, end,
    // Reactant: the loss (start − end) scales with the limiting reactant; product: the final amount does.
    value: (c, t) => (mode === "product" ? c.final * (1 - Math.exp(-c.k * t)) : amount - (amount - end) * (c.final / amount) * (1 - Math.exp(-c.k * t))),
    gradient: (c, t) => (mode === "product" ? 1 : -(amount - end) / amount) * c.final * c.k * Math.exp(-c.k * t),
  };
}

const COLOUR: Record<Kind, Ink> = { original: "ink", faster: PALETTE.red, slower: PALETTE.blue };
const PART: Record<Kind, string> = { original: "curve", faster: "steeper-curve", slower: "slower-curve" };

export const rateGraph: FigureComponent = {
  name: "rateGraph",
  title: "Rate of reaction graph: amount of product (or reactant) against time for different conditions, plateau, tangent gradient = rate, initial rate",
  params: `curves (up to 3, separated by ";": "original" plus "faster: <condition>" and/or "slower: <condition>", e.g. "original; faster: higher temperature; slower: lower concentration"; add "half" when the limiting reactant is halved, e.g. "slower: half the mass of magnesium (half)" — final amount then halves; default "original; faster: higher temperature"), y ("product" — default, rising — or "reactant", falling), quantity (y-axis quantity, e.g. "Volume of hydrogen", "Mass of flask"), unit (e.g. "cm³", "g"), final (final amount of product / starting amount of reactant, default 60), end (reactant mode: the value it falls to, e.g. the flask's final mass; default 0), duration (time axis length, default 120), timeUnit (default "s"), tangentAt (a time: draws the tangent there on the original curve and writes its gradient = rate), initialRate (true: draws the tangent at t = 0 and writes the initial rate). Code computes the curves, plateau and gradients.`,
  match: /\b(rates? of (a )?reactions? graphs?|rate graphs?|(volume|mass|amount) of (gas|product|hydrogen|carbon dioxide|oxygen)[^.]{0,30}(against|vs\.?|over) time|gradient of (the )?(curve|tangent)[^.]{0,30}rate|initial rate|tangent to the curve[^.]{0,30}rate|reaction (is )?(finished|complete)[^.]{0,20}(curve|graph|plateau))\b/i,
  parts: [
    { id: "curve", name: "Original reaction" },
    { id: "steeper-curve", name: "Faster reaction (steeper)" },
    { id: "slower-curve", name: "Slower reaction" },
    { id: "plateau", name: "Reaction finished" },
    { id: "tangent", name: "Tangent (gradient = rate)" },
    { id: "initial-rate", name: "Initial rate" },
  ],
  build(params: FigureParams) {
    const M = rateModel(params);
    const sk = new Sketch();
    const PW = 470, PH = 300;
    const X = (t: number) => (t / M.duration) * PW;
    const Y = (v: number) => -((v - M.yMin) / (M.yMax - M.yMin)) * PH;
    // Axes, ticks, titles.
    sk.line([{ x: 0, y: -PH - 18 }, { x: 0, y: 0 }, { x: PW + 18, y: 0 }], { stroke: "ink", width: 2.4 });
    sk.polygon([{ x: 0, y: -PH - 26 }, { x: -6, y: -PH - 14 }, { x: 6, y: -PH - 14 }], { fill: "ink", stroke: "ink", width: 1 });
    sk.polygon([{ x: PW + 26, y: 0 }, { x: PW + 14, y: -6 }, { x: PW + 14, y: 6 }], { fill: "ink", stroke: "ink", width: 1 });
    const tStep = nice(M.duration / 6), yStep = M.yStep;
    for (let t = 0; t <= M.duration + 1e-9; t += tStep) {
      sk.line([{ x: X(t), y: 0 }, { x: X(t), y: 6 }], { stroke: "ink", width: 1.6 }, false);
      sk.text({ x: X(t), y: 20 }, fmt(t, 2), 15, "ink");
    }
    for (let v = M.yMin + (M.yMin > 0 ? 0 : yStep); v <= M.yMax + 1e-9; v += yStep) {
      sk.line([{ x: -6, y: Y(v) }, { x: 0, y: Y(v) }], { stroke: "ink", width: 1.6 }, false);
      sk.text({ x: -12 - fmt(v, 2).length * 4.3, y: Y(v) }, fmt(v, 2), 15, "ink");
    }
    sk.text({ x: PW / 2, y: 46 }, `Time / ${M.timeUnit}`, 18, "ink");
    const yTitle = `${M.quantity} / ${M.unit}`;
    sk.text({ x: 4 + yTitle.length * 4.6, y: -PH - 34 }, yTitle, 18, "ink");

    // The curves, drawn as sampled polylines (exact values at every sample).
    const order: Kind[] = ["slower", "original", "faster"];
    const tEndO = Math.min(M.duration, Math.log(40) / M.curves.find((x) => x.kind === "original")!.k);
    const anchors: Record<string, Pt> = {};
    const names: Record<string, string> = {};
    for (const kind of order) {
      const c = M.curves.find((x) => x.kind === kind);
      if (!c) continue;
      const pts: Pt[] = [];
      for (let i = 0; i <= 120; i++) {
        const t = (i / 120) * M.duration;
        pts.push({ x: X(t), y: Y(M.value(c, t)) });
      }
      if (kind === "original") {
        // The flat end (reaction finished) is its own part: the plateau.
        const cut = pts.findIndex((q) => q.x >= X(tEndO));
        const split = cut > 1 ? cut : pts.length - 1;
        sk.line(pts.slice(0, split + 1), { stroke: COLOUR[kind], width: 3.2, part: PART[kind] });
        if (split < pts.length - 1) sk.line(pts.slice(split), { stroke: COLOUR[kind], width: 3.2, part: "plateau" });
      } else sk.line(pts, { stroke: COLOUR[kind], width: 2.8, dash: kind === "slower" ? "9 6" : undefined, part: PART[kind] });
      // Anchor on the rising (or falling) stretch, where curves are furthest apart.
      const tg = optNum(params.tangentAt ?? params.tangent);
      const tA = kind === "faster" ? 0.1 : kind === "original" ? (tg !== undefined && Math.abs(tg / M.duration - 0.2) < 0.1 ? (tg / M.duration > 0.2 ? 0.1 : 0.32) : 0.2) : 0.38;
      anchors[PART[kind]] = { x: X(tA * M.duration), y: Y(M.value(c, tA * M.duration)) };
      names[PART[kind]] = kind === "original" ? (/^(original|standard|control|reference|first)?$/i.test(c.label) ? "Original conditions" : c.label) : `${c.label[0].toUpperCase()}${c.label.slice(1)}`;
    }
    // Plateau: the original curve once the reaction has finished, with its final value marked.
    const o = M.curves.find((x) => x.kind === "original")!;
    const tEnd = Math.min(M.duration, Math.log(40) / o.k);
    anchors.plateau = { x: X(Math.min(M.duration * 0.92, tEnd + (M.duration - tEnd) * 0.6)), y: 0 };
    anchors.plateau.y = Y(M.value(o, (anchors.plateau.x / PW) * M.duration));
    names.plateau = "Reaction finished";
    if (M.mode === "product") {
      // The final amount on the axis: a dashed guide from the plateau.
      const fy = Y(o.final);
      sk.line([{ x: 0, y: fy }, { x: X(tEnd) * 0.95, y: fy }], { stroke: "muted", width: 1.2, dash: "4 5" }, false);
    }

    // Tangents: gradient = rate (exact derivative).
    const drawTangent = (c: RateCurve, t: number, part: "tangent" | "initial-rate") => {
      const v = M.value(c, t), g = M.gradient(c, t);
      const P = { x: X(t), y: Y(v) };
      // Pixel slope; extend both ways inside the plot.
      const slope = (g / (M.yMax - M.yMin)) * PH / (PW / M.duration);
      const span = part === "initial-rate" ? Math.min(PW * 0.42, (PH * 0.85) / Math.max(Math.abs(slope), 0.01)) : PW * 0.22;
      const clip = (dx: number) => {
        let d = dx;
        const yAt = (q: number) => P.y - slope * q;
        for (let k = 0; k < 40 && (yAt(d) < -PH || yAt(d) > 0 || P.x + d < 0 || P.x + d > PW); k++) d *= 0.9;
        return d;
      };
      const d1 = part === "initial-rate" ? 0 : clip(-span), d2 = clip(span);
      const A = { x: P.x + d1, y: P.y - slope * d1 }, B = { x: P.x + d2, y: P.y - slope * d2 };
      sk.line([A, B], { stroke: PALETTE.amber, width: 2.6, part });
      sk.circle(P, 4.5, { fill: PALETTE.amber, stroke: PALETTE.amber, width: 1, part }, false);
      // The gradient triangle under (or over) the tangent, with its two sides' values.
      const L = { x: P.x + d1 * 0.85 + (part === "initial-rate" ? d2 * 0.1 : 0), y: 0 }, R = { x: P.x + d2 * 0.85, y: 0 };
      L.y = P.y - slope * (L.x - P.x);
      R.y = P.y - slope * (R.x - P.x);
      const corner = g >= 0 ? { x: R.x, y: L.y } : { x: L.x, y: R.y };
      const triangle = part === "tangent";
      if (triangle) sk.line([L, corner, R], { stroke: PALETTE.amber, width: 1.5, dash: "5 4" }, false);
      const dv = Math.abs(((R.y - L.y) / PH) * (M.yMax - M.yMin)), dt = ((R.x - L.x) / PW) * M.duration;
      const rate = Math.abs(g);
      const midH = { x: (L.x + R.x) / 2, y: corner.y }, midV = { x: corner.x, y: (L.y + R.y) / 2 };
      if (triangle) {
        sk.placeText(`${sig(dt, 2)} ${M.timeUnit}`, 14, midH, { x: 0, y: g >= 0 ? 1 : -1 }, { min: 9, max: 40, fill: PALETTE.amber });
        sk.placeText(`${sig(dv, 2)} ${M.unit}`, 14, midV, { x: g >= 0 ? 1 : -1, y: 0 }, { min: 10, max: 70, fill: PALETTE.amber });
      }
      const text = `${part === "initial-rate" ? "initial rate" : "rate"} = ${sig(rate, 2)} ${M.unit}/${M.timeUnit}`;
      sk.placeText(text, 16, B, { x: 0.6, y: g >= 0 ? -1 : 1 }, { min: 14, max: 120, slide: { x: 1, y: 0 }, fill: PALETTE.amber });
      anchors[part] = { x: P.x + d2 * 0.8, y: P.y - slope * d2 * 0.8 };
      names[part] = part === "initial-rate" ? "Initial rate (tangent at 0)" : `Tangent at ${fmt(t, 2)} ${M.timeUnit}`;
    };
    const tangentT = optNum(params.tangentAt ?? params.tangent);
    const on = String(params.tangentOn ?? "original").toLowerCase();
    const tc = M.curves.find((c) => (/fast|steep/.test(on) ? c.kind === "faster" : /slow/.test(on) ? c.kind === "slower" : c.kind === "original")) ?? o;
    if (tangentT !== undefined && tangentT > 0 && tangentT < M.duration) drawTangent(tc, tangentT, "tangent");
    if (bool(params.initialRate, false)) drawTangent(o, 0, "initial-rate");

    for (const [id, p] of Object.entries(anchors)) sk.part(id, names[id], p);
    return sk.finish(14);
  },
};
