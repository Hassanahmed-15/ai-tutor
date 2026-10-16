import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { blobPoints, r2, rng, smoothClosed } from "./bioDraw";
import { keepParts, mergeRuns } from "./bloodVessels";

/**
 * A BLOOD SMEAR, AS THE TEXTBOOK DRAWS IT: the cells of blood lying in plasma, each with the feature
 * an exam asks about — red cells biconcave with no nucleus (one seen edge on), a phagocyte
 * (neutrophil) with its lobed nucleus and granular cytoplasm, a lymphocyte whose large round nucleus
 * almost fills it, a monocyte with a kidney-shaped nucleus, and platelets as small cell fragments.
 * Sizes are relative (red cell ≈ 7.5 µm, neutrophil ≈ 12 µm, monocyte ≈ 18 µm, platelet ≈ 2–3 µm).
 * The board chooses which cells to show; the layout spreads them so each label has a clear path.
 */

type Kind = "red" | "neutrophil" | "lymphocyte" | "monocyte" | "platelets";
const ORDER: Kind[] = ["red", "neutrophil", "lymphocyte", "monocyte", "platelets"];

const C = {
  line: "#44403c",
  plasma: "#fef9c3",
  rbc: "#f87171",
  rbcPale: "#fecaca",
  rbcLine: "#b91c1c",
  nucleus: "#7c3aed",
  nucleusDark: "#5b21b6",
  neutro: "#f3e8ff",
  granule: "#c084fc",
  lympho: "#dbeafe",
  mono: "#e0e7ff",
  platelet: "#c4b5fd",
} as const;

/** "red, lymphocyte" / "white blood cells" / "phagocytes and platelets" → the kinds to draw (all when none named). */
export function bloodCellKinds(v: unknown): Kind[] {
  const s = (Array.isArray(v) ? v.join(",") : String(v ?? "")).toLowerCase();
  if (!s.trim() || /\ball\b/.test(s)) return ORDER;
  const set = new Set<Kind>();
  if (/\b(red|rbcs?|erythro\w*)\b/.test(s)) set.add("red");
  if (/neutro|phago|granulocyte|polymorph/.test(s)) set.add("neutrophil");
  if (/lympho/.test(s)) set.add("lymphocyte");
  if (/mono|macrophage/.test(s)) set.add("monocyte");
  if (/platelet|thrombocyte/.test(s)) set.add("platelets");
  if (/\b(white|wbcs?|leu[ck]ocytes?)\b/.test(s)) for (const k of ["neutrophil", "lymphocyte", "monocyte"] as Kind[]) set.add(k);
  return set.size ? ORDER.filter((k) => set.has(k)) : ORDER;
}

const PARTS: Array<{ id: string; name: string }> = [
  { id: "red-blood-cell", name: "Red blood cell" },
  { id: "biconcave", name: "Red cell side view (biconcave)" },
  { id: "phagocyte", name: "Phagocyte (neutrophil)" },
  { id: "lobed-nucleus", name: "Lobed nucleus" },
  { id: "lymphocyte", name: "Lymphocyte" },
  { id: "large-nucleus", name: "Large round nucleus" },
  { id: "monocyte", name: "Monocyte" },
  { id: "kidney-nucleus", name: "Kidney-shaped nucleus" },
  { id: "platelets", name: "Platelets" },
  { id: "plasma", name: "Plasma" },
];

const polar = (c: Pt, r: number, a: number): Pt => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
const circleD = (c: Pt, r: number) => `M${r2(c.x - r)} ${r2(c.y)} a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0 a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0 Z`;
const deg = Math.PI / 180;

/** Each kind's slot (width × height) in the smear. */
const SLOT: Record<Kind, { w: number; h: number }> = {
  red: { w: 150, h: 230 },
  neutrophil: { w: 120, h: 120 },
  lymphocyte: { w: 84, h: 84 },
  monocyte: { w: 144, h: 140 },
  platelets: { w: 84, h: 76 },
};
const RBC_R = 31;

type Out = { shapes: FigureShape[]; anchors: Record<string, Pt> };

