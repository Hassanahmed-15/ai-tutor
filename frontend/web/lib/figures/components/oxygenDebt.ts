import type { FigureComponent, FigureParams } from "../types";
import { PALETTE, Sketch, num } from "./mathsKit";

/**
 * Oxygen uptake against time through rest, exercise and recovery. The area between the recovery
 * curve and the resting rate is the oxygen debt (EPOC) — computed from the numbers, never guessed.
 */

export function oxygenDebtArea(rest: number, exercise: number, exerciseMin: number, recoveryMin: number): number {
  // Resting baseline for the recovery window; the extra during recovery is modelled as a triangle
  // from the exercise rate down to rest (standard O Level sketch).
  const extra = Math.max(0, exercise - rest);
  return extra * recoveryMin * 0.5 + extra * 0; // triangle under the recovery slope
}

export const oxygenDebt: FigureComponent = {
  name: "oxygenDebt",
  title: "Oxygen uptake against time: resting rate, a raised plateau during exercise, recovery back to rest, with the oxygen debt shaded",
  params: `rest (resting uptake, default 0.3 dm³/min); exercise (during exercise, default 2.4); exerciseMin (duration of exercise, default 4); recoveryMin (recovery duration, default 6). Units on the axes are minutes and dm³/min.`,
  match: /\boxygen debt\b|\bEPOC\b|\bexcess post[- ]exercise oxygen\b|\boxygen (uptake|consumption) (during|after|in) (exercise|recovery)\b|\brecovery (period|oxygen)\b|\balactacid|lactacid\b|\baerobic and anaerobic (exercise|respiration) (together|during exercise)\b/i,
  parts: [
    { id: "resting", name: "Resting uptake" },
    { id: "exercise", name: "During exercise" },
    { id: "recovery", name: "Recovery" },
    { id: "debt", name: "Oxygen debt (shaded)" },
    { id: "time-axis", name: "Time / min" },
    { id: "uptake-axis", name: "Oxygen uptake" },
  ],
  build(params: FigureParams) {
    const rest = num(params.rest ?? params.resting, 0.3, 0, 20);
    const ex = num(params.exercise ?? params.during, 2.4, rest, 40);
    const tEx = num(params.exerciseMin ?? params.exerciseTime, 4, 0.5, 60);
    const tRec = num(params.recoveryMin ?? params.recovery, 6, 0.5, 60);
    const tEnd = tEx + tRec;
    const debt = oxygenDebtArea(rest, ex, tEx, tRec);
    const sk = new Sketch();
    const plot = { x: 70, y: 40, w: 480, h: 280 };
    const maxY = ex * 1.15;
    const X = (t: number) => plot.x + (t / tEnd) * plot.w;
    const Y = (v: number) => plot.y + plot.h - (v / maxY) * plot.h;
    sk.line([{ x: plot.x, y: plot.y }, { x: plot.x, y: plot.y + plot.h }, { x: plot.x + plot.w, y: plot.y + plot.h }], { stroke: "ink", width: 2, part: "time-axis" });
    sk.text({ x: plot.x + plot.w / 2, y: plot.y + plot.h + 28 }, "Time / min", 16, "ink", "time-axis");
    sk.text({ x: plot.x - 36, y: plot.y + plot.h / 2 }, "O₂ uptake", 14, "ink", "uptake-axis");
    const restY = Y(rest);
    const exY = Y(ex);
    const x0 = X(0), xEx = X(tEx), xEnd = X(tEnd);
    // Shaded oxygen debt: triangle under recovery, down to the resting line.
    sk.polygon(
      [{ x: xEx, y: exY }, { x: xEnd, y: restY }, { x: xEx, y: restY }],
      { fill: PALETTE.amber, opacity: 0.35, stroke: PALETTE.amber, width: 1.4, part: "debt" },
    );
    sk.line([{ x: x0, y: restY }, { x: xEx, y: restY }], { stroke: PALETTE.green, width: 2.4, dash: "6 5", part: "resting" }, false);
    sk.line([{ x: x0, y: restY }, { x: X(tEx * 0.12), y: exY }, { x: xEx, y: exY }], { stroke: PALETTE.red, width: 3, part: "exercise" });
    sk.line([{ x: xEx, y: exY }, { x: xEnd, y: restY }], { stroke: PALETTE.blue, width: 3, part: "recovery" });
    sk.text({ x: (x0 + xEx) / 2, y: restY - 14 }, "resting", 13, PALETTE.green, "resting");
    sk.text({ x: (x0 + xEx) / 2, y: exY - 14 }, "exercise", 13, PALETTE.red, "exercise");
    sk.text({ x: (xEx + xEnd) / 2 + 10, y: (exY + restY) / 2 }, "oxygen debt", 14, PALETTE.amber, "debt");
    sk.part("resting", "Resting uptake", { x: (x0 + xEx) / 2, y: restY });
    sk.part("exercise", "During exercise", { x: (x0 + xEx) / 2, y: exY });
    sk.part("recovery", "Recovery", { x: (xEx + xEnd) / 2, y: (exY + restY) / 2 });
    sk.part("debt", `Oxygen debt ${debt.toFixed(2)} dm³`, { x: xEx + 40, y: (exY + restY) / 2 });
    sk.part("time-axis", "Time / min", { x: plot.x + plot.w / 2, y: plot.y + plot.h });
    sk.part("uptake-axis", "Oxygen uptake", { x: plot.x, y: plot.y + plot.h / 2 });
    return sk.finish(16);
  },
};
