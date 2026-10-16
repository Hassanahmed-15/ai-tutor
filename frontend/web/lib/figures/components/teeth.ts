import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { r2, rng, smoothClosed, smoothOpen } from "./bioDraw";
import { keepParts, mergeRuns } from "./bloodVessels";

/**
 * TEETH, AS THE O LEVEL TEXTBOOK DRAWS THEM. "types": the four kinds of human teeth side by side from
 * the cheek side, set in the gum (chisel-edged incisor, pointed canine with the longest root, premolar
 * with two cusps, broad molar with several cusps and two roots), necks aligned on one gum line.
 * "section": a molar cut lengthways — enamel cap over dentine, pulp cavity with nerves and blood
 * vessels entering through the root canals, cement over the roots, gum and jaw bone round them — with
 * brackets marking the crown (above the gum) and the root (in the bone).
 */

const C = {
  line: "#44403c",
  enamel: "#f1f5f9",
  dentine: "#fde9b6",
  pulp: "#fca5a5",
  cement: "#d4b77a",
  gum: "#f9a8b4",
  gumLine: "#be185d",
  bone: "#efe3c8",
  boneMark: "#c4ab7c",
  artery: "#dc2626",
  vein: "#2563eb",
  nerve: "#ca8a04",
  bracket: "muted",
} as const;

type View = "types" | "section";
function viewOf(v: unknown): View {
  const s = String(v ?? "").toLowerCase();
  if (/type|kind|incisor|canine|premolar|shape|set|all/.test(s) && !/section|structure|inside|internal/.test(s)) return "types";
  return "section";
}

const PARTS: Array<{ id: string; name: string }> = [
  { id: "enamel", name: "Enamel" },
  { id: "dentine", name: "Dentine" },
  { id: "pulp-cavity", name: "Pulp cavity" },
  { id: "nerves-vessels", name: "Nerves and blood vessels" },
  { id: "cement", name: "Cement" },
  { id: "gum", name: "Gum" },
  { id: "jaw-bone", name: "Jaw bone" },
  { id: "crown", name: "Crown" },
  { id: "root", name: "Root" },
  { id: "incisor", name: "Incisor" },
  { id: "canine", name: "Canine" },
  { id: "premolar", name: "Premolar" },
  { id: "molar", name: "Molar" },
  { id: "cusp", name: "Cusp" },
];

const at = (pts: Array<[number, number]>, dx = 0, dy = 0): Pt[] => pts.map(([x, y]) => ({ x: x + dx, y: y + dy }));

/** A curly bracket from y0 to y1 at x, its point facing right (dir 1) or left (-1). */
function bracket(x: number, y0: number, y1: number, dir: 1 | -1): { d: string; tip: Pt } {
  const m = (y0 + y1) / 2, k = 9 * dir;
  return {
    d: `M${r2(x - k)} ${r2(y0)} Q${r2(x)} ${r2(y0)} ${r2(x)} ${r2(y0 + 10)} V${r2(m - 10)} Q${r2(x)} ${r2(m)} ${r2(x + k)} ${r2(m)} Q${r2(x)} ${r2(m)} ${r2(x)} ${r2(m + 10)} V${r2(y1 - 10)} Q${r2(x)} ${r2(y1)} ${r2(x - k)} ${r2(y1)}`,
    tip: { x: x + k, y: m },
  };
}

