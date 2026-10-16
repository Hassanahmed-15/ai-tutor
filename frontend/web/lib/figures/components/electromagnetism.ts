import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, add, bool, mul, num, sub, unit } from "./mathsKit";
import { INK, arrowTo, ray, show } from "./physicsKit2";

/**
 * ELECTROMAGNETIC DEVICES as textbook schematics: solenoid, d.c. motor, a.c. generator, transformer,
 * relay and electric bell. The model picks the device and the numbers; code decides the physics:
 *   solenoid    right-hand grip rule: current anticlockwise seen from an end makes that end N;
 *   motor       F = I L × B (Fleming's left-hand rule) on the two sides of the coil, which turn it;
 *               the split-ring commutator reverses the current every half turn;
 *   generator   the side moving up through B → induced current by Fleming's right-hand rule; slip
 *               rings keep each coil end on its own brush (a.c. output);
 *   transformer Vs / Vp = Ns / Np (and Is = Vp·Ip / Vs for an ideal transformer);
 *   relay/bell  the energised coil attracts the soft-iron armature.
 */

type Device = "solenoid" | "dc-motor" | "ac-generator" | "transformer" | "relay" | "electric-bell";
const N_INK: Ink = INK.red, S_INK: Ink = INK.blue;

function deviceOf(v: unknown): Device {
  const s = String(v ?? "").toLowerCase();
  if (/transform/.test(s)) return "transformer";
  if (/generat|dynamo|alternat/.test(s)) return "ac-generator";
  if (/motor/.test(s)) return "dc-motor";
  if (/relay/.test(s)) return "relay";
  if (/bell/.test(s)) return "electric-bell";
  return "solenoid";
}

/** Transformer equation: Vs = Vp × Ns / Np, and the ideal-transformer secondary current. */
export function transformer(np: number, ns: number, vp: number, ip?: number): { vs: number; is?: number; kind: "step-up" | "step-down" | "isolating" } {
  const vs = (vp * ns) / np;
  return { vs, ...(ip !== undefined && vs > 0 ? { is: (vp * ip) / vs } : {}), kind: ns > np ? "step-up" : ns < np ? "step-down" : "isolating" };
}

/* ── drawing pieces ─────────────────────────────────────────────────────────────────────────── */

const wire = (sk: Sketch, pts: Pt[], part?: string) => sk.line(pts, { stroke: "ink", width: 2.2, ...(part ? { part } : {}) });

/** A cell on a horizontal wire centred at c: long plate (+) on the `plus` side. */
function cell(sk: Sketch, c: Pt, plus: -1 | 1, part: string) {
  const g = 7;
  const longX = c.x + plus * g, shortX = c.x - plus * g;
  sk.line([{ x: longX, y: c.y - 20 }, { x: longX, y: c.y + 20 }], { stroke: "ink", width: 2.6, part });
  sk.line([{ x: shortX, y: c.y - 10 }, { x: shortX, y: c.y + 10 }], { stroke: "ink", width: 5, part });
  sk.text({ x: longX + plus * 8, y: c.y - 26 }, "+", 16, "ink", part);
  sk.text({ x: shortX - plus * 8, y: c.y - 26 }, "−", 16, "ink", part);
  return { left: { x: Math.min(longX, shortX), y: c.y }, right: { x: Math.max(longX, shortX), y: c.y } };
}
/** An a.c. supply: a circle with a sine wave. */
function acSupply(sk: Sketch, c: Pt, part: string) {
  sk.circle(c, 18, { fill: "paper", stroke: "ink", width: 2.2, part });
  const pts = Array.from({ length: 21 }, (_, k) => ({ x: c.x - 11 + (22 * k) / 20, y: c.y - 6 * Math.sin((2 * Math.PI * k) / 20) }));
  sk.line(pts, { stroke: "ink", width: 1.8, part }, false);
}
function lamp(sk: Sketch, c: Pt, part: string, r = 16) {
  sk.circle(c, r, { fill: "paper", stroke: "ink", width: 2.2, part });
  const k = r * 0.7;
  sk.line([{ x: c.x - k, y: c.y - k }, { x: c.x + k, y: c.y + k }], { stroke: "ink", width: 1.8, part }, false);
  sk.line([{ x: c.x - k, y: c.y + k }, { x: c.x + k, y: c.y - k }], { stroke: "ink", width: 1.8, part }, false);
}
function meter(sk: Sketch, c: Pt, letter: string, part: string) {
  sk.circle(c, 17, { fill: "paper", stroke: "ink", width: 2.2, part });
  sk.text(c, letter, 17, "ink", part);
}
/** A bar-magnet pole block with its letter. */
function pole(sk: Sketch, pts: Pt[], letterAt: Pt, north: boolean, part: string) {
  sk.polygon(pts, { fill: north ? N_INK : S_INK, stroke: "ink", width: 2, opacity: 0.9, part });
  sk.text(letterAt, north ? "N" : "S", 24, "paper", part);
}
/**
 * Coil turns round a horizontal former from x0 to x1 (half-height h about y0): back strands thin and
 * muted, front strands bold, each front strand rising left→right. `between` draws a core between them.
 */
