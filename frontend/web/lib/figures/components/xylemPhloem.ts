import type { FigureComponent, FigurePart, FigureParams, FigureShape, Pt } from "../types";
import { arrowShapes, r2, roundedPoly, smoothClosed, transform } from "./bioDraw";

/**
 * XYLEM AND PHLOEM, as the O/A Level textbook draws them.
 *
 * view "cells" (default): a xylem vessel in longitudinal section — two vessel elements joined end to
 * end with no end walls (only a remnant rim), thick lignified side walls with pits, spiral lignin
 * thickening, a hollow lumen with no cytoplasm and water rising through it — beside a phloem sieve
 * tube: sieve tube elements with thin walls and peripheral cytoplasm, no nucleus, joined by
 * perforated sieve plates, each with a companion cell (dense cytoplasm, nucleus, mitochondria)
 * linked by plasmodesmata; sucrose moves both ways.
 *
 * view "ts-stem" / "ts-root": plan diagrams (tissue outlines, no cells) of a dicot stem — vascular
 * bundles in a ring, phloem outside, xylem inside, cambium between, pith in the middle — and of a
 * dicot root — xylem a central star, phloem between its arms, endodermis round the stele.
 */

type View = "cells" | "ts-stem" | "ts-root";

/** Outlines inside pale fills: a fixed dark that stays dark on the chalkboard too. */
const DARK = "#374151";
const C = {
  lignin: "#e8c58a",
  ligninBand: "#8a5a14",
  lumen: "#f0f9ff",
  wall: "#d9f99d",
  sieveCyto: "#fef9c3",
  sieveLumen: "#fffdf2",
  companion: "#fde68a",
  nucleus: "#ddd6fe",
  mito: "#fdba74",
  water: "#1e40af",
  sucrose: "#b45309",
  xylem: "#93c5fd",
  phloem: "#fdba74",
  cambium: "#166534",
  cortex: "#ecfccb",
  epidermis: "#bbf7d0",
  pith: "#fefce8",
} as const;

function viewOf(v: unknown): View {
  const s = String(v ?? "").toLowerCase();
  if (/root/.test(s)) return "ts-root";
  if (/stem|ts|transverse|cross|section|plan|bundle/.test(s)) return "ts-stem";
  return "cells";
}

const rect = (x0: number, y0: number, x1: number, y1: number) => `M${r2(x0)} ${r2(y0)} H${r2(x1)} V${r2(y1)} H${r2(x0)} Z`;
const rrect = (x0: number, y0: number, x1: number, y1: number, r: number) =>
  roundedPoly([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], r);
const ellipse = (c: Pt, rx: number, ry: number) =>
  `M${r2(c.x - rx)} ${r2(c.y)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(c.x + rx)} ${r2(c.y)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(c.x - rx)} ${r2(c.y)} Z`;
const ring = (c: Pt, r: number) => ellipse(c, r, r);

/* ── longitudinal view: a xylem vessel beside a sieve tube and its companion cells ─────────────── */

const CW = 640, CH = 384;
const X = { x0: 96, x1: 240, wall: 15, top: 14, bot: 370, joint: 192 } as const;
const P = { x0: 382, x1: 484, wall: 5, cc1: 532, top: 14, bot: 370, plates: [130, 252] } as const;

