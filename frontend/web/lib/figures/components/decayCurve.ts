import type { FigureComponent, FigureParams, Pt } from "../types";
import { Sketch, PALETTE, num, optNum, str, fmt } from "./mathsKit";

/**
 * RADIOACTIVE DECAY CURVE, computed: N = B + (N₀ − B)·(½)^(t/T½). The dashed construction lines sit
 * at each halving of the (background-corrected) value, so the half-life read off the graph is the
 * half-life the curve was drawn with; a reading at any time is the curve's exact value there.
 */

export type DecayModel = { n0: number; halfLife: number; background: number; halfLives: number; tMax: number; unit: string; timeUnit: string; quantity: string; value(t: number): number };

const UNIT_FOR: Array<[RegExp, string, string]> = [
  [/count/, "Count rate", "counts/min"],
  [/mass/, "Mass", "g"],
  [/nucle|atoms|number/, "Number of undecayed nuclei", ""],
  [/activ/, "Activity", "Bq"],
];

export function decayModel(params: FigureParams): DecayModel {
  const q = String(params.quantity ?? params.y ?? "activity").toLowerCase();
  const [qName, qUnit] = (UNIT_FOR.find(([re]) => re.test(q)) ?? UNIT_FOR[3]).slice(1) as [string, string];
  const n0 = num(params.initial ?? params.n0 ?? params.start ?? params.initialActivity, 800, 1e-6, 1e12);
  const halfLife = num(params.halfLife ?? params.halflife ?? params.T, 2, 1e-6, 1e9);
  const background = num(params.background ?? params.backgroundCount, 0, 0, n0 * 0.4);
  const halfLives = Math.round(num(params.halfLives ?? params.show ?? params.n, 3, 1, 4));
  const tMax = Math.max(4, halfLives + 1) * halfLife;
  const unit = str(params.unit ?? params.units, qUnit, 14);
  const timeUnit = str(params.timeUnit ?? params.timeUnits, "hours", 10);
  const quantity = str(params.quantityName ?? params.axisLabel, qName, 34);
  return { n0, halfLife, background, halfLives, tMax, unit, timeUnit, quantity, value: (t) => background + (n0 - background) * Math.pow(0.5, t / halfLife) };
}

const nice = (x: number) => {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};
const val = (n: number) => (Math.abs(n) >= 100 ? fmt(n, 0) : Math.abs(n) >= 10 ? fmt(n, 1) : fmt(n, 2));
const withUnit = (n: number, u: string) => (u ? `${val(n)} ${u}` : val(n));

