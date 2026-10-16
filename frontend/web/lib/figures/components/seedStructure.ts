import type { FigureComponent, FigurePart, FigureParams, FigureShape, Pt } from "../types";
import { r2, smoothClosed, smoothOpen } from "./bioDraw";

/**
 * A DICOT SEED (a bean), as the O/A Level textbook draws it.
 *
 * view "seed" (default): the seed opened, one cotyledon lifted away — the testa (seed coat) round
 * the outside, the large cotyledon (the food store) inside it, and the embryo at the concave edge:
 * the radicle (embryonic root) pointing at the micropyle, and the plumule (embryonic shoot, two tiny
 * folded leaves) lying between the cotyledons. The hilum (the scar where the seed was attached to
 * the pod) is beside the micropyle.
 *
 * view "germinating": the same seed a few days later — the testa split, the radicle grown down into
 * a root with root hairs behind its tip, the plumule growing up beside the seed, hooked over to
 * protect its tip as it pushes through the soil. The cotyledons stay inside the testa.
 */


/** Outlines inside pale fills: a fixed dark that stays dark on the chalkboard too. */
const DARK = "#374151";
const C = {
  testa: "#c48a55",
  cotyledon: "#fdebc0",
  radicle: "#fcd9a8",
  plumule: "#86efac",
  stem: "#bbf7d0",
  hilum: "#7c2d12",
  root: "#fef3c7",
} as const;

/** A bean's kidney outline about centre c, half-width hw and half-height hh, with the dip (the hilum side) at the bottom. */
function kidney(c: Pt, hw: number, hh: number, dip = 0.2): Pt[] {
  return Array.from({ length: 36 }, (_, i) => {
    const t = (i / 36) * Math.PI * 2;
    // An ellipse pushed in at the bottom (t = π/2) — the concave side of a bean.
    const d = Math.PI / 2 - Math.atan2(Math.sin(t), Math.cos(t));
    const pull = dip * Math.exp(-((d / 0.42) ** 2));
    return { x: c.x + hw * Math.cos(t), y: c.y + hh * (Math.sin(t) - pull * 1.9 * Math.max(0, Math.sin(t))) };
  });
}

/** A tapering, rounded-tip organ along a centreline (root, radicle): widths from base w0 to tip w1. */
function taper(line: Pt[], w0: number, w1: number): Pt[] {
  const n = line.length;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    left.push({ x: line[i].x + nx * w, y: line[i].y + ny * w });
    right.push({ x: line[i].x - nx * w, y: line[i].y - ny * w });
  }
  const tip = line[n - 1], prev = line[n - 2] ?? line[0];
  const L = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
  const round = { x: tip.x + ((tip.x - prev.x) / L) * w1 * 0.7, y: tip.y + ((tip.y - prev.y) / L) * w1 * 0.7 };
  // The base is rounded too.
  const next = line[1] ?? tip, B = Math.hypot(next.x - line[0].x, next.y - line[0].y) || 1;
  const back = { x: line[0].x - ((next.x - line[0].x) / B) * w0 * 0.45, y: line[0].y - ((next.y - line[0].y) / B) * w0 * 0.45 };
  return [...left, round, ...right.reverse(), back];
}


/** A small pointed leaf from base to tip, bulging to one side by `bulge`. */
function leaf(base: Pt, tip: Pt, bulge: number): string {
  const mx = (base.x + tip.x) / 2, my = (base.y + tip.y) / 2;
  const L = Math.hypot(tip.x - base.x, tip.y - base.y) || 1, nx = -(tip.y - base.y) / L, ny = (tip.x - base.x) / L;
  const p = (x: number, y: number) => `${r2(x)} ${r2(y)}`;
  return `M${p(base.x, base.y)} Q${p(mx + nx * bulge, my + ny * bulge)} ${p(tip.x, tip.y)} Q${p(mx - nx * bulge * 0.35, my - ny * bulge * 0.35)} ${p(base.x, base.y)} Z`;
}