function cellsView(): { w: number; h: number; shapes: FigureShape[]; parts: FigurePart[] } {
  const shapes: FigureShape[] = [];
  const parts: FigurePart[] = [];
  const li = X.x0 + X.wall, ri = X.x1 - X.wall; // the lumen's edges

  // Xylem: the hollow lumen, then the two thick lignified side walls, open at top and bottom.
  shapes.push({ t: "path", d: rect(li, X.top, ri, X.bot), fill: C.lumen, stroke: "none", part: "lumen" });
  // Spiral lignin thickening on the vessel's inner surface: each turn's far side faint and dashed,
  // its near side solid.
  const turn = 30;
  for (let y = X.top + 4; y < X.bot - 24; y += turn) {
    shapes.push({ t: "path", d: `M${ri} ${r2(y + 14)} Q${r2((li + ri) / 2)} ${r2(y + 16)} ${li} ${r2(y + turn)}`, fill: "none", stroke: C.ligninBand, width: 1.6, dash: "4 4", opacity: 0.4, part: "lignin" });
    shapes.push({ t: "path", d: `M${li} ${r2(y)} Q${r2((li + ri) / 2)} ${r2(y + 22)} ${ri} ${r2(y + 14)}`, fill: "none", stroke: C.ligninBand, width: 2.6, opacity: 0.8, part: "lignin" });
  }
  for (const [a, b] of [[X.x0, li], [ri, X.x1]] as const) {
    shapes.push({ t: "path", d: rect(a, X.top, b, X.bot), fill: C.lignin, stroke: "ink", width: 2, part: "xylem-vessel" });
  }
  // Remnant rims of the end walls where two vessel elements meet: the end walls themselves are gone.
  for (const [x, dir] of [[li, 1], [ri, -1]] as const) {
    shapes.push({ t: "path", d: `M${x} ${X.joint - 9} L${x + dir * 15} ${X.joint} L${x} ${X.joint + 9} Z`, fill: C.lignin, stroke: DARK, width: 1.6, part: "end-wall" });
  }
  // Pits: thin, unlignified places in the wall where water passes sideways.
  const pitYs = [52, 112, 272, 330];
  for (const y of pitYs) for (const x of [X.x0 + X.wall / 2, X.x1 - X.wall / 2]) {
    shapes.push({ t: "path", d: ellipse({ x, y }, 3.6, 9), fill: C.lumen, stroke: DARK, width: 1.4, part: "pit" });
  }
  // Water and dissolved mineral ions rise through the lumen.
  const wx = (li + ri) / 2 + 10;
  shapes.push(...arrowShapes({ x: wx, y: X.bot - 24 }, { x: wx, y: X.top + 22 }, C.water, 3.2, "water-flow", { head: 15 }));

  // Phloem sieve tube: a lining of cytoplasm, an open lumen, then the thin cellulose side walls. The
  // drawn length is cut at both ends (the tubes run on above and below), so no line closes the ends.
  shapes.push({ t: "path", d: rect(P.x0 + P.wall, P.top, P.x1 - P.wall, P.bot), fill: C.sieveCyto, stroke: "none", part: "sieve-tube" });
  shapes.push({ t: "path", d: rect(P.x0 + P.wall + 6, P.top, P.x1 - P.wall - 6, P.bot), fill: C.sieveLumen, stroke: "none", part: "sieve-tube" });
  for (const [a, b] of [[P.x0, P.x0 + P.wall], [P.x1 - P.wall, P.x1]] as const) {
    shapes.push({ t: "path", d: rect(a, P.top, b, P.bot), fill: C.wall, stroke: "ink", width: 1.6, part: "sieve-tube" });
  }

  // Sieve plates: cross walls perforated by sieve pores, strands of cytoplasm running through.
  const pin = P.x0 + P.wall, pout = P.x1 - P.wall;
  const pores = 4, pw = (pout - pin) / (pores * 2 + 1);
  for (const y of P.plates) {
    shapes.push({ t: "path", d: rect(pin, y - 6, pout, y + 6), fill: C.wall, stroke: DARK, width: 1.8, part: "sieve-plate" });
    for (let k = 0; k < pores; k++) {
      const x = pin + pw * (2 * k + 1);
      shapes.push({ t: "path", d: rect(x + 1, y - 6, x + pw - 1, y + 6), fill: C.sieveLumen, stroke: "none", part: "sieve-plate" });
      shapes.push({ t: "path", d: `M${r2(x + pw / 2)} ${y - 12} V${y + 12}`, fill: "none", stroke: C.sucrose, width: 1.6, opacity: 0.75, part: "sieve-plate" });
    }
  }
  // Sucrose moves both ways along the sieve tube (source to sink).
  const sx = (P.x0 + P.x1) / 2 - 14, mid = (P.plates[0] + P.plates[1]) / 2;
  shapes.push(...arrowShapes({ x: sx, y: mid - 8 }, { x: sx, y: P.top + 24 }, C.sucrose, 3, "translocation", { head: 14 }));
  shapes.push(...arrowShapes({ x: sx, y: mid + 8 }, { x: sx, y: P.bot - 24 }, C.sucrose, 3, "translocation", { head: 14 }));

  // A companion cell beside each sieve tube element (shorter than it): dense cytoplasm, a nucleus,
  // mitochondria. The gaps at the sieve plates keep the plates in plain view from the side.
  const elems: Array<[number, number]> = [[P.top + 30, P.plates[0] - 26], [P.plates[0] + 22, P.plates[1] - 26], [P.plates[1] + 22, P.bot - 10]];
  elems.forEach(([y0, y1]) => {
    const x0 = P.x1 + 2, x1 = P.cc1;
    shapes.push({ t: "path", d: rrect(x0, y0, x1, y1, 12), fill: C.companion, stroke: "ink", width: 2, part: "companion-cell" });
    const ny = (y0 + y1) / 2;
    shapes.push({ t: "path", d: ellipse({ x: (x0 + x1) / 2 + 3, y: ny }, 13, 18), fill: C.nucleus, stroke: DARK, width: 1.6, part: "companion-cell" });
    // Many mitochondria (energy to load sucrose), above and below the nucleus.
    const room = (y1 - y0) / 2 - 18;
    for (const dy of [-(18 + room / 2), 18 + room / 2]) {
      const c = { x: (x0 + x1) / 2 + 3, y: ny + dy };
      shapes.push({ t: "path", d: ellipse(c, 8, 4), fill: C.mito, stroke: DARK, width: 1.2, part: "companion-cell" });
    }
    // Plasmodesmata: fine channels through the shared wall.
    for (const py of [y0 + (y1 - y0) * 0.22, y0 + (y1 - y0) * 0.78]) {
      for (const d of [-2.5, 2.5]) shapes.push({ t: "path", d: `M${P.x1 - P.wall - 2} ${r2(py + d)} H${P.x1 + 10}`, fill: "none", stroke: DARK, width: 1.2, part: "plasmodesmata" });
    }
  });

  const cc = elems[1];
  const pd = elems[2][0] + (elems[2][1] - elems[2][0]) * 0.78;
  parts.push(
    { id: "xylem-vessel", name: "Xylem vessel", anchor: { x: X.x0 + 4, y: 84 } },
    { id: "lignin", name: "Lignin thickening", anchor: { x: li + 10, y: r2(X.top + 4 + turn + 5) } },
    { id: "pit", name: "Pit", anchor: { x: X.x0 + X.wall / 2, y: 112 } },
    { id: "end-wall", name: "No end walls (rim left)", anchor: { x: li + 5, y: X.joint } },
    { id: "lumen", name: "Hollow lumen (no cytoplasm)", anchor: { x: li + 18, y: 240 } },
    { id: "water-flow", name: "Water and mineral ions", anchor: { x: wx, y: 300 } },
    { id: "translocation", name: "Sucrose moves both ways", anchor: { x: sx, y: P.top + 30 } },
    { id: "sieve-plate", name: "Sieve plate", anchor: { x: pout - 3, y: P.plates[0] } },
    { id: "companion-cell", name: "Companion cell", anchor: { x: P.cc1 - 2, y: r2((cc[0] + cc[1]) / 2) } },
    { id: "sieve-tube", name: "Sieve tube element", anchor: { x: P.x1 - 2, y: P.plates[1] - 16 } },
    { id: "plasmodesmata", name: "Plasmodesmata", anchor: { x: P.x1 + 6, y: r2(pd + 2.5) } },
  );
  return { w: CW, h: CH, shapes, parts };
}

