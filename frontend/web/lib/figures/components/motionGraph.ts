import type { FigureComponent, FigureParams, Pt } from "../types";
import { Sketch, add, mul, num, sub, unit } from "./mathsKit";
import { INK, show } from "./physicsKit2";

/**
 * MOTION GRAPHS (distance–time, displacement–time, velocity–time, acceleration–time). The model
 * gives the stages as time ranges with start and end values; code draws each stage (straight, or a
 * smooth curve when asked), names it by its physics, and computes:
 *   gradient   Δy/Δt of a stage — speed/velocity on a d–t or s–t graph, acceleration on a v–t graph;
 *   area       the area between the graph and the time axis — displacement (and distance) on a v–t
 *              graph, change of velocity on an a–t graph — exactly, stage by stage;
 *   tangent    the gradient of a curved stage at one instant.
 */

type GraphType = "distance-time" | "displacement-time" | "velocity-time" | "acceleration-time";
export type Stage = { t0: number; t1: number; y0: number; y1: number; curve: "up" | "down" | null };
type Kind = "accelerating" | "constant" | "decelerating" | "stationary" | "returning";

const AXIS: Record<GraphType, { sym: string; unit: string; grad: string; gradUnit: string }> = {
  "distance-time": { sym: "d", unit: "m", grad: "speed", gradUnit: "m/s" },
  "displacement-time": { sym: "s", unit: "m", grad: "velocity", gradUnit: "m/s" },
  "velocity-time": { sym: "v", unit: "m/s", grad: "acceleration", gradUnit: "m/s²" },
  "acceleration-time": { sym: "a", unit: "m/s²", grad: "rate of change of acceleration", gradUnit: "m/s³" },
};