function section(): { w: number; h: number; shapes: FigureShape[]; anchors: Record<string, Pt> } {
  const s: FigureShape[] = [];
  const w = 560, h = 440;
  const gumTop = 172, crest = 214, bx0 = 60, bx1 = 476;
  // Jaw bone, with spongy-bone marks, under everything.
  s.push({ t: "path", part: "jaw-bone", d: `M${bx0} ${crest + 6} Q${bx0} ${crest} ${bx0 + 8} ${crest} H${bx1 - 8} Q${bx1} ${crest} ${bx1} ${crest + 6} V${h - 8} H${bx0} Z`, fill: C.bone, stroke: C.line, width: 1.8 });
  const rand = rng(9);
  let marks = "";
  for (let i = 0; i < 70; i++) {
    const x = bx0 + 14 + rand() * (bx1 - bx0 - 28), y = crest + 14 + rand() * (h - crest - 40);
    const rx = 4 + rand() * 5, ry = 2.5 + rand() * 3;
    marks += `M${r2(x - rx)} ${r2(y)} a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(2 * rx)} 0 a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(-2 * rx)} 0 Z `;
  }
  s.push({ t: "path", part: "jaw-bone", d: marks.trim(), fill: "none", stroke: C.boneMark, width: 1.4 });
  // Nerves and vessels run along the jaw and up into each root.
  const runs = (dy: number, colour: string) => {
    s.push({ t: "path", part: "nerves-vessels", d: `M${bx0} ${r2(402 + dy)} H${bx1}`, stroke: colour as never, width: 2.4, fill: "none" });
  };
  runs(-6, C.artery); runs(0, C.nerve); runs(6, C.vein);
  // The tooth outline: crown (two cusps) and two roots.
  const outline = at([
    [196, 176], [176, 132], [172, 92], [182, 58], [208, 36], [230, 32], [256, 48], [280, 56], [304, 48], [330, 32], [352, 36], [378, 58], [388, 92], [384, 132], [364, 176],
    [368, 236], [362, 304], [352, 368], [340, 400], [326, 400], [318, 362], [308, 296], [296, 246], [280, 236], [264, 246], [252, 296], [242, 362], [234, 400], [220, 400], [208, 368], [198, 304], [192, 236],
  ]);
  const toothD = smoothClosed(outline, 0.9);
  s.push({ t: "path", part: "dentine", d: toothD, fill: C.dentine, stroke: "none" });
  // Cement: a thin coat over the roots, from the neck to the tips.
  const rootPts = outline.slice(14).concat(outline.slice(0, 1));
  s.push({ t: "path", part: "cement", d: smoothOpen(at([[364, 176], [368, 236], [362, 304], [352, 368], [340, 400], [326, 400], [318, 362], [308, 296], [296, 246], [280, 236], [264, 246], [252, 296], [242, 362], [234, 400], [220, 400], [208, 368], [198, 304], [192, 236], [196, 176]]), 0.9), stroke: C.cement, width: 7, fill: "none" });
  void rootPts;
  // Enamel cap: outer crown surface down to the neck, back along the enamel–dentine junction.
  const crownOuter = outline.slice(0, 15);
  const dej = at([[364, 176], [366, 132], [364, 96], [352, 70], [334, 56], [306, 70], [280, 76], [254, 70], [226, 56], [208, 70], [196, 96], [194, 132], [196, 176]]);
  s.push({ t: "path", part: "enamel", d: `${smoothOpen(crownOuter, 0.9)} L${r2(dej[0].x)} ${r2(dej[0].y)} ${smoothOpen(dej, 0.9).replace(/^M[^C]*/, "")} Z`, fill: C.enamel, stroke: C.line, width: 1.6 });
  // Pulp cavity: chamber with horns under the cusps, canals down each root to the tip.
  const pulp = at([
    [220, 196], [222, 140], [228, 100], [238, 98], [262, 116], [280, 120], [298, 116], [322, 98], [332, 100], [338, 140], [340, 196],
    [338, 260], [336, 330], [334, 396], [328, 396], [326, 330], [318, 264], [306, 222], [280, 214], [254, 222], [242, 264], [234, 330], [232, 396], [226, 396], [224, 330], [222, 260],
  ]);
  s.push({ t: "path", part: "pulp-cavity", d: smoothClosed(pulp, 0.85), fill: C.pulp, stroke: C.line, width: 1.6 });
  // Nerves and vessels inside the pulp, entering at each root tip.
  for (const [cx, colour, dx] of [[229, C.artery, -2.2], [229, C.nerve, 0], [229, C.vein, 2.2], [331, C.artery, -2.2], [331, C.nerve, 0], [331, C.vein, 2.2]] as const) {
    const left = cx < 280;
    const d = smoothOpen(at([[cx + dx, 402], [cx + dx, 394], [cx + dx + (left ? 3 : -3), 330], [cx + dx + (left ? 10 : -10), 262], [cx + dx + (left ? 20 : -20), 210], [cx + dx + (left ? 28 : -28), 160], [cx + dx + (left ? 22 : -22), 124]]), 1);
    s.push({ t: "path", part: "nerves-vessels", d, stroke: colour as never, width: 1.8, fill: "none" });
  }
  s.push({ t: "path", d: toothD, fill: "none", stroke: "ink", width: 2.2 });
  // Gum: soft tissue over the bone crest, tapering to a margin against the neck of the tooth.
  for (const dir of [-1, 1] as const) {
    const X = (x: number) => 280 + dir * (x - 280);
    const g = at([[X(184), 150], [X(158), 150], [X(132), gumTop - 2], [X(100), gumTop + 6], [X(bx0 + 2), gumTop + 10], [X(bx0 + 2), crest + 4], [X(130), crest + 2], [X(178), crest - 4], [X(193), 196], [X(192), 166]]);
    const d = `M${r2(g[0].x)} ${r2(g[0].y)} C${r2(g[1].x)} ${r2(g[1].y)} ${r2(g[2].x)} ${r2(g[2].y)} ${r2(g[3].x)} ${r2(g[3].y)} L${r2(g[4].x)} ${r2(g[4].y)} L${r2(g[5].x)} ${r2(g[5].y)} L${r2(g[6].x)} ${r2(g[6].y)} Q${r2(g[7].x)} ${r2(g[7].y)} ${r2(g[8].x)} ${r2(g[8].y)} Q${r2(g[9].x)} ${r2(g[9].y)} ${r2(g[0].x)} ${r2(g[0].y)} Z`;
    s.push({ t: "path", part: "gum", d, fill: C.gum, stroke: C.gumLine, width: 1.6 });
  }
  // Brackets: the crown stands above the gum, the root is held in the jaw.
  const bx = 500;
  const crownB = bracket(bx, 32, 166, 1), rootB = bracket(bx, 194, 400, 1);
  s.push({ t: "path", part: "crown", d: crownB.d, stroke: C.bracket, width: 2, fill: "none" });
  s.push({ t: "path", part: "root", d: rootB.d, stroke: C.bracket, width: 2, fill: "none" });
  return {
    w, h, shapes: s,
    anchors: {
      enamel: { x: 180, y: 100 },
      "pulp-cavity": { x: 236, y: 150 },
      dentine: { x: 209, y: 262 },
      cement: { x: 197, y: 318 },
      "nerves-vessels": { x: 229, y: 360 },
      crown: crownB.tip,
      root: rootB.tip,
      gum: { x: 424, y: 186 },
      "jaw-bone": { x: 446, y: 422 },
    },
  };
}

