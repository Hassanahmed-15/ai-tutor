import type { FigureComponent, FigureParams, Pt } from "../types";
import { Sketch, clamp, fmt, num } from "./mathsKit";
import { betweenTicks, dashed, drawFrame, niceScale } from "./statsKit";

/**
 * OXYGEN UPTAKE AGAINST TIME THROUGH REST, EXERCISE AND RECOVERY, COMPUTED. The oxygen the muscles
 * need jumps to the exercise rate the moment exercise starts, but uptake only rises towards it
 * exponentially (u = rest + A(1 − e^(−t/τ))), so for the first minutes some energy comes from
 * anaerobic respiration: the gap is the OXYGEN DEFICIT. After exercise uptake does not drop at once;
 * it decays back to the resting rate along a fast and a slow exponential (the lactate is oxidised,
 * ATP/creatine phosphate and myoglobin's oxygen restored): the area between that curve and the
 * resting rate is the OXYGEN DEBT. Both areas are the exact integrals of the curve that is drawn.
 */

export type DebtModel = {
  rest: number;
  ex: number;
  /** Minutes of rest before exercise starts, the exercise, and the recovery window. */
  tStart: number;
  tEx: number;
  tRec: number;
  tauOn: number;
  tauFast: number;
  tauSlow: number;
  /** Share of the recovery drop that is the fast component. */
  fast: number;
};

export function debtModel(rest: number, ex: number, tEx: number, tRec: number, tStart?: number): DebtModel {
  const r = Number.isFinite(rest) ? Math.max(0, rest) : 0;
  const e = Number.isFinite(ex) ? Math.max(r, ex) : r;
  const te = Number.isFinite(tEx) && tEx > 0 ? tEx : 0.5;
  const tr = Number.isFinite(tRec) && tRec > 0 ? tRec : 0.5;
  const ts = tStart !== undefined && Number.isFinite(tStart) && tStart > 0 ? tStart : clamp(Math.round(0.18 * (te + tr)), 1, 10);
  const tauOn = clamp(Math.min(0.06 * (ts + te + tr), 0.2 * te), 0.5, 1);
  const tauFast = clamp(tr / 8, 0.3, 2);
  const tauSlow = Math.max(tauFast * 1.5, tr / 4.5);
  return { rest: r, ex: e, tStart: ts, tEx: te, tRec: tr, tauOn, tauFast, tauSlow, fast: 0.55 };
}

/** Oxygen uptake (dm³/min) at time t (minutes from the start of the graph). */
export function uptakeAt(m: DebtModel, t: number): number {
  const t1 = m.tStart, t2 = m.tStart + m.tEx;
  if (t <= t1) return m.rest;
  const A = m.ex - m.rest;
  if (t <= t2) return m.rest + A * (1 - Math.exp(-(t - t1) / m.tauOn));
  const B = A * (1 - Math.exp(-m.tEx / m.tauOn));
  const s = t - t2;
  return m.rest + B * (m.fast * Math.exp(-s / m.tauFast) + (1 - m.fast) * Math.exp(-s / m.tauSlow));
}

/** Oxygen deficit (dm³): ∫ (required − uptake) over the exercise. */
export function deficitOf(m: DebtModel): number {
  return (m.ex - m.rest) * m.tauOn * (1 - Math.exp(-m.tEx / m.tauOn));
}
/** Oxygen debt (dm³): ∫ (uptake − resting) over the recovery window — the shaded area. */
export function debtOf(m: DebtModel): number {
  const B = (m.ex - m.rest) * (1 - Math.exp(-m.tEx / m.tauOn));
  const L = m.tRec;
  return B * (m.fast * m.tauFast * (1 - Math.exp(-L / m.tauFast)) + (1 - m.fast) * m.tauSlow * (1 - Math.exp(-L / m.tauSlow)));
}

export function oxygenDebtArea(rest: number, exercise: number, exerciseMin: number, recoveryMin: number): number {
  return debtOf(debtModel(rest, exercise, exerciseMin, recoveryMin));
}

/** A volume to 2 s.f. (1.3, 12, 0.45). */
const vol = (v: number) => (Number.isFinite(v) ? fmt(Number(v.toPrecision(2)), 3) : "?");