function rbcFace(o: Out, p: Pt) {
  o.shapes.push({ t: "circle", part: "red-blood-cell", cx: r2(p.x), cy: r2(p.y), r: RBC_R, fill: C.rbc, stroke: C.rbcLine, width: 1.8 });
  o.shapes.push({ t: "circle", part: "red-blood-cell", cx: r2(p.x), cy: r2(p.y), r: RBC_R * 0.42, fill: C.rbcPale, stroke: "none" });
}

function redCells(o: Out, c: Pt, side: number) {
  const faces: Pt[] = [{ x: -38, y: -78 }, { x: 34, y: -70 }, { x: -34, y: -4 }, { x: 38, y: 2 }];
  for (const f of faces) rbcFace(o, { x: c.x + f.x, y: c.y + f.y });
  // One red cell lies on its edge: the biconcave profile (thick rim, thin centre).
  const sv = { x: c.x, y: c.y + 78 };
  const pts = sidePoints(70, 22).map((p) => ({ x: sv.x + p.y, y: sv.y + p.x }));
  o.shapes.push({ t: "path", part: "biconcave", d: smoothClosed(pts), fill: C.rbc, stroke: C.rbcLine, width: 1.8 });
  const face = faces[side < 0 ? 2 : 3];
  o.anchors["red-blood-cell"] = { x: c.x + face.x + side * 22, y: c.y + face.y - 8 };
  o.anchors.biconcave = { x: sv.x + side * 28, y: sv.y };
}
/** The biconcave outline (long axis along y), as points. */
function sidePoints(len: number, thick: number): Pt[] {
  const L = len / 2, T = thick / 2;
  const right: Pt[] = [{ x: 0, y: -L }, { x: T * 0.8, y: -L + T * 0.2 }, { x: T, y: -L + T * 0.75 }, { x: T * 0.75, y: -L + T * 1.45 }, { x: T * 0.52, y: -L * 0.3 }, { x: T * 0.5, y: 0 }, { x: T * 0.52, y: L * 0.3 }, { x: T * 0.75, y: L - T * 1.45 }, { x: T, y: L - T * 0.75 }, { x: T * 0.8, y: L - T * 0.2 }];
  return [...right, { x: 0, y: L }, ...right.slice(1).reverse().map((p) => ({ x: -p.x, y: p.y }))];
}

function neutrophil(o: Out, c: Pt, side: number) {
  const r = 56;
  o.shapes.push({ t: "path", part: "phagocyte", d: smoothClosed(blobPoints(c, r, r * 0.96, 14, 0.03, 7)), fill: C.neutro, stroke: C.line, width: 2 });
  // Fine granules in the cytoplasm.
  const rand = rng(11);
  let g = "";
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2, rr = r * (0.3 + 0.6 * Math.sqrt(rand()));
    g += `${circleD(polar(c, rr, a), 1.9)} `;
  }
  o.shapes.push({ t: "path", part: "phagocyte", d: g.trim(), fill: C.granule, stroke: "none" });
  // Three lobes joined by thin strands.
  const lobes: Pt[] = [{ x: -26, y: -10 }, { x: 0, y: 14 }, { x: 26, y: -8 }].map((p) => ({ x: c.x + p.x, y: c.y + p.y }));
  o.shapes.push({ t: "path", part: "lobed-nucleus", d: `M${r2(lobes[0].x)} ${r2(lobes[0].y)} Q${r2(c.x - 10)} ${r2(c.y + 10)} ${r2(lobes[1].x)} ${r2(lobes[1].y)} Q${r2(c.x + 11)} ${r2(c.y + 8)} ${r2(lobes[2].x)} ${r2(lobes[2].y)}`, stroke: C.nucleusDark, width: 5, fill: "none" });
  lobes.forEach((p, i) => o.shapes.push({ t: "path", part: "lobed-nucleus", d: smoothClosed(blobPoints(p, 15, 13, 9, 0.08, 20 + i, i)), fill: C.nucleus, stroke: C.nucleusDark, width: 1.6 }));
  o.anchors.phagocyte = polar(c, r * 0.86, side < 0 ? 218 * deg : -38 * deg);
  o.anchors["lobed-nucleus"] = side < 0 ? { x: lobes[0].x - 7, y: lobes[0].y + 3 } : { x: lobes[2].x + 7, y: lobes[2].y + 3 };
}

