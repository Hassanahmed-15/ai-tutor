import type { FigureComponent, FigureParams, Pt } from "../types";
import { Sketch, bool, num, polar } from "./mathsKit";
import { INK, arrowTo, firstNumber, show } from "./physicsKit2";

/**
 * MOMENTS ON A BEAM (see-saw, lever, metre rule on a pivot). The model lists the forces and where
 * they act; code computes each moment (force × perpendicular distance from the pivot), sums the
 * clockwise and anticlockwise moments, says whether the beam balances (principle of moments), and
 * — when one force or one distance is given as "?" — solves for the value that balances it. Force
 * arrows are drawn to scale (length ∝ force) at their true distances along the beam.
 */

export type Force = { F: number; d: number; side: -1 | 1; up: boolean; unknown: "F" | "d" | null; label?: string };
export type MomentResult = {
  forces: Force[];
  /** The beam's own weight, acting at its centre (0 when not given). */
  weight: { W: number; d: number; side: -1 | 1 } | null;
  clockwise: number;
  anticlockwise: number;
  balanced: boolean;
  /** Solving for an unknown failed (it would need a negative force/distance): drawn with "?". */
  unsolvable: boolean;
  reaction: number;
  length: number;
  pivot: number;
  lenUnit: "cm" | "m";
};

/** Clockwise moment of a force (positive) or anticlockwise (negative), about the pivot. */
const signed = (f: { F: number; d: number; side: -1 | 1; up: boolean }) => f.F * f.d * f.side * (f.up ? -1 : 1);

function parseForce(chunk: string): Force | null {
  const c = chunk.replace(/−/g, "-").trim();
  if (!c) return null;
  const [before, after = ""] = c.split(/\bat\b|@/i);
  const side: -1 | 1 = /\bleft\b|\banti-?clockwise side\b/i.test(c) ? -1 : 1;
  const up = /\bup(wards?)?\b|\bupward\b|\bpush(es|ing)? up\b/i.test(c);
  const fNum = firstNumber(before);
  const dNum = after ? firstNumber(after) : firstNumber(before.replace(/^[^\d]*-?\d+(?:\.\d+)?/, ""));
  const fUnknown = /\?/.test(before) || (fNum === undefined && /\b[A-Za-z]\b/.test(before));
  const dUnknown = !fUnknown && (/\?/.test(after) || (after !== "" && dNum === undefined && /\b[a-z]\b/i.test(after)));
  if (fNum === undefined && !fUnknown) return null;
  const F = fUnknown ? 1 : Math.abs(fNum as number);
  const d = dUnknown ? 1 : Math.abs(dNum ?? 1);
  if (!Number.isFinite(F) || !Number.isFinite(d)) return null;
  const letter = before.match(/\b([A-Za-z])\b/)?.[1];
  return { F: Math.min(F, 1e6), d: Math.min(d, 1e6), side: dNum !== undefined && dNum < 0 ? -1 : side, up, unknown: fUnknown ? "F" : dUnknown ? "d" : null, ...(fUnknown && letter ? { label: letter } : {}) };
}