const CURVE = "ink" as const;
const DEBT_FILL = "#fde68a" as const;
const DEFICIT_FILL = "#ddd6fe" as const;
const REQUIRED = "#7c3aed" as const;

export const oxygenDebt: FigureComponent = {
  name: "oxygenDebt",
  title: "Oxygen uptake against time: rest, a rise to a steady rate in exercise (the oxygen deficit) and a smooth fall in recovery, with the oxygen debt shaded",
  params: `rest (resting uptake, dm³/min, default 0.3); exercise (steady uptake during exercise, default 2.4); exerciseMin (minutes of exercise, default 4); recoveryMin (minutes of recovery, default 6); restMin (minutes of rest shown before exercise; default about a fifth of the rest). The rise, the fall, the oxygen deficit and the oxygen debt are all computed — never give them.`,
  match: /\boxygen debt\b|\bEPOC\b|\bexcess post[- ]exercise oxygen\b|\boxygen (uptake|consumption) (during|after|in) (exercise|recovery)\b|\brecovery (period|oxygen)\b|\balactacid|lactacid\b|\boxygen deficit\b|\baerobic and anaerobic (exercise|respiration) (together|during exercise)\b/i,
  parts: [
    { id: "resting", name: "Resting oxygen uptake" },
    { id: "exercise", name: "Steady uptake in exercise" },
    { id: "recovery", name: "Uptake falls in recovery" },
    { id: "debt", name: "Oxygen debt (shaded)" },
    { id: "deficit", name: "Oxygen deficit" },
    { id: "required", name: "Oxygen needed in exercise" },
    { id: "time-axis", name: "Time axis" },
    { id: "uptake-axis", name: "Oxygen uptake axis" },
  ],
  build(params: FigureParams) {
    const rest = num(params.rest ?? params.resting, 0.3, 0, 20);
    // Exercise uptake is always clearly above rest, or there is no debt to draw.
    const ex = Math.max(num(params.exercise ?? params.during, 2.4, 0, 40), rest + Math.max(0.2, rest * 0.25));
    const tEx = num(params.exerciseMin ?? params.exerciseTime, 4, 0.5, 60);
    const tRec = num(params.recoveryMin ?? params.recovery, 6, 0.5, 60);
    const tStartParam = params.restMin ?? params.restTime;
    const m = debtModel(rest, ex, tEx, tRec, tStartParam === undefined ? undefined : num(tStartParam, 2, 0.5, 20));
    const t1 = m.tStart, t2 = m.tStart + m.tEx, t3 = t2 + m.tRec;
    const debt = debtOf(m), deficit = deficitOf(m);

    const sk = new Sketch();
    const W = 500, H = 270;
    const xs = niceScale(0, t3 + Math.max(0.6, 0.06 * t3), 7, "force");
    // Headroom above the plateau: the exercise label reaches its line from above.
    const ys = niceScale(0, ex * 1.3, 8, "force");
    const fr = drawFrame(sk, { w: W, h: H, x: xs, y: ys, xTitle: "Time / min", yTitle: "Oxygen uptake / dm³ min⁻¹", xPart: "time-axis", yPart: "uptake-axis" });
    const P = (t: number): Pt => ({ x: fr.X(t), y: fr.Y(uptakeAt(m, t)) });
    const samples = (a: number, b: number, n = 120): Pt[] => Array.from({ length: n + 1 }, (_, i) => P(a + ((b - a) * i) / n));
    const restY = fr.Y(rest), exY = fr.Y(ex);

    // Shaded areas first, so the lines sit on them.
    // The deficit is shaded until uptake has all but met the need (within 2%, after 4τ): beyond that
    // the gap is thinner than the line, and the plateau stays clear for the exercise label.
    const tc = Math.min(t2, t1 + 4 * m.tauOn);
    const deficitEdge = samples(t1, tc);
    sk.polygon([{ x: fr.X(t1), y: exY }, { x: fr.X(tc), y: exY }, ...[...deficitEdge].reverse()], { fill: DEFICIT_FILL, stroke: "none", part: "deficit" }, false);
    const debtEdge = samples(t2, t3, 160);
    sk.polygon([...debtEdge, { x: fr.X(t3), y: restY }, { x: fr.X(t2), y: restY }], { fill: DEBT_FILL, stroke: "none", part: "debt" }, false);

    // Exercise starts and stops: dashed verticals.
    // (They stop at the curve, so nothing stands above the plateau in a label's way.)
    dashed(sk, [{ x: fr.X(t1), y: H }, { x: fr.X(t1), y: restY }], "muted", undefined, 1.4);
    dashed(sk, [{ x: fr.X(t2), y: H }, P(t2)], "muted", undefined, 1.4);
    // The resting rate carried on under the curve: the line the debt is measured from.
    dashed(sk, [{ x: fr.X(t1), y: restY }, { x: W, y: restY }], "muted", "resting", 1.6);
    // The oxygen the muscles need: the exercise rate from the first instant.
    sk.line([{ x: fr.X(t1), y: restY }, { x: fr.X(t1), y: exY }, { x: fr.X(tc), y: exY }], { stroke: REQUIRED, width: 2.2, dash: "7 5", part: "required" }, false);

    // The uptake curve: one line in three parts.
    sk.line(samples(0, t1, 4), { stroke: CURVE, width: 2.6, part: "resting" });
    sk.line(samples(t1, t2), { stroke: CURVE, width: 2.6, part: "exercise" });
    sk.line(samples(t2, xs.hi, 200), { stroke: CURVE, width: 2.6, part: "recovery" });

    // Anchors: each on its own line or area, apart from the others.
    const at = (t: number) => P(t);
    sk.part("resting", "Resting oxygen uptake", at(t1 * 0.45));
    // Exercise: on the plateau once it is reached, well before the fall (its label comes in from above the
    // recovery curve, clear of the debt).
    const steady = uptakeAt(m, t2) >= rest + 0.95 * (ex - rest);
    sk.part("exercise", steady ? "Steady uptake in exercise" : "Uptake rises in exercise", at(tc < t2 - 0.1 * m.tEx ? (tc + t2) / 2 : t2 - 0.1 * m.tEx));
    // Recovery: on the falling curve, a third of the way down.
    const B = uptakeAt(m, t2) - rest;
    let tr = t2;
    while (tr < t3 && uptakeAt(m, tr) - rest > 0.42 * B) tr += m.tRec / 400;
    sk.part("recovery", "Uptake falls in recovery", at(tr));
    // Debt: inside the shading, low and to the right of the fall, where the area is still tall.
    const td = t2 + Math.min(m.tRec * 0.5, Math.max(m.tauFast * 0.9, (tr - t2) * 0.55));
    const ud = uptakeAt(m, td);
    sk.part("debt", `Oxygen debt ≈ ${vol(debt)} dm³`, { x: fr.X(td), y: fr.Y(rest + 0.35 * (ud - rest)) });
    // Deficit: inside the gap between the need and the uptake, midway between them, where the gap is wide.
    const tf = t1 + Math.min(m.tEx, m.tauOn * 1.3) / 2;
    sk.part("deficit", `Oxygen deficit ≈ ${vol(deficit)} dm³`, { x: fr.X(tf), y: fr.Y((uptakeAt(m, tf) + ex) / 2) });
    // The need: the corner where it jumps to the exercise rate.
    sk.part("required", "Oxygen needed in exercise", { x: fr.X(t1), y: exY });
    sk.part("time-axis", "Time axis", { x: fr.X(betweenTicks(xs, 0.88)), y: H });
    // The y axis: between two tick values, as far as it can be from the other anchors on the left.
    const busy = [rest, ex, (uptakeAt(m, tf) + ex) / 2];
    const mids = ys.ticks.slice(1).map((v, i) => (v + ys.ticks[i]) / 2).filter((v) => v < ex * 1.15);
    const axisAt = mids.reduce((best, v) => (Math.min(...busy.map((b) => Math.abs(b - v))) > Math.min(...busy.map((b) => Math.abs(b - best))) ? v : best), mids[0] ?? betweenTicks(ys, 0.3));
    sk.part("uptake-axis", "Oxygen uptake axis", { x: 0, y: fr.Y(axisAt) });
    return sk.finish(16, { w: 560, h: 260 });
  },
};