function lymphocyte(o: Out, c: Pt, side: number) {
  const r = 38;
  o.shapes.push({ t: "path", part: "lymphocyte", d: smoothClosed(blobPoints(c, r, r * 0.97, 12, 0.025, 31)), fill: C.lympho, stroke: C.line, width: 2 });
  const nc = { x: c.x - side * 4, y: c.y + 1 };
  o.shapes.push({ t: "path", part: "large-nucleus", d: smoothClosed(blobPoints(nc, 30, 29, 12, 0.03, 33)), fill: C.nucleus, stroke: C.nucleusDark, width: 1.6 });
  o.anchors.lymphocyte = polar(c, r - 4, side < 0 ? 205 * deg : -25 * deg);
  o.anchors["large-nucleus"] = { x: nc.x + side * 14, y: nc.y + 12 };
}

function monocyte(o: Out, c: Pt, side: number) {
  const r = 68;
  o.shapes.push({ t: "path", part: "monocyte", d: smoothClosed(blobPoints(c, r, r * 0.95, 14, 0.035, 41)), fill: C.mono, stroke: C.line, width: 2 });
  // A kidney-shaped nucleus: an oval with a notch on one side.
  const nc = { x: c.x + 2, y: c.y - 2 };
  const n = 24;
  const kidney = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const notch = Math.exp(-(((a - Math.PI / 2 + Math.PI) % (2 * Math.PI) - Math.PI) ** 2) / (2 * 0.32 ** 2));
    const k = 1 - 0.55 * notch;
    return { x: nc.x + 42 * Math.cos(a) * (0.9 + 0.1 * k), y: nc.y + 30 * Math.sin(a) * k };
  });
  o.shapes.push({ t: "path", part: "kidney-nucleus", d: smoothClosed(kidney), fill: C.nucleus, stroke: C.nucleusDark, width: 1.6 });
  o.anchors.monocyte = polar(c, r * 0.86, side < 0 ? 218 * deg : -38 * deg);
  o.anchors["kidney-nucleus"] = { x: nc.x + side * 30, y: nc.y + 8 };
}

function platelets(o: Out, c: Pt, side: number) {
  const spots: Pt[] = [{ x: -24, y: -18 }, { x: 8, y: -26 }, { x: 28, y: 4 }, { x: -6, y: 6 }, { x: -28, y: 22 }, { x: 14, y: 28 }];
  const rand = rng(51);
  spots.forEach((s, i) => {
    const p = { x: c.x + s.x, y: c.y + s.y };
    const rr = 7 + rand() * 3;
    o.shapes.push({ t: "path", part: "platelets", d: smoothClosed(blobPoints(p, rr, rr * 0.75, 7, 0.22, 60 + i, rand() * 3)), fill: C.platelet, stroke: C.nucleusDark, width: 1.4 });
    o.shapes.push({ t: "circle", part: "platelets", cx: r2(p.x), cy: r2(p.y), r: 2.2, fill: C.nucleus, stroke: "none" });
  });
  const pick = side < 0 ? spots[0] : spots[2];
  o.anchors.platelets = { x: c.x + pick.x, y: c.y + pick.y };
}

