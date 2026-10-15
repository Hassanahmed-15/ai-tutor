import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, angleMark, clamp, dist, fmt, lerp, list, num, rad, str, sub, textBox, unit, add, mul } from "./mathsKit";

/**
 * CIRCLE THEOREMS, DRAWN EXACTLY. The board names the theorem and one angle; the code places the
 * points on the circle so the configuration really has that angle, and computes the angle the
 * theorem gives (angle at the centre = 2 × angle at the circumference, angle in a semicircle = 90°,
 * angles in the same segment are equal, opposite angles of a cyclic quadrilateral sum to 180°,
 * tangent ⟂ radius, alternate segment theorem). Values are written at their arcs.
 */

export const THEOREMS = ["angle-at-centre", "semicircle", "same-segment", "cyclic-quadrilateral", "tangent-radius", "alternate-segment"] as const;
export type Theorem = (typeof THEOREMS)[number];

/** The theorem's angles, from the given one (all in degrees). */
export function circleAngles(theorem: Theorem, angle: number, angle2?: number, givenAt: "circumference" | "centre" = "circumference") {
  switch (theorem) {
    case "angle-at-centre": {
      const atCirc = givenAt === "centre" ? angle / 2 : angle;
      return { given: angle, found: givenAt === "centre" ? atCirc : 2 * atCirc, atCircumference: atCirc, atCentre: 2 * atCirc };
    }
    case "semicircle":
      return { given: angle, found: 90, other: 90 - angle };
    case "same-segment":
      return { given: angle, found: angle };
    case "cyclic-quadrilateral": {
      const b = angle2 ?? 95;
      return { given: angle, found: 180 - angle, b, d: 180 - b };
    }
    case "tangent-radius":
      return { given: angle, found: 90, other: 90 - angle };
    case "alternate-segment":
      return { given: angle, found: angle };
  }
}

const DEFAULT_ANGLE: Record<Theorem, number> = { "angle-at-centre": 50, semicircle: 35, "same-segment": 40, "cyclic-quadrilateral": 75, "tangent-radius": 32, "alternate-segment": 58 };
const RANGE: Record<Theorem, [number, number]> = { "angle-at-centre": [12, 84], semicircle: [15, 75], "same-segment": [15, 80], "cyclic-quadrilateral": [40, 140], "tangent-radius": [18, 70], "alternate-segment": [15, 80] };
const LETTERS: Record<Theorem, string[]> = { "angle-at-centre": ["A", "B", "C"], semicircle: ["A", "B", "C"], "same-segment": ["A", "B", "C", "D"], "cyclic-quadrilateral": ["A", "B", "C", "D"], "tangent-radius": ["T", "P"], "alternate-segment": ["T", "A", "B"] };

const ALIASES: Array<[RegExp, Theorem]> = [
  [/alternate/, "alternate-segment"], [/tangent|radius/, "tangent-radius"], [/cyclic|quadrilateral/, "cyclic-quadrilateral"],
  [/semi|diameter/, "semicircle"], [/same|segment/, "same-segment"], [/centre|center|double|twice/, "angle-at-centre"],
];

const PARTS = [
  { id: "centre", name: "Centre O" },
  { id: "circumference", name: "Circumference" },
  { id: "line", name: "Chord / diameter / tangent (depends on the theorem)" },
  { id: "given-angle", name: "The given angle" },
  { id: "found-angle", name: "The angle the theorem gives" },
];