function typeOf(v: unknown): GraphType {
  const s = String(v ?? "").toLowerCase();
  if (/accel/.test(s)) return "acceleration-time";
  if (/displace/.test(s)) return "displacement-time";
  if (/dist/.test(s)) return "distance-time";
  return "velocity-time";
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;
/** "0-4: 0 to 8; 4-10: 8 to 8; 10-12: 8 to 0 curve" → stages, cleaned: sorted, joined end to end in time
 *  (and in value, except on an a–t graph where jumps are real), at most 8, never empty. */
export function parseStages(v: unknown, type: GraphType = "velocity-time"): Stage[] {
  const text = typeof v === "string" ? v.replace(/[−–—]/g, "-").replace(/→/g, " to ") : "";
  const raw: Stage[] = [];
  for (const chunk of text.split(/[;\n|]/)) {
    // Units out first ("m/s²", "m s-1", "m", "s"), so a unit is never read as a minus sign.
    const bare = chunk.replace(/m\s*\/\s*s(?:²|\^?2)?|m\s*s\s*-\s*[12]|\b[ms]\b/gi, " ");
    const m = bare.match(new RegExp(String.raw`^\s*t?\s*=?\s*(${NUM})\s*(?:-|to)\s*(${NUM})\s*[:,=]?\s*(?:(${NUM})\s*(?:to|-)\s*)?(${NUM})`, "i"));
    if (!m) continue;
    const t0 = Number(m[1]), t1 = Number(m[2]);
    const y1 = Number(m[4]), y0 = m[3] !== undefined ? Number(m[3]) : NaN;
    if (![t0, t1, y1].every(Number.isFinite) || t1 <= t0) continue;
    const curve = /curv\w*\s*down|concave\s*down|levell?ing|slowing|\bdown\b/i.test(chunk) ? "down" : /curv/i.test(chunk) ? "up" : null;
    raw.push({ t0, t1, y0, y1, curve });
  }
  raw.sort((a, b) => a.t0 - b.t0);
  const out: Stage[] = [];
  for (const s of raw.slice(0, 8)) {
    const prev = out[out.length - 1];
    // Each stage starts where the last ended (a gap or an overlap in the times is closed up).
    const t0 = prev ? prev.t1 : Math.max(0, s.t0);
    const t1 = s.t1 > t0 ? s.t1 : t0 + (s.t1 - s.t0);
    const y0 = prev && (type !== "acceleration-time" || !Number.isFinite(s.y0)) ? prev.y1 : Number.isFinite(s.y0) ? s.y0 : type === "acceleration-time" ? s.y1 : 0;
    out.push({ t0, t1, y0, y1: s.y1, curve: s.y1 === y0 ? null : s.curve });
  }
  if (out.length) return out.map((s) => ({ ...s, y0: clampV(s.y0), y1: clampV(s.y1) }));
  return type === "acceleration-time"
    ? [{ t0: 0, t1: 4, y0: 2, y1: 2, curve: null }, { t0: 4, t1: 10, y0: 0, y1: 0, curve: null }, { t0: 10, t1: 12, y0: -4, y1: -4, curve: null }]
    : type === "velocity-time"
      ? [{ t0: 0, t1: 4, y0: 0, y1: 8, curve: null }, { t0: 4, t1: 10, y0: 8, y1: 8, curve: null }, { t0: 10, t1: 12, y0: 8, y1: 0, curve: null }]
      : [{ t0: 0, t1: 5, y0: 0, y1: 20, curve: null }, { t0: 5, t1: 8, y0: 20, y1: 20, curve: null }, { t0: 8, t1: 10, y0: 20, y1: 40, curve: null }];
}
const textLen = (s: string) => s.length;
const clampV = (n: number) => Math.max(-1e6, Math.min(1e6, n));

/** Value and gradient of a stage at time t. */
export function stageAt(s: Stage, t: number): { y: number; dydt: number } {
  const T = s.t1 - s.t0, u = Math.max(0, Math.min(1, (t - s.t0) / T)), D = s.y1 - s.y0;
  if (s.curve === "up") return { y: s.y0 + D * u * u, dydt: (2 * D * u) / T };
  if (s.curve === "down") return { y: s.y0 + D * (1 - (1 - u) * (1 - u)), dydt: (2 * D * (1 - u)) / T };
  return { y: s.y0 + D * u, dydt: D / T };
}
/** Exact signed area under a stage, and the unsigned area (distance, for a v–t graph). */
export function stageArea(s: Stage): { signed: number; unsigned: number } {
  const T = s.t1 - s.t0, D = s.y1 - s.y0;
  const signed = s.curve === "up" ? T * (s.y0 + D / 3) : s.curve === "down" ? T * (s.y0 + (2 * D) / 3) : (T * (s.y0 + s.y1)) / 2;
  if (s.y0 * s.y1 >= 0 && (s.curve === null || Math.sign(s.y0 || s.y1) === Math.sign(signed || 1))) return { signed, unsigned: Math.abs(signed) };
  // Crosses zero: integrate |y| numerically (fine steps; exact for the straight case to 1e-9).
  let unsigned = 0;
  const n = 2000;
  for (let k = 0; k < n; k++) {
    const a = stageAt(s, s.t0 + (T * k) / n).y, b = stageAt(s, s.t0 + (T * (k + 1)) / n).y;
    unsigned += a * b >= 0 ? (Math.abs(a + b) * T) / (2 * n) : ((a * a + b * b) / (Math.abs(a) + Math.abs(b))) * T / (2 * n);
  }
  return { signed, unsigned };
}

function kindOf(type: GraphType, s: Stage): Kind {
  const D = s.y1 - s.y0, flat = Math.abs(D) < 1e-9;
  if (type === "velocity-time") {
    if (flat) return Math.abs(s.y0) < 1e-9 ? "stationary" : "constant";
    return Math.abs(s.y1) > Math.abs(s.y0) ? "accelerating" : "decelerating";
  }
  if (type === "acceleration-time") {
    const mean = (s.y0 + s.y1) / 2;
    return Math.abs(mean) < 1e-9 && flat ? "constant" : mean > 0 ? "accelerating" : "decelerating";
  }
  if (flat) return "stationary";
  if (D < 0) return "returning";
  return s.curve === "up" ? "accelerating" : s.curve === "down" ? "decelerating" : "constant";
}

function niceStep(range: number, target = 6): number {
  const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Which stages a list like "all", "2", "1-3", "1,3" picks (1-based). */
function pick(v: unknown, n: number, fallback: number[]): number[] {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v ? [...Array(n).keys()] : [];
  const s = String(v).toLowerCase().trim();
  if (/^(all|true|yes|whole)/.test(s)) return [...Array(n).keys()];
  if (/^(none|no|false|off|0)$/.test(s)) return [];
  const out = new Set<number>();
  for (const part of s.split(/[,;\s]+/)) {
    const r = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!r) continue;
    const a = Number(r[1]), b = r[2] ? Number(r[2]) : a;
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (k >= 1 && k <= n) out.add(k - 1);
  }
  return out.size ? [...out].sort((a, b) => a - b) : fallback;
}

export const motionGraph: FigureComponent = {
  name: "motionGraph",
  title: "Motion graph: distance–time, displacement–time, velocity–time or acceleration–time, drawn stage by stage, with a gradient triangle, the shaded area under the graph and its value, or a tangent",
  params: `type ("velocity-time" default, "distance-time", "displacement-time", "acceleration-time"). segments: the stages in order, "t0-t1: start to end" separated by semicolons, e.g. "0-4: 0 to 8; 4-10: 8 to 8; 10-12: 8 to 0" (seconds; values in m, m/s or m/s²); add "curve" to a stage for a smooth curve speeding up (gradient increasing) or "curve down" for one levelling off. gradient (the stage number whose gradient triangle is drawn, e.g. 1; "none"; default the first sloping straight stage, none on an a–t graph). area ("all", a stage number "3", a range "1-2", or "none"; default "all" on v–t and a–t graphs, none otherwise): shaded, with the value of each stage's area written in it. tangentAt (a time in s: draws the tangent there and computes its gradient). The code names each stage (accelerating, constant speed/velocity, decelerating, stationary, moving back) with its gradient, and computes the area (distance travelled on a v–t graph, change of velocity on an a–t graph).`,
  match: /\b(distance[- ]time|displacement[- ]time|velocity[- ]time|speed[- ]time|acceleration[- ]time|motion) graphs?\b|\b(area under (a |the )?(velocity|speed|v-t)[- ]?(time )?graph)\b|\b(gradient of (a |the )?(distance|displacement|velocity|speed)[- ]time graph)\b|\b[dvs]-t graphs?\b/i,
  parts: [
    { id: "accelerating", name: "Accelerating" },
    { id: "constant", name: "Constant speed" },
    { id: "decelerating", name: "Decelerating" },
    { id: "stationary", name: "Stationary" },
    { id: "returning", name: "Moving back" },
    { id: "gradient", name: "Gradient" },
    { id: "area", name: "Area under graph" },
    { id: "tangent", name: "Tangent" },
    { id: "time-axis", name: "Time axis" },
    { id: "value-axis", name: "Vertical axis" },
  ],
  build(params: FigureParams) {
    const type = typeOf(params.type ?? params.graph);
    const ax = AXIS[type];
    const stages = parseStages(params.segments ?? params.stages, type);
    const n = stages.length;
    const tMax = stages[n - 1].t1;
    const ys = stages.flatMap((s) => [s.y0, s.y1]);
    const yHi = Math.max(0, ...ys), yLo = Math.min(0, ...ys);
    const tStep = niceStep(tMax, 8), yStep = niceStep(Math.max(1e-9, yHi - yLo), 5);
    const tTop = Math.ceil(tMax / tStep - 1e-9) * tStep;
    const yTop = yHi > 0 ? Math.ceil((yHi * 1.06) / yStep - 1e-9) * yStep : 0;
    const yBot = yLo < 0 ? Math.floor((yLo * 1.06) / yStep + 1e-9) * yStep : 0;
    const W = 500, H = 290;
    const sx = W / tTop, sy = H / Math.max(1e-9, yTop - yBot);
    const P = (t: number, y: number): Pt => ({ x: t * sx, y: -(y - yBot) * sy });
    const zeroY = P(0, 0).y;
    const sk = new Sketch();

    // Grid, then axes with arrowheads, tick values and the axis symbols.
    for (let t = tStep; t <= tTop + 1e-9; t += tStep) sk.line([P(t, yBot), P(t, yTop)], { stroke: "muted", width: 0.7, opacity: 0.45 }, false);
    for (let y = yBot; y <= yTop + 1e-9; y += yStep) if (Math.abs(y) > 1e-9) sk.line([P(0, y), P(tTop, y)], { stroke: "muted", width: 0.7, opacity: 0.45 }, false);
    // Only the arrowheads carry the axis parts: a whole axis would be an obstacle no leader could cross.
    const axisArrow = (from: Pt, to: Pt, part: string) => {
      const u = unit(sub(to, from)), nn = { x: -u.y, y: u.x };
      sk.line([from, sub(to, mul(u, 8))], { stroke: "ink", width: 2 });
      sk.polygon([to, add(sub(to, mul(u, 12)), mul(nn, 5.5)), add(sub(to, mul(u, 12)), mul(nn, -5.5))], { fill: "ink", stroke: "ink", width: 1, part });
    };
    axisArrow({ x: 0, y: zeroY }, { x: W + 26, y: zeroY }, "time-axis");
    axisArrow(P(0, yBot), { x: 0, y: P(0, yTop).y - 26 }, "value-axis");
    const dp = (step: number) => [0, 1, 2, 3].find((d) => Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-6) ?? 3;
    for (let t = tStep; t <= tTop + 1e-9; t += tStep) {
      sk.line([{ x: t * sx, y: zeroY }, { x: t * sx, y: zeroY + 6 }], { stroke: "ink", width: 1.6 }, false);
      sk.text({ x: t * sx, y: (yBot < 0 ? P(0, yBot).y : zeroY) + 18 }, show(t, dp(tStep)), 14, "ink");
    }
    for (let y = yBot; y <= yTop + 1e-9; y += yStep) {
      sk.line([{ x: -6, y: P(0, y).y }, { x: 0, y: P(0, y).y }], { stroke: "ink", width: 1.6 }, false);
      const label = show(y, dp(yStep));
      sk.text({ x: -12 - label.length * 4, y: P(0, y).y }, label, 14, "ink");
    }
    sk.text({ x: W + 22, y: zeroY + 30 }, "t / s", 16, "ink");
    sk.text({ x: 16 + textLen(`${ax.sym} / ${ax.unit}`) * 4.4, y: P(0, yTop).y - 26 }, `${ax.sym} / ${ax.unit}`, 16, "ink");

    // Shaded areas first (under the line), stage by stage.
    const areaPick = pick(params.area ?? params.shade, n, type === "velocity-time" || type === "acceleration-time" ? [...Array(n).keys()] : []);
    const curvePts = (s: Stage, k = 24) => Array.from({ length: s.curve ? k + 1 : 2 }, (_, j) => { const t = s.t0 + ((s.t1 - s.t0) * j) / (s.curve ? k : 1); return P(t, stageAt(s, t).y); });
    let areaSigned = 0, areaUnsigned = 0, bestArea: { s: Stage; a: number } | null = null;
    for (const k of areaPick) {
      const s = stages[k];
      sk.polygon([P(s.t0, 0), ...curvePts(s), P(s.t1, 0)], { fill: INK.violet, stroke: "none", opacity: 0.16, part: "area" }, false);
      const a = stageArea(s);
      areaSigned += a.signed;
      areaUnsigned += a.unsigned;
      if (!bestArea || a.unsigned > bestArea.a) bestArea = { s, a: a.unsigned };
    }
    // The graph line.
    const line: Pt[] = [];
    for (const s of stages) for (const p of curvePts(s)) if (!line.length || Math.hypot(p.x - line[line.length - 1].x, p.y - line[line.length - 1].y) > 1e-6) line.push(p);
    if (type === "acceleration-time") for (const s of stages) sk.line(curvePts(s), { stroke: INK.blue, width: 3.2, part: undefined });
    else sk.line(line, { stroke: INK.blue, width: 3.2 });
    if (type === "acceleration-time") for (let k = 1; k < n; k++) if (stages[k].y0 !== stages[k - 1].y1) sk.line([P(stages[k].t0, stages[k - 1].y1), P(stages[k].t0, stages[k].y0)], { stroke: INK.blue, width: 1.4, dash: "4 4" }, false);

    // Area values written inside each shaded stage (when there is room), total in the label.
    const areaUnit = type === "velocity-time" ? "m" : type === "acceleration-time" ? "m/s" : `${ax.unit}·s`;
    for (const k of areaPick) {
      const s = stages[k];
      const a = stageArea(s);
      const mid = (s.t0 + s.t1) / 2, yMid = stageAt(s, mid).y;
      const c = P(mid, yMid / 2.4);
      const text = `${show(a.signed, 1)} ${areaUnit}`;
      if ((s.t1 - s.t0) * sx > text.length * 8.5 + 6 && Math.abs(yMid) * sy > 30) sk.placeText(text, 15, c, { x: 0, y: yMid >= 0 ? 1 : -1 }, { max: 20, fill: INK.violet, part: "area", slide: { x: 1, y: 0 } });
    }

    // Stages: one labelled part per kind (the first stage of that kind), named with its gradient.
    const seen = new Set<Kind>();
    const kindName = (kind: Kind, s: Stage) => {
      const g = (s.y1 - s.y0) / (s.t1 - s.t0);
      const gs = `${show(Math.abs(g), 2)} ${ax.gradUnit}`;
      if (type === "velocity-time") return kind === "accelerating" ? `Accelerating (${show(g, 2)} m/s²)` : kind === "decelerating" ? `Decelerating (${show(g, 2)} m/s²)` : kind === "stationary" ? "At rest" : `Constant velocity (${show(s.y0, 2)} m/s)`;
      if (type === "acceleration-time") return kind === "constant" ? "Zero acceleration" : kind === "accelerating" ? `Accelerating (${show((s.y0 + s.y1) / 2, 2)} m/s²)` : `Decelerating (${show((s.y0 + s.y1) / 2, 2)} m/s²)`;
      if (kind === "stationary") return "Stationary";
      if (kind === "returning") return `Moving back (${s.curve ? "speed changing" : gs})`;
      if (kind === "accelerating") return "Speeding up";
      if (kind === "decelerating") return "Slowing down";
      return `Constant ${type === "displacement-time" ? "velocity" : "speed"} (${gs})`;
    };
    for (const s of stages) {
      const kind = kindOf(type, s);
      if (seen.has(kind)) continue;
      seen.add(kind);
      const mid = (s.t0 + s.t1) / 2;
      sk.part(kind, kindName(kind, s), P(mid, stageAt(s, mid).y));
    }

    // Gradient triangle on one straight sloping stage.
    const firstSlope = stages.findIndex((s) => !s.curve && Math.abs(s.y1 - s.y0) > 1e-9);
    const gPick = pick(params.gradient ?? params.gradientOf, n, type === "acceleration-time" || firstSlope < 0 ? [] : [firstSlope]);
    const gs = gPick.length ? stages[gPick[0]] : null;
    if (gs && Math.abs(gs.y1 - gs.y0) > 1e-9) {
      const A = P(gs.t0, gs.y0), B = P(gs.t1, gs.y0), C = P(gs.t1, gs.y1);
      sk.line([A, B, C], { stroke: INK.amber, width: 2, dash: "6 4", part: "gradient" });
      const dt = gs.t1 - gs.t0, dy = gs.y1 - gs.y0;
      const up = dy > 0;
      sk.placeText(`${show(dt, 2)} s`, 15, { x: (A.x + B.x) / 2, y: B.y }, { x: 0, y: up ? -1 : 1 }, { min: 12, max: 50, fill: INK.amber, part: "gradient", slide: { x: 1, y: 0 } });
      sk.placeText(`${show(Math.abs(dy), 2)} ${ax.unit}`, 15, { x: B.x, y: (B.y + C.y) / 2 }, { x: 1, y: 0 }, { min: 30, max: 90, fill: INK.amber, part: "gradient", slide: { x: 0, y: 1 } });
      const g = dy / dt;
      sk.part("gradient", `Gradient = ${show(dy, 2)} ÷ ${show(dt, 2)} = ${show(g, 2)} ${ax.gradUnit}`, { x: B.x, y: B.y + (C.y - B.y) * 0.3 });
    }

    // Tangent at a chosen instant.
    const tAt = num(params.tangentAt ?? params.tangent, NaN, 0, tMax);
    if (Number.isFinite(tAt)) {
      const s = stages.find((st) => tAt >= st.t0 - 1e-9 && tAt <= st.t1 + 1e-9) ?? stages[0];
      const { y, dydt } = stageAt(s, tAt);
      const Q = P(tAt, y);
      const dir = unit({ x: sx, y: -dydt * sy });
      const half = 90;
      sk.line([sub(Q, mul(dir, half)), add(Q, mul(dir, half))], { stroke: INK.red, width: 2.2, part: "tangent" });
      sk.circle(Q, 4, { fill: INK.red, stroke: INK.red, width: 1, part: "tangent" });
      sk.part("tangent", `Tangent (gradient ${show(dydt, 2)} ${ax.gradUnit})`, add(Q, mul(dir, half * 0.8)));
    }

    if (areaPick.length && bestArea) {
      const s = bestArea.s;
      const t = s.t0 + (s.t1 - s.t0) * 0.22, y = stageAt(s, t).y;
      const what = type === "velocity-time"
        ? Math.abs(areaSigned - areaUnsigned) > 1e-6 ? `${show(areaSigned, 1)} m (distance ${show(areaUnsigned, 1)} m)` : `distance = ${show(areaSigned, 1)} m`
        : type === "acceleration-time" ? `Δv = ${show(areaSigned, 1)} m/s` : `${show(areaSigned, 1)} ${areaUnit}`;
      sk.part("area", type === "velocity-time" && Math.abs(areaSigned - areaUnsigned) > 1e-6 ? `Area = ${what}` : `Area: ${what}`, P(t, y * 0.25));
    }
    sk.part("time-axis", "Time (s)", { x: W + 22, y: zeroY });
    sk.part("value-axis", `${ax.sym === "d" ? "Distance" : ax.sym === "s" ? "Displacement" : ax.sym === "v" ? "Velocity" : "Acceleration"} (${ax.unit})`, { x: 0, y: P(0, yTop).y - 22 });
    return sk.finish(14);
  },
};
