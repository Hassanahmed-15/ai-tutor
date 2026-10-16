import type { FigureComponent, FigurePart, FigureParams, FigureShape, Pt } from "../types";
import { arrowShapes, blobPoints, r2, roundedPoly, smoothClosed } from "./bioDraw";
import { bool } from "./mathsKit";

/**
 * ROOT HAIR CELL, the O/A Level line diagram: an epidermal cell of the root whose outer wall grows
 * out into a long, thin root hair (a large surface area for absorption). Cell wall, cell membrane,
 * cytoplasm, a large vacuole reaching into the hair, the nucleus pushed to the side, mitochondria
 * (energy for active transport of ions) and — no chloroplasts, because a root is underground.
 * With showUptake the hair grows between soil particles, each wrapped in a film of soil water, and
 * arrows show water entering by osmosis and mineral ions by active transport.
 */

const W = 720, H = 400;
/** The cell body (an epidermal cell) and the hair's centreline, a gentle curve rising to its tip. */
const BODY = { x0: 40, x1: 280, y0: 176, y1: 336 } as const;
const HAIR = { a: { x: BODY.x1, y: 224 }, c: { x: 480, y: 238 }, b: { x: 668, y: 180 }, hw: 30 } as const;
const WALL = 8, MEMBRANE = 12;
/** Outlines drawn inside pale fills: a fixed dark that stays dark on the chalkboard too (plain "ink" turns light there and vanishes on a pale fill). */
const DARK = "#374151";

export const PLANT_COLOURS = {
  wall: "#d9f99d",
  cytoplasm: "#fef3c7",
  vacuole: "#dbeafe",
  nucleus: "#ddd6fe",
  nucleolus: "#7c3aed",
  mitochondrion: "#fdba74",
  soil: "#e7cfa6",
  water: "#2563eb",
  ion: "#d97706",
} as const;

/** A point on the hair's centreline (quadratic Bézier) and its unit normal pointing to the hair's upper side. */
function hairAt(t: number): { p: Pt; n: Pt } {
  const { a, c, b } = HAIR;
  const u = 1 - t;
  const p = { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  const d = { x: 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x), y: 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y) };
  const L = Math.hypot(d.x, d.y) || 1;
  return { p, n: { x: d.y / L, y: -d.x / L } };
}

/** The hair's two edges at half-width `hw`, from t = 0 to `upto`, closed by a round end. */
function hairEdges(hw: number, upto: number, steps = 18): { upper: Pt[]; lower: Pt[]; tip: Pt[] } {
  const upper: Pt[] = [], lower: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * upto;
    const { p, n } = hairAt(t);
    upper.push({ x: p.x + n.x * hw, y: p.y + n.y * hw });
    lower.push({ x: p.x - n.x * hw, y: p.y - n.y * hw });
  }
  const { p, n } = hairAt(upto);
  const dir = { x: -n.y, y: n.x }; // along the hair, towards the tip
  const tip: Pt[] = [];
  for (let i = 1; i < 8; i++) {
    const a = (i / 8) * Math.PI; // from the upper side round the end to the lower side
    tip.push({ x: p.x + n.x * hw * Math.cos(a) + dir.x * hw * Math.sin(a), y: p.y + n.y * hw * Math.cos(a) + dir.y * hw * Math.sin(a) });
  }
  return { upper, lower, tip };
}

/** The whole cell outline (body + hair), inset by `i` — the wall's outer face, its inner face, the membrane. */
function cellOutline(i: number): string {
  const { upper, lower, tip } = hairEdges(HAIR.hw - i, 1);
  // The hair leaves the body's right wall: its edges start on that wall.
  upper[0] = { x: BODY.x1 - i, y: upper[0].y };
  lower[0] = { x: BODY.x1 - i, y: lower[0].y };
  const pts: Pt[] = [
    { x: BODY.x0 + i, y: BODY.y0 + i },
    { x: BODY.x1 - i, y: BODY.y0 + i },
    ...upper,
    ...tip,
    ...[...lower].reverse(),
    { x: BODY.x1 - i, y: BODY.y1 - i },
    { x: BODY.x0 + i, y: BODY.y1 - i },
  ];
  const radii = pts.map((_, k) => (k < 2 || k >= pts.length - 2 ? 16 : 40));
  return roundedPoly(pts, radii);
}