function seedView(): { w: number; h: number; shapes: FigureShape[]; parts: FigurePart[] } {
  const W = 640, H = 380, c = { x: 320, y: 196 };
  const hw = 250, hh = 150;
  const shapes: FigureShape[] = [];
  // Testa: the tough seed coat, a band round the outside.
  shapes.push({ t: "path", d: smoothClosed(kidney(c, hw, hh)), fill: C.testa, stroke: "ink", width: 2.4, part: "testa" });
  shapes.push({ t: "path", d: smoothClosed(kidney(c, hw - 11, hh - 11)), fill: "paper", stroke: DARK, width: 1.2, part: "testa" });
  // Cotyledon: the food store filling the seed, just inside the testa.
  shapes.push({ t: "path", d: smoothClosed(kidney({ x: c.x, y: c.y - 1 }, hw - 17, hh - 17)), fill: C.cotyledon, stroke: DARK, width: 2, part: "cotyledon" });
  // The embryo at the concave edge: radicle pointing down-left at the micropyle, plumule up between
  // the cotyledons.
  // Positions are taken from the cotyledon's own outline so the embryo always lies inside the seed:
  // the radicle runs along the edge left of the dip, its tip just inside the testa at the micropyle.
  const inner = kidney({ x: c.x, y: c.y - 1 }, hw - 17, hh - 17);
  const toward = (p: Pt, d: number): Pt => { const L = Math.hypot(c.x - p.x, c.y - p.y) || 1; return { x: p.x + ((c.x - p.x) / L) * d, y: p.y + ((c.y - p.y) / L) * d }; };
  const base = toward(inner[8], 52);
  const radicleLine = [base, toward(inner[9], 40), toward(inner[10], 26), toward(inner[11], 13)];
  shapes.push({ t: "path", d: smoothClosed(taper(radicleLine, 34, 12), 0.6), fill: C.radicle, stroke: DARK, width: 2.2, part: "radicle" });
  const stemEnd = { x: base.x + 34, y: base.y - 44 };
  const stem = `M${base.x} ${base.y} Q${base.x + 26} ${base.y - 12} ${stemEnd.x} ${stemEnd.y}`;
  shapes.push({ t: "path", d: stem, fill: "none", stroke: DARK, width: 12, part: "plumule" });
  shapes.push({ t: "path", d: stem, fill: "none", stroke: C.stem, width: 8, part: "plumule" });
  // The plumule's two tiny first leaves, folded together.
  shapes.push({ t: "path", d: leaf(stemEnd, { x: stemEnd.x + 56, y: stemEnd.y - 30 }, 17), fill: C.plumule, stroke: DARK, width: 1.8, part: "plumule" });
  shapes.push({ t: "path", d: leaf(stemEnd, { x: stemEnd.x + 22, y: stemEnd.y - 60 }, -16), fill: C.plumule, stroke: DARK, width: 1.8, part: "plumule" });

  // Hilum: the dark scar on the testa where the seed was attached to the pod; micropyle: the tiny
  // pore in the testa beside it, at the radicle's tip.
  const outline = kidney(c, hw, hh);
  const dip = outline[9]; // the bottom of the concave side
  shapes.push({ t: "path", d: smoothClosed([{ x: dip.x - 30, y: dip.y - 1 }, { x: dip.x, y: dip.y - 5 }, { x: dip.x + 30, y: dip.y - 1 }, { x: dip.x, y: dip.y + 5 }], 0.9), fill: C.hilum, stroke: DARK, width: 1.4, part: "hilum" });
  // The micropyle: a tiny pore through the testa, at the radicle's tip.
  const mic = toward(outline[11], 5);
  shapes.push({ t: "circle", cx: r2(mic.x), cy: r2(mic.y), r: 4.2, fill: DARK, stroke: "none", part: "micropyle" });

  const parts: FigurePart[] = [
    { id: "testa", name: "Testa (seed coat)", anchor: { x: c.x - hw + 5, y: c.y - 20 } },
    { id: "cotyledon", name: "Cotyledon (food store)", anchor: { x: c.x - 110, y: c.y - 30 } },
    { id: "radicle", name: "Radicle", anchor: { x: r2(radicleLine[2].x), y: r2(radicleLine[2].y) } },
    { id: "plumule", name: "Plumule", anchor: { x: r2(stemEnd.x + 34), y: r2(stemEnd.y - 18) } },
    { id: "micropyle", name: "Micropyle", anchor: { x: r2(mic.x), y: r2(mic.y) } },
    { id: "hilum", name: "Hilum (scar)", anchor: { x: r2(dip.x + 12), y: r2(dip.y) } },
  ];
  return { w: W, h: H, shapes, parts };
}

