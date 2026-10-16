import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, add, angleMark, bool, deg, dot, mul, num, perp, rad, sub, unit } from "./mathsKit";
import { INK, ray, reflect, refract, show } from "./physicsKit2";

/**
 * REFLECTION AND REFRACTION OF LIGHT, the textbook ray diagrams. The model picks the set-up and the
 * numbers; code applies the laws:
 *   reflection   angle of reflection = angle of incidence (both from the normal);
 *   refraction   n1 sin i = n2 sin r (Snell's law);
 *   critical     sin c = n2 / n1 (n1 > n2), total internal reflection when i > c;
 *   prism        the ray is traced through both faces (or reflected inside when it exceeds c), and
 *                the deviation D is the angle between the incident and the emergent ray;
 *   dispersion   white light through a prism, each colour with its own n (red lowest, violet highest),
 *                so red is deviated least and the spectrum reads red → violet.
 */

type Setup = "plane-mirror" | "refraction" | "total-internal-reflection" | "prism" | "dispersion";

/** Snell's law: the angle of refraction (degrees) for incidence i from n1 into n2, or null (TIR). */
export function snell(iDeg: number, n1: number, n2: number): number | null {
  const s = (n1 * Math.sin(rad(iDeg))) / n2;
  return Math.abs(s) > 1 + 1e-12 ? null : deg(Math.asin(Math.max(-1, Math.min(1, s))));
}
/** Critical angle (degrees) going from n1 into n2; null unless n1 > n2. */
export function criticalAngle(n1: number, n2: number): number | null {
  return n1 > n2 ? deg(Math.asin(n2 / n1)) : null;
}

function setupOf(v: unknown): Setup {
  const s = String(v ?? "").toLowerCase();
  if (/disper|spectrum|rainbow|white light/.test(s)) return "dispersion";
  if (/prism/.test(s)) return "prism";
  if (/total|tir|critical|semi-?circ/.test(s)) return "total-internal-reflection";
  if (/refract|snell|glass block|boundary/.test(s)) return "refraction";
  if (/mirror|reflect/.test(s)) return "plane-mirror";
  return "refraction";
}
function mediumName(v: unknown, n: number): string {
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 30);
  if (Math.abs(n - 1) < 0.02) return "Air";
  if (Math.abs(n - 1.33) < 0.03) return "Water";
  if (n >= 1.4 && n <= 1.7) return "Glass";
  if (Math.abs(n - 2.42) < 0.05) return "Diamond";
  return "Medium";
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rot = (u: Pt, a: number): Pt => ({ x: u.x * Math.cos(a) - u.y * Math.sin(a), y: u.x * Math.sin(a) + u.y * Math.cos(a) });

const SPECTRUM: Array<{ name: string; ink: Ink }> = [
  { name: "red", ink: "#dc2626" }, { name: "orange", ink: "#ea580c" }, { name: "yellow", ink: "#eab308" }, { name: "green", ink: "#16a34a" },
  { name: "blue", ink: "#2563eb" }, { name: "indigo", ink: "#4338ca" }, { name: "violet", ink: "#7c3aed" },
];