export const bloodCells: FigureComponent = {
  name: "bloodCells",
  title: "Blood smear: red blood cells (biconcave, no nucleus, one edge on), a phagocyte with a lobed nucleus, a lymphocyte with a large round nucleus, a monocyte and platelets in plasma",
  params: `show (which cells to draw, a list: "red", "phagocyte"/"neutrophil", "lymphocyte", "monocyte", "platelets", or "white" for the three white cells; default all of them). Sizes are drawn to relative scale.`,
  match: /\b(red|white) blood cells?\b|\b(erythrocytes?|leu[ck]ocytes?|platelets?|thrombocytes?)\b|\bblood (smear|film|cells)\b|\b(components?|composition|constituents) of (the )?blood\b|\b(lymphocytes?|phagocytes?|neutrophils?|monocytes?)\b(?=[\s\S]{0,160}\b(lymphocytes?|phagocytes?|neutrophils?|monocytes?|lobed|nucleus|nuclei)\b)/i,
  parts: PARTS,
  build(params: FigureParams) {
    const kinds = bloodCellKinds(params.show ?? params.cells);
    // Two columns, each cell beside the margin its labels stand in, so no leader crosses another cell.
    const cols: Kind[][] = [[], []];
    if (kinds.length === 1) cols[0].push(kinds[0]);
    else kinds.forEach((k, i) => cols[i % 2].push(k));
    const gap = 18, pad = 22;
    const colH = cols.map((col) => col.reduce((s, k) => s + SLOT[k].h, 0) + gap * Math.max(0, col.length - 1));
    const h = Math.max(260, Math.min(460, Math.max(...colH) + 2 * pad));
    const w = kinds.includes("red") ? 600 : 560;
    const o: Out = { shapes: [], anchors: {} };
    o.shapes.push({ t: "path", part: "plasma", d: `M24 6 H${w - 24} Q${w - 6} 6 ${w - 6} 24 V${h - 24} Q${w - 6} ${h - 6} ${w - 24} ${h - 6} H24 Q6 ${h - 6} 6 ${h - 24} V24 Q6 6 24 6 Z`, fill: C.plasma, stroke: C.line, width: 1.6 });
    const centres: Array<{ k: Kind; c: Pt; side: number }> = [];
    cols.forEach((col, ci) => {
      if (!col.length) return;
      const free = h - 2 * pad - colH[ci];
      let y = pad + free / 2;
      for (const k of col) {
        const x = kinds.length === 1 ? w * 0.3 : ci === 0 ? pad + 14 + SLOT[k].w / 2 : w - pad - 14 - SLOT[k].w / 2;
        centres.push({ k, c: { x, y: y + SLOT[k].h / 2 }, side: ci === 0 ? -1 : 1 });
        y += SLOT[k].h + gap;
      }
    });
    // Red cells lie loose between the columns (real blood is mostly red cells); they are labelled only
    // when the board asks for red cells, and never stand between a cell and its margin.
    const loose: Pt[] = [];
    const leftEdge = Math.max(0, ...centres.filter((q) => q.side < 0).map(({ k, c }) => c.x + SLOT[k].w / 2));
    const rightEdge = Math.min(w, ...centres.filter((q) => q.side > 0).map(({ k, c }) => c.x - SLOT[k].w / 2));
    for (const f of [[0.5, 0.3], [0.56, 0.62], [0.44, 0.84], [0.6, 0.12], [0.4, 0.5], [0.64, 0.86], [0.36, 0.16], [0.7, 0.42], [0.3, 0.68]]) {
      const p = { x: w * f[0], y: h * f[1] };
      const clear = centres.every(({ k, c }) => Math.hypot(p.x - c.x, p.y - c.y) > Math.max(SLOT[k].w, SLOT[k].h) / 2 + RBC_R + 6)
        && loose.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 2 * RBC_R + 8)
        && p.x - RBC_R > leftEdge + 10 && p.x + RBC_R < rightEdge - 10 && p.y - RBC_R > 12 && p.y + RBC_R < h - 12;
      if (clear && loose.length < 6) { loose.push(p); rbcFace(o, p); }
    }
    for (const { k, c, side } of centres) {
      if (k === "red") redCells(o, c, side);
      else if (k === "neutrophil") neutrophil(o, c, side);
      else if (k === "lymphocyte") lymphocyte(o, c, side);
      else if (k === "monocyte") monocyte(o, c, side);
      else platelets(o, c, side);
    }
    // Plasma is labelled at the clearest point of the smear's edge.
    const edge: Pt[] = [];
    for (let y = 30; y <= h - 30; y += 20) edge.push({ x: 18, y }, { x: w - 18, y });
    const clearance = (p: Pt) => Math.min(...centres.map(({ k, c }) => Math.hypot(p.x - c.x, p.y - c.y) - Math.max(SLOT[k].w, SLOT[k].h) / 2));
    o.anchors.plasma = edge.reduce((best, p) => (clearance(p) > clearance(best) + 0.5 ? p : best), edge[0]);
    const parts: FigurePart[] = PARTS.filter((p) => o.anchors[p.id]).map((p) => ({ id: p.id, name: p.name, anchor: { x: r2(o.anchors[p.id].x), y: r2(o.anchors[p.id].y) } }));
    return { w, h, shapes: mergeRuns(keepParts(o.shapes, parts.map((p) => p.id))), parts };
  },
};