function helix(sk: Sketch, x0: number, x1: number, y0: number, h: number, turns: number, part: string, between?: () => void) {
  const p = (x1 - x0) / turns;
  for (let k = 0; k < turns; k++) sk.line([{ x: x0 + k * p + p / 2, y: y0 - h }, { x: x0 + (k + 1) * p, y: y0 + h }], { stroke: INK.amber, width: 1.6, opacity: 0.55, part }, false);
  between?.();
  const fronts: Array<[Pt, Pt]> = [];
  for (let k = 0; k < turns; k++) {
    const a = { x: x0 + k * p, y: y0 + h }, b = { x: x0 + k * p + p / 2, y: y0 - h };
    sk.line([a, b], { stroke: INK.amber, width: 3, part });
    fronts.push([a, b]);
  }
  return fronts;
}
/** The same round a vertical former from y0 to y1 (half-width w about x0); front strands fall left→right. */
function helixV(sk: Sketch, y0: number, y1: number, x0: number, w: number, turns: number, part: string, between?: () => void) {
  const p = (y1 - y0) / turns;
  for (let k = 0; k < turns; k++) sk.line([{ x: x0 + w, y: y0 + k * p + p / 2 }, { x: x0 - w, y: y0 + (k + 1) * p }], { stroke: INK.amber, width: 1.6, opacity: 0.55, part }, false);
  between?.();
  for (let k = 0; k < turns; k++) sk.line([{ x: x0 - w, y: y0 + k * p }, { x: x0 + w, y: y0 + k * p + p / 2 }], { stroke: INK.amber, width: 3, part });
}

/* ── the devices ────────────────────────────────────────────────────────────────────────────── */

function solenoid(sk: Sketch, params: FigureParams) {
  const reverse = /^clock|cw$/i.test(String(params.current ?? "").trim()) || bool(params.reverse, false);
  const withCore = bool(params.core, true);
  const leftN = !reverse; // anticlockwise seen from the left end (current up the front strands) → left end N
  const turns = Math.round(num(params.turns, 8, 4, 14));
  const x0 = -150, x1 = 150, h = 48;
  // Field: lines inside run S→N, outside N→S, closing round the ends like a bar magnet's.
  const fieldInk: Ink = "muted";
  for (const yy of [-22, 0, 22]) {
    sk.line([{ x: x0 - 30, y: yy }, { x: x1 + 30, y: yy }], { stroke: fieldInk, width: 1.4, dash: "6 5", part: "field" }, false);
    const at = { x: yy === 0 ? 0 : yy < 0 ? -60 : 60, y: yy };
    arrowTo(sk, add(at, { x: leftN ? 9 : -9, y: 0 }), add(at, { x: leftN ? -9 : 9, y: 0 }), fieldInk, "field", 1.4, 11);
  }
  for (const [lift, sgn] of [[95, -1], [140, -1], [95, 1], [140, 1]] as const) {
    const pts: Pt[] = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40, a = Math.PI * t;
      pts.push({ x: -(x1 + 30) * Math.cos(a), y: sgn * (lift * Math.sin(a) + 22 * (1 - Math.sin(a))) });
    }
    sk.line(pts, { stroke: fieldInk, width: 1.4, dash: "6 5", part: "field" }, false);
    const mid = pts[20], dir = leftN ? 1 : -1;
    arrowTo(sk, add(mid, { x: -9 * dir, y: 0 }), add(mid, { x: 9 * dir, y: 0 }), fieldInk, "field", 1.4, 11);
  }
  const fronts = helix(sk, x0, x1, 0, h, turns, "coil", withCore ? () => sk.polygon([{ x: x0 - 22, y: -26 }, { x: x1 + 22, y: -26 }, { x: x1 + 22, y: 26 }, { x: x0 - 22, y: 26 }], { fill: "metal", stroke: "ink", width: 2, part: "core" }) : undefined);
  // Current arrows on two front strands; leads to + and − terminals below.
  for (const k of [1, turns - 2]) {
    const [a, b] = fronts[k];
    ray(sk, reverse ? b : a, reverse ? a : b, INK.amber, "current", { arrow: true, width: 0.01 });
  }
  const leadL = { x: x0, y: h }, leadR = { x: x1, y: h };
  wire(sk, [leadL, { x: x0, y: 200 }, { x: -40, y: 200 }]);
  wire(sk, [leadR, { x: x1, y: 200 }, { x: 40, y: 200 }]);
  sk.circle({ x: -40, y: 200 }, 5, { fill: "paper", stroke: "ink", width: 2, part: "supply" });
  sk.circle({ x: 40, y: 200 }, 5, { fill: "paper", stroke: "ink", width: 2, part: "supply" });
  // Conventional current enters at the + terminal: the left lead when the front strands carry it upwards.
  sk.text({ x: -40, y: 222 }, reverse ? "−" : "+", 20, "ink", "supply");
  sk.text({ x: 40, y: 222 }, reverse ? "+" : "−", 20, "ink", "supply");
  arrowTo(sk, { x: x0, y: reverse ? 120 : 160 }, { x: x0, y: reverse ? 160 : 120 }, INK.amber, "current", 2.2, 12);
  sk.text({ x: x0 + 16, y: 140 }, "I", 18, INK.amber, "current");
  const nX = leftN ? x0 - 62 : x1 + 62, sX = leftN ? x1 + 62 : x0 - 62;
  sk.text({ x: nX, y: -2 }, "N", 26, N_INK, "north-pole");
  sk.text({ x: sX, y: -2 }, "S", 26, S_INK, "south-pole");
  sk.part("coil", `Coil (${turns} turns)`, fronts[Math.floor(turns / 2)][0]);
  if (withCore) sk.part("core", "Soft iron core", { x: x0 - 16, y: 12 });
  sk.part("north-pole", "North pole", { x: nX + (nX < 0 ? -12 : 12), y: -6 });
  sk.part("south-pole", "South pole", { x: sX + (sX < 0 ? -12 : 12), y: -6 });
  sk.part("field", "Magnetic field lines", { x: 0, y: -140 });
  sk.part("current", "Current", { x: x0, y: 140 });
  sk.part("supply", "d.c. supply", { x: 40, y: 200 });
}