/* ── plan diagrams: transverse sections of a dicot stem and root ─────────────────────────────────── */

const TW = 600, TH = 440, O: Pt = { x: TW / 2, y: TH / 2 };

/** A closed outline given in (radial r, tangential s) coordinates, turned to angle `a` about the centre. */
function radial(pts: Array<[number, number]>, a: number): Pt[] {
  return transform(pts.map(([r, s]) => ({ x: O.x + r, y: O.y + s })), O, a);
}

function stemView(): { w: number; h: number; shapes: FigureShape[]; parts: FigurePart[] } {
  const shapes: FigureShape[] = [];
  const R = 206, EP = 9;
  shapes.push({ t: "path", d: ring(O, R), fill: C.epidermis, stroke: "ink", width: 2.4, part: "epidermis" });
  shapes.push({ t: "path", d: ring(O, R - EP), fill: C.cortex, stroke: DARK, width: 1.4, part: "cortex" });
  // The pith: the soft centre inside the ring of bundles.
  shapes.push({ t: "path", d: ring(O, 96), fill: C.pith, stroke: DARK, width: 1, dash: "5 5", opacity: 0.9, part: "pith" });
  const n = 8;
  let firstBundle: { xy: Pt; ph: Pt; cam: Pt; vb: Pt } | null = null;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + Math.PI / n;
    // Xylem towards the centre (a wedge), cambium across the bundle, phloem as the outer cap.
    const xylem = radial([[86, -10], [138, -24], [138, 24], [86, 10]], a);
    const phloem = radial([[144, -24], [168, -18], [172, 0], [168, 18], [144, 24]], a);
    shapes.push({ t: "path", d: roundedPoly(xylem, [6, 4, 4, 6]), fill: C.xylem, stroke: DARK, width: 1.8, part: "xylem" });
    shapes.push({ t: "path", d: roundedPoly(phloem, [3, 8, 10, 8, 3]), fill: C.phloem, stroke: DARK, width: 1.8, part: "phloem" });
    const cam = radial([[141, -25], [141, 25]], a);
    shapes.push({ t: "path", d: `M${r2(cam[0].x)} ${r2(cam[0].y)} L${r2(cam[1].x)} ${r2(cam[1].y)}`, fill: "none", stroke: C.cambium, width: 2.6, part: "cambium" });
    // The bundle's own outline round all three.
    const vb = radial([[82, -12], [140, -30], [176, -20], [180, 0], [176, 20], [140, 30], [82, 12]], a);
    shapes.push({ t: "path", d: smoothClosed(vb, 0.8), fill: "none", stroke: DARK, width: 1, dash: "3 4", part: "vascular-bundle" });
    if (i === 0) {
      const at = (r: number, s: number) => radial([[r, s]], a)[0];
      firstBundle = { xy: at(118, 0), ph: at(158, 0), cam: at(141, 10), vb: at(178, 0) };
    }
  }
  const fb = firstBundle!;
  // Parts are pointed out on bundles near the edge of the figure, each on its own tissue.
  const right = (deg: number, r: number): Pt => ({ x: r2(O.x + r * Math.cos((deg * Math.PI) / 180)), y: r2(O.y + r * Math.sin((deg * Math.PI) / 180)) });
  const bundleAt = (k: number, r: number, s = 0): Pt => radial([[r, s]], -Math.PI / 2 + (k / n) * Math.PI * 2 + Math.PI / n)[0];
  void fb;
  const parts: FigurePart[] = [
    { id: "epidermis", name: "Epidermis", anchor: right(200, R - EP / 2) },
    { id: "cortex", name: "Cortex", anchor: right(160, 188) },
    { id: "vascular-bundle", name: "Vascular bundle", anchor: bundleAt(1, 178) },
    { id: "phloem", name: "Phloem", anchor: bundleAt(2, 158) },
    { id: "cambium", name: "Cambium", anchor: bundleAt(3, 141, 14) },
    { id: "xylem", name: "Xylem", anchor: bundleAt(7, 114, -6) },
    { id: "pith", name: "Pith", anchor: { x: O.x - 30, y: O.y + 20 } },
  ].map((p) => ({ ...p, anchor: { x: r2(p.anchor.x), y: r2(p.anchor.y) } }));
  return { w: TW, h: TH, shapes, parts };
}

