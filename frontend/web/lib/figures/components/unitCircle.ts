import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { PALETTE, Sketch, add, arrow, bool, dist, fmt, mul, polar, unit } from "./mathsKit";
import { normalizeExpr } from "./calculusKit";
import { evalExpr } from "../../canvas/expr";

/**
 * THE UNIT CIRCLE. The board gives an angle (degrees or radians, any size, negative allowed); the
 * code finds its quadrant, reference angle, cos θ and sin θ (exact surds for the special angles:
 * 150° → (−√3/2, 1/2)), and draws the terminal side, the point, the sine and cosine as lengths,
 * the reference angle, ASTC quadrant signs and optionally tan θ on the tangent line x = 1.
 */

export type UnitCirclePoint = {
  deg: number; // the angle as given, in degrees
  norm: number; // in [0, 360)
  quadrant: 0 | 1 | 2 | 3 | 4; // 0 = on an axis
  reference: number; // degrees, 0..90
  cos: number;
  sin: number;
  cosText: string;
  sinText: string;
  tanText: string;
};

const EXACT: Record<number, { sin: string; cos: string; tan: string }> = {
  0: { sin: "0", cos: "1", tan: "0" },
  30: { sin: "1/2", cos: "√3/2", tan: "√3/3" },
  45: { sin: "√2/2", cos: "√2/2", tan: "1" },
  60: { sin: "√3/2", cos: "1/2", tan: "√3" },
  90: { sin: "1", cos: "0", tan: "undefined" },
};

/** "150", 150, "150°", "5π/6", "5pi/6 rad", "-3pi/4", "2.5 rad" → degrees (and whether it was given in radians). */
export function parseAngle(v: unknown, units?: unknown): { deg: number; radians: boolean; text?: string } {
  if (typeof v === "number" && Number.isFinite(v)) {
    const r = /^rad/i.test(String(units ?? ""));
    return { deg: clampDeg(r ? (v * 180) / Math.PI : v), radians: r };
  }
  const s = String(v ?? "").trim();
  if (!s) return { deg: 150, radians: false };
  const isRad = /π|pi|rad/i.test(s) || /^rad/i.test(String(units ?? ""));
  const body = s.replace(/°|deg(rees?)?|rad(ians?)?/gi, "").trim();
  const val = evalExpr(normalizeExpr(body), {}, NaN);
  if (!Number.isFinite(val)) return { deg: 150, radians: false };
  return isRad ? { deg: clampDeg((val * 180) / Math.PI), radians: true, text: /π|pi/i.test(s) ? piText((val * 180) / Math.PI) : undefined } : { deg: clampDeg(val), radians: false };
}
const clampDeg = (d: number) => Math.max(-1080, Math.min(1080, Math.round(d * 1e9) / 1e9));
/** 150 → "5π/6" when it is a multiple of 15°. */
function piText(deg: number): string | undefined {
  const k = deg / 15;
  if (Math.abs(k - Math.round(k)) > 1e-6) return undefined;
  let n = Math.round(k), d = 12;
  const g = gcd(Math.abs(n), d);
  n /= g;
  d /= g;
  if (n === 0) return "0";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  return `${sign}${a === 1 ? "" : a}π${d === 1 ? "" : `/${d}`}`;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a || 1);

export function unitCirclePoint(deg: number): UnitCirclePoint {
  const norm = ((deg % 360) + 360) % 360;
  const n = Math.abs(norm - 360) < 1e-9 ? 0 : norm;
  const axis = [0, 90, 180, 270].find((a) => Math.abs(n - a) < 1e-9);
  const quadrant = axis !== undefined ? 0 : ((Math.floor(n / 90) + 1) as 1 | 2 | 3 | 4);
  const reference = axis !== undefined ? (axis === 90 || axis === 270 ? 90 : 0) : quadrant === 1 ? n : quadrant === 2 ? 180 - n : quadrant === 3 ? n - 180 : 360 - n;
  const r = (n * Math.PI) / 180;
  const cos = axis !== undefined ? [1, 0, -1, 0][axis / 90] : Math.cos(r);
  const sin = axis !== undefined ? [0, 1, 0, -1][axis / 90] : Math.sin(r);
  const special = [0, 30, 45, 60, 90].find((s) => Math.abs(reference - s) < 1e-9);
  const sign = (v: number, t: string) => (t === "0" ? "0" : v < 0 ? `−${t}` : t);
  let cosText: string, sinText: string, tanText: string;
  if (special !== undefined) {
    const e = EXACT[special];
    cosText = sign(cos, e.cos);
    sinText = sign(sin, e.sin);
    tanText = e.tan === "undefined" ? "undefined" : sign(cos * sin, e.tan);
  } else {
    cosText = fmt(cos, 3);
    sinText = fmt(sin, 3);
    tanText = fmt(sin / cos, 3);
  }
  return { deg, norm: n, quadrant, reference: Math.round(reference * 1e9) / 1e9, cos: Math.abs(cos) < 1e-12 ? 0 : cos, sin: Math.abs(sin) < 1e-12 ? 0 : sin, cosText, sinText, tanText };
}