function germinatingView(): { w: number; h: number; shapes: FigureShape[]; parts: FigurePart[] } {
  const W = 600, H = 440, c = { x: 262, y: 128 };
  const hw = 128, hh = 82;
  const shapes: FigureShape[] = [];
  // The root: radicle grown down from the micropyle end, tapering to its root cap, with root hairs
  // on the zone just behind the tip.
  const top = { x: c.x - 10, y: c.y + hh * 0.62 };
  const rootLine: Pt[] = [top, { x: top.x - 5, y: top.y + 60 }, { x: top.x + 2, y: top.y + 120 }, { x: top.x + 12, y: top.y + 175 }, { x: top.x + 16, y: H - 22 }];
  // Position along the root by length, with the normal at that point.
  const segs = rootLine.slice(1).map((b, i) => Math.hypot(b.x - rootLine[i].x, b.y - rootLine[i].y));
  const total = segs.reduce((x, y) => x + y, 0);
  const along = (t: number): { p: Pt; n: Pt } => {
    let d = Math.max(0, Math.min(1, t)) * total, i = 0;
    while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++; }
    const a = rootLine[i], b = rootLine[i + 1], L = segs[i] || 1, u = Math.min(1, d / L);
    return { p: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, n: { x: -(b.y - a.y) / L, y: (b.x - a.x) / L } };
  };
  const widthAt = (t: number) => 24 + (9 - 24) * t;
  // Root hairs: a band of fine hairs a little way behind the tip (none at the tip itself).
  const hairs: string[] = [];
  for (let k = 0; k < 12; k++) {
    const t = 0.52 + k * 0.028, { p, n } = along(t), w = widthAt(t) / 2 - 1;
    for (const s of [1, -1]) {
      const from = { x: p.x + n.x * s * w, y: p.y + n.y * s * w }, len = 13 + ((k * 7) % 3) * 3;
      hairs.push(`M${r2(from.x)} ${r2(from.y)} q${r2(n.x * s * len * 0.6)} ${r2(n.y * s * len * 0.6)} ${r2(n.x * s * len)} ${r2(n.y * s * len + 5)}`);
    }
  }
  shapes.push({ t: "path", d: hairs.join(" "), fill: "none", stroke: "ink", width: 1.2, part: "root-hair" });
  shapes.push({ t: "path", d: smoothClosed(taper(rootLine, 24, 9), 0.7), fill: C.root, stroke: "ink", width: 2, part: "radicle" });
  // Root cap: a darker cap over the very tip.
  const rt = rootLine[rootLine.length - 1];
  shapes.push({ t: "path", d: `M${r2(rt.x - 5)} ${r2(rt.y - 7)} Q${r2(rt.x + 1)} ${r2(rt.y + 13)} ${r2(rt.x + 7)} ${r2(rt.y - 6)} Z`, fill: C.radicle, stroke: "ink", width: 1.4, part: "radicle" });

  // The plumule: from between the cotyledons, up beside the seed, hooked at the top.
  const pb = { x: c.x + 22, y: c.y + hh * 0.8 };
  const shoot: Pt[] = [pb, { x: pb.x + 40, y: pb.y + 26 }, { x: c.x + hw + 10, y: c.y + hh + 4 }, { x: c.x + hw + 44, y: c.y + 20 }, { x: c.x + hw + 52, y: c.y - hh + 10 }, { x: c.x + hw + 34, y: 24 }, { x: c.x + hw + 8, y: 26 }, { x: c.x + hw - 2, y: 50 }];
  shapes.push({ t: "path", d: smoothOpen(shoot), fill: "none", stroke: "ink", width: 13, part: "plumule" });
  shapes.push({ t: "path", d: smoothOpen(shoot), fill: "none", stroke: C.stem, width: 8.5, part: "plumule" });
  const ht = shoot[shoot.length - 1];
  shapes.push({ t: "path", d: leaf(ht, { x: ht.x - 12, y: ht.y + 26 }, 10), fill: C.plumule, stroke: "ink", width: 1.6, part: "plumule" });
  shapes.push({ t: "path", d: leaf(ht, { x: ht.x + 8, y: ht.y + 26 }, -9), fill: C.plumule, stroke: "ink", width: 1.6, part: "plumule" });

  // The seed: cotyledons inside the split testa.
  shapes.push({ t: "path", d: smoothClosed(kidney(c, hw - 9, hh - 9)), fill: C.cotyledon, stroke: DARK, width: 2, part: "cotyledon" });
  shapes.push({ t: "path", d: `M${c.x - 6} ${c.y - hh + 12} Q${c.x + 4} ${c.y} ${c.x - 2} ${c.y + hh * 0.7}`, fill: "none", stroke: DARK, width: 1.4, part: "cotyledon" });
  // The testa, split open along the bottom where the root and shoot came out.
  const k = kidney(c, hw, hh);
  // The coat runs round from just right of the dip, over the top, to just left of it.
  const coat = smoothOpen([...k.slice(0, 7).reverse(), ...k.slice(13).reverse()]);
  shapes.push({ t: "path", d: coat, fill: "none", stroke: "ink", width: 12, part: "testa" });
  shapes.push({ t: "path", d: coat, fill: "none", stroke: C.testa, width: 8, part: "testa" });

  const rh = along(0.7);
  const parts: FigurePart[] = [
    { id: "testa", name: "Testa (split)", anchor: { x: r2(k[18].x), y: r2(k[18].y) } },
    { id: "cotyledon", name: "Cotyledon (food store)", anchor: { x: c.x - 60, y: c.y - 6 } },
    { id: "plumule", name: "Plumule (hooked shoot)", anchor: { x: r2(shoot[3].x), y: r2(shoot[3].y) } },
    { id: "radicle", name: "Radicle (root)", anchor: { x: r2(along(0.4).p.x), y: r2(along(0.4).p.y) } },
    { id: "root-hair", name: "Root hairs", anchor: { x: r2(rh.p.x - rh.n.x * 20), y: r2(rh.p.y - rh.n.y * 20 + 6) } },
  ];
  return { w: W, h: H, shapes, parts };
}