function types(): { w: number; h: number; shapes: FigureShape[]; anchors: Record<string, Pt> } {
  const s: FigureShape[] = [];
  const w = 660, h = 330, neck = 150;
  // The jaw (bone) and the gum hold every tooth; drawn behind the teeth so each whole tooth shows.
  s.push({ t: "path", part: "jaw-bone", d: `M16 ${neck + 18} H${w - 16} V${h - 10} H16 Z`, fill: C.bone, stroke: C.line, width: 1.6 });
  s.push({ t: "path", part: "gum", d: `M16 ${neck - 6} C60 ${neck - 16} 100 ${neck - 16} 150 ${neck - 6} S240 ${neck - 16} 300 ${neck - 6} S400 ${neck - 16} 460 ${neck - 6} S560 ${neck - 16} ${w - 16} ${neck - 6} V${neck + 26} H16 Z`, fill: C.gum, stroke: C.gumLine, width: 1.6 });
  const tooth = (part: string, crown: Array<[number, number]>, roots: Array<Array<[number, number]>>, dx: number) => {
    // Roots first (dentine/cement colour), then the enamel crown over them.
    for (const r of roots) s.push({ t: "path", part, d: smoothClosed(at(r, dx), 0.9), fill: C.dentine, stroke: C.line, width: 1.8 });
    s.push({ t: "path", part, d: smoothClosed(at(crown, dx), 0.9), fill: C.enamel, stroke: C.line, width: 2 });
    // The labelled crown, root and cusp are traced over one tooth's own outline (so the pen can light them).
    if (part === "incisor") s.push({ t: "path", part: "crown", d: smoothClosed(at(crown, dx), 0.9), fill: "none", stroke: C.line, width: 2 });
    if (part === "canine") s.push({ t: "path", part: "root", d: smoothClosed(at(roots[0], dx), 0.9), fill: "none", stroke: C.line, width: 1.8 });
    if (part === "molar") s.push({ t: "path", part: "cusp", d: smoothOpen(at([[30, 100], [40, 88], [50, 92], [54, 110]], dx), 0.9), fill: "none", stroke: C.line, width: 2 });
  };
  // Incisor: a flat chisel edge, one conical root.
  tooth("incisor", [[-22, 80], [0, 78], [22, 80], [24, 104], [20, 132], [16, neck + 4], [0, neck + 6], [-16, neck + 4], [-20, 132], [-24, 104]],
    [[[-16, neck - 4], [16, neck - 4], [14, 196], [8, 236], [2, 262], [-2, 262], [-8, 236], [-14, 196]]], 80);
  // Canine: one pointed cusp, the longest root.
  tooth("canine", [[0, 58], [14, 70], [26, 92], [26, 116], [20, 140], [16, neck + 4], [0, neck + 6], [-16, neck + 4], [-20, 140], [-26, 116], [-26, 92], [-14, 70]],
    [[[-17, neck - 4], [17, neck - 4], [15, 204], [9, 260], [2, 294], [-2, 294], [-9, 260], [-15, 204]]], 220);
  // Premolar: two cusps, two slender roots.
  tooth("premolar", [[-30, 98], [-20, 84], [-10, 82], [-2, 94], [4, 94], [12, 80], [22, 82], [32, 96], [34, 116], [26, 140], [22, neck + 4], [0, neck + 6], [-22, neck + 4], [-28, 140], [-34, 116]],
    [[[-22, neck - 4], [-2, neck - 4], [-4, 200], [-8, 244], [-12, 266], [-16, 266], [-19, 230], [-21, 190]], [[2, neck - 4], [22, neck - 4], [21, 190], [19, 230], [16, 266], [12, 266], [8, 244], [4, 200]]], 382);
  // Molar: a broad crown with several cusps, two spreading roots.
  tooth("molar", [[-48, 104], [-40, 90], [-28, 88], [-18, 100], [-8, 100], [2, 86], [14, 86], [22, 100], [30, 100], [40, 88], [50, 92], [54, 110], [50, 136], [42, neck + 4], [0, neck + 6], [-42, neck + 4], [-50, 136], [-54, 116]],
    [[[-42, neck - 4], [-8, neck - 4], [-12, 196], [-20, 236], [-28, 254], [-36, 252], [-42, 222], [-44, 184]], [[8, neck - 4], [42, neck - 4], [46, 184], [44, 222], [38, 252], [30, 254], [22, 236], [14, 196]]], 552);
  return {
    w, h, shapes: s,
    anchors: {
      crown: { x: 62, y: 104 },
      incisor: { x: 80, y: 220 },
      canine: { x: 220, y: 74 },
      root: { x: 220, y: 270 },
      premolar: { x: 366, y: 250 },
      cusp: { x: 600, y: 96 },
      molar: { x: 600, y: 128 },
      gum: { x: w - 30, y: neck + 8 },
      "jaw-bone": { x: w - 30, y: 300 },
    },
  };
}