export const reflectionRefraction: FigureComponent = {
  name: "reflectionRefraction",
  title: "Reflection and refraction ray diagram: plane mirror, refraction at a boundary (Snell's law), total internal reflection with the critical angle, a ray through a prism, or dispersion of white light into a spectrum",
  params: `setup ("plane-mirror"; "refraction" default — a ray crossing a flat boundary; "total-internal-reflection" — a ray inside a semicircular glass block meeting the flat face; "prism" — one ray through a triangular prism with its deviation; "dispersion" — white light split by a prism into red…violet). i (angle of incidence in degrees from the normal, default 40; 50 for TIR; 48 for a prism). n1 (refractive index of the medium the ray starts in, default 1.00 for refraction, 1.50 for TIR), n2 (the medium it enters, default 1.50 for refraction, 1.00 for TIR), n (prism index, default 1.5), apex (prism angle in degrees, default 60), medium1/medium2 (names, e.g. "air", "water"; default from n). partialReflection (true also draws the weak reflected ray at a boundary). The code applies the law of reflection and n1 sin i = n2 sin r, computes the critical angle (sin c = n2/n1), switches to total internal reflection when i > c, traces the prism ray and its deviation, and orders the spectrum red (least deviated) to violet. Angles are written on the arcs.`,
  match: /\b(refraction|refractive index|snell'?s law|angle of (incidence|reflection|refraction)|law of reflection|plane mirror|critical angle|total internal reflection|optical fibres?|(glass|triangular) prism|dispersion of (white )?light|(white light|light) (through|into) a prism|spectrum of white light|semicircular (glass )?block)\b/i,
  parts: [
    { id: "boundary", name: "Boundary" },
    { id: "normal", name: "Normal" },
    { id: "incident-ray", name: "Incident ray" },
    { id: "reflected-ray", name: "Reflected ray" },
    { id: "refracted-ray", name: "Refracted ray" },
    { id: "emergent-ray", name: "Emergent ray" },
    { id: "angle-of-incidence", name: "Angle of incidence" },
    { id: "angle-of-reflection", name: "Angle of reflection" },
    { id: "angle-of-refraction", name: "Angle of refraction" },
    { id: "critical-angle", name: "Critical angle" },
    { id: "deviation", name: "Angle of deviation" },
    { id: "medium-1", name: "First medium" },
    { id: "medium-2", name: "Second medium" },
    { id: "spectrum", name: "Spectrum" },
    { id: "red-light", name: "Red light (deviated least)" },
    { id: "violet-light", name: "Violet light (deviated most)" },
  ],
  build(params: FigureParams) {
    const setup = setupOf(params.setup);
    const sk = new Sketch();
    if (setup === "prism" || setup === "dispersion") buildPrism(sk, params, setup === "dispersion");
    else if (setup === "plane-mirror") buildMirror(sk, params);
    else buildBoundary(sk, params, setup === "total-internal-reflection");
    return sk.finish(18, { w: 520, h: 380 });
  },
};

const NORMAL = { stroke: "ink" as Ink, width: 1.8, dash: "8 6", part: "normal" };
const iOf = (params: FigureParams, fallback: number) => num(params.i ?? params.angle ?? params.incidence, fallback, 0, 85);

function buildMirror(sk: Sketch, params: FigureParams) {
  const i = iOf(params, 40);
  const L = 200, O = { x: 0, y: 0 };
  const half = 230;
  // Mirror: a thick line with the hatching of its silvered back underneath.
  sk.line([{ x: -half, y: 0 }, { x: half, y: 0 }], { stroke: "ink", width: 4, part: "boundary" });
  let hatch: Pt[] = [];
  for (let x = -half + 6; x <= half; x += 16) hatch = [{ x, y: 3 }, { x: x - 12, y: 16 }], sk.line(hatch, { stroke: "ink", width: 1.4, part: "boundary" }, false);
  sk.line([{ x: 0, y: -L - 10 }, { x: 0, y: 0 }], NORMAL);
  const s = Math.sin(rad(i)), c = Math.cos(rad(i));
  const S = { x: -L * s, y: -L * c }, R = { x: L * s, y: -L * c };
  ray(sk, S, O, INK.red, "incident-ray");
  ray(sk, O, R, INK.blue, "reflected-ray");
  const top = { x: 0, y: -L };
  const ai = i >= 2 ? angleMark(sk, O, top, S, { r: 58, text: `${show(i)}°`, colour: INK.red, part: "angle-of-incidence" }) : { x: -6, y: -40 };
  const ar = i >= 2 ? angleMark(sk, O, top, R, { r: 58, text: `${show(i)}°`, colour: INK.blue, part: "angle-of-reflection" }) : { x: 6, y: -40 };
  sk.part("boundary", "Plane mirror", { x: -half + 30, y: 0 });
  sk.part("normal", "Normal", { x: 0, y: -L - 4 });
  sk.part("incident-ray", "Incident ray", add(O, mul(S, 0.72)));
  sk.part("reflected-ray", "Reflected ray", add(O, mul(R, 0.72)));
  sk.part("angle-of-incidence", `Angle of incidence (${show(i)}°)`, ai);
  sk.part("angle-of-reflection", `Angle of reflection (${show(i)}°)`, ar);
}

function buildBoundary(sk: Sketch, params: FigureParams, tirSetup: boolean) {
  const n1 = num(params.n1, tirSetup ? 1.5 : 1.0, 1, 3);
  const n2 = num(params.n2, tirSetup ? 1.0 : 1.5, 1, 3);
  const i = iOf(params, tirSetup ? 50 : 40);
  const c = criticalAngle(n1, n2);
  const r = snell(i, n1, n2);
  const grazing = c !== null && Math.abs(i - c) < 0.25;
  const tir = r === null && !grazing;
  const partial = bool(params.partialReflection, tirSetup);
  const name1 = mediumName(params.medium1, n1), name2 = mediumName(params.medium2, n2);
  const O = { x: 0, y: 0 };
  // The incident medium is on top for a plain boundary, below (inside the block) for the TIR block,
  // so the ray always travels into the picture's middle: s = the side (−1 up, +1 down) it comes from.
  const s = tirSetup ? 1 : -1;
  const L = 200, R0 = 180, half = 240;

  // Media. The denser medium is tinted as glass/water.
  if (tirSetup) {
    sk.path([{ k: "M", p: { x: -R0, y: 0 } }, { k: "L", p: { x: R0, y: 0 } }, { k: "A", c: O, r: R0, to: { x: -R0, y: 0 }, large: false, sweep: true }], true, { fill: "glass", stroke: "ink", width: 2.4, part: "boundary" }, true);
  } else {
    const dense = n2 >= n1 ? 1 : -1; // which side is tinted
    if (Math.max(n1, n2) > 1.02) sk.polygon([{ x: -half, y: 0 }, { x: half, y: 0 }, { x: half, y: dense * 190 }, { x: -half, y: dense * 190 }], { fill: "glass", stroke: "none", part: dense === -s ? "medium-2" : "medium-1" }, false);
    sk.line([{ x: -half, y: 0 }, { x: half, y: 0 }], { stroke: "ink", width: 2.6, part: "boundary" });
  }
  const nLen = tirSetup ? R0 : 190;
  sk.line([{ x: 0, y: -nLen }, { x: 0, y: nLen }], NORMAL);

  const si = Math.sin(rad(i)), ci = Math.cos(rad(i));
  const Sdir = { x: -si, y: s * ci }; // from O back towards the source
  const S = mul(Sdir, tirSetup ? R0 + 70 : L);
  ray(sk, S, O, INK.red, "incident-ray", { at: tirSetup ? 0.62 : 0.5 });
  const nIn = { x: 0, y: s * nLen }, nOut = { x: 0, y: -s * nLen };
  // Angle marks wait until every line is drawn, so their values are placed clear of all of them
  // (critical angle first: its arc is the outer one).
  const marks: Array<() => void> = [];
  const markIncidence = () => sk.part("angle-of-incidence", `Angle of incidence (${show(i)}°)`, i >= 2 ? angleMark(sk, O, nIn, S, { r: 54, text: `${show(i)}°`, colour: INK.red, part: "angle-of-incidence" }) : { x: -5, y: s * 40 });
  sk.part("incident-ray", "Incident ray", mul(S, tirSetup ? 0.55 : 0.7));
  sk.part("normal", "Normal", { x: 0, y: -s * (nLen - 6) });

  // Reflected ray: strong under TIR, weak (partial reflection) otherwise.
  const Rdir = { x: si, y: s * ci };
  if (tir || partial) {
    const Rend = mul(Rdir, tirSetup ? R0 + 70 : L);
    ray(sk, O, Rend, INK.blue, "reflected-ray", tir ? { at: tirSetup ? 0.38 : 0.5 } : { width: 1.6, opacity: 0.55, at: 0.6 });
    sk.part("reflected-ray", tir ? "Totally internally reflected ray" : "Weak reflected ray", mul(Rend, tirSetup ? 0.5 : 0.7));
    if (tir && i >= 2) marks.push(() => sk.part("angle-of-reflection", `Angle of reflection (${show(i)}°)`, angleMark(sk, O, nIn, Rend, { r: 54, text: `${show(i)}°`, colour: INK.blue, part: "angle-of-reflection" })));
  }
  if (!tir) {
    const rr = grazing ? 90 : (r as number);
    const Tdir = { x: Math.sin(rad(rr)), y: -s * Math.cos(rad(rr)) };
    const T = mul(Tdir, grazing ? R0 + 40 : L);
    ray(sk, O, T, INK.green, "refracted-ray");
    sk.part("refracted-ray", grazing ? "Refracted ray (along the boundary, r = 90°)" : "Refracted ray", mul(T, 0.7));
    if (rr >= 2 && !grazing) marks.push(() => sk.part("angle-of-refraction", `Angle of refraction (${show(rr)}°)`, angleMark(sk, O, nOut, T, { r: 70, text: `${show(rr)}°`, colour: INK.green, part: "angle-of-refraction" })));
  }
  // The critical angle: drawn for the TIR block, and whenever a ray is totally internally reflected.
  if (c !== null && (tirSetup || tir)) {
    const C = mul({ x: -Math.sin(rad(c)), y: s * Math.cos(rad(c)) }, (tirSetup ? R0 : L) * 0.92);
    sk.line([O, C], { stroke: INK.amber, width: 1.8, dash: "4 5", part: "critical-angle" });
    const rc = Math.abs(i - c) < 9 ? 96 : 84;
    marks.unshift(() => {
      // Its value goes inside its wedge when the incident ray is outside it (i > c), else just
      // beyond the dashed line, away from the normal (the incident ray then runs inside the wedge).
      const inside = i > c + 4;
      const at = angleMark(sk, O, nIn, C, { r: rc, ...(inside ? { text: `c = ${show(c)}°`, size: 16 } : {}), colour: INK.amber, part: "critical-angle" });
      if (!inside) {
        const u = unit(C), away = { x: -1, y: 0 };
        sk.placeText(`c = ${show(c)}°`, 16, add(O, mul(u, rc + 18)), away, { min: 46, max: 140, fill: INK.amber, part: "critical-angle", slide: u });
      }
      const len = (tirSetup ? R0 : L) * 0.92;
      sk.part("critical-angle", `Critical angle (${show(c)}°)`, sk.clearAnchor([at, mul(unit(C), len * 0.97), mul(unit(C), len * 0.75)]));
    });
  }
  marks.splice(c !== null && (tirSetup || tir) ? 1 : 0, 0, markIncidence);
  for (const m of marks) m();

  // Media: the index written in each, and named by label.
  const tag = (n: number) => `n = ${n.toFixed(2)}`;
  if (tirSetup) {
    sk.placeText(tag(n1), 16, { x: R0 * 0.62, y: 26 }, { x: 0, y: 1 }, { part: "medium-1", max: 60 });
    sk.placeText(tag(n2), 16, { x: R0 * 0.85, y: -24 }, { x: 0, y: -1 }, { part: "medium-2", max: 60 });
    sk.part("boundary", "Semicircular glass block", { x: -R0 * 0.7, y: R0 * 0.71 });
    sk.part("medium-1", `${cap(name1)} (n = ${n1.toFixed(2)})`, { x: -R0 * 0.62, y: 34 });
    sk.part("medium-2", `${cap(name2)} (n = ${n2.toFixed(2)})`, { x: -R0 * 0.85, y: -60 });
  } else {
    sk.placeText(tag(n1), 16, { x: half - 46, y: s * 22 }, { x: 0, y: s }, { part: "medium-1", max: 60 });
    sk.placeText(tag(n2), 16, { x: half - 46, y: -s * 22 }, { x: 0, y: -s }, { part: "medium-2", max: 60 });
    sk.part("boundary", "Boundary", { x: half - 20, y: 0 });
    sk.part("medium-1", `${cap(name1)} (n = ${n1.toFixed(2)})`, { x: -half + 40, y: s * 60 });
    sk.part("medium-2", `${cap(name2)} (n = ${n2.toFixed(2)})`, { x: -half + 40, y: -s * 60 });
  }
}

/** Where the ray p + t·d first leaves the polygon (t > ε), and the edge's normal there. */
function exitHit(poly: Pt[], p: Pt, d: Pt): { at: Pt; normal: Pt } | null {
  let best: { t: number; at: Pt; normal: Pt } | null = null;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const e = sub(b, a);
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(a, p);
    const t = (w.x * e.y - w.y * e.x) / den;
    const u = (w.x * d.y - w.y * d.x) / den;
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && (!best || t < best.t)) best = { t, at: add(p, mul(d, t)), normal: unit(perp(e)) };
  }
  return best ? { at: best.at, normal: best.normal } : null;
}