export const seedStructure: FigureComponent = {
  name: "seedStructure",
  title: "Dicot (bean) seed: opened to show the testa, cotyledon, radicle, plumule, micropyle and hilum — or the germinating seed with its root, root hairs and hooked shoot",
  params: `view ("seed" default: the seed opened, one cotyledon removed | "germinating": the testa split, the radicle grown into a root with root hairs, the plumule hooked above).`,
  match: /\b(?:structure|parts) of (?:a |the )?(?:bean |dicot\w* )?seeds?\b|\bseed structure\b|\b(?:bean|dicot\w*|broad bean) seeds?\b|\b(?:testa|plumule|radicle|micropyle|cotyledons?)\b|\b(?<!pollen (?:grains? )?)germinat\w*\b(?=[\s\S]{0,120}\bseeds?\b)|\bseeds?\b(?=[\s\S]{0,80}\bgerminat\w*)/i,
  parts: [
    { id: "testa", name: "Testa (seed coat)" },
    { id: "cotyledon", name: "Cotyledon (food store)" },
    { id: "radicle", name: "Radicle" },
    { id: "plumule", name: "Plumule" },
    { id: "micropyle", name: "Micropyle" },
    { id: "hilum", name: "Hilum (scar)" },
    { id: "root-hair", name: "Root hairs" },
  ],
  build(params: FigureParams) {
    const v = String(params?.view ?? params?.stage ?? "").toLowerCase();
    return /germin|sprout|seedling|grow/.test(v) ? germinatingView() : seedView();
  },
};