export const decayCurve: FigureComponent = {
  name: "decayCurve",
  title: "Radioactive decay curve: activity (count rate, mass or nuclei) against time, halving every half-life, construction lines, readings, background",
  params: `halfLife (number, default 2), timeUnit (e.g. "hours" — default, "days", "minutes", "s", "years"), initial (value at t = 0, default 800), quantity ("activity" — default, Bq; "count rate" — counts/min; "mass" — g; "nuclei" — number of undecayed nuclei), unit (overrides the unit), halfLives (1-4 half-lives marked with dashed construction lines, default 3), readAt (a time: reads the value off the curve there), background (background count rate: the curve levels off at it and the halvings are of the corrected count). Code computes every value: N = background + (initial − background)·(1/2)^(t/halfLife).`,
  match: /\b(half[- ]li(fe|ves)|radioactive decay (curve|graph)|decay curves?|activity (against|vs\.?|over|with) time|count rate (against|vs\.?|over|with) time|radioactive decay|exponential decay of (activity|nuclei))\b/i,
  parts: [
    { id: "curve", name: "Decay curve" },
    { id: "initial-value", name: "Initial value" },
    { id: "half-life", name: "One half-life" },
    { id: "half-value", name: "Half the initial value" },
    { id: "after-n", name: "After n half-lives" },
    { id: "reading", name: "Reading from the curve" },
    { id: "background", name: "Background count" },
  ],
  build(params: FigureParams) {
    const M = decayModel(params);
    const sk = new Sketch();
    const PW = 480, PH = 300;
    const yStep = nice((M.n0 * 1.08) / 5);
    const yMax = Math.ceil((M.n0 * 1.08) / yStep) * yStep;
    const X = (t: number) => (t / M.tMax) * PW;
    const Y = (v: number) => -(v / yMax) * PH;
    sk.line([{ x: 0, y: -PH - 18 }, { x: 0, y: 0 }, { x: PW + 18, y: 0 }], { stroke: "ink", width: 2.4 });
    sk.polygon([{ x: 0, y: -PH - 26 }, { x: -6, y: -PH - 14 }, { x: 6, y: -PH - 14 }], { fill: "ink", stroke: "ink", width: 1 });
    sk.polygon([{ x: PW + 26, y: 0 }, { x: PW + 14, y: -6 }, { x: PW + 14, y: 6 }], { fill: "ink", stroke: "ink", width: 1 });
    sk.text({ x: PW / 2, y: 46 }, `Time / ${M.timeUnit}`, 18, "ink");
    const yTitle = M.unit ? `${M.quantity} / ${M.unit}` : M.quantity;
    sk.text({ x: 4 + yTitle.length * 4.6, y: -PH - 34 }, yTitle, 18, "ink");

    // Time ticks at every half-life.
    const nT = Math.round(M.tMax / M.halfLife);
    for (let k = 0; k <= nT; k++) {
      sk.line([{ x: X(k * M.halfLife), y: 0 }, { x: X(k * M.halfLife), y: 6 }], { stroke: "ink", width: 1.6 }, false);
      sk.text({ x: X(k * M.halfLife), y: 20 }, val(k * M.halfLife), 15, "ink");
    }
    // Value ticks; the construction levels are written in amber and displace any tick label too close.
    const levels = Array.from({ length: M.halfLives + 1 }, (_, n) => M.value(n * M.halfLife));
    const yLabels: Array<{ y: number; text: string; amber: boolean }> = levels.slice(1).map((v) => ({ y: Y(v), text: val(v), amber: true }));
    for (let v = yStep; v <= yMax + 1e-9; v += yStep) {
      sk.line([{ x: -6, y: Y(v) }, { x: 0, y: Y(v) }], { stroke: "ink", width: 1.6 }, false);
      if (yLabels.every((l) => Math.abs(l.y - Y(v)) > 15)) yLabels.push({ y: Y(v), text: val(v), amber: false });
    }
    if (yLabels.every((l) => Math.abs(l.y - Y(M.n0)) > 15)) yLabels.push({ y: Y(M.n0), text: val(M.n0), amber: true });
    // Amber labels that crowd each other (late halvings near the axis) are thinned, keeping the earlier one.
    const kept: typeof yLabels = [];
    for (const l of yLabels.sort((a, b) => Number(b.amber) - Number(a.amber))) if (kept.every((k) => Math.abs(k.y - l.y) > 15)) kept.push(l);
    // Tick values left of the axis; the construction values just inside it, above their dashed line,
    // where a label's leader (which runs along that line) does not cross them.
    for (const l of kept) {
      if (l.amber) sk.text({ x: 8 + l.text.length * 4.4, y: l.y - 11 }, l.text, 15, PALETTE.amber);
      else sk.text({ x: -12 - l.text.length * 4.4, y: l.y }, l.text, 15, "ink");
    }

    // Background level.
    const anchors: Record<string, Pt> = {};
    const names: Record<string, string> = {};
    if (M.background > 0) {
      sk.line([{ x: 0, y: Y(M.background) }, { x: PW, y: Y(M.background) }], { stroke: PALETTE.blue, width: 2, dash: "8 6", part: "background" }, false);
      anchors.background = { x: PW * 0.94, y: Y(M.background) };
      names.background = `Background (${withUnit(M.background, M.unit)})`;
    }
    // Construction lines: across from each halved level to the curve, then down to the time axis.
    for (let n = 1; n <= M.halfLives; n++) {
      const t = n * M.halfLife, p = { x: X(t), y: Y(levels[n]) };
      sk.line([{ x: 0, y: p.y }, p, { x: p.x, y: 0 }], { stroke: PALETTE.amber, width: 1.6, dash: "6 5" }, false);
      sk.circle(p, 4.5, { fill: PALETTE.amber, stroke: PALETTE.amber, width: 1, part: n === 1 ? "half-value" : n === M.halfLives ? "after-n" : undefined }, false);
    }
    // The curve.
    const pts: Pt[] = [];
    for (let i = 0; i <= 160; i++) {
      const t = (i / 160) * M.tMax;
      pts.push({ x: X(t), y: Y(M.value(t)) });
    }
    sk.line(pts, { stroke: "ink", width: 3.2, part: "curve" });
    sk.circle({ x: 0, y: Y(M.n0) }, 5, { fill: PALETTE.red, stroke: PALETTE.red, width: 1, part: "initial-value" }, false);
    // One half-life: a double arrow along the time axis from 0 to T½, just above it.
    const ay = -14;
    sk.line([{ x: 6, y: ay }, { x: X(M.halfLife) - 6, y: ay }], { stroke: PALETTE.violet, width: 2.2, part: "half-life" }, false);
    sk.polygon([{ x: 0, y: ay }, { x: 10, y: ay - 5 }, { x: 10, y: ay + 5 }], { fill: PALETTE.violet, stroke: PALETTE.violet, width: 1, part: "half-life" }, false);
    sk.polygon([{ x: X(M.halfLife), y: ay }, { x: X(M.halfLife) - 10, y: ay - 5 }, { x: X(M.halfLife) - 10, y: ay + 5 }], { fill: PALETTE.violet, stroke: PALETTE.violet, width: 1, part: "half-life" }, false);
    sk.placeText(`T½ = ${val(M.halfLife)} ${M.timeUnit}`, 15, { x: X(M.halfLife) / 2, y: ay }, { x: 0, y: -1 }, { min: 13, max: 60, slide: { x: 1, y: 0 }, fill: PALETTE.violet, part: "half-life" });

    anchors.curve = { x: X(M.tMax * 0.82), y: Y(M.value(M.tMax * 0.82)) };
    names.curve = "Decay curve";
    anchors["initial-value"] = { x: 0, y: Y(M.n0) };
    names["initial-value"] = `Initial: ${withUnit(M.n0, M.unit)}`;
    anchors["half-life"] = { x: X(M.halfLife) - 4, y: ay };
    names["half-life"] = `One half-life (${val(M.halfLife)} ${M.timeUnit})`;
    anchors["half-value"] = { x: X(M.halfLife), y: Y(levels[1]) };
    names["half-value"] = `Halved: ${withUnit(levels[1], M.unit)}`;
    if (M.halfLives >= 2) {
      anchors["after-n"] = { x: X(M.halfLives * M.halfLife), y: Y(levels[M.halfLives]) };
      names["after-n"] = `${M.halfLives} half-lives: ${withUnit(levels[M.halfLives], M.unit)}`;
    }
    // A reading at any time.
    const tr = optNum(params.readAt ?? params.reading ?? params.at);
    if (tr !== undefined && tr > 0 && tr <= M.tMax) {
      const v = M.value(tr), p = { x: X(tr), y: Y(v) };
      sk.line([{ x: p.x, y: 0 }, p, { x: 0, y: p.y }], { stroke: PALETTE.green, width: 1.8, dash: "3 4", part: "reading" }, false);
      sk.circle(p, 5, { fill: PALETTE.green, stroke: PALETTE.green, width: 1, part: "reading" }, false);
      anchors.reading = p;
      names.reading = `At ${val(tr)} ${M.timeUnit}: ${withUnit(v, M.unit)}`;
    }
    for (const [id, p] of Object.entries(anchors)) sk.part(id, names[id], p);
    return sk.finish(14);
  },
};