/** Trace one ray through the prism: entry refraction, then up to three internal hits. */
export function tracePrism(apexDeg: number, n: number, iDeg: number, side = 300) {
  const A = rad(apexDeg);
  const P = { x: 0, y: 0 }, BL = { x: -side * Math.sin(A / 2), y: side * Math.cos(A / 2) }, BR = { x: side * Math.sin(A / 2), y: side * Math.cos(A / 2) };
  const poly = [P, BR, BL];
  const E = add(P, mul(sub(BL, P), 0.5));
  const centroid = { x: 0, y: (2 * side * Math.cos(A / 2)) / 3 };
  let nin = unit(perp(sub(BL, P)));
  if (dot(nin, sub(centroid, E)) < 0) nin = mul(nin, -1);
  const dIn = rot(nin, -rad(iDeg)); // rising towards the face, below the normal
  const inside: Pt[] = [E];
  let d = refract(dIn, nin, 1, n) ?? dIn;
  const rIn = deg(Math.acos(Math.max(-1, Math.min(1, dot(d, nin)))));
  let p = E, dOut: Pt | null = null, exitNormal: Pt = nin, tirInside = false;
  for (let k = 0; k < 4 && !dOut; k++) {
    const h = exitHit(poly, p, d);
    if (!h) break;
    inside.push(h.at);
    const t = refract(d, h.normal, n, 1);
    if (t) { dOut = t; exitNormal = h.normal; p = h.at; }
    else { d = reflect(d, h.normal); p = h.at; tirInside = true; }
  }
  const out = dOut ?? d;
  const deviation = deg(Math.acos(Math.max(-1, Math.min(1, dot(dIn, out)))));
  return { poly, E, nin, dIn, rIn, inside, exit: inside[inside.length - 1], exitNormal, dOut: out, deviation, tirInside, emerged: !!dOut };
}

