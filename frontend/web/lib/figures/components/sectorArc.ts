import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, clamp, fmt, num, polar, rad } from "./mathsKit";

/**
 * A circle with one sector shaded, its radius, the arc, the angle at the centre, and the two
 * formulae an O Level mensuration question uses: arc = (θ/360)×2πr, sector = (θ/360)×πr².
 */

export function sectorMeasures(r: number, theta: number): { arc: number; area: number } {
  const t = ((theta % 360) + 360) % 360;
  return { arc: (t / 360) * 2 * Math.PI * r, area: (t / 360) * Math.PI * r * r };
}

export const sectorArc: FigureComponent = {
  name: "sectorArc",
  title: "A circle with a shaded sector, marked radius, arc and centre angle, and the arc-length and sector-area formulae evaluated from r and θ",
  params: `r (radius, default 7); theta (centre angle in degrees, 1–359, default 72); unit (cm default). showChord (true draws the chord of the minor arc).`,
  match: /\b(arcs? and sectors?|sectors? and arcs?|arc length|area of (a |the )?sector|sector area|length of (an |the )?arc|minor (arc|sector)|major (arc|sector)|angle at the centre)\b|\bcircles?, arcs and sectors\b|\b(θ|theta)\s*\/\s*360\b/i,
  parts: [
    { id: "circle", name: "Circle" },
    { id: "radius", name: "Radius" },
    { id: "sector", name: "Sector" },
    { id: "arc", name: "Arc" },
    { id: "angle", name: "Angle at the centre" },
    { id: "formula", name: "Arc and sector formulae" },
  ],
  build(params: FigureParams) {
    const rVal = num(params.r ?? params.radius, 7, 0.1, 1e6);
    const theta = clamp(num(params.theta ?? params.angle, 72, 1, 359), 1, 359);
    const unit = String(params.unit ?? "cm").replace(/[^a-zA-Z°]/g, "").slice(0, 4) || "cm";
    const showChord = String(params.showChord ?? "") === "true" || params.showChord === true;
    const m = sectorMeasures(rVal, theta);
    const sk = new Sketch();
    const c: Pt = { x: 210, y: 210 };
    const R = 150;
    const a0 = -Math.PI / 2;
    const a1 = a0 + rad(theta);
    const p0 = polar(c, R, a0);
    const p1 = polar(c, R, a1);
    sk.circle(c, R, { stroke: "ink", width: 2.4, fill: "none", part: "circle" });
    sk.path(
      [
        { k: "M", p: c },
        { k: "L", p: p0 },
        { k: "A", c, r: R, to: p1, large: theta > 180, sweep: true },
      ],
      true,
      { fill: PALETTE.blue, opacity: 0.22, stroke: PALETTE.blue, width: 2.2, part: "sector" },
    );
    sk.arc(c, R, a0, a1, { stroke: PALETTE.red, width: 5, part: "arc" });
    sk.line([c, p0], { stroke: "ink", width: 2.2, part: "radius" });
    sk.line([c, p1], { stroke: "ink", width: 2.2, part: "radius" });
    if (showChord) sk.line([p0, p1], { stroke: PALETTE.amber, width: 2, dash: "6 5", part: "arc" });
    sk.circle(c, 4, { fill: "ink", stroke: "none", part: "angle" });
    const amid = a0 + rad(theta) / 2;
    sk.arc(c, 36, a0, a1, { stroke: PALETTE.amber, width: 2, part: "angle" });
    sk.text(polar(c, 54, amid), `${fmt(theta, 1)}°`, 16, PALETTE.amber, "angle");
    sk.text({ x: (c.x + p0.x) / 2 - 18, y: (c.y + p0.y) / 2 }, `r = ${fmt(rVal, 2)} ${unit}`, 16, "ink", "radius");
    sk.polygon([{ x: 390, y: 40 }, { x: 640, y: 40 }, { x: 640, y: 200 }, { x: 390, y: 200 }], { fill: "#eff6ff", stroke: PALETTE.blue, width: 2, part: "formula" });
    sk.text({ x: 515, y: 78 }, `arc = (θ/360)×2πr`, 16, PALETTE.blue, "formula");
    sk.text({ x: 515, y: 108 }, `= ${fmt(m.arc, 2)} ${unit}`, 18, "ink", "formula");
    sk.text({ x: 515, y: 148 }, `sector = (θ/360)×πr²`, 16, PALETTE.blue, "formula");
    sk.text({ x: 515, y: 178 }, `= ${fmt(m.area, 2)} ${unit}²`, 18, "ink", "formula");
    sk.part("circle", "Circle", { x: c.x + R * 0.7, y: c.y + R * 0.7 });
    sk.part("radius", `Radius ${fmt(rVal, 2)} ${unit}`, { x: (c.x + p0.x) / 2, y: (c.y + p0.y) / 2 });
    sk.part("sector", "Sector", polar(c, R * 0.45, amid));
    sk.part("arc", "Arc", polar(c, R, amid));
    sk.part("angle", `Angle ${fmt(theta, 1)}°`, polar(c, 54, amid));
    sk.part("formula", "Arc and sector formulae", { x: 515, y: 120 });
    return sk.finish(16);
  },
};