export function solveMoments(params: FigureParams): MomentResult {
  const lenUnit: "cm" | "m" = /^m$|metre|meter/i.test(String(params.units ?? params.unit ?? "")) && !/cm|centi/i.test(String(params.units ?? params.unit ?? "")) ? "m" : "cm";
  const text = typeof params.forces === "string" ? params.forces : "3 N at 20 cm left; 2 N at 30 cm right";
  let forces = text.split(/[;\n]|,(?=\s*[?\dA-Za-z]+\s*k?N\b)/).map(parseForce).filter((f): f is Force => !!f).slice(0, 4);
  if (!forces.length) forces = [{ F: 3, d: 20, side: -1, up: false, unknown: null }, { F: 2, d: 30, side: 1, up: false, unknown: null }];
  // At most one unknown; any further ones are read as 1.
  let seenUnknown = false;
  forces = forces.map((f) => (f.unknown && seenUnknown ? { ...f, unknown: null } : (f.unknown && (seenUnknown = true), f)));
  const maxL = Math.max(0, ...forces.filter((f) => f.side < 0).map((f) => f.d));
  const maxR = Math.max(0, ...forces.filter((f) => f.side > 0).map((f) => f.d));
  let length = num(params.length ?? params.beamLength, Math.max(100, 2 * Math.max(maxL, maxR) * 1.15) || 100, 0.01, 1e6);
  let pivot = num(params.pivot ?? params.pivotAt, length / 2, 0, length);
  // The beam always reaches every force (a little past it).
  if (pivot < maxL * 1.06) { const grow = maxL * 1.06 - pivot; pivot += grow; length += grow; }
  if (length - pivot < maxR * 1.06) length = pivot + maxR * 1.06;
  const Wb = num(params.beamWeight ?? params.weight, 0, 0, 1e6);
  const off = length / 2 - pivot;
  const weight = Wb > 0 ? { W: Wb, d: Math.abs(off), side: (off < 0 ? -1 : 1) as -1 | 1 } : null;
  const known = forces.filter((f) => !f.unknown).reduce((s, f) => s + signed(f), 0) + (weight ? signed({ F: weight.W, d: weight.d, side: weight.side, up: false }) : 0);
  let unsolvable = false;
  const u = forces.find((f) => f.unknown);
  if (u) {
    // Its moment must cancel the rest: signed(u) = −known.
    const unitMoment = signed({ ...u, [u.unknown === "F" ? "F" : "d"]: 1 } as Force);
    const need = unitMoment !== 0 ? -known / unitMoment : NaN;
    if (Number.isFinite(need) && need > 0) {
      if (u.unknown === "F") u.F = need;
      else {
        u.d = need;
        if (u.side < 0 && pivot < need * 1.06) { const grow = need * 1.06 - pivot; pivot += grow; length += grow; }
        if (u.side > 0 && length - pivot < need * 1.06) length = pivot + need * 1.06;
      }
    } else unsolvable = true;
  }
  let cw = 0, acw = 0;
  const all = [...forces.filter((f) => !(f.unknown && unsolvable)), ...(weight ? [{ F: weight.W, d: weight.d, side: weight.side, up: false }] : [])];
  for (const f of all) { const m = signed(f); if (m > 0) cw += m; else acw -= m; }
  const reaction = all.reduce((s, f) => s + (f.up ? -f.F : f.F), 0);
  return { forces, weight, clockwise: cw, anticlockwise: acw, balanced: !unsolvable && Math.abs(cw - acw) <= 1e-9 * Math.max(1, cw, acw), unsolvable, reaction, length, pivot, lenUnit };
}

