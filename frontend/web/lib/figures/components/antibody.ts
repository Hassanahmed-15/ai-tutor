import type { FigureComponent, FigureParams, FigurePart, FigureShape, Ink, Pt } from "../types";
import { r2, roundedPoly } from "./bioDraw";

/**
 * AN ANTIBODY (IMMUNOGLOBULIN G), as the O/A Level textbooks draw it: a Y of four polypeptide chains.
 * Two long heavy chains run up the stem and along the inner side of each arm; a short light chain
 * lies along the outer side of each arm. Disulphide bridges hold the heavy chains together at the
 * flexible hinge and each light chain to its heavy chain. The tips of all four chains are the
 * variable regions (orange), whose shape differs between antibodies: together they form an
 * antigen-binding site at the end of each arm. The rest is the constant region. With `bound`, an
 * antigen whose shape is complementary to the site sits in one of them.
 */

const DARK: Ink = "#374151";
const C = {
  heavy: "#93c5fd" as Ink,
  light: "#ddd6fe" as Ink,
  variable: "#fdba74" as Ink,
  antigen: "#fca5a5" as Ink,
  bridge: "#a16207" as Ink,
  site: "#c2410c" as Ink,
};

const W = 600, H = 440;
const MID = 300;
/** Chain width, the gap between the heavy chains in the stem, the gap between heavy and light chains in an arm. */
const BW = 30, GAP_STEM = 14, GAP_ARM = 12;
const HINGE_Y = 240, HINGE_END = 284, STEM_BOTTOM = 428;
/** Arm angle from the vertical, arm length (hinge to tip), where the variable region starts, where the light chain starts. */
const ANGLE = (42 * Math.PI) / 180, L = 218, SV = L - 70, SL = 40;
/** The binding pocket at each tip (arm-local units): its centre across the arm, half-widths at the mouth and floor, depth. */
const TL = -(BW + GAP_ARM);
const TM = TL / 2, MOUTH = 21, FLOOR = 9, DEPTH = 22;

const pt = (x: number, y: number): Pt => ({ x, y });

function boolOf(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    if (/^(true|yes|on|1|show|bound)$/i.test(v.trim())) return true;
    if (/^(false|no|off|0|hide|none|free|unbound)$/i.test(v.trim())) return false;
  }
  return fallback;
}