function rootView(): { w: number; h: number; shapes: FigureShape[]; parts: FigurePart[] } {
  const shapes: FigureShape[] = [];
  const R = 186, EP = 9, END = 96;
  // Root hairs: each a thin tubular outgrowth of one epidermal cell (drawn first, so the epidermis
  // covers their bases).
  const hairs = [-62, -20, 28, 74, 126, 170, 214, 262, 300];
  for (const deg of hairs) {
    const a = (deg * Math.PI) / 180;
    const tube = radial([[R - 6, -3.5], [R + 18, -3.5], [R + 22, 0], [R + 18, 3.5], [R - 6, 3.5]], a);
    shapes.push({ t: "path", d: roundedPoly(tube, [0, 3, 3, 3, 0]), fill: C.epidermis, stroke: "ink", width: 1.6, part: "root-hair" });
  }
  shapes.push({ t: "path", d: ring(O, R), fill: C.epidermis, stroke: "ink", width: 2.4, part: "epidermis" });
  shapes.push({ t: "path", d: ring(O, R - EP), fill: C.cortex, stroke: DARK, width: 1.4, part: "cortex" });
  // The endodermis: one ring of cells round the stele.
  shapes.push({ t: "path", d: ring(O, END), fill: C.pith, stroke: C.cambium, width: 6, opacity: 0.85, part: "endodermis" });
  shapes.push({ t: "path", d: ring(O, END), fill: "none", stroke: DARK, width: 1.2, part: "endodermis" });
  // Xylem: a star of four arms at the centre; phloem: a patch between each pair of arms.
  const arms = 4, star: Pt[] = [];
  for (let k = 0; k < arms * 2; k++) {
    const a = -Math.PI / 2 + (k / (arms * 2)) * Math.PI * 2;
    const r = k % 2 === 0 ? 76 : 22;
    star.push({ x: O.x + r * Math.cos(a), y: O.y + r * Math.sin(a) });
  }
  shapes.push({ t: "path", d: roundedPoly(star, star.map((_, k) => (k % 2 === 0 ? 10 : 6))), fill: C.xylem, stroke: DARK, width: 1.8, part: "xylem" });
  for (let k = 0; k < arms; k++) {
    const a = -Math.PI / 4 + (k / arms) * Math.PI * 2;
    const c = { x: O.x + 56 * Math.cos(a), y: O.y + 56 * Math.sin(a) };
    shapes.push({ t: "path", d: ellipse(c, 16, 16), fill: C.phloem, stroke: DARK, width: 1.8, part: "phloem" });
  }
  const at = (deg: number, r: number): Pt => ({ x: r2(O.x + r * Math.cos((deg * Math.PI) / 180)), y: r2(O.y + r * Math.sin((deg * Math.PI) / 180)) });
  const parts: FigurePart[] = [
    { id: "root-hair", name: "Root hair", anchor: at(-20, R + 16) },
    { id: "epidermis", name: "Epidermis", anchor: at(196, R - EP / 2) },
    { id: "cortex", name: "Cortex", anchor: at(150, 140) },
    { id: "endodermis", name: "Endodermis", anchor: at(160, END) },
    { id: "xylem", name: "Xylem", anchor: at(0, 60) },
    { id: "phloem", name: "Phloem", anchor: at(45, 58) },
  ];
  return { w: TW, h: TH, shapes, parts };
}