const ROMAN = ["", "I", "II", "III", "IV"];
const ASTC = ["", "A", "S", "T", "C"];
const QUAD_NAME = ["", "Quadrant I: all positive", "Quadrant II: sin positive", "Quadrant III: tan positive", "Quadrant IV: cos positive"];

const PARTS = [
  { id: "circle", name: "Unit circle (radius 1)" },
  { id: "angle", name: "Angle θ" },
  { id: "terminal-side", name: "Terminal side" },
  { id: "point", name: "Point (cos θ, sin θ)" },
  { id: "sine", name: "sin θ (vertical)" },
  { id: "cosine", name: "cos θ (horizontal)" },
  { id: "reference-angle", name: "Reference angle" },
  { id: "quadrant", name: "Quadrant" },
  { id: "tangent", name: "tan θ on the tangent line" },
];

export const unitCircle: FigureComponent = {
  name: "unitCircle",
  title: "The unit circle with an angle θ: terminal side, the point (cos θ, sin θ) with exact values for special angles, sine and cosine drawn as lengths, the reference angle, ASTC quadrant signs and optionally tan θ",
  params: `angle (θ in degrees, e.g. 150, -45, 390; or radians as text, e.g. "5π/6", "-3pi/4", "2 rad"; default 150); units ("deg" default | "rad": a plain number is radians); sincos (true default: draw sin θ and cos θ as the vertical and horizontal lengths with their values); tan (false default: draw tan θ on the tangent line x = 1); reference (true default: mark the reference angle when it differs from θ); astc (true default: write A, S, T, C in the quadrants); coordinates (true default: write (cos θ, sin θ) at the point). All values are computed — never give them.`,
  match: /\bunit circle\b|\breference angles?\b|\bASTC\b|\bCAST (diagram|rule)\b|\ball students take calculus\b|\b(terminal|initial) side\b|\b(trig(onometric)? (ratios|functions) of (any|obtuse|all) angles?)\b|\bradian measure\b.*\bcircle\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const ang = parseAngle(params.angle ?? params.theta, params.units);
    const pt = unitCirclePoint(ang.deg);
    const R = 150;
    const S = (x: number, y: number): Pt => ({ x: x * R, y: -y * R });
    const O = { x: 0, y: 0 };
    const P = S(pt.cos, pt.sin);
    const showSC = bool(params.sincos, true), showTan = bool(params.tan, false), showRef = bool(params.reference, true);
    const showAstc = bool(params.astc, true), showCoords = bool(params.coordinates, true);
    const sk = new Sketch();

    // Axes and the circle.
    arrow(sk, { x: -R - 34, y: 0 }, { x: R + 40, y: 0 }, "ink", 1.8, undefined, 11);
    arrow(sk, { x: 0, y: R + 34 }, { x: 0, y: -R - 40 }, "ink", 1.8, undefined, 11);
    sk.text({ x: R + 48, y: 14 }, "x", 19);
    sk.text({ x: 14, y: -R - 46 }, "y", 19);
    sk.circle(O, R, { fill: "none", stroke: "ink", width: 2.4, part: "circle" });
    for (const [x, y, t] of [[1, 0, "1"], [-1, 0, "−1"], [0, 1, "1"], [0, -1, "−1"]] as Array<[number, number, string]>) {
      const at = S(x, y);
      sk.line(x ? [{ x: at.x, y: -4 }, { x: at.x, y: 4 }] : [{ x: -4, y: at.y }, { x: 4, y: at.y }], { stroke: "ink", width: 1.5 }, false);
      sk.text(x ? { x: at.x + (x > 0 ? 12 : -14), y: 14 } : { x: -14, y: at.y + (y > 0 ? -12 : 12) }, t, 16, "muted");
    }
    sk.text({ x: -12, y: 14 }, "O", 16, "muted");

    // tan θ on the tangent line x = 1 (only when it is not too long to draw).
    const tan = pt.cos !== 0 ? pt.sin / pt.cos : Infinity;
    const tanOn = showTan && Number.isFinite(tan) && Math.abs(tan) <= 2.2;
    if (tanOn) {
      const T = S(1, tan);
      sk.line([{ x: R, y: -R * 2.3 }, { x: R, y: R * 2.3 }].map((p) => ({ x: p.x, y: Math.max(-R * 1.25, Math.min(R * 1.25, p.y)) })), { stroke: "muted", width: 1.4, dash: "4 5" }, false);
      if (pt.cos < 0) sk.line([O, T], { stroke: PALETTE.green, width: 1.8, dash: "6 5", part: "tangent" });
      else sk.line([P, T], { stroke: PALETTE.green, width: 1.8, dash: "6 5", part: "tangent" });
      sk.line([S(1, 0), T], { stroke: PALETTE.green, width: 3.4, part: "tangent" });
      sk.circle(T, 4, { fill: PALETTE.green, stroke: PALETTE.green, width: 1, part: "tangent" }, false);
      sk.placeText(`tan θ = ${pt.tanText}`, 18, { x: R, y: T.y / 2 }, { x: 1, y: 0 }, { min: 10, max: 80, fill: PALETTE.green, part: "tangent" });
    }

    // Cosine along the x-axis, sine straight up/down from it, with a right-angle mark at the foot.
    const foot = S(pt.cos, 0);
    if (showSC) {
      if (pt.cos !== 0) sk.line([O, foot], { stroke: PALETTE.blue, width: 4, part: "cosine" });
      if (pt.sin !== 0) sk.line([foot, P], { stroke: PALETTE.red, width: 4, part: "sine" });
      if (pt.cos !== 0 && pt.sin !== 0 && Math.abs(foot.x) > 16 && Math.abs(P.y) > 16) {
        const sx = pt.cos > 0 ? -1 : 1, sy = pt.sin > 0 ? -1 : 1, q = 10;
        sk.line([{ x: foot.x + sx * q, y: 0 }, { x: foot.x + sx * q, y: sy * q }, { x: foot.x, y: sy * q }], { stroke: "ink", width: 1.4, part: "sine" }, false);
      }
    }
    sk.line([O, P], { stroke: "ink", width: 3, part: "terminal-side" });

    // θ: an arc (a spiral past a full turn) from the positive x-axis, with an arrowhead.
    const total = (ang.deg * Math.PI) / 180;
    const turns = Math.abs(total) / (2 * Math.PI);
    const r0 = 30, grow = turns > 1 ? 9 / (2 * Math.PI) : 0;
    const steps = Math.max(8, Math.ceil(Math.abs(total) / 0.06));
    const arcPts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (total * i) / steps;
      arcPts.push(polar(O, r0 + grow * Math.abs(t), -t));
    }
    let angleAnchor = polar(O, r0, -total / 2);
    if (Math.abs(total) > 1e-9) {
      sk.line(arcPts.slice(0, -1), { stroke: PALETTE.violet, width: 2.2, part: "angle" });
      const end = arcPts[arcPts.length - 1], before = arcPts[Math.max(0, arcPts.length - 4)];
      const u = unit({ x: end.x - before.x, y: end.y - before.y });
      const nrm = { x: -u.y, y: u.x };
      sk.polygon([end, add(add(end, mul(u, -10)), mul(nrm, 4.5)), add(add(end, mul(u, -10)), mul(nrm, -4.5))], { fill: PALETTE.violet, stroke: PALETTE.violet, width: 1, part: "angle" });
      angleAnchor = arcPts[Math.floor(arcPts.length * (turns > 1 ? 0.15 : 0.3))];
    }
    const thetaText = `θ = ${ang.radians ? ang.text ?? `${fmt((ang.deg * Math.PI) / 180, 3)} rad` : `${fmt(ang.deg, 2)}°`}`;

    // The reference angle: between the terminal side and the nearer x-axis, when it is not θ itself.
    const refOn = showRef && pt.quadrant !== 0 && !(ang.deg > 0 && ang.deg < 90);
    let refAnchor: Pt | undefined;
    if (refOn) {
      const tA = Math.atan2(P.y, P.x);
      const xA = pt.cos > 0 ? 0 : Math.PI;
      const rr = 58;
      sk.arc(O, rr, xA, tA, { stroke: PALETTE.amber, width: 2.6, part: "reference-angle" });
      let mid = (xA + tA) / 2;
      if (Math.abs(xA - tA) > Math.PI) mid += Math.PI;
      refAnchor = polar(O, rr, mid);
      sk.placeText(`${fmt(pt.reference, 2)}°`, 18, O, { x: Math.cos(mid), y: Math.sin(mid) }, { min: rr + 14, max: rr + 50, fill: PALETTE.amber, part: "reference-angle" });
    }
    // θ's value, near its arc (inside the circle, clear of the lines).
    const thetaDir = unit(Math.abs(total) > 1e-9 ? sub0(arcPts[Math.floor(arcPts.length / 2)]) : { x: 1, y: -1 });
    const thetaSpot = sk.findText(thetaText, 19, O, thetaDir, { min: r0 + 16, max: R - 10 });
    const thetaAlt = thetaSpot.ok ? thetaSpot : sk.findText(thetaText, 19, O, { x: thetaDir.x > 0 ? 1 : -1, y: thetaDir.y > 0 ? 0.5 : -0.5 }, { min: r0 + 10, max: R + 60 });
    sk.text(thetaAlt.c, thetaText, 19, PALETTE.violet, "angle");

    // The point and its coordinates.
    sk.circle(P, 6.5, { fill: "ink", stroke: "ink", width: 1, part: "point" }, false);
    if (showCoords) {
      const coord = `(${pt.cosText}, ${pt.sinText})`;
      sk.placeText(coord, 20, P, unit(P.x || P.y ? P : { x: 1, y: -1 }), { min: 22, max: 90, fill: "ink", part: "point" });
    }
    if (showSC) {
      if (pt.sin !== 0) sk.placeText(pt.sinText, 18, { x: P.x, y: P.y / 2 }, { x: pt.cos >= 0 ? 1 : -1, y: 0 }, { min: 10, max: 60, fill: PALETTE.red, part: "sine", slide: { x: 0, y: 1 } });
      if (pt.cos !== 0) sk.placeText(pt.cosText, 18, { x: foot.x / 2, y: 0 }, { x: 0, y: pt.sin > 0 ? 1 : -1 }, { min: 12, max: 50, fill: PALETTE.blue, part: "cosine", slide: { x: 1, y: 0 } });
    }

    // ASTC: which ratios are positive in each quadrant; the terminal side's quadrant in ink.
    const quadAnchor: Pt[] = [];
    if (showAstc || pt.quadrant) {
      for (let q = 1; q <= 4; q++) {
        const dir = { x: q === 1 || q === 4 ? 1 : -1, y: q === 1 || q === 2 ? -1 : 1 };
        // Inside the quadrant, on the side away from the terminal side.
        const q0 = (q - 1) * 90;
        // In the terminal side's quadrant: the middle of the wider of the two wedges it leaves (the
        // sine–cosine triangle sits in the x-axis wedge, so that one must be clearly wider).
        const yAxisAt = q % 2 ? q0 + 90 : q0, xAxisAt = q % 2 ? q0 : q0 + 90;
        const yWedge = Math.abs(yAxisAt - pt.norm), xWedge = Math.abs(xAxisAt - pt.norm);
        const pick = q !== pt.quadrant ? q0 + 45 : xWedge > yWedge + 10 ? (xAxisAt + pt.norm) / 2 : (yAxisAt + pt.norm) / 2;
        const d = { x: Math.cos((pick * Math.PI) / 180), y: -Math.sin((pick * Math.PI) / 180) };
        void dir;
        const here = q === pt.quadrant;
        if (showAstc) {
          const size = here ? 26 : 22;
          const spot = (here ? [0.8, 0.66, 0.5] : [0.66, 0.5, 0.8]).map((k) => sk.findText(ASTC[q], size, mul(d, R * k), d, { min: 0, max: 14, slide: { x: -d.y, y: d.x } })).find((sp) => sp.ok) ?? { c: mul(d, R * 0.66) };
          sk.text(spot.c, ASTC[q], size, here ? (PALETTE.amber as Ink) : "muted", here ? "quadrant" : undefined);
          quadAnchor[q] = add(spot.c, mul(d, size * 0.7));
        } else quadAnchor[q] = { x: dir.x * R * 0.7, y: dir.y * R * 0.7 };
      }
    }

    // Anchors.
    sk.part("circle", "Unit circle (radius 1)", sk.clearAnchor([210, 240, 300, 330, 120, 60].map((d) => polar(O, R, (d * Math.PI) / 180)).filter((p) => dist(p, P) > 30)));
    sk.part("angle", `Angle θ = ${thetaText.slice(4)}`, angleAnchor);
    sk.part("terminal-side", "Terminal side", { x: P.x * 0.8, y: P.y * 0.8 });
    sk.part("point", "Point (cos θ, sin θ)", P);
    if (showSC && pt.sin !== 0) sk.part("sine", `sin θ = ${pt.sinText}`, { x: P.x, y: P.y * 0.22 });
    if (showSC && pt.cos !== 0) sk.part("cosine", `cos θ = ${pt.cosText}`, { x: foot.x * 0.22, y: 0 });
    if (refAnchor) sk.part("reference-angle", `Reference angle ${fmt(pt.reference, 2)}°`, refAnchor);
    if (pt.quadrant) sk.part("quadrant", `${QUAD_NAME[pt.quadrant]}`.replace(/^Quadrant [IV]+/, `Quadrant ${ROMAN[pt.quadrant]}`), quadAnchor[pt.quadrant]);
    if (tanOn) sk.part("tangent", `tan θ = ${pt.tanText}`, { x: R, y: -tan * R * 0.5 });
    return sk.finish(12);
  },
};

const sub0 = (p: Pt): Pt => (Math.hypot(p.x, p.y) > 1e-9 ? p : { x: 1, y: -1 });