/** The large vacuole: most of the body (the nucleus pressed to the left) and on into the hair. */
function vacuoleOutline(): string {
  const reach = 0.8, hw = HAIR.hw - 19;
  const { upper, lower, tip } = hairEdges(hw, reach, 14);
  const x0 = BODY.x0 + 62, x1 = BODY.x1 - 30, y0 = BODY.y0 + 24, y1 = BODY.y1 - 24;
  const pts: Pt[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1 + 14, y: upper[0].y },
    ...upper.slice(1),
    ...tip,
    ...[...lower].reverse().slice(0, -1),
    { x: x1 + 14, y: lower[0].y },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  return roundedPoly(pts, pts.map((_, k) => (k === 0 || k === pts.length - 1 ? 22 : 30)));
}

/** A mitochondrion: a small capsule with a folded inner membrane. */
function mitochondrion(c: Pt, angle: number): FigureShape[] {
  const rx = 10, ry = 5.5, cos = Math.cos(angle), sin = Math.sin(angle);
  const at = (x: number, y: number) => `${r2(c.x + x * cos - y * sin)} ${r2(c.y + x * sin + y * cos)}`;
  const outline = `M${at(-rx, 0)} A${rx} ${ry} ${r2((angle * 180) / Math.PI)} 1 1 ${at(rx, 0)} A${rx} ${ry} ${r2((angle * 180) / Math.PI)} 1 1 ${at(-rx, 0)} Z`;
  const cristae = `M${at(-6, 2)} L${at(-4, -3)} L${at(-1, 2)} L${at(2, -3)} L${at(5, 2)}`;
  return [
    { t: "path", d: outline, fill: PLANT_COLOURS.mitochondrion, stroke: DARK, width: 1.4, part: "mitochondrion" },
    { t: "path", d: cristae, fill: "none", stroke: "#9a3412", width: 1.1, part: "mitochondrion" },
  ];
}

/**
 * Soil particles hugging the hair (two rows, one each side, gaps left where the arrows come in) and
 * a few further out: [t along the hair, side (+1 above, −1 below), extra gap, rx, ry, seed].
 */
const SOIL_ALONG: Array<[number, 1 | -1, number, number, number, number]> = [
  [0.14, 1, 10, 30, 24, 3], [0.3, 1, 8, 28, 30, 7], [0.62, 1, 9, 30, 26, 11], [0.8, 1, 8, 26, 24, 5], [0.95, 1, 8, 20, 18, 17],
  [0.12, -1, 9, 32, 26, 13], [0.3, -1, 8, 30, 30, 2], [0.47, -1, 10, 26, 26, 19], [0.84, -1, 8, 32, 28, 23],
  [0.27, 1, 72, 26, 20, 29], [0.12, -1, 74, 28, 22, 37],
];
function soilParticles(): Array<{ c: Pt; rx: number; ry: number; seed: number }> {
  return SOIL_ALONG.map(([t, side, gap, rx, ry, seed]) => {
    const { p, n } = hairAt(t);
    const off = HAIR.hw + gap + ry;
    return { c: { x: r2(p.x + n.x * side * off), y: r2(p.y + n.y * side * off) }, rx, ry, seed };
  });
}

