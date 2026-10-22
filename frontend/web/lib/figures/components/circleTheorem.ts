import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { PALETTE, Sketch, angleMark, clamp, dist, fmt, lerp, list, num, rad, str, sub, textBox, unit, add, mul } from "./mathsKit";

/**
 * CIRCLE THEOREMS, DRAWN EXACTLY. The board names the theorem and one angle; the code places the
 * points on the circle so the configuration really has that angle, and computes the angle the
 * theorem gives (angle at the centre = 2 × angle at the circumference, angle in a semicircle = 90°,
 * angles in the same segment are equal, opposite angles of a cyclic quadrilateral sum to 180°,
 * tangent perpendicular to radius, alternate segment theorem). Values are written at their arcs.
 */

export const THEOREMS = ["angle-at-centre", "semicircle", "same-segment", "cyclic-quadrilateral", "tangent-radius", "alternate-segment"] as const;
export type Theorem = (typeof THEOREMS)[number];
/**
 * The chord and tangent theorems, whose facts are LENGTHS, not angles: the perpendicular from the
 * centre bisects a chord, equal chords are equidistant from the centre, the two tangents from an
 * outside point are equal. A circle-theorems lesson on exactly these had no diagram that could show
 * them — the writer drew an angle theorem with invented angles, the review rejected it twice and the
 * boards became flows (QA 2026-10-17).
 */
export const LENGTH_THEOREMS = ["chord-bisector", "equal-chords", "tangents-from-point"] as const;
export type LengthTheorem = (typeof LENGTH_THEOREMS)[number];

/**
 * A chord/tangent configuration's lengths, from whichever two the board gives (radius r, chord
 * length c, perpendicular distance d, outside distance OP, tangent length t). Pythagoras completes
 * the rest; a set that cannot exist (a chord longer than the diameter) returns null.
 */
export function circleLengths(theorem: LengthTheorem, g: { radius?: number; chord?: number; distance?: number; op?: number; tangent?: number }) {
  const pos = (v?: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  const [r0, c0, d0, op0, t0] = [pos(g.radius), pos(g.chord), pos(g.distance), pos(g.op), pos(g.tangent)];
  if (theorem === "tangents-from-point") {
    const r = r0 ?? (op0 && t0 ? Math.sqrt(op0 ** 2 - t0 ** 2) : undefined);
    const op = op0 ?? (r && t0 ? Math.sqrt(r ** 2 + t0 ** 2) : undefined);
    const t = t0 ?? (r && op ? Math.sqrt(op ** 2 - r ** 2) : undefined);
    if (r && op && op <= r) return null;
    return { radius: r, op, tangent: t };
  }
  const r = r0 ?? (c0 && d0 ? Math.sqrt((c0 / 2) ** 2 + d0 ** 2) : undefined);
  const c = c0 ?? (r && d0 && d0 < r ? 2 * Math.sqrt(r ** 2 - d0 ** 2) : undefined);
  const d = d0 ?? (r && c && c <= 2 * r ? Math.sqrt(r ** 2 - (c / 2) ** 2) : undefined);
  if (r && c && c > 2 * r) return null;
  return { radius: r, chord: c, distance: d, half: c ? c / 2 : undefined };
}

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
  { id: "given-angle", name: "The given angle (chord/tangent theorems: the right angle)" },
  { id: "found-angle", name: "The angle the theorem gives (chord/tangent theorems: the equal lengths)" },
];