export const xylemPhloem: FigureComponent = {
  name: "xylemPhloem",
  title: "Xylem and phloem: a lignified xylem vessel (no end walls, hollow lumen, pits) beside a phloem sieve tube with sieve plates and companion cells — or a plan diagram of where they lie in a dicot stem or root",
  params: `view ("cells" default: xylem vessel and phloem sieve tube side by side, lengthways | "ts-stem": transverse section of a dicot stem, vascular bundles in a ring | "ts-root": transverse section of a dicot root, xylem star in the centre).`,
  match: /\bxylem\b|\bphloem\b|\bsieve (?:tube|plate)s?\b|\bcompanion cells?\b|\bvascular (?:bundles?|tissues?)\b|\btranslocation\b(?=[\s\S]{0,160}\b(?:sucrose|phloem|sieve|source|sink)\b)|\b(?:transverse|cross)[- ]section (?:of|through) (?:a |the )?(?:dicot\w* )?(?:stem|root)\b/i,
  parts: [
    { id: "xylem-vessel", name: "Xylem vessel" },
    { id: "lignin", name: "Lignin thickening" },
    { id: "lumen", name: "Hollow lumen (no cytoplasm)" },
    { id: "pit", name: "Pit" },
    { id: "end-wall", name: "No end walls (rim left)" },
    { id: "water-flow", name: "Water and mineral ions" },
    { id: "sieve-tube", name: "Sieve tube element" },
    { id: "sieve-plate", name: "Sieve plate" },
    { id: "companion-cell", name: "Companion cell" },
    { id: "plasmodesmata", name: "Plasmodesmata" },
    { id: "translocation", name: "Sucrose moves both ways" },
    { id: "epidermis", name: "Epidermis" },
    { id: "cortex", name: "Cortex" },
    { id: "vascular-bundle", name: "Vascular bundle" },
    { id: "xylem", name: "Xylem" },
    { id: "phloem", name: "Phloem" },
    { id: "cambium", name: "Cambium" },
    { id: "pith", name: "Pith" },
    { id: "endodermis", name: "Endodermis" },
    { id: "root-hair", name: "Root hair" },
  ],
  build(params: FigureParams) {
    const view = viewOf(params?.view ?? params?.section);
    return view === "ts-stem" ? stemView() : view === "ts-root" ? rootView() : cellsView();
  },
};