/** Cabinet projection: X right, Y up, Z towards the viewer (drawn down and to the left). */
const proj = (X: number, Y: number, Z: number): Pt => ({ x: X - 0.3 * Z, y: -Y + 0.42 * Z });

function rotor(sk: Sketch, params: FigureParams, generator: boolean) {
  const reverse = bool(params.reverse, false) || /revers|anti/i.test(String(params.current ?? params.rotation ?? ""));
  const a = 110, b = 80;
  const A = proj(-a, 0, -b), B = proj(-a, 0, b), C = proj(a, 0, b), D = proj(a, 0, -b);
  // Magnets: N on the left, S on the right (a block each: back-face, top, and the face towards the coil).
  const block = (x0: number, x1: number, north: boolean) => {
    const f = [proj(x0, 70, b), proj(x1, 70, b), proj(x1, -70, b), proj(x0, -70, b)];
    const top = [proj(x0, 70, -b), proj(x1, 70, -b), proj(x1, 70, b), proj(x0, 70, b)];
    const inner = north ? [proj(x1, 70, -b), proj(x1, -70, -b), proj(x1, -70, b), proj(x1, 70, b)] : [proj(x0, 70, -b), proj(x0, -70, -b), proj(x0, -70, b), proj(x0, 70, b)];
    const part = north ? "north-pole" : "south-pole";
    sk.polygon(inner, { fill: north ? N_INK : S_INK, stroke: "ink", width: 1.6, opacity: 0.55, part });
    sk.polygon(top, { fill: north ? N_INK : S_INK, stroke: "ink", width: 1.6, opacity: 0.7, part });
    const c = proj((x0 + x1) / 2, 0, b);
    pole(sk, f, c, north, part);
    return c;
  };
  const nC = block(-220, -150, true), sC = block(150, 220, false);
  // Field from N to S across the gap.
  for (const [Y, Z] of [[35, -40], [-35, 40]] as const) {
    const p = proj(-150, Y, Z), q = proj(150, Y, Z);
    sk.line([p, q], { stroke: "muted", width: 1.3, dash: "6 5", part: "field" }, false);
    arrowTo(sk, sub(add(p, mul(sub(q, p), 0.82)), mul(unit(sub(q, p)), 9)), add(p, mul(sub(q, p), 0.82)), "muted", "field", 1.3, 11);
  }
  // The coil (one rectangle drawn heavy) and its ends running to the front of the axle.
  const coilInk: Ink = INK.amber;
  sk.line([B, A, D, C], { stroke: coilInk, width: 3.4, part: "coil" });
  const axleZ = b + 70;
  const hub = proj(0, 0, axleZ);
  const r = 22;
  let toLeft: Pt, toRight: Pt;
  if (!generator) {
    // Split-ring commutator: two half rings (gaps top and bottom), brushes pressing on left and right.
    const arcPts = (from: number, to: number) => Array.from({ length: 13 }, (_, k) => add(hub, { x: r * Math.cos(from + ((to - from) * k) / 12), y: r * Math.sin(from + ((to - from) * k) / 12) }));
    sk.line(arcPts(Math.PI / 2 + 0.25, (3 * Math.PI) / 2 - 0.25), { stroke: "metal", width: 7, part: "commutator" });
    sk.line(arcPts(-Math.PI / 2 + 0.25, Math.PI / 2 - 0.25), { stroke: "metal", width: 7, part: "commutator" });
    sk.line(arcPts(Math.PI / 2 + 0.25, (3 * Math.PI) / 2 - 0.25), { stroke: "ink", width: 1.2, part: "commutator" }, false);
    sk.line(arcPts(-Math.PI / 2 + 0.25, Math.PI / 2 - 0.25), { stroke: "ink", width: 1.2, part: "commutator" }, false);
    wire(sk, [B, proj(-a * 0.25, 0, axleZ - 26), add(hub, { x: -r, y: 0 })], "coil");
    wire(sk, [C, proj(a * 0.25, 0, axleZ - 26), add(hub, { x: r, y: 0 })], "coil");
    const bw = 22, bh = 14;
    sk.polygon([{ x: hub.x - r - 4 - bw, y: hub.y - bh / 2 }, { x: hub.x - r - 4, y: hub.y - bh / 2 }, { x: hub.x - r - 4, y: hub.y + bh / 2 }, { x: hub.x - r - 4 - bw, y: hub.y + bh / 2 }], { fill: "#374151", stroke: "ink", width: 1.6, part: "brushes" });
    sk.polygon([{ x: hub.x + r + 4, y: hub.y - bh / 2 }, { x: hub.x + r + 4 + bw, y: hub.y - bh / 2 }, { x: hub.x + r + 4 + bw, y: hub.y + bh / 2 }, { x: hub.x + r + 4, y: hub.y + bh / 2 }], { fill: "#374151", stroke: "ink", width: 1.6, part: "brushes" });
    toLeft = { x: hub.x - r - 4 - bw, y: hub.y };
    toRight = { x: hub.x + r + 4 + bw, y: hub.y };
    sk.part("commutator", "Split-ring commutator", add(hub, { x: 0, y: -r }));
    sk.part("brushes", "Carbon brushes", { x: toRight.x - 6, y: toRight.y });
  } else {
    // Two slip rings along the axle; each coil end keeps to its own ring and brush.
    const h1 = proj(0, 0, axleZ - 20), h2 = proj(0, 0, axleZ + 110);
    // The axle; one coil end runs to the near ring, the other inside the axle (dashed) to the far one.
    const hubB = proj(0, 0, b + 14);
    sk.line([hubB, h2], { stroke: "ink", width: 5, opacity: 0.35 }, false);
    sk.circle(h1, 18, { fill: "none", stroke: "metal", width: 6, part: "slip-rings" });
    sk.circle(h2, 18, { fill: "none", stroke: "metal", width: 6, part: "slip-rings" });
    wire(sk, [B, proj(-a * 0.3, 0, axleZ - 20), add(h1, { x: -18, y: 0 })], "coil");
    wire(sk, [C, proj(a * 0.2, 0, b + 14), hubB], "coil");
    sk.line([hubB, h2], { stroke: "ink", width: 1.6, dash: "4 4", part: "coil" }, false);
    for (const h of [h1, h2]) sk.polygon([{ x: h.x - 7, y: h.y + 21 }, { x: h.x + 7, y: h.y + 21 }, { x: h.x + 7, y: h.y + 41 }, { x: h.x - 7, y: h.y + 41 }], { fill: "#374151", stroke: "ink", width: 1.6, part: "brushes" });
    toLeft = { x: h1.x, y: h1.y + 41 };
    toRight = { x: h2.x, y: h2.y + 41 };
    sk.part("slip-rings", "Slip rings", add(h2, { x: -18, y: 0 }));
    sk.part("brushes", "Carbon brushes", { x: h2.x + 7, y: h2.y + 31 });
  }
  // Current: motor — the + brush feeds the right side, so it runs C→D (back) on the right and A→B
  // (front) on the left; F = I L × B gives up on the left side, down on the right. Generator — the
  // left side is driven up through B, so v × B drives current to the back along it (B→A).
  const leftUp = generator ? !reverse : !reverse;
  const leftCurrentFront = generator ? reverse : !reverse; // current on the left side flows towards the front?
  const along = (p: Pt, q: Pt, forward: boolean) => (forward ? [p, q] : [q, p]) as [Pt, Pt];
  const [l1, l2] = along(A, B, leftCurrentFront), [r1, r2] = along(D, C, !leftCurrentFront);
  ray(sk, l1, l2, coilInk, "current", { width: 0.01, at: 0.3 });
  ray(sk, r1, r2, coilInk, "current", { width: 0.01, at: 0.7 });
  const lMid = add(A, mul(sub(B, A), 0.5)), rMid = add(D, mul(sub(C, D), 0.5));
  if (!generator) {
    arrowTo(sk, lMid, add(lMid, { x: 0, y: leftUp ? -78 : 78 }), INK.red, "force", 3.4, 14);
    arrowTo(sk, rMid, add(rMid, { x: 0, y: leftUp ? 78 : -78 }), INK.red, "force", 3.4, 14);
    sk.text(add(lMid, { x: -16, y: leftUp ? -64 : 64 }), "F", 19, INK.red, "force");
    sk.text(add(rMid, { x: 16, y: leftUp ? 64 : -64 }), "F", 19, INK.red, "force");
    sk.part("force", "Force (left-hand rule)", add(lMid, { x: 0, y: leftUp ? -40 : 40 }));
  } else {
    // Rotation: a curved arrow round the back of the axle (the coil is turned by an outside force).
    const c = proj(0, 0, -b - 80);
    const pts = Array.from({ length: 17 }, (_, k) => { const t = Math.PI * (0.15 + (1.1 * k) / 16) * (leftUp ? -1 : 1); return add(c, { x: 40 * Math.cos(t + Math.PI), y: 18 * Math.sin(t + Math.PI) }); });
    sk.line(pts, { stroke: INK.violet, width: 2.4, part: "rotation" });
    arrowTo(sk, pts[pts.length - 2], add(pts[pts.length - 1], mul(sub(pts[pts.length - 1], pts[pts.length - 2]), 1.2)), INK.violet, "rotation", 2.4, 11);
    sk.part("rotation", `Rotation (${leftUp ? "anticlockwise" : "clockwise"})`, pts[8]);
  }
  sk.text(add(lMid, { x: -20, y: 22 }), "I", 18, coilInk, "current");
  // External circuit below: a cell for the motor, a meter for the generator.
  const yb = Math.max(toLeft.y, toRight.y) + 90;
  const midX = (toLeft.x + toRight.x) / 2;
  if (!generator) {
    wire(sk, [toLeft, { x: toLeft.x - 30, y: toLeft.y }, { x: toLeft.x - 30, y: yb }, { x: midX - 7, y: yb }]);
    wire(sk, [toRight, { x: toRight.x + 30, y: toRight.y }, { x: toRight.x + 30, y: yb }, { x: midX + 7, y: yb }]);
    cell(sk, { x: midX, y: yb }, reverse ? -1 : 1, "supply");
    sk.part("supply", "d.c. supply", { x: midX + (reverse ? -7 : 7), y: yb + 18 });
  } else {
    wire(sk, [toLeft, { x: toLeft.x, y: yb }, { x: midX - 17, y: yb }]);
    wire(sk, [toRight, { x: toRight.x, y: yb }, { x: midX + 17, y: yb }]);
    meter(sk, { x: midX, y: yb }, "V", "output");
    sk.part("output", "a.c. output (voltmeter)", { x: midX, y: yb + 17 });
  }
  sk.part("coil", "Coil", add(A, mul(sub(D, A), 0.3)));
  sk.part("north-pole", "North pole", add(nC, { x: 0, y: 30 }));
  sk.part("south-pole", "South pole", add(sC, { x: 0, y: 30 }));
  sk.part("field", "Magnetic field (N to S)", proj(100, 35, -40));
  sk.part("current", "Current", l1.x < l2.x ? add(l1, mul(sub(l2, l1), 0.3)) : add(l2, mul(sub(l1, l2), 0.7)));
}

