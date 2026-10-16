import type { FigureComponent, FigureShape } from "../types";

/**
 * Antibody (immunoglobulin) as a Y: two antigen-binding sites on the arms, a constant stem, and
 * one antigen docked on a site — the diagram an immunity labelling question needs.
 */
export const antibody: FigureComponent = {
  name: "antibody",
  title: "Antibody: Y-shaped immunoglobulin with antigen-binding sites and a bound antigen",
  params: `bound (true default: an antigen on one arm).`,
  match: /\bantibod\w*\b|\bimmunoglobulin\b|\bantigen[- ]binding\b|\b(active|passive) immunit\w*\b|\bvariable region\b(?=[\s\S]{0,80}\b(antibody|antigen)\b)/i,
  parts: [
    { id: "heavy-chain", name: "Heavy chain" },
    { id: "light-chain", name: "Light chain" },
    { id: "binding-site", name: "Antigen-binding site" },
    { id: "antigen", name: "Antigen" },
    { id: "stem", name: "Constant region" },
  ],
  build() {
    const shapes: FigureShape[] = [];
    shapes.push({ t: "path", part: "heavy-chain", d: "M320 360 L320 210 L210 90", stroke: "#1d4ed8", width: 18, fill: "none" });
    shapes.push({ t: "path", part: "heavy-chain", d: "M320 210 L430 90", stroke: "#1d4ed8", width: 18, fill: "none" });
    shapes.push({ t: "path", part: "light-chain", d: "M250 150 L210 90", stroke: "#93c5fd", width: 10, fill: "none" });
    shapes.push({ t: "path", part: "light-chain", d: "M390 150 L430 90", stroke: "#93c5fd", width: 10, fill: "none" });
    shapes.push({ t: "path", part: "stem", d: "M300 250 H340 V360 H300 Z", fill: "#1e40af", stroke: "ink", width: 1.6 });
    shapes.push({ t: "circle", part: "binding-site", cx: 210, cy: 84, r: 16, fill: "#fde68a", stroke: "ink", width: 1.8 });
    shapes.push({ t: "circle", part: "binding-site", cx: 430, cy: 84, r: 16, fill: "#fde68a", stroke: "ink", width: 1.8 });
    shapes.push({ t: "path", part: "antigen", d: "M186 40 H234 V72 H186 Z", fill: "#fca5a5", stroke: "ink", width: 1.8 });
    return {
      w: 640,
      h: 400,
      shapes,
      parts: [
        { id: "binding-site", name: "Antigen-binding site", anchor: { x: 430, y: 84 } },
        { id: "antigen", name: "Antigen", anchor: { x: 210, y: 56 } },
        { id: "light-chain", name: "Light chain", anchor: { x: 250, y: 140 } },
        { id: "heavy-chain", name: "Heavy chain", anchor: { x: 320, y: 230 } },
        { id: "stem", name: "Constant region", anchor: { x: 320, y: 310 } },
      ],
    };
  },
};