export const rootHairCell: FigureComponent = {
  name: "rootHairCell",
  title: "Root hair cell: an epidermal cell of the root with a long root hair, cell wall, cell membrane, cytoplasm, large vacuole, nucleus and mitochondria, growing between soil particles as water and mineral ions are taken up",
  params: `showUptake (true default: soil particles with their water film, an arrow of water entering by osmosis and of mineral ions entering by active transport; false: the cell alone).`,
  match: /\broot[- ]hairs?(?:[- ]cells?)?\b|\b(?:absorption|uptake) of (?:water|mineral ions?|minerals)(?: and (?:water|mineral ions?|minerals))? (?:by|in|into|from) (?:the )?roots?\b|\broots?\b[\s\S]{0,40}\b(?:absorb|take up|takes up)\b[\s\S]{0,30}\b(?:water|mineral ions?)\b[\s\S]{0,60}\b(?:osmosis|active transport|surface area)\b/i,
  parts: [
    { id: "root-hair", name: "Root hair" },
    { id: "cell-wall", name: "Cell wall" },
    { id: "cell-membrane", name: "Cell membrane" },
    { id: "cytoplasm", name: "Cytoplasm" },
    { id: "vacuole", name: "Vacuole (cell sap)" },
    { id: "nucleus", name: "Nucleus" },
    { id: "mitochondrion", name: "Mitochondrion" },
    { id: "soil-particle", name: "Soil particle" },
    { id: "water-uptake", name: "Water enters by osmosis" },
    { id: "ion-uptake", name: "Ions enter by active transport" },
    { id: "soil-water", name: "Film of soil water" },
  ],
  build(params: FigureParams) {
    const uptake = bool(params?.showUptake ?? params?.uptake ?? params?.soil, true);
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];

    if (uptake) {
      for (const s of soilParticles()) {
        const d = smoothClosed(blobPoints(s.c, s.rx, s.ry, 9, 0.16, s.seed));
        // The film of water clinging round each grain, drawn first so the grain sits on it.
        shapes.push({ t: "path", d, fill: "none", stroke: PLANT_COLOURS.water, width: 9, opacity: 0.28, part: "soil-water" });
        shapes.push({ t: "path", d, fill: PLANT_COLOURS.soil, stroke: "ink", width: 1.6, part: "soil-particle" });
      }
    }

    // Cell wall (a band between its outer and inner faces), then the membrane-bound cytoplasm.
    shapes.push({ t: "path", d: cellOutline(0), fill: PLANT_COLOURS.wall, stroke: "ink", width: 2.4, part: "cell-wall" });
    shapes.push({ t: "path", d: cellOutline(WALL), fill: "paper", stroke: DARK, width: 1.1, opacity: 0.9, part: "cell-wall" });
    // The cytoplasm fills the membrane; the membrane is its own line, so each can be picked out.
    shapes.push({ t: "path", d: cellOutline(MEMBRANE), fill: PLANT_COLOURS.cytoplasm, stroke: "none", part: "cytoplasm" });
    shapes.push({ t: "path", d: cellOutline(MEMBRANE), fill: "none", stroke: "#0f766e", width: 1.6, part: "cell-membrane" });
    // The hair's own outline over the wall, so the hair can be picked out on its own.
    const hair = hairEdges(HAIR.hw, 1);
    const hairPath = [hair.upper, hair.tip, [...hair.lower].reverse()].flat();
    hairPath[0] = { x: BODY.x1, y: hairPath[0].y };
    hairPath[hairPath.length - 1] = { x: BODY.x1, y: hairPath[hairPath.length - 1].y };
    shapes.push({ t: "path", d: `M${hairPath.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L")}`, fill: "none", stroke: "ink", width: 2.4, part: "root-hair" });
    // A light speckle marks the cytoplasm.
    shapes.push({ t: "path", d: vacuoleOutline(), fill: PLANT_COLOURS.vacuole, stroke: DARK, width: 1.6, part: "vacuole" });

    // Nucleus pressed against the side wall by the vacuole, with its nucleolus.
    const nuc = { x: BODY.x0 + 37, y: (BODY.y0 + BODY.y1) / 2 + 6 };
    shapes.push({ t: "path", d: smoothClosed(blobPoints(nuc, 15, 24, 10, 0.03, 4)), fill: PLANT_COLOURS.nucleus, stroke: DARK, width: 1.8, part: "nucleus" });
    shapes.push({ t: "circle", cx: nuc.x + 2, cy: nuc.y - 3, r: 5, fill: PLANT_COLOURS.nucleolus, stroke: "none", opacity: 0.7, part: "nucleus" });

    // Mitochondria in the dense cytoplasm at the hair tip and along the body.
    const tipC = hairAt(0.94).p;
    const mitos: Array<[Pt, number]> = [[{ x: tipC.x - 4, y: tipC.y + 4 }, -0.5], [{ x: BODY.x0 + 34, y: BODY.y1 - 28 }, 0.3], [{ x: BODY.x0 + 34, y: BODY.y0 + 30 }, -0.3], [{ x: 170, y: BODY.y1 - 18 }, 0]];
    for (const [c, a] of mitos) shapes.push(...mitochondrion(c, a));

    // Speckles of cytoplasm in the wide parts (between membrane and vacuole).
    const cytoAnchor = hairAt(0.9).p;
    for (const [x, y] of [[cytoAnchor.x - 8, cytoAnchor.y - 8], [cytoAnchor.x + 8, cytoAnchor.y - 14], [tipC.x + 10, tipC.y - 6], [120, BODY.y1 - 18], [220, BODY.y1 - 17], [130, BODY.y0 + 18], [220, BODY.y0 + 18]] as Array<[number, number]>) {
      shapes.push({ t: "circle", cx: r2(x), cy: r2(y), r: 1.6, fill: "#b45309", stroke: "none", opacity: 0.7, part: "cytoplasm" });
    }

    if (uptake) {
      // Water and ions cross from the soil water into the hair through gaps between the grains: each
      // arrow starts out in the soil and ends on the hair's surface.
      const onHair = (t: number, side: 1 | -1, gap: number): Pt => { const { p, n } = hairAt(t); return { x: r2(p.x + n.x * side * (HAIR.hw + gap)), y: r2(p.y + n.y * side * (HAIR.hw + gap)) }; };
      const wTo = onHair(0.46, 1, 3), wFrom = onHair(0.46, 1, 104);
      shapes.push(...arrowShapes(wFrom, wTo, PLANT_COLOURS.water, 2.6, "water-uptake", { head: 13 }));
      shapes.push({ t: "text", x: wFrom.x, y: r2(wFrom.y - 8), text: "H₂O", size: 18, anchor: "middle", fill: PLANT_COLOURS.water, part: "water-uptake" });
      const iTo = onHair(0.64, -1, 3), iFrom = onHair(0.64, -1, 92);
      shapes.push(...arrowShapes(iFrom, iTo, PLANT_COLOURS.ion, 2.6, "ion-uptake", { head: 13 }));
      shapes.push({ t: "text", x: iFrom.x, y: r2(iFrom.y + 20), text: "NO₃⁻  Mg²⁺", size: 17, anchor: "middle", fill: PLANT_COLOURS.ion, part: "ion-uptake" });
      parts.push({ id: "water-uptake", name: "Water enters by osmosis", anchor: { x: wFrom.x, y: r2(wFrom.y + 8) } });
      parts.push({ id: "ion-uptake", name: "Ions enter by active transport", anchor: { x: iFrom.x, y: r2(iFrom.y - 8) } });
      const soil = soilParticles();
      const s = soil[3], f = soil[8];
      parts.push({ id: "soil-particle", name: "Soil particle", anchor: { x: s.c.x + 4, y: s.c.y } });
      parts.push({ id: "soil-water", name: "Film of soil water", anchor: { x: r2(f.c.x + f.rx * 0.98), y: f.c.y } });
    }

    const tip = hairAt(1);
    const tipDir = { x: -tip.n.y, y: tip.n.x };
    parts.unshift(
      { id: "root-hair", name: "Root hair", anchor: { x: r2(tip.p.x + tipDir.x * (HAIR.hw - 2)), y: r2(tip.p.y + tipDir.y * (HAIR.hw - 2)) } },
      { id: "cell-wall", name: "Cell wall", anchor: { x: BODY.x0 + WALL / 2, y: BODY.y0 + 40 } },
      { id: "cell-membrane", name: "Cell membrane", anchor: { x: BODY.x0 + MEMBRANE, y: BODY.y1 - 46 } },
      // Without soil the right margin is free: cytoplasm and a mitochondrion are pointed out in the
      // dense cytoplasm at the hair's tip, balancing the labels round the cell.
      { id: "cytoplasm", name: "Cytoplasm", anchor: uptake ? { x: BODY.x0 + 30, y: BODY.y0 + 52 } : { x: r2(cytoAnchor.x - 6), y: r2(cytoAnchor.y + 12) } },
      { id: "vacuole", name: "Vacuole (cell sap)", anchor: { x: 170, y: 250 } },
      { id: "nucleus", name: "Nucleus", anchor: { x: nuc.x - 4, y: nuc.y + 10 } },
      { id: "mitochondrion", name: "Mitochondrion", anchor: uptake ? { x: BODY.x0 + 34, y: BODY.y1 - 28 } : { x: r2(tipC.x - 4), y: r2(tipC.y + 4) } },
    );
    if (uptake) return { w: W, h: H, shapes, parts };
    // Without the soil, the figure is cropped to the cell so the cell is drawn larger.
    return { w: W, h: 270, shapes: shapes.map((sh) => shiftShape(sh, -CROP)), parts: parts.map((p) => ({ ...p, anchor: { x: p.anchor.x, y: r2(p.anchor.y - CROP) } })) };
  },
};

const CROP = 118;
/** The same shape moved up by `dy` (absolute path commands only — all paths here are absolute). */
function shiftShape(sh: FigureShape, dy: number): FigureShape {
  if (sh.t === "circle") return { ...sh, cy: r2(sh.cy + dy) };
  if (sh.t === "text") return { ...sh, y: r2(sh.y + dy) };
  return { ...sh, d: shiftPath(sh.d, dy) };
}
/** Shifts every y in an absolute path (M/L/C/Q pairs; A keeps its radii, flags and rotation). */
export function shiftPath(d: string, dy: number): string {
  return d.replace(/([MLCQA])([^MLCQAZ]*)/g, (_, cmd: string, args: string) => {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === "A") {
      for (let i = 0; i + 6 < n.length; i += 7) n[i + 6] += dy;
    } else {
      for (let i = 1; i < n.length; i += 2) n[i] += dy;
    }
    return `${cmd}${n.map(r2).join(" ")} `;
  }).trim();
}