export const moments: FigureComponent = {
  name: "moments",
  title: "Moments on a beam: a beam or see-saw on a pivot with the forces drawn to scale at their distances, the clockwise and anticlockwise moments and whether it balances",
  params: `forces (up to 4, separated by semicolons: "magnitude at distance left/right" measured from the pivot, e.g. "3 N at 20 cm left; 2 N at 30 cm right"; add "up" for an upward force; use "?" (or a letter, "F at 30 cm right") for the one unknown force, or "2 N at ? cm right" for an unknown distance — the code solves it for balance). length (beam length, default 100), pivot (the pivot's distance from the left end, default the middle), units ("cm" default or "m"), beamWeight (the beam's own weight in N, acting at its centre; default 0), showReaction (true draws the pivot's upward reaction force). The code computes every moment = force × distance, the total clockwise and anticlockwise moments (N cm or N m) and whether the beam balances.`,
  match: /\b(moments? (of a force|about a pivot)|principle of moments|clockwise moments?|anticlockwise moments?|turning (effect|forces?)|see-?saw|lever( arm)?s?|pivot(ed)? (beam|rule)|metre rule (on|balanced)|balanced beam|fulcrum)\b/i,
  parts: [
    { id: "pivot", name: "Pivot" },
    { id: "beam", name: "Beam" },
    { id: "force-1", name: "First force" },
    { id: "force-2", name: "Second force" },
    { id: "force-3", name: "Third force" },
    { id: "force-4", name: "Fourth force" },
    { id: "beam-weight", name: "Weight of the beam" },
    { id: "reaction", name: "Reaction at the pivot" },
    { id: "distance-1", name: "Distance of the first force" },
    { id: "distance-2", name: "Distance of the second force" },
    { id: "distance-3", name: "Distance of the third force" },
    { id: "distance-4", name: "Distance of the fourth force" },
    { id: "clockwise-moment", name: "Clockwise moment" },
    { id: "anticlockwise-moment", name: "Anticlockwise moment" },
  ],
  build(params: FigureParams) {
    const r = solveMoments(params);
    const showR = bool(params.showReaction ?? params.reaction, false);
    const mu = `N ${r.lenUnit}`;
    const sk = new Sketch();
    const BEAM_W = 560;
    const s = BEAM_W / r.length;
    const X = (d: number, side: number) => (r.pivot + side * d) * s; // distance from pivot → x
    const px = r.pivot * s;
    const top = -8, bot = 8;

    // Beam and pivot (a triangle on hatched ground).
    sk.polygon([{ x: 0, y: top }, { x: BEAM_W, y: top }, { x: BEAM_W, y: bot }, { x: 0, y: bot }], { fill: "wood", stroke: "ink", width: 2, part: "beam" });
    sk.polygon([{ x: px, y: bot }, { x: px - 22, y: bot + 40 }, { x: px + 22, y: bot + 40 }], { fill: "metal", stroke: "ink", width: 2, part: "pivot" });
    sk.line([{ x: px - 40, y: bot + 40 }, { x: px + 40, y: bot + 40 }], { stroke: "ink", width: 2, part: "pivot" });
    for (let x = px - 36; x <= px + 36; x += 10) sk.line([{ x, y: bot + 41 }, { x: x - 8, y: bot + 50 }], { stroke: "ink", width: 1.2, part: "pivot" }, false);
    sk.part("pivot", `Pivot (${r.unsolvable ? "cannot balance" : r.balanced ? "balanced" : r.clockwise > r.anticlockwise ? "turns clockwise" : "turns anticlockwise"})`, { x: px, y: bot + 26 });
    // The beam's anchor: the spot along it farthest from every force and the pivot.
    const busy = [px, ...r.forces.map((f) => X(f.d, f.side)), ...(r.weight ? [BEAM_W / 2] : [])];
    const beamX = [16, BEAM_W - 16, BEAM_W * 0.25, BEAM_W * 0.75].map((x) => ({ x, gap: Math.min(...busy.map((b) => Math.abs(b - x))) })).sort((a, b) => b.gap - a.gap)[0].x;
    sk.part("beam", r.weight ? "Beam" : "Beam (uniform)", { x: beamX, y: 0 });

    // Forces to scale: the largest is 120 long.
    const shown = r.forces.map((f) => ({ ...f, unknownLeft: !!(f.unknown && r.unsolvable) }));
    const Fmax = Math.max(...shown.map((f) => f.F), r.weight?.W ?? 0, 1e-9); // the applied forces set the scale
    const L = (F: number) => Math.max(16, (120 * F) / Fmax);
    const valueText = (f: (typeof shown)[number]) => (f.unknownLeft ? `${f.label ?? "F"} = ?` : f.unknown === "F" ? `${f.label ?? "F"} = ${show(f.F, 2)} N` : `${show(f.F, 2)} N`);
    const dimsBySide: Record<string, number> = { "-1": 0, "1": 0 };
    shown.forEach((f, k) => {
      const x = X(f.d, f.side);
      const len = L(f.F);
      const colour = [INK.red, INK.blue, INK.green, INK.violet][k];
      const part = `force-${k + 1}`;
      if (f.up) arrowTo(sk, { x, y: bot + len + (Math.abs(x - px) < 30 ? 44 : 0) }, { x, y: bot }, colour, part, 3.4, 14);
      else arrowTo(sk, { x, y: top - len }, { x, y: top }, colour, part, 3.4, 14);
      const tail = f.up ? { x, y: bot + len + (Math.abs(x - px) < 30 ? 44 : 0) } : { x, y: top - len };
      sk.placeText(valueText(f), 16, tail, { x: 0, y: f.up ? 1 : -1 }, { min: 12, max: 50, fill: colour, part, slide: { x: 1, y: 0 } });
      sk.part(part, f.unknown === "F" ? `Force for balance (${f.unknownLeft ? "cannot balance" : `${show(f.F, 2)} N`})` : `${show(f.F, 2)} N force${f.up ? " (upwards)" : ""}`, { x, y: f.up ? bot + len * 0.55 : top - len * 0.55 });
      // Distance from the pivot, as a dimension line below the ground (stacked per side).
      const row = dimsBySide[String(f.side)]++;
      const y = bot + 74 + row * 30;
      sk.line([{ x, y: bot + 4 }, { x, y: y + 6 }], { stroke: "muted", width: 1, dash: "3 4" }, false);
      sk.line([{ x: px, y: bot + 52 }, { x: px, y: y + 6 }], { stroke: "muted", width: 1, dash: "3 4" }, false);
      const dpart = `distance-${k + 1}`;
      arrowTo(sk, { x: (x + px) / 2, y }, { x, y }, "ink", dpart, 1.6, 9);
      arrowTo(sk, { x: (x + px) / 2, y }, { x: px, y }, "ink", dpart, 1.6, 9);
      const dText = f.unknown === "d" ? (f.unknownLeft ? "d = ?" : `d = ${show(f.d, 2)} ${r.lenUnit}`) : `${show(f.d, 2)} ${r.lenUnit}`;
      sk.placeText(dText, 15, { x: (x + px) / 2, y }, { x: 0, y: 1 }, { min: 11, max: 30, part: dpart, slide: { x: 1, y: 0 } });
      sk.part(dpart, f.unknown === "d" ? `Distance for balance (${f.unknownLeft ? "cannot balance" : `${show(f.d, 2)} ${r.lenUnit}`})` : `${show(f.d, 2)} ${r.lenUnit} from the pivot`, { x: x + (px > x ? 14 : -14), y });
    });

    // The beam's weight at its centre; the reaction at the pivot.
    if (r.weight) {
      const x = BEAM_W / 2;
      const len = L(r.weight.W);
      arrowTo(sk, { x, y: top - len }, { x, y: top }, INK.amber, "beam-weight", 3.4, 14);
      sk.placeText(`W = ${show(r.weight.W, 2)} N`, 16, { x, y: top - len }, { x: 0, y: -1 }, { min: 12, max: 50, fill: INK.amber, part: "beam-weight", slide: { x: 1, y: 0 } });
      sk.part("beam-weight", `Weight of the beam (${show(r.weight.W, 2)} N, at its centre)`, { x, y: top - len * 0.55 });
    }
    if (showR && r.reaction > 0) {
      const len = Math.min(200, L(r.reaction));
      arrowTo(sk, { x: px, y: top }, { x: px, y: top - len }, "ink", "reaction", 3, 14);
      sk.placeText(`R = ${show(r.reaction, 2)} N`, 16, { x: px, y: top - len }, { x: 0, y: -1 }, { min: 12, max: 50, part: "reaction", slide: { x: 1, y: 0 } });
      sk.part("reaction", `Reaction at the pivot (${show(r.reaction, 2)} N)`, { x: px, y: top - len * 0.55 });
    }

    // Turning arrows: anticlockwise on the left of the pivot, clockwise on the right, with the totals.
    const turn = (cx: number, clockwise: boolean, part: string, value: number) => {
      const c: Pt = { x: cx, y: bot + 32 }, rr = 14;
      const a0 = clockwise ? -Math.PI * 0.95 : -Math.PI * 0.05;
      const pts = Array.from({ length: 19 }, (_, j) => polar(c, rr, a0 + ((clockwise ? 1 : -1) * (Math.PI * 1.4) * j) / 18));
      sk.line(pts, { stroke: INK.violet, width: 2.2, part });
      const end = pts[pts.length - 1], prev = pts[pts.length - 2];
      arrowTo(sk, prev, { x: end.x + (end.x - prev.x) * 1.5, y: end.y + (end.y - prev.y) * 1.5 }, INK.violet, part, 2.2, 9);
      // The total goes under its arrow, out of the lane a label's leader takes to reach it.
      sk.placeText(`${show(value, 2)} ${mu}`, 15, { x: cx, y: c.y + 16 }, { x: 0, y: 1 }, { min: 10, max: 60, fill: INK.violet, part, slide: { x: 1, y: 0 } });
      return c;
    };
    const leftRoom = px, rightRoom = BEAM_W - px;
    if (leftRoom > 60) sk.part("anticlockwise-moment", `Anticlockwise moment: ${show(r.anticlockwise, 2)} ${mu}`, turn(Math.max(30, px - Math.min(110, leftRoom * 0.5)), false, "anticlockwise-moment", r.anticlockwise));
    else sk.part("anticlockwise-moment", `Anticlockwise moment: ${show(r.anticlockwise, 2)} ${mu}`, { x: px - 10, y: top });
    if (rightRoom > 60) sk.part("clockwise-moment", `Clockwise moment: ${show(r.clockwise, 2)} ${mu}`, turn(Math.min(BEAM_W - 30, px + Math.min(110, rightRoom * 0.5)), true, "clockwise-moment", r.clockwise));
    else sk.part("clockwise-moment", `Clockwise moment: ${show(r.clockwise, 2)} ${mu}`, { x: px + 10, y: top });
    return sk.finish(16);
  },
};