export const circleTheorem: FigureComponent = {
  name: "circleTheorem",
  title: "Circle theorem diagram drawn exactly: circle, centre O, the chords/tangent of one theorem, the given angle and the angle the theorem gives (values at the arcs)",
  params: `theorem: "angle-at-centre" (angle at centre = 2 × angle at circumference) | "semicircle" (angle in a semicircle = 90°) | "same-segment" (angles in the same segment are equal) | "cyclic-quadrilateral" (opposite angles sum to 180°) | "tangent-radius" (tangent perpendicular to radius) | "alternate-segment" (tangent–chord angle = angle in the alternate segment); default "angle-at-centre". angle: the given angle in degrees — angle-at-centre: the angle at the circumference (12-84, default 50); semicircle: angle CAB (15-75); same-segment: angle ACB (15-80); cyclic-quadrilateral: angle A (40-140; angle2 = angle B, default 95); tangent-radius: angle OPT at the outside point P (18-70); alternate-segment: angle between the tangent and chord TA (15-80). givenAt ("circumference" default | "centre", angle-at-centre only: the angle given is the one at the centre). show ("both" default: write the found angle's value | "given": write the found angle as the unknown symbol); unknown (symbol for it, default "x"); givenSymbol (a general proof with no angle: the symbol written at the given angle, e.g. "x" — leave angle out and nothing numeric is drawn); letters (point letters in order, e.g. "A,B,C,D"; tangent-radius uses "T,P", alternate-segment "T,A,B"); centre (centre letter, default "O"). Parts that name lines get the theorem's name: chord AB, diameter AB, tangent at T.
CHORD AND TANGENT THEOREMS (lengths, not angles): theorem "chord-bisector" (the perpendicular from the centre to a chord bisects it: chord AB, OM perpendicular to AB, AM = MB) | "equal-chords" (equal chords are equidistant from the centre: chords AB and CD, OM = ON) | "tangents-from-point" (tangents from an outside point are equal: PA = PB, each perpendicular to its radius). Lengths, all optional, in the board's own numbers: radius, chord (chord length), distance (perpendicular distance from the centre), op (distance from the centre to the outside point), tangent (tangent length); code completes the rest by Pythagoras and writes them on the lines; units (e.g. "cm"). Letters: chord-bisector "A,B,M", equal-chords "A,B,C,D,M,N", tangents-from-point "A,B,P".`,
  match: /\bequal chords?\b|\bperpendicular (from|bisector of) (the )?(centre|center|a chord)\b|\bbisects? (the|a) chord\b|\btangents? from (an? )?(external|outside|one|the same)? ?point\b|\bcircle theorems?\b|\b(angle|angles) (at|in) the (centre|center|circumference)\b|\bangle in a semicircle\b|\bsame segment\b|\bcyclic quadrilateral\b|\balternate segment\b|\btangents? (to a circle|and radius|meets? the radius)\b|\bsubtended\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const raw = str(params.theorem, "angle-at-centre", 30).toLowerCase().replace(/[\s_]+/g, "-");
    const lengthTheorem = (LENGTH_THEOREMS as readonly string[]).includes(raw) ? (raw as LengthTheorem)
      : /bisect|perpendicular|midpoint/.test(raw) ? "chord-bisector" : /equal-?chords?|equidistant/.test(raw) ? "equal-chords" : /tangents?-from|two-tangents|external|outside/.test(raw) ? "tangents-from-point" : undefined;
    if (lengthTheorem) return buildLengthTheorem(lengthTheorem, params);
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
    // No angle given (a general proof in letters): the given angle is marked with its symbol, or just
    // its arc — never the built-in example's number ("35°" on a proof in x and y; maths benchmark).
    // The found angle keeps its value only where the theorem fixes it (90° in a semicircle).
    const angleGiven = params.angle !== undefined && params.angle !== null && String(params.angle).trim() !== "";
    const givenSymbol = str(params.givenSymbol, "", 4);
    const val = (v: number) => (angleGiven ? `${fmt(v)}°` : givenSymbol);
    const fixedByTheorem = theorem === "semicircle" || theorem === "tangent-radius";
    const foundText = (v: number) => (showFound && (angleGiven || fixedByTheorem) ? `${fmt(v)}°` : unknown);
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
        if (!angleGiven) {
          // THE PROOF'S FIGURE (maths benchmark, 2026-10-21): it showed "x&y" at both base angles, no
          // radius OC, and 90° at C — the very thing being proved. Now: the radius OC that makes two
          // isosceles triangles, x at A and at C, y at B and at C, and nothing written at C beyond them.
          // Only letters name the base angles: a writer's "180°" was written on all four (round 4).
          const sym = String(params.givenSymbol ?? "").slice(0, 20).split(/\s*(?:&|,|;|\band\b|\/)\s*/).map((t) => t.trim()).filter((t) => /^[a-zα-ω][′']?$/i.test(t));
          const sx = sym[0] ?? "x", sy = sym[1] ?? (sx === "x" ? "y" : `${sx}′`);
          const Y = PALETTE.amber;
          seg(O, C);
          givenAnchor = angleMark(sk, A, C, B, { r: r0 + 8, size: 23, colour: G, part: "given-angle", text: sx });
          angleMark(sk, B, A, C, { r: r0 + 8, size: 23, colour: Y, text: sy });
          const cx = angleMark(sk, C, A, O, { r: r0, size: 21, colour: G, part: "found-angle", text: sx });
          const cy = angleMark(sk, C, O, B, { r: r0 + 6, size: 21, colour: Y, part: "found-angle", text: sy });
          foundAnchor = lerp(cx, cy, 0.5);
          givenName = `Angle ${L[2]}${L[0]}${L[1]}`;
          foundName = `Angle ${L[0]}${L[2]}${L[1]}`;
          break;
        }
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

/** The chord and tangent theorems: positions from the board's lengths, the lengths written on the lines. */
function buildLengthTheorem(theorem: LengthTheorem, params: FigureParams) {
  const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : undefined);
  const given = { radius: n(params.radius), chord: n(params.chord ?? params.length), distance: n(params.distance), op: n(params.op ?? params.outside), tangent: n(params.tangent) };
  const L0: { radius?: number; chord?: number; distance?: number; half?: number; op?: number; tangent?: number } = circleLengths(theorem, given) ?? {};
  const unitText = str(params.units ?? params.unit, "", 6);
  const len = (v?: number) => (v === undefined ? undefined : `${fmt(Math.round(v * 100) / 100)}${unitText ? ` ${unitText}` : ""}`);
  const custom = list(params.letters);
  const defaults = theorem === "chord-bisector" ? ["A", "B", "M"] : theorem === "equal-chords" ? ["A", "B", "C", "D", "M", "N"] : ["A", "B", "P"];
  const L = defaults.map((d, i) => str(custom[i], d, 3));
  const centreLetter = str(params.centre, "O", 3);
  const R = 150;
  const O: Pt = { x: 0, y: 0 };
  const at = (phi: number): Pt => ({ x: R * Math.cos(rad(phi)), y: -R * Math.sin(rad(phi)) });
  const sk = new Sketch();
  sk.circle(O, R, { stroke: "ink", width: 2.6, fill: "none", part: "circumference" });
  sk.circle(O, 4, { fill: "ink", stroke: "ink", width: 1, part: "centre" }, false);
  const G = PALETTE.blue, F = PALETTE.red;
  /**
   * Two short strokes across a segment's middle: the textbook "these are equal" mark. They are
   * obstacles, so the length written on the segment moves clear of them ("7 cm" was printed over
   * the chord's tick marks, 2026-10-17).
   */
  const ticks = (p: Pt, q: Pt, count: number, colour: Ink = F) => {
    const m = lerp(p, q, 0.5), u = unit(sub(q, p)), nrm = { x: -u.y, y: u.x };
    for (let i = 0; i < count; i++) {
      const c = add(m, mul(u, (i - (count - 1) / 2) * 6));
      sk.line([add(c, mul(nrm, -7)), add(c, mul(nrm, 7))], { stroke: colour, width: 2 });
    }
  };
  const onLine = (text: string | undefined, p: Pt, q: Pt, away: Pt, fill: Ink = "ink") => {
    if (!text) return;
    const m = lerp(p, q, 0.5);
    const out = unit(sub(m, away));
    sk.placeText(text, 18, m, Math.abs(out.x) + Math.abs(out.y) > 0 ? out : { x: 0, y: 1 }, { min: 12, max: 70, fill });
  };
  const letter = (pt: Pt, text: string) => {
    const radial = unit(sub(pt, O));
    sk.placeText(text, 24, pt, Math.abs(radial.x) + Math.abs(radial.y) > 0 ? radial : { x: 0, y: 1 }, { min: 10, max: 60 });
  };
  // Proportions from the lengths when given; a clear textbook shape otherwise.
  const ratio = (a?: number, b?: number, d = 0.5) => (a && b ? clamp(a / b, 0.18, 0.82) : d);

  if (theorem === "chord-bisector" || theorem === "equal-chords") {
    const dR = ratio(L0.distance, L0.radius) * R;
    const chordAt = (phi: number) => {
      // The chord whose perpendicular from O points along phi, at distance dR.
      const dir = { x: Math.cos(rad(phi)), y: -Math.sin(rad(phi)) };
      const M = mul(dir, dR), half = Math.sqrt(R * R - dR * dR), along = { x: -dir.y, y: dir.x };
      return { M, P: add(M, mul(along, -half)), Q: add(M, mul(along, half)) };
    };
    const one = chordAt(270);
    sk.line([one.P, one.Q], { stroke: "ink", width: 2.4, part: "line" });
    sk.line([O, one.M], { stroke: G, width: 2.2, part: "given-angle", dash: "6 4" });
    const right1 = angleMark(sk, one.M, O, one.Q, { r: 18, right: true, colour: G, part: "given-angle" });
    sk.circle(one.M, 3.5, { fill: "ink", stroke: "ink", width: 1, part: "found-angle" }, false);
    letter(one.P, L[0]); letter(one.Q, L[1]);
    sk.placeText(L[theorem === "chord-bisector" ? 2 : 4], 22, one.M, { x: 0.35, y: 1 }, { min: 12, max: 50 });
    let found: Pt;
    if (theorem === "chord-bisector") {
      ticks(one.P, one.M, 1); ticks(one.M, one.Q, 1);
      onLine(len(L0.half), one.P, one.M, O, F); onLine(len(L0.half), one.M, one.Q, O, F);
      onLine(len(L0.distance), O, one.M, one.Q, G);
      if (L0.radius) { sk.line([O, one.Q], { stroke: "muted", width: 1.6, dash: "4 4" }); onLine(len(L0.radius), O, one.Q, one.M); }
      found = lerp(one.P, one.M, 0.5);
      sk.part("found-angle", `${L[0]}${L[2]} = ${L[2]}${L[1]}`, found);
      sk.part("given-angle", `${centreLetter}${L[2]} meets ${L[0]}${L[1]} at 90°`, right1);
      sk.part("line", `Chord ${L[0]}${L[1]}`, lerp(one.M, one.Q, 0.65));
    } else {
      const two = chordAt(40);
      sk.line([two.P, two.Q], { stroke: "ink", width: 2.4, part: "line" });
      sk.line([O, two.M], { stroke: G, width: 2.2, part: "given-angle", dash: "6 4" });
      angleMark(sk, two.M, O, two.Q, { r: 18, right: true, colour: G });
      letter(two.P, L[2]); letter(two.Q, L[3]);
      sk.placeText(L[5], 22, two.M, unit(two.M), { min: 12, max: 50 });
      ticks(one.P, one.Q, 1); ticks(two.P, two.Q, 1);
      ticks(O, one.M, 2, G); ticks(O, two.M, 2, G);
      onLine(len(L0.chord), one.P, one.Q, O); onLine(len(L0.chord), two.P, two.Q, O);
      onLine(len(L0.distance), O, one.M, one.Q, G); onLine(len(L0.distance), O, two.M, two.Q, G);
      sk.part("found-angle", `${L[0]}${L[1]} = ${L[2]}${L[3]}`, lerp(two.M, two.Q, 0.6));
      sk.part("given-angle", `${centreLetter}${L[4]} = ${centreLetter}${L[5]}`, lerp(O, two.M, 0.5));
      sk.part("line", `Chord ${L[0]}${L[1]}`, lerp(one.M, one.Q, 0.65));
    }
  } else {
    // Tangents from P: OP along the x axis, at OP/R from the lengths (1.9 R by default).
    const k = L0.op && L0.radius ? clamp(L0.op / L0.radius, 1.3, 2.6) : 1.9;
    const P: Pt = { x: k * R, y: 0 };
    const phi = Math.acos(1 / k) * (180 / Math.PI);
    const A = at(phi), B = at(-phi);
    sk.line([P, A], { stroke: "ink", width: 2.4, part: "line" });
    sk.line([P, B], { stroke: "ink", width: 2.4, part: "line" });
    sk.line([O, A], { stroke: G, width: 2.2, part: "perpendicular" });
    sk.line([O, B], { stroke: G, width: 2.2 });
    sk.line([O, P], { stroke: "muted", width: 1.6, dash: "5 4" });
    const rA = angleMark(sk, A, O, P, { r: 18, right: true, colour: G, part: "given-angle" });
    angleMark(sk, B, O, P, { r: 18, right: true, colour: G });
    sk.circle(P, 3.5, { fill: "ink", stroke: "ink", width: 1, part: "line" }, false);
    ticks(A, P, 1); ticks(B, P, 1);
    onLine(len(L0.tangent), A, P, O, F); onLine(len(L0.tangent), B, P, O, F);
    onLine(len(L0.radius), O, A, B, G);
    if (L0.op) onLine(len(L0.op), O, P, A);
    letter(A, L[0]); letter(B, L[1]);
    sk.placeText(L[2], 24, P, { x: 1, y: 0 }, { min: 10, max: 40 });
    sk.part("found-angle", `${L[2]}${L[0]} = ${L[2]}${L[1]}`, lerp(A, P, 0.55));
    sk.part("given-angle", `Radius meets tangent at 90°`, rA);
    sk.part("line", `Tangent ${L[2]}${L[0]}`, lerp(A, P, 0.3));
  }
  const oSpot = [{ x: -0.6, y: -0.8 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: -0.6, y: 0.8 }].map((d) => sk.findText(centreLetter, 22, O, d, { min: 14, max: 45 })).find((sp) => sp.ok);
  sk.text((oSpot ?? { c: { x: -22, y: -18 } }).c, centreLetter, 22, "ink", "centre");
  sk.part("centre", `Centre ${centreLetter}`, O);
  sk.part("circumference", "Circumference", sk.clearAnchor([135, 160, 200, 110].map(at)));
  return sk.finish(14);
}