function transformerDevice(sk: Sketch, params: FigureParams) {
  const np = Math.round(num(params.np ?? params.Np ?? params.primaryTurns, 200, 1, 1e6));
  let ns = Math.round(num(params.ns ?? params.Ns ?? params.secondaryTurns, NaN, 1, 1e6));
  const vp = num(params.vp ?? params.Vp ?? params.inputVoltage, 240, 0.001, 1e7);
  const vsGiven = num(params.vs ?? params.Vs, NaN, 0.001, 1e7);
  if (!Number.isFinite(ns)) ns = Number.isFinite(vsGiven) ? Math.max(1, Math.round((np * vsGiven) / vp)) : 50;
  const ip = num(params.ip ?? params.Ip, NaN, 0, 1e6);
  const t = transformer(np, ns, vp, Number.isFinite(ip) ? ip : undefined);
  // Core: a square frame of laminated iron.
  const X0 = -150, X1 = 150, Y0 = -120, Y1 = 120, w = 44;
  sk.path([
    { k: "M", p: { x: X0, y: Y0 } }, { k: "L", p: { x: X1, y: Y0 } }, { k: "L", p: { x: X1, y: Y1 } }, { k: "L", p: { x: X0, y: Y1 } }, { k: "L", p: { x: X0, y: Y0 } },
    { k: "M", p: { x: X0 + w, y: Y0 + w } }, { k: "L", p: { x: X0 + w, y: Y1 - w } }, { k: "L", p: { x: X1 - w, y: Y1 - w } }, { k: "L", p: { x: X1 - w, y: Y0 + w } }, { k: "L", p: { x: X0 + w, y: Y0 + w } },
  ], true, { fill: "metal", stroke: "ink", width: 2.2, part: "core" }, true);
  for (let k = 1; k < 4; k++) sk.line([{ x: X0 + w + 14 * k, y: Y0 + 3 }, { x: X0 + w + 14 * k, y: Y0 + w - 3 }], { stroke: "ink", width: 0.8, opacity: 0.5, part: "core" }, false);
  // Flux round the core.
  const f = w / 2;
  sk.line([{ x: X0 + f, y: Y0 + f }, { x: X1 - f, y: Y0 + f }, { x: X1 - f, y: Y1 - f }, { x: X0 + f, y: Y1 - f }, { x: X0 + f, y: Y0 + f }], { stroke: INK.violet, width: 1.4, dash: "5 5", opacity: 0.8, part: "field" }, false);
  arrowTo(sk, { x: -10, y: Y0 + f }, { x: 10, y: Y0 + f }, INK.violet, "field", 1.4, 11);
  arrowTo(sk, { x: 10, y: Y1 - f }, { x: -10, y: Y1 - f }, INK.violet, "field", 1.4, 11);
  // Coils: drawn turns proportional to the real turns (3–14).
  const most = Math.max(np, ns);
  const drawn = (n: number) => Math.max(3, Math.round((14 * n) / most));
  const pTurns = drawn(np), sTurns = drawn(ns);
  const lx = X0 + w / 2, rx = X1 - w / 2, top = Y0 + w + 8, bot = Y1 - w - 8;
  helixV(sk, top, bot, lx, w / 2 + 8, pTurns, "primary-coil");
  helixV(sk, top, bot, rx, w / 2 + 8, sTurns, "secondary-coil");
  // Leads: the a.c. supply on the left, a lamp on the right.
  const sx = X0 - 110, ox = X1 + 110;
  wire(sk, [{ x: lx - w / 2 - 8, y: top }, { x: sx, y: top }, { x: sx, y: -18 }]);
  wire(sk, [{ x: lx - w / 2 - 8, y: bot }, { x: sx, y: bot }, { x: sx, y: 18 }]);
  acSupply(sk, { x: sx, y: 0 }, "supply");
  wire(sk, [{ x: rx + w / 2 + 8, y: top }, { x: ox, y: top }, { x: ox, y: -16 }]);
  wire(sk, [{ x: rx + w / 2 + 8, y: bot }, { x: ox, y: bot }, { x: ox, y: 16 }]);
  lamp(sk, { x: ox, y: 0 }, "output");
  sk.text({ x: sx - 52, y: 0 }, `Vp = ${show(vp, 2)} V`, 15, "ink", "supply");
  sk.text({ x: ox + 52, y: 0 }, `Vs = ${show(t.vs, 2)} V`, 15, "ink", "output");
  sk.text({ x: lx, y: Y1 + 22 }, `Np = ${np}`, 15, INK.amber, "primary-coil");
  sk.text({ x: rx, y: Y1 + 22 }, `Ns = ${ns}`, 15, INK.amber, "secondary-coil");
  sk.part("primary-coil", `Primary coil (${np} turns)`, { x: lx - w / 2 - 6, y: (top + bot) / 2 - 10 });
  sk.part("secondary-coil", `Secondary coil (${ns} turns)`, { x: rx + w / 2 + 6, y: (top + bot) / 2 - 10 });
  sk.part("core", "Laminated soft iron core", { x: 0, y: Y0 + 6 });
  sk.part("field", "Changing magnetic field", { x: 0, y: Y1 - f });
  sk.part("supply", `a.c. supply (${show(vp, 2)} V)`, { x: sx, y: -18 });
  const cur = t.is !== undefined ? `, ${show(t.is, 2)} A` : "";
  sk.part("output", `Output ${show(t.vs, 2)} V${cur} (${t.kind})`, { x: ox, y: 16 });
}