export const circleTheorem: FigureComponent = {
  name: "circleTheorem",
  title: "Circle theorem diagram drawn exactly: circle, centre O, the chords/tangent of one theorem, the given angle and the angle the theorem gives (values at the arcs)",
  params: `theorem: "angle-at-centre" (angle at centre = 2 × angle at circumference) | "semicircle" (angle in a semicircle = 90°) | "same-segment" (angles in the same segment are equal) | "cyclic-quadrilateral" (opposite angles sum to 180°) | "tangent-radius" (tangent ⟂ radius) | "alternate-segment" (tangent–chord angle = angle in the alternate segment); default "angle-at-centre". angle: the given angle in degrees — angle-at-centre: the angle at the circumference (12-84, default 50); semicircle: angle CAB (15-75); same-segment: angle ACB (15-80); cyclic-quadrilateral: angle A (40-140; angle2 = angle B, default 95); tangent-radius: angle OPT at the outside point P (18-70); alternate-segment: angle between the tangent and chord TA (15-80). givenAt ("circumference" default | "centre", angle-at-centre only: the angle given is the one at the centre). show ("both" default: write the found angle's value | "given": write the found angle as the unknown symbol); unknown (symbol for it, default "x"); letters (point letters in order, e.g. "A,B,C,D"; tangent-radius uses "T,P", alternate-segment "T,A,B"); centre (centre letter, default "O"). Parts that name lines get the theorem's name: chord AB, diameter AB, tangent at T.`,
  match: /\bcircle theorems?\b|\b(angle|angles) (at|in) the (centre|center|circumference)\b|\bangle in a semicircle\b|\bsame segment\b|\bcyclic quadrilateral\b|\balternate segment\b|\btangents? (to a circle|and radius|meets? the radius)\b|\bsubtended\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const raw = str(params.theorem, "angle-at-centre", 30).toLowerCase().replace(/[\s_]+/g, "-");
    const theorem: Theorem = (THEOREMS as readonly string[]).includes(raw) ? (raw as Theorem) : ALIASES.find(([re]) => re.test(raw))?.[1] ?? "angle-at-centre";
    const givenAt = /centre|center/i.test(String(params.givenAt ?? "")) && theorem === "angle-at-centre" ? "centre" : "circumference";
    const [lo, hi] = givenAt === "centre" ? [24, 168] : RANGE[theorem];
    const angle = num(params.angle, givenAt === "centre" ? 100 : DEFAULT_ANGLE[theorem], lo, hi);
    const angle2 = theorem === "cyclic-quadrilateral" ? num(params.angle2, 95, 40, 140) : undefined;
    const vals = circleAngles(theorem, angle, angle2, givenAt);
    const showFound = !/^given$/i.test(String(params.show ?? ""));
    const unknown = str(params.unknown, "x", 4);
    const custom = list(params.letters);
    const L = LETTERS[theorem].map((d, i) => str(custom[i], d, 3));
    const centreLetter = str(params.centre, "O", 3);

    const R = 150;
    const O: Pt = { x: 0, y: 0 };
    const at = (phi: number): Pt => ({ x: R * Math.cos(rad(phi)), y: -R * Math.sin(rad(phi)) });
    const sk = new Sketch();
    sk.circle(O, R, { stroke: "ink", width: 2.6, fill: "none", part: "circumference" });
    sk.circle(O, 4, { fill: "ink", stroke: "ink", width: 1, part: "centre" }, false);

    const G = PALETTE.blue, F = PALETTE.red;
    const val = (v: number) => `${fmt(v)}°`;
    const foundText = (v: number) => (showFound ? val(v) : unknown);
    const seg = (p: Pt, q: Pt, part?: string, dash?: string) => sk.line([p, q], { stroke: "ink", width: 2.2, part, dash });
    const r0 = 30;
    let points: Array<[Pt, string]> = [];
    let line: { p: Pt; q: Pt; name: string } = { p: O, q: O, name: "" };
    let givenAnchor: Pt = O, foundAnchor: Pt = O;
    let givenName = "", foundName = "";

    switch (theorem) {
      case "angle-at-centre": {
        const t = vals.atCircumference!;
        const A = at(270 - t), B = at(270 + t), C = at(100);
        seg(A, B, "line");
        seg(O, A); seg(O, B); seg(C, A); seg(C, B);
        points = [[A, L[0]], [B, L[1]], [C, L[2]]];
        line = { p: A, q: B, name: `Chord ${L[0]}${L[1]}` };
        const atC = givenAt === "centre" ? { colour: F, part: "found-angle", text: foundText(t) } : { colour: G, part: "given-angle", text: val(t) };
        const atO = givenAt === "centre" ? { colour: G, part: "given-angle", text: val(2 * t) } : { colour: F, part: "found-angle", text: foundText(2 * t) };
        const aC = angleMark(sk, C, A, B, { r: r0 + 6, size: 23, ...atC });
        const aO = angleMark(sk, O, A, B, { r: r0 - 4, size: 23, ...atO });
        [givenAnchor, foundAnchor] = givenAt === "centre" ? [aO, aC] : [aC, aO];
        givenName = givenAt === "centre" ? `Angle at centre ${L[0]}${centreLetter}${L[1]}` : `Angle at circumference ${L[0]}${L[2]}${L[1]}`;
        foundName = givenAt === "centre" ? `Angle at circumference ${L[0]}${L[2]}${L[1]}` : `Angle at centre ${L[0]}${centreLetter}${L[1]}`;
        break;
      }
      case "semicircle": {
        const A = at(180), B = at(0), C = at(2 * angle);
        seg(A, B, "line"); seg(C, A); seg(C, B);
        points = [[A, L[0]], [B, L[1]], [C, L[2]]];
        line = { p: A, q: B, name: `Diameter ${L[0]}${L[1]}` };
        givenAnchor = angleMark(sk, A, C, B, { r: r0 + 8, size: 23, colour: G, part: "given-angle", text: val(angle) });
        foundAnchor = angleMark(sk, C, A, B, { r: r0, size: 23, colour: F, part: "found-angle", text: foundText(90), right: true });
        if (showFound) angleMark(sk, B, A, C, { r: r0 + 8, size: 23, colour: "muted", text: val(vals.other!) });
        givenName = `Angle ${L[2]}${L[0]}${L[1]}`;
        foundName = `Angle in a semicircle`;
        break;
      }
      case "same-segment": {
        const span = 360 - 2 * angle, start = angle - 90;
        const A = at(270 - angle), B = at(270 + angle), C = at(start + 0.7 * span), D = at(start + 0.36 * span);
        seg(A, B, "line"); seg(C, A); seg(C, B); seg(D, A); seg(D, B);
        points = [[A, L[0]], [B, L[1]], [C, L[2]], [D, L[3]]];
        line = { p: A, q: B, name: `Chord ${L[0]}${L[1]}` };
        givenAnchor = angleMark(sk, C, A, B, { r: r0 + 8, size: 23, colour: G, part: "given-angle", text: val(angle) });
        foundAnchor = angleMark(sk, D, A, B, { r: r0 + 8, size: 23, colour: F, part: "found-angle", text: foundText(angle) });
        givenName = `Angle ${L[0]}${L[2]}${L[1]}`;
        foundName = `Angle ${L[0]}${L[3]}${L[1]}`;
        break;
      }
      case "cyclic-quadrilateral": {
        const arcs = cyclicArcs(angle, angle2!);
        const phiA = 270 - arcs.p / 2;
        const A = at(phiA), B = at(phiA + arcs.p), C = at(phiA + arcs.p + arcs.q), D = at(phiA + arcs.p + arcs.q + arcs.s);
        seg(A, B, "line"); seg(B, C); seg(C, D); seg(D, A);
        points = [[A, L[0]], [B, L[1]], [C, L[2]], [D, L[3]]];
        line = { p: A, q: B, name: `Side ${L[0]}${L[1]} (a chord)` };
        givenAnchor = angleMark(sk, A, B, D, { r: r0, size: 23, colour: G, part: "given-angle", text: val(angle) });
        foundAnchor = angleMark(sk, C, B, D, { r: r0, size: 23, colour: F, part: "found-angle", text: foundText(180 - angle) });
        angleMark(sk, B, A, C, { r: r0, size: 23, colour: "ink", text: val(vals.b!) });
        angleMark(sk, D, A, C, { r: r0, size: 23, colour: "muted", text: showFound ? val(vals.d!) : undefined });
        givenName = `Angle ${L[0]}`;
        foundName = `Opposite angle ${L[2]}`;
        break;
      }
      case "tangent-radius": {
        const T = at(90 - angle), P: Pt = { x: R / Math.sin(rad(angle)), y: 0 };
        const u = unit(sub(P, T));
        seg(sub(T, mul(u, 70)), add(P, mul(u, 36)), "line");
        seg(O, T); seg(O, P);
        sk.circle(P, 3.5, { fill: "ink", stroke: "ink", width: 1 }, false);
        points = [[T, L[0]], [P, L[1]]];
        line = { p: sub(T, mul(u, 70)), q: P, name: `Tangent at ${L[0]}` };
        givenAnchor = angleMark(sk, P, O, T, { r: r0 + 14, size: 23, colour: G, part: "given-angle", text: val(angle) });
        foundAnchor = angleMark(sk, T, O, P, { r: r0, size: 23, colour: F, part: "found-angle", text: foundText(90), right: true });
        if (showFound) angleMark(sk, O, T, P, { r: r0 - 4, size: 23, colour: "muted", text: val(vals.other!) });
        givenName = `Angle ${centreLetter}${L[1]}${L[0]}`;
        foundName = `Radius–tangent angle`;
        break;
      }
      case "alternate-segment": {
        const T = at(270), A = at(2 * angle - 90), B = at(angle + 90);
        const left: Pt = { x: -R * 1.15, y: T.y }, right: Pt = { x: R * 1.15, y: T.y };
        seg(left, right, "line"); seg(T, A); seg(T, B); seg(A, B);
        points = [[T, L[0]], [A, L[1]], [B, L[2]]];
        line = { p: T, q: right, name: `Tangent at ${L[0]}` };
        givenAnchor = angleMark(sk, T, right, A, { r: r0 + 14, size: 23, colour: G, part: "given-angle", text: val(angle) });
        foundAnchor = angleMark(sk, B, T, A, { r: r0 + 8, size: 23, colour: F, part: "found-angle", text: foundText(angle) });
        givenName = `Tangent–chord angle`;
        foundName = `Angle in alternate segment`;
        break;
      }
    }

    // Point letters outside the circle (radially), the centre letter where it is clear.
    for (const [p, letter] of points) {
      // Radially outward; a point level with the centre gets its letter below-outward, out of the
      // horizontal lane a label's leader uses to reach it.
      const radial = unit(sub(p, O));
      const dir = Math.abs(radial.y) < 0.45 ? unit({ x: radial.x, y: 0.9 }) : radial;
      sk.placeText(letter, 26, p, dir, { min: 10, max: 60 });
    }
    const oSpots = [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: -0.5, y: 0.87 }, { x: 0.5, y: 0.87 }, { x: -0.5, y: -0.87 }, { x: 0.5, y: -0.87 }].map((d) => sk.findText(centreLetter, 22, O, d, { min: 15, max: 45 }));
    const oSpot = oSpots.find((sp) => sp.ok && sk.approachClear(O, 9, [textBox(sp.c, centreLetter, 22)])) ?? oSpots.find((sp) => sp.ok) ?? oSpots[0];
    sk.text(oSpot.c, centreLetter, 22, "ink", "centre");

    // The circumference's anchor: a stretch of the circle away from every point and clear to approach.
    const taken = points.map(([p]) => p);
    const circAnchors = [135, 45, 160, 20, 200, 340, 110, 70, 180, 0].map(at).filter((p) => taken.every((q) => dist(p, q) > 40));
    sk.part("centre", `Centre ${centreLetter}`, O);
    sk.part("circumference", "Circumference", sk.clearAnchor(circAnchors.length ? circAnchors : [at(135)]));
    sk.part("line", line.name, sk.clearAnchor([0.7, 0.3, 0.8, 0.2, 0.6, 0.4].map((t) => lerp(line.p, line.q, t))));
    sk.part("given-angle", givenName, givenAnchor);
    sk.part("found-angle", foundName, foundAnchor);
    return sk.finish(14);
  },
};

/** Arcs AB, BC, CD, DA (degrees) of a cyclic quadrilateral with angles A and B, as even as possible. */
export function cyclicArcs(A: number, B: number) {
  // Angle A = (BC + CD) / 2, angle B = (CD + DA) / 2.
  let best = { p: 90, q: 90, s: 90, t: 90 }, score = -Infinity;
  const lo = Math.max(1, 2 * A + 2 * B - 360 + 1), hi = Math.min(2 * A, 2 * B) - 1;
  for (let s = lo; s <= hi; s += 0.5) {
    const q = 2 * A - s, t = 2 * B - s, p = 360 - q - s - t;
    const m = Math.min(p, q, s, t);
    if (p > 0 && m > score) (score = m), (best = { p, q, s, t });
  }
  return { ...best, p: clamp(best.p, 1, 358) };
}