export const antibody: FigureComponent = {
  name: "antibody",
  title: "Antibody: a Y-shaped immunoglobulin of two heavy and two light polypeptide chains held by disulphide bridges, with variable regions forming two antigen-binding sites, a hinge region and a constant region, one site holding a complementary antigen",
  params: `bound (true default: an antigen with a complementary shape sits in one antigen-binding site; false: both sites empty).`,
  match: /\bantibod\w*\b|\bimmunoglobulin\b|\bantigen[- ]binding\b|\b(active|passive) immunit\w*\b|\bvariable region\b(?=[\s\S]{0,80}\b(antibody|antigen)\b)/i,
  parts: [
    { id: "binding-site", name: "Antigen-binding site" },
    { id: "antigen", name: "Antigen" },
    { id: "light-chain", name: "Light chain" },
    { id: "heavy-chain", name: "Heavy chain" },
    { id: "stem", name: "Constant region" },
    { id: "variable-region", name: "Variable region" },
    { id: "disulphide-bridge", name: "Disulphide bridge" },
    { id: "hinge-region", name: "Hinge region" },
  ],
  build(params: FigureParams) {
    const bound = boolOf(params?.bound ?? params?.antigen, true);
    const chains: FigureShape[] = [];
    const over: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const poly = (part: string, pts: Pt[], fill: Ink, radii: number | number[] = 3) => chains.push({ t: "path", part, d: roundedPoly(pts, radii), fill, stroke: DARK, width: 2 });

    // Each heavy chain is a polyline: up the stem, then out along its arm. Built for the left arm and
    // mirrored for the right (side −1 left, +1 right).
    for (const side of [-1, 1] as const) {
      const mx = (p: Pt): Pt => (side === -1 ? p : pt(2 * MID - p.x, p.y));
      const cx = MID - (BW / 2 + GAP_STEM / 2);
      const hinge = pt(cx, HINGE_Y);
      const u = pt(-Math.sin(ANGLE), -Math.cos(ANGLE)); // along the left arm, towards its tip
      const n = pt(-u.y, u.x); // across the arm, towards the inner (stem) side
      const at = (s: number, t: number) => mx(pt(hinge.x + u.x * s + n.x * t, hinge.y + u.y * s + n.y * t));
      // The elbow is mitred: the seam between stem and arm runs along the bisector.
      const half = BW / 2;
      const elbowA = pt(cx - half, HINGE_Y + half * Math.tan(ANGLE / 2)); // on the stem's outer edge (the arm's lower edge)
      const elbowB = pt(cx + half, HINGE_Y - half * Math.tan(ANGLE / 2)); // on the stem's inner edge (the arm's upper edge)
      // Stem (constant region), hinge, then the heavy chain's arm (constant part) and its variable tip.
      poly("stem", [mx(pt(cx - half, STEM_BOTTOM)), mx(pt(cx + half, STEM_BOTTOM)), mx(pt(cx + half, HINGE_END)), mx(pt(cx - half, HINGE_END))], C.heavy, [10, 10, 2, 2]);
      poly("hinge-region", [mx(pt(cx - half, HINGE_END)), mx(pt(cx + half, HINGE_END)), mx(elbowB), mx(elbowA)], C.heavy, 2);
      poly("heavy-chain", [mx(elbowA), mx(elbowB), at(SV, half), at(SV, -half)], C.heavy, 2);
      poly("variable-region", [at(SV, -half), at(SV, half), at(L, half), at(L, TM + MOUTH), at(L - DEPTH, TM + FLOOR), at(L - DEPTH, -half)], C.variable, [2, 2, 6, 1, 1, 2]);
      // The light chain alongside, on the arm's outer side.
      poly("light-chain", [at(SL, TL - half), at(SL, TL + half), at(SV, TL + half), at(SV, TL - half)], C.light, [10, 10, 2, 2]);
      poly("variable-region", [at(SV, TL - half), at(SV, TL + half), at(L - DEPTH, TL + half), at(L - DEPTH, TM - FLOOR), at(L, TM - MOUTH), at(L, TL - half)], C.variable, [2, 2, 2, 1, 1, 6]);
      // Disulphide bridges: heavy to light in the arm.
      for (const s0 of [SL + 24, SL + 40]) {
        const a = at(s0, -half + 5), b = at(s0, TL + half - 5);
        over.push({ t: "path", part: "disulphide-bridge", d: `M${r2(a.x)} ${r2(a.y)} L${r2(b.x)} ${r2(b.y)}`, stroke: C.bridge, width: 4, fill: "none" });
      }
      // The binding site: the pocket the two variable tips make, its surface traced.
      const pocket = [at(L, TM + MOUTH), at(L - DEPTH, TM + FLOOR), at(L - DEPTH, TM - FLOOR), at(L, TM - MOUTH)];
      over.push({ t: "path", part: "binding-site", d: `M${pocket.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L")}`, stroke: C.site, width: 2.6, fill: "none" });
      if (side === 1) {
        const floor = at(L - DEPTH, TM);
        parts.push({ id: "binding-site", name: "Antigen-binding site", anchor: pt(r2(floor.x), r2(floor.y)) });
        const lv = at((SV + L) / 2 - 6, TL - 4);
        parts.push({ id: "variable-region", name: "Variable region", anchor: pt(r2(lv.x), r2(lv.y)) });
        const db = at(SL + 24, TM);
        parts.push({ id: "disulphide-bridge", name: "Disulphide bridge", anchor: pt(r2(db.x), r2(db.y)) });
        const hc = at((SV + 30) / 2, 0);
        parts.push({ id: "heavy-chain", name: "Heavy chain", anchor: pt(r2(hc.x), r2(hc.y)) });
      } else {
        const lc = at((SL + SV) / 2, TL);
        parts.push({ id: "light-chain", name: "Light chain", anchor: pt(r2(lc.x), r2(lc.y)) });
        parts.push({ id: "hinge-region", name: "Hinge region", anchor: pt(cx - 2, (HINGE_Y + HINGE_END) / 2 + 4) });
        parts.push({ id: "stem", name: "Constant region", anchor: pt(cx, 372) });
        if (bound) {
          // The antigen: its surface has a shape complementary to the site, and fills it.
          const S = (s: number, t: number) => at(L + s, TM + t);
          const ag = [S(-DEPTH + 1.5, -FLOOR + 1.5), S(0.5, -MOUTH + 1.5), S(2, -40), S(30, -46), S(54, -22), S(56, 10), S(38, 42), S(4, 40), S(0.5, MOUTH - 1.5), S(-DEPTH + 1.5, FLOOR - 1.5)];
          over.push({ t: "path", part: "antigen", d: roundedPoly(ag, [1, 1, 8, 16, 16, 16, 16, 8, 1, 1]), fill: C.antigen, stroke: DARK, width: 2 });
          const c = S(30, 0);
          parts.push({ id: "antigen", name: "Antigen", anchor: pt(r2(c.x), r2(c.y)) });
        }
      }
    }
    // Disulphide bridges joining the two heavy chains at the hinge.
    for (const y of [HINGE_END - 2, HINGE_END + 14]) {
      over.push({ t: "path", part: "disulphide-bridge", d: `M${MID - GAP_STEM / 2 - 5} ${y} H${MID + GAP_STEM / 2 + 5}`, stroke: C.bridge, width: 4, fill: "none" });
    }
    const order = antibody.parts.map((p) => p.id);
    parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { w: W, h: H, shapes: [...chains, ...over], parts };
  },
};