function relay(sk: Sketch, params: FigureParams) {
  const on = bool(params.on ?? params.energised ?? params.switch, true);
  // Electromagnet: a vertical iron core with its coil.
  const cx = 0, cTop = 0, cBot = 130;
  helixV(sk, cTop + 12, cBot - 8, cx, 26, 8, "coil", () => sk.polygon([{ x: cx - 16, y: cTop }, { x: cx + 16, y: cTop }, { x: cx + 16, y: cBot }, { x: cx - 16, y: cBot }], { fill: "metal", stroke: "ink", width: 2, part: "core" }));
  // Armature: pivoted on a bracket at the left, lying over the core; pulled down when energised.
  const piv = { x: -70, y: -22 };
  const tilt = on ? 0.06 : -0.06;
  const end = { x: piv.x + 260, y: piv.y + 260 * tilt };
  sk.line([{ x: piv.x, y: piv.y }, { x: piv.x, y: cBot + 20 }], { stroke: "ink", width: 4, part: "pivot" });
  sk.polygon([piv, end, add(end, { x: 0, y: 10 }), add(piv, { x: 0, y: 10 })], { fill: "metal", stroke: "ink", width: 2, part: "armature" });
  sk.circle(add(piv, { x: 0, y: 5 }), 5, { fill: "paper", stroke: "ink", width: 2, part: "pivot" });
  // Contacts: an insulating pusher under the armature's end presses the upper spring onto the lower one.
  const kx = end.x - 6;
  const upperY = end.y + 26, lowerY = on ? upperY + 8 : upperY + 22;
  sk.line([{ x: kx, y: end.y + 10 }, { x: kx, y: upperY }], { stroke: "ink", width: 4, part: "contacts" });
  sk.line([{ x: kx - 20, y: upperY }, { x: kx + 90, y: upperY }], { stroke: "ink", width: 2.6, part: "contacts" });
  sk.line([{ x: kx - 20, y: lowerY + 14 }, { x: kx + 90, y: lowerY + 14 }], { stroke: "ink", width: 2.6, part: "contacts" });
  sk.circle({ x: kx, y: upperY + 4 }, 4, { fill: "metal", stroke: "ink", width: 1.4, part: "contacts" });
  sk.circle({ x: kx, y: lowerY + 10 }, 4, { fill: "metal", stroke: "ink", width: 1.4, part: "contacts" });
  // Output circuit: the contacts' strips to a lamp and its own supply on the right.
  const ox = kx + 150;
  wire(sk, [{ x: kx + 90, y: upperY }, { x: ox, y: upperY }, { x: ox, y: upperY + 40 }]);
  lamp(sk, { x: ox, y: upperY + 56 }, "output");
  wire(sk, [{ x: ox, y: upperY + 72 }, { x: ox, y: cBot + 90 }, { x: kx + 107, y: cBot + 90 }]);
  cell(sk, { x: kx + 100, y: cBot + 90 }, 1, "output");
  wire(sk, [{ x: kx + 93, y: cBot + 90 }, { x: kx + 40, y: cBot + 90 }, { x: kx + 40, y: lowerY + 14 }]);
  // Input circuit: coil leads down to a switch and a cell.
  const lead0 = { x: cx - 26, y: cTop + 12 }, lead1 = { x: cx + 26, y: cBot - 8 };
  wire(sk, [lead0, { x: cx - 46, y: cTop + 12 }, { x: cx - 46, y: cBot + 90 }, { x: cx - 7, y: cBot + 90 }]);
  cell(sk, { x: cx, y: cBot + 90 }, -1, "supply");
  wire(sk, [{ x: cx + 7, y: cBot + 90 }, { x: cx + 40, y: cBot + 90 }]);
  const sw0 = { x: cx + 40, y: cBot + 90 }, sw1 = { x: cx + 80, y: cBot + 90 };
  sk.circle(sw0, 3.5, { fill: "paper", stroke: "ink", width: 1.8, part: "switch" });
  sk.circle(sw1, 3.5, { fill: "paper", stroke: "ink", width: 1.8, part: "switch" });
  sk.line([sw0, on ? sw1 : { x: sw1.x - 4, y: sw1.y - 20 }], { stroke: "ink", width: 2.4, part: "switch" });
  wire(sk, [sw1, { x: cx + 50 + 50, y: cBot + 90 }, { x: cx + 100, y: lead1.y }, lead1]);
  if (on) {
    arrowTo(sk, { x: 40, y: -60 }, { x: 40, y: -36 }, INK.red, "force", 2.6, 11);
  }
  sk.part("coil", "Coil", { x: cx + 26, y: 60 });
  sk.part("core", "Soft iron core", { x: cx, y: cBot - 2 });
  sk.part("armature", on ? "Iron armature (attracted)" : "Iron armature", { x: piv.x + 200, y: piv.y + 200 * tilt + 5 });
  sk.part("pivot", "Pivot", add(piv, { x: 0, y: 5 }));
  sk.part("contacts", on ? "Contacts (closed)" : "Contacts (open)", { x: kx + 60, y: upperY });
  sk.part("switch", on ? "Switch (closed)" : "Switch (open)", { x: (sw0.x + sw1.x) / 2, y: sw0.y - (on ? 0 : 10) });
  sk.part("supply", "Low-current circuit supply", { x: cx, y: cBot + 110 });
  sk.part("output", "High-current circuit", { x: ox + 16, y: upperY + 56 });
  if (on) sk.part("force", "Magnetic attraction", { x: 40, y: -50 });
}