export const teeth: FigureComponent = {
  name: "teeth",
  title: "Human teeth: the four types (incisor, canine, premolar, molar) or a molar in longitudinal section showing enamel, dentine, pulp cavity, nerves and blood vessels, cement, gum and jaw bone",
  params: `view ("section" default: a molar cut lengthways — enamel, dentine, pulp cavity, nerves and blood vessels, cement, gum, jaw bone, crown and root | "types": incisor, canine, premolar and molar side by side, set in the gum).`,
  // A bare "teeth" needs dental context: language lessons listing body-part words ("eyes, ears, teeth")
  // matched 127 times across the catalogue (scan 2026-10-17).
  match: /(?<!\b(gear|cog|saw|comb|zip) )\b(teeth|tooth)\b(?!\s*(paste|brush))(?=[\s\S]{0,200}\b(enamel|dentine|pulp|incisors?|canines?|premolars?|molars?|decay|caries|plaque|structure|types? of|chew\w*|bite|biting|grind\w*|digestion|mechanical|crown|root|gum|jaw)\b)|\b(structure|types?) of (human )?(teeth|tooth)\b|\b(incisors?|premolars?|dentine|dental (caries|decay|formula|plaque)|tooth decay|pulp cavity)\b|\b(canines?|molars?)\b(?=[\s\S]{0,160}\b(teeth|tooth|incisors?|premolars?|jaw|chew\w*|bit(e|ing)|grind\w*|tear(ing)?|enamel)\b)|\benamel\b(?=[\s\S]{0,120}\b(teeth|tooth|dentine|decay)\b)/i,
  parts: PARTS,
  build(params: FigureParams) {
    const v = viewOf(params.view ?? params.show);
    const d = v === "types" ? types() : section();
    const parts: FigurePart[] = PARTS.filter((p) => d.anchors[p.id]).map((p) => ({ id: p.id, name: p.name, anchor: { x: r2(d.anchors[p.id].x), y: r2(d.anchors[p.id].y) } }));
    return { w: d.w, h: d.h, shapes: mergeRuns(keepParts(d.shapes, parts.map((p) => p.id))), parts };
  },
};