function buildPrism(sk: Sketch, params: FigureParams, disperse: boolean) {
  const apex = num(params.apex ?? params.prismAngle, 60, 30, 75);
  const n = num(params.n ?? params.n2, 1.5, 1.2, 2.5);
  const i = iOf(params, 48);
  const main = tracePrism(apex, n, i);
  const [, BR, BL] = main.poly;
  sk.polygon(main.poly, { fill: "glass", stroke: "ink", width: 2.4, part: "boundary" });
  sk.part("boundary", "Glass prism", add(BL, mul(sub(BR, BL), 0.3)));
  const S = sub(main.E, mul(main.dIn, 190));
  // Normal at the entry face (and at the exit face for a single ray).
  sk.line([sub(main.E, mul(main.nin, 80)), add(main.E, mul(main.nin, 70))], NORMAL);
  sk.part("normal", "Normal", sub(main.E, mul(main.nin, 76)));
  if (!disperse) {
    ray(sk, S, main.E, INK.red, "incident-ray");
    sk.part("incident-ray", "Incident ray", add(S, mul(main.dIn, 70)));
    for (let k = 0; k < main.inside.length - 1; k++) ray(sk, main.inside[k], main.inside[k + 1], INK.green, "refracted-ray", { arrow: k === 0 });
    sk.part("refracted-ray", main.tirInside ? "Ray totally internally reflected" : "Refracted ray", add(main.inside[0], mul(sub(main.inside[1], main.inside[0]), 0.5)));
    const X = main.exit, Oend = add(X, mul(main.dOut, 200));
    ray(sk, X, Oend, INK.blue, "emergent-ray");
    sk.part("emergent-ray", "Emergent ray", add(X, mul(main.dOut, 150)));
    sk.line([sub(X, mul(main.exitNormal, 64)), add(X, mul(main.exitNormal, 64))], NORMAL);
    const ai = angleMark(sk, main.E, sub(main.E, mul(main.nin, 80)), S, { r: 52, text: `${show(i)}°`, colour: INK.red, part: "angle-of-incidence", size: 16 });
    sk.part("angle-of-incidence", `Angle of incidence (${show(i)}°)`, ai);
    const ar = angleMark(sk, main.E, add(main.E, mul(main.nin, 70)), main.inside[1], { r: 40, text: `${show(main.rIn)}°`, colour: INK.green, part: "angle-of-refraction", size: 16 });
    sk.part("angle-of-refraction", `Angle of refraction (${show(main.rIn)}°)`, ar);
    // Deviation: the incident ray continued (dashed) and the emergent ray traced back meet at V.
    const den = main.dIn.x * main.dOut.y - main.dIn.y * main.dOut.x;
    if (main.emerged && Math.abs(den) > 1e-6 && main.deviation > 3) {
      const w = sub(X, main.E);
      const t = (w.x * main.dOut.y - w.y * main.dOut.x) / den;
      const V = add(main.E, mul(main.dIn, t));
      const fwd = add(V, mul(main.dIn, Math.hypot(X.x - V.x, X.y - V.y) + 110));
      sk.line([main.E, fwd], { stroke: INK.red, width: 1.5, dash: "5 5", opacity: 0.7, part: "deviation" });
      sk.line([V, X], { stroke: INK.blue, width: 1.5, dash: "5 5", opacity: 0.7, part: "deviation" });
      const rd = Math.hypot(X.x - V.x, X.y - V.y) + 70;
      angleMark(sk, V, fwd, add(V, mul(main.dOut, 150)), { r: rd, text: `D = ${show(main.deviation)}°`, colour: INK.violet, part: "deviation", size: 16 });
      // The anchor sits on the arc near the emergent ray, away from the value written at its middle.
      const a0 = Math.atan2(main.dIn.y, main.dIn.x), a1 = Math.atan2(main.dOut.y, main.dOut.x);
      sk.part("deviation", `Angle of deviation (${show(main.deviation)}°)`, add(V, mul({ x: Math.cos(a0 + (a1 - a0) * 0.82), y: Math.sin(a0 + (a1 - a0) * 0.82) }, rd)));
    }
    return;
  }
  // Dispersion: one white ray in, seven colours out. Each colour's index is spread about n (spread
  // exaggerated about ×4 for visibility); the order red (lowest n) → violet (highest) is physics.
  ray(sk, S, main.E, "ink", "incident-ray", { width: 3.6 });
  sk.part("incident-ray", "White light", add(S, mul(main.dIn, 70)));
  const traces = SPECTRUM.map((col, k) => ({ col, t: tracePrism(apex, n, i, 300), nk: n - 0.06 + (k * 0.12) / 6 }));
  for (const tr of traces) tr.t = tracePrism(apex, tr.nk, i, 300);
  // A screen to the right of the prism, square to the middle emergent colour.
  const mid = traces[3].t;
  const screenX = Math.max(BR.x, mid.exit.x) + 250;
  const hits: Pt[] = [];
  for (const { col, t } of traces) {
    for (let k = 0; k < t.inside.length - 1; k++) sk.line([t.inside[k], t.inside[k + 1]], { stroke: col.ink, width: 1.6, part: "refracted-ray" }, false);
    const tt = t.dOut.x > 0.05 ? (screenX - t.exit.x) / t.dOut.x : 240;
    const end = add(t.exit, mul(t.dOut, Math.min(tt, 420)));
    hits.push(end);
    sk.line([t.exit, end], { stroke: col.ink, width: 2, part: "spectrum" }, false);
  }
  sk.part("refracted-ray", "Refraction inside the prism", add(mid.inside[0], mul(sub(mid.inside[1], mid.inside[0]), 0.55)));
  const ys = hits.map((h) => h.y);
  const top = Math.min(...ys) - 12, bot = Math.max(...ys) + 12;
  sk.line([{ x: screenX + 3, y: top - 30 }, { x: screenX + 3, y: bot + 30 }], { stroke: "ink", width: 4, part: "spectrum" });
  for (let k = 0; k < hits.length; k++) {
    const y0 = k === 0 ? top : (hits[k - 1].y + hits[k].y) / 2, y1 = k === hits.length - 1 ? bot : (hits[k].y + hits[k + 1].y) / 2;
    sk.polygon([{ x: screenX - 5, y: y0 }, { x: screenX, y: y0 }, { x: screenX, y: y1 }, { x: screenX - 5, y: y1 }], { fill: SPECTRUM[k].ink, stroke: "none", part: "spectrum" }, false);
  }
  sk.part("spectrum", "Spectrum on a screen", { x: screenX + 5, y: bot + 22 });
  sk.part("red-light", "Red light (deviated least)", { x: screenX - 2, y: hits[0].y });
  sk.part("violet-light", "Violet light (deviated most)", { x: screenX - 2, y: hits[hits.length - 1].y });
  sk.part("angle-of-incidence", `Angle of incidence (${show(i)}°)`, angleMark(sk, main.E, sub(main.E, mul(main.nin, 80)), S, { r: 44, text: `${show(i)}°`, colour: "ink", part: "angle-of-incidence", size: 16 }));
}