function bell(sk: Sketch) {
  // U-shaped core lying on its side (poles to the right), a coil on each limb.
  const yA = 0, yB = 90, x0 = 0, x1 = 110, t = 20;
  sk.path([{ k: "M", p: { x: x1, y: yA - t / 2 } }, { k: "L", p: { x: x0, y: yA - t / 2 } }, { k: "L", p: { x: x0, y: yB + t / 2 } }, { k: "L", p: { x: x1, y: yB + t / 2 } }, { k: "L", p: { x: x1, y: yB - t / 2 } }, { k: "L", p: { x: x0 + t, y: yB - t / 2 } }, { k: "L", p: { x: x0 + t, y: yA + t / 2 } }, { k: "L", p: { x: x1, y: yA + t / 2 } }], true, { fill: "metal", stroke: "ink", width: 2, part: "core" }, true);
  helix(sk, 34, 100, yA, 18, 5, "coil");
  helix(sk, 34, 100, yB, 18, 5, "coil");
  wire(sk, [{ x: 100, y: yA + 18 }, { x: 104, y: yB - 18 }], "coil");
  // Armature: a soft-iron strip facing the poles, on a flat spring at the bottom, the hammer at its top.
  const ax = x1 + 14;
  sk.polygon([{ x: ax, y: -70 }, { x: ax + 9, y: -70 }, { x: ax + 9, y: yB + 34 }, { x: ax, y: yB + 34 }], { fill: "metal", stroke: "ink", width: 2, part: "armature" });
  sk.line([{ x: ax + 4, y: yB + 34 }, { x: ax + 4, y: yB + 70 }], { stroke: "ink", width: 2.2, part: "spring" });
  for (let k = 0; k < 4; k++) sk.line([{ x: ax - 2, y: yB + 40 + k * 8 }, { x: ax + 10, y: yB + 44 + k * 8 }], { stroke: "ink", width: 1.4, part: "spring" }, false);
  sk.polygon([{ x: ax - 16, y: yB + 70 }, { x: ax + 24, y: yB + 70 }, { x: ax + 24, y: yB + 82 }, { x: ax - 16, y: yB + 82 }], { fill: "wood", stroke: "ink", width: 1.6, part: "spring" });
  sk.line([{ x: ax + 4, y: -70 }, { x: ax + 4, y: -92 }], { stroke: "ink", width: 2.6, part: "hammer" });
  sk.circle({ x: ax + 4, y: -102 }, 11, { fill: "#374151", stroke: "ink", width: 1.6, part: "hammer" });
  // Gong: a dome just beyond the hammer.
  const g = { x: ax + 84, y: -112 };
  sk.path([{ k: "M", p: { x: g.x - 66, y: g.y + 22 } }, { k: "A", c: { x: g.x, y: g.y + 22 }, r: 66, to: { x: g.x + 66, y: g.y + 22 }, large: false, sweep: true }], false, { fill: "none", stroke: INK.amber, width: 5, part: "gong" }, true);
  sk.line([{ x: g.x, y: g.y - 44 }, { x: g.x, y: g.y - 60 }], { stroke: "ink", width: 3, part: "gong" });
  // Contact screw touching the spring contact on the armature.
  const cy = 40;
  sk.line([{ x: ax + 9, y: cy }, { x: ax + 70, y: cy }], { stroke: "ink", width: 4, part: "contacts" });
  for (let k = 0; k < 5; k++) sk.line([{ x: ax + 30 + k * 7, y: cy - 4 }, { x: ax + 34 + k * 7, y: cy + 4 }], { stroke: "paper", width: 1, part: "contacts" }, false);
  sk.polygon([{ x: ax + 70, y: cy - 20 }, { x: ax + 86, y: cy - 20 }, { x: ax + 86, y: yB + 82 }, { x: ax + 70, y: yB + 82 }], { fill: "wood", stroke: "ink", width: 1.6, part: "contacts" });
  // Circuit: cell and push switch below; coil → spring → armature → contact screw → back to the cell.
  const yb = yB + 140;
  wire(sk, [{ x: 34, y: yA - 18 }, { x: -40, y: yA - 18 }, { x: -40, y: yb }, { x: 20, y: yb }]);
  const s0 = { x: 20, y: yb }, s1 = { x: 64, y: yb };
  sk.circle(s0, 3.5, { fill: "paper", stroke: "ink", width: 1.8, part: "switch" });
  sk.circle(s1, 3.5, { fill: "paper", stroke: "ink", width: 1.8, part: "switch" });
  sk.line([{ x: s0.x - 2, y: yb - 14 }, { x: s1.x + 2, y: yb - 14 }], { stroke: "ink", width: 2.6, part: "switch" });
  sk.line([{ x: (s0.x + s1.x) / 2, y: yb - 14 }, { x: (s0.x + s1.x) / 2, y: yb - 26 }], { stroke: "ink", width: 2.2, part: "switch" });
  wire(sk, [s1, { x: 100, y: yb }]);
  cell(sk, { x: 107, y: yb }, -1, "supply");
  wire(sk, [{ x: 114, y: yb }, { x: ax + 78, y: yb }, { x: ax + 78, y: yB + 82 }]);
  wire(sk, [{ x: 34, y: yB + 18 }, { x: 34, y: yB + 40 }, { x: ax - 16, y: yB + 76 }]);
  sk.part("coil", "Electromagnet coil", { x: 67, y: yA + 18 });
  sk.part("core", "Soft iron core", { x: x0 + 10, y: (yA + yB) / 2 });
  sk.part("armature", "Soft iron armature", { x: ax + 4, y: -30 });
  sk.part("spring", "Spring strip", { x: ax + 4, y: yB + 52 });
  sk.part("hammer", "Hammer", { x: ax + 4, y: -102 });
  sk.part("gong", "Gong", { x: g.x + 60, y: g.y - 2 });
  sk.part("contacts", "Contact screw", { x: ax + 50, y: cy });
  sk.part("switch", "Push switch", { x: (s0.x + s1.x) / 2, y: yb - 14 });
  sk.part("supply", "Cell", { x: 107, y: yb + 20 });
}

