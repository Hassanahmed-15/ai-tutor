import { solutionColour } from "../colours";
import type { FigureComponent, FigureParams, FigureShape } from "../types";

const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : fallback);
const level = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Math.max(0.05, Math.min(1, Number(v))) : fallback);

/**
 * Acid–base titration: retort stand and clamp, a burette read from 0 at the top, its tap and jet,
 * a conical flask on a white tile. The solutions' colours are parameters (the indicator's colour
 * before or at the end-point is the chemistry the board is teaching).
 */
export const titration: FigureComponent = {
  name: "titration",
  title: "Acid–base titration apparatus: stand, clamp, burette with scale, tap and jet, conical flask on a white tile",
  params: `titrant (what is in the burette, e.g. "hydrochloric acid"), analyte (what is in the flask, e.g. "sodium hydroxide + phenolphthalein"), buretteColour and flaskColour (colour names: colourless, pink, yellow, orange, red, blue…), buretteLevel and flaskLevel (0-1), drop (true: a drop leaving the jet)`,
  match: /\btitrat\w*|\bburette\b|\bpipette\b.*\bconical flask\b/i,
  parts: [
    { id: "burette", name: "Burette" },
    { id: "titrant", name: "Titrant" },
    { id: "scale", name: "Scale (0 at the top)" },
    { id: "tap", name: "Tap" },
    { id: "jet", name: "Jet" },
    { id: "clamp", name: "Clamp" },
    { id: "stand", name: "Retort stand" },
    { id: "conical-flask", name: "Conical flask" },
    { id: "analyte", name: "Solution in the flask" },
    { id: "white-tile", name: "White tile" },
  ],
  build(params: FigureParams) {
    const titrant = text(params.titrant, "Acid");
    const analyte = text(params.analyte, "Alkali + indicator");
    const bLevel = level(params.buretteLevel, 0.85);
    const fLevel = level(params.flaskLevel, 0.4);
    const bColour = solutionColour(params.buretteColour, "colourless");
    const fColour = solutionColour(params.flaskColour, "pink");
    const shapes: FigureShape[] = [];
    // Stand: base, rod, boss and clamp arm.
    shapes.push({ t: "path", part: "stand", d: "M60 494 h250 v14 h-250 z", fill: "wood", stroke: "ink", width: 2 });
    shapes.push({ t: "path", part: "stand", d: "M88 40 h9 v454 h-9 z", fill: "metal", stroke: "ink", width: 2 });
    shapes.push({ t: "path", part: "clamp", d: "M84 104 h22 v16 h-22 z", fill: "metal", stroke: "ink", width: 2 });
    shapes.push({ t: "path", part: "clamp", d: "M106 108 H186 M186 100 v24 M214 100 v24 M186 100 h28 M186 124 h28", stroke: "ink", width: 3, fill: "none" });
    // Burette: glass tube, liquid, scale (0 at the top), tap, jet.
    const top = 34, bottom = 334, inner = { l: 193, r: 207 };
    const liquidTop = bottom - (bottom - top - 6) * bLevel;
    shapes.push({ t: "path", part: "titrant", d: `M${inner.l} ${liquidTop} H${inner.r} V${bottom} H${inner.l} Z`, fill: bColour, stroke: "none", opacity: 0.85 });
    shapes.push({ t: "path", part: "titrant", d: `M${inner.l} ${liquidTop} Q200 ${liquidTop + 4} ${inner.r} ${liquidTop}`, stroke: "ink", width: 1.4, fill: "none" });
    shapes.push({ t: "path", part: "burette", d: `M190 ${top} V${bottom} M210 ${top} V${bottom}`, stroke: "ink", width: 2.6, fill: "none" });
    shapes.push({ t: "path", part: "burette", d: `M190 ${top} H210`, stroke: "ink", width: 1.2, fill: "none", opacity: 0.5 });
    for (let i = 0; i <= 50; i += 5) {
      const y = top + 14 + (i / 50) * (bottom - top - 30);
      shapes.push({ t: "path", part: "scale", d: `M210 ${y} h${i % 10 === 0 ? 9 : 5}`, stroke: "ink", width: 1.2, fill: "none" });
      if (i % 10 === 0) shapes.push({ t: "text", part: "scale", x: 222, y: y + 4, text: String(i), size: 11, anchor: "start", fill: "muted" });
    }
    shapes.push({ t: "path", part: "tap", d: `M195 ${bottom} h10 v14 h-10 z`, fill: "glass", stroke: "ink", width: 2 });
    shapes.push({ t: "path", part: "tap", d: `M180 ${bottom + 5} h40 v5 h-40 z`, fill: "ink", stroke: "ink", width: 1 });
    shapes.push({ t: "path", part: "jet", d: `M196 ${bottom + 14} L198.5 ${bottom + 50} M204 ${bottom + 14} L201.5 ${bottom + 50}`, stroke: "ink", width: 2, fill: "none" });
    if (params.drop === true) shapes.push({ t: "circle", part: "jet", cx: 200, cy: bottom + 60, r: 3.2, fill: bColour, stroke: "ink", width: 1 });
    // Conical flask on a white tile.
    const neckTop = 404, neckBottom = 426, base = 484;
    const wall = (y: number, side: -1 | 1) => 200 + side * (20 + ((y - neckBottom) / (base - neckBottom)) * 42);
    const liquidY = base - (base - neckBottom) * fLevel * 0.9;
    shapes.push({ t: "path", part: "white-tile", d: "M124 484 h152 v10 h-152 z", fill: "paper", stroke: "ink", width: 1.6 });
    shapes.push({ t: "path", part: "analyte", d: `M${wall(liquidY, -1)} ${liquidY} H${wall(liquidY, 1)} L${wall(base - 2, 1)} ${base - 2} H${wall(base - 2, -1)} Z`, fill: fColour, stroke: "none", opacity: 0.85 });
    shapes.push({ t: "path", part: "conical-flask", d: `M180 ${neckTop} V${neckBottom} L${wall(base, -1)} ${base} H${wall(base, 1)} L220 ${neckBottom} V${neckTop}`, stroke: "ink", width: 2.6, fill: "none" });
    shapes.push({ t: "path", part: "conical-flask", d: `M176 ${neckTop} h8 M216 ${neckTop} h8`, stroke: "ink", width: 2.6, fill: "none" });
    const flaskWallX = wall(446, 1);
    return {
      w: 340,
      h: 520,
      shapes,
      parts: [
        { id: "burette", name: "Burette", anchor: { x: 190, y: 120 } },
        { id: "titrant", name: titrant, anchor: { x: 200, y: Math.max(liquidTop + 30, 200) } },
        { id: "scale", name: "Scale (0 at the top)", anchor: { x: 214, y: top + 28 } },
        { id: "tap", name: "Tap", anchor: { x: 218, y: bottom + 7 } },
        { id: "jet", name: "Jet", anchor: { x: 200, y: bottom + 34 } },
        { id: "clamp", name: "Clamp", anchor: { x: 146, y: 108 } },
        { id: "stand", name: "Retort stand", anchor: { x: 92, y: 300 } },
        { id: "conical-flask", name: "Conical flask", anchor: { x: flaskWallX, y: 446 } },
        { id: "analyte", name: analyte, anchor: { x: 200, y: (liquidY + base) / 2 } },
        { id: "white-tile", name: "White tile", anchor: { x: 264, y: 489 } },
      ],
    };
  },
};