export const electromagnetism: FigureComponent = {
  name: "electromagnetism",
  title: "Electromagnetic device: solenoid with its field and poles, d.c. motor (split-ring commutator), a.c. generator (slip rings), transformer, relay or electric bell, drawn as the standard textbook schematic",
  params: `device ("solenoid" default, "dc-motor", "ac-generator", "transformer", "relay", "electric-bell"). Solenoid: current ("anticlockwise" default = anticlockwise seen from the left end, making the left end N; "clockwise" reverses it), core (false = air-cored), turns (4–14). Motor / generator: reverse (true reverses the current / rotation). Transformer: np, ns (turns), vp (primary voltage), optional ip (primary current) or vs (gives ns); the code computes Vs = Vp × Ns / Np, the secondary current of an ideal transformer, and step-up/step-down. Relay: on (false shows it off, contacts open). The code places the poles by the right-hand grip rule, the forces on a motor coil by Fleming's left-hand rule and the generator current by the right-hand rule.`,
  match: /\b(solenoids?|electromagnets?|electric motors?|d\.?c\.? motors?|motor effect|split[- ]ring commutator|commutator|a\.?c\.? generators?|dynamos?|alternators?|slip rings?|transformers?|step[- ](up|down) transformers?|turns ratio|relays?(?=[\s\S]*\b(coils?|electromagnets?|switch(es)?|circuits?|current)\b)|electric bells?|fleming'?s (left|right)[- ]hand rule|right[- ]hand grip rule)\b/i,
  parts: [
    { id: "coil", name: "Coil" },
    { id: "core", name: "Soft iron core" },
    { id: "north-pole", name: "North pole" },
    { id: "south-pole", name: "South pole" },
    { id: "field", name: "Magnetic field" },
    { id: "current", name: "Current" },
    { id: "force", name: "Force" },
    { id: "commutator", name: "Split-ring commutator" },
    { id: "slip-rings", name: "Slip rings" },
    { id: "brushes", name: "Brushes" },
    { id: "rotation", name: "Rotation" },
    { id: "primary-coil", name: "Primary coil" },
    { id: "secondary-coil", name: "Secondary coil" },
    { id: "supply", name: "Supply" },
    { id: "output", name: "Output" },
    { id: "armature", name: "Armature" },
    { id: "pivot", name: "Pivot" },
    { id: "contacts", name: "Contacts" },
    { id: "switch", name: "Switch" },
    { id: "spring", name: "Spring" },
    { id: "hammer", name: "Hammer" },
    { id: "gong", name: "Gong" },
  ],
  build(params: FigureParams) {
    const device = deviceOf(params.device ?? params.type);
    const sk = new Sketch();
    if (device === "dc-motor") rotor(sk, params, false);
    else if (device === "ac-generator") rotor(sk, params, true);
    else if (device === "transformer") transformerDevice(sk, params);
    else if (device === "relay") relay(sk, params);
    else if (device === "electric-bell") bell(sk);
    else solenoid(sk, params);
    return sk.finish(16);
  },
};
