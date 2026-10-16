import type { FigureComponent, FigureParams, FigurePart, FigureShape, Ink, Pt } from "../types";
import { arrowMid, arrowShapes, blobPoints, r2, rng, roundedPoly, smoothClosed } from "./bioDraw";
import { bool } from "./mathsKit";

/**
 * A TRANSVERSE SECTION OF A LEAF, as the O/A Level textbooks draw it, built cell by cell: the waxy
 * cuticle over an upper epidermis of clear cells (no chloroplasts); the palisade mesophyll — tall
 * columns packed with chloroplasts; the spongy mesophyll — rounded cells with fewer chloroplasts and
 * large air spaces between them; a vascular bundle (vein) with xylem towards the upper surface and
 * phloem below it, in a sheath of cells; and the lower epidermis with stomata, each a pore between
 * two guard cells (which have chloroplasts) opening into a substomatal air space. `gases` adds the
 * exchange at a stoma: carbon dioxide diffusing in, oxygen and water vapour diffusing out.
 */

const DARK: Ink = "#374151";
const C = {
  cuticle: "#fef08a" as Ink,
  epidermis: "#f7fee7" as Ink,
  palisade: "#d9f99d" as Ink,
  spongy: "#ecfccb" as Ink,
  chloroplast: "#22c55e" as Ink,
  chloroEdge: "#14532d" as Ink,
  airSpace: "#f0fdfa" as Ink,
  sheath: "#fef9c3" as Ink,
  xylem: "#bfdbfe" as Ink,
  phloem: "#fed7aa" as Ink,
  guard: "#bbf7d0" as Ink,
  co2: "#1e40af" as Ink,
  out: "#be123c" as Ink,
};

const W = 680, H = 440;
const X0 = 20, X1 = 660;
/** Layer boundaries (y). */
const Y = { cuticle: 20, upper: 28, palisade: 62, spongy: 180, lower: 356, lowerEnd: 382 };
const BUNDLE = { c: { x: 352, y: 262 }, r: 60 };
const STOMATA = [168, 520];

const pt = (x: number, y: number): Pt => ({ x, y });
const circleD = (c: Pt, r: number) => `M${r2(c.x - r)} ${r2(c.y)} a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0 a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0 Z`;

/**
 * Every path of one part and one style becomes one path (a tissue is one shape): the picture is the
 * same, and the label engine meets one tissue instead of seventy cells, so a leader runs straight
 * across the section as a textbook's does instead of zig-zagging between cells.
 */
function mergeByStyle(shapes: FigureShape[]): FigureShape[] {
  const out: FigureShape[] = [];
  const at = new Map<string, number>();
  for (const sh of shapes) {
    if (sh.t !== "path") { out.push(sh); continue; }
    const key = JSON.stringify([sh.part, sh.fill, sh.stroke, sh.width, sh.dash, sh.opacity]);
    const i = at.get(key);
    if (i === undefined) { at.set(key, out.length); out.push({ ...sh }); }
    else out[i] = { ...(out[i] as typeof sh), d: `${(out[i] as typeof sh).d} ${sh.d}` };
  }
  return out;
}
const ellipseD = (c: Pt, rx: number, ry: number, rot = 0) => smoothClosed(Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2, x = rx * Math.cos(a), y = ry * Math.sin(a);
  return { x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) };
}));

export const leafCrossSection: FigureComponent = {
  name: "leafCrossSection",
  title: "Transverse section of a leaf: cuticle, upper epidermis, palisade and spongy mesophyll with air spaces, a vascular bundle (xylem above phloem), lower epidermis with stomata and guard cells",
  params: `view ("section" default). gases (true: arrows at a stoma for carbon dioxide diffusing in and oxygen and water vapour diffusing out; default false). Parts are the tissues a labelling question names.`,
  match: /\bleaf\b(?=[\s\S]{0,200}\b(cross[- ]section|palisade|spongy|mesophyll|stomata?|cuticle|xylem|phloem|epidermis|photosynthes)\b)|\b(palisade|spongy mesophyll|structure of (a |the )?leaf)\b/i,
  parts: [
    { id: "cuticle", name: "Cuticle" },
    { id: "upper-epidermis", name: "Upper epidermis" },
    { id: "palisade", name: "Palisade mesophyll" },
    { id: "spongy", name: "Spongy mesophyll" },
    { id: "stoma", name: "Stoma" },
    { id: "xylem", name: "Xylem" },
    { id: "phloem", name: "Phloem" },
    { id: "lower-epidermis", name: "Lower epidermis" },
    { id: "air-space", name: "Air space" },
    { id: "guard-cell", name: "Guard cell" },
    { id: "chloroplast", name: "Chloroplast" },
    { id: "vascular-bundle", name: "Vascular bundle (vein)" },
    { id: "gas-exchange", name: "CO₂ in; O₂ and water vapour out" },
  ],
  build(params: FigureParams) {
    const gases = bool(params?.gases ?? params?.gas ?? params?.exchange, false);
    const rand = rng(11);
    const back: FigureShape[] = [];
    const cells: FigureShape[] = [];
    const over: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const cell = (part: string, d: string, fill: Ink, width = 1.6) => cells.push({ t: "path", part, d, fill, stroke: DARK, width });
    const chloro = (c: Pt, rot: number, scale = 1) => cells.push({ t: "path", part: "chloroplast", d: ellipseD(c, 2.9 * scale, 4.8 * scale, rot), fill: C.chloroplast, stroke: C.chloroEdge, width: 1.2 });

    // The mesophyll's air: behind every mesophyll cell (what shows between them is air space).
    back.push({ t: "path", part: "air-space", d: `M${X0} ${Y.palisade + 4} H${X1} V${Y.lower + 2} H${X0} Z`, fill: C.airSpace, stroke: "none" });

    // ── Cuticle and upper epidermis. ──
    cells.push({ t: "path", part: "cuticle", d: roundedPoly([pt(X0, Y.cuticle), pt(X1, Y.cuticle), pt(X1, Y.upper), pt(X0, Y.upper)], 2), fill: C.cuticle, stroke: DARK, width: 1.6 });
    const row = (y0: number, y1: number, part: string, gaps: Array<[number, number]>) => {
      let x = X0;
      const out: Array<{ x0: number; x1: number }> = [];
      while (x < X1 - 6) {
        const gap = gaps.find(([a, b]) => x >= a - 2 && x < b);
        if (gap) { x = gap[1]; continue; }
        let x1 = Math.min(X1, x + 40 + rand() * 18);
        const next = gaps.find(([a]) => a > x && a < x1 + 24);
        if (next) x1 = next[0];
        if (X1 - x1 < 22) x1 = X1;
        out.push({ x0: x, x1 });
        cell(part, roundedPoly([pt(x + 1, y0), pt(x1 - 1, y0), pt(x1 - 1, y1), pt(x + 1, y1)], 5), C.epidermis);
        x = x1;
      }
      return out;
    };
    row(Y.upper, Y.palisade - 2, "upper-epidermis", []);

    // ── Palisade mesophyll: tall columns, chloroplasts crowded along their walls. ──
    const pw = 32, pg = 5;
    const nPal = Math.floor((X1 - X0) / (pw + pg));
    const palStart = X0 + ((X1 - X0) - (nPal * (pw + pg) - pg)) / 2;
    for (let i = 0; i < nPal; i++) {
      const x = palStart + i * (pw + pg), top = Y.palisade + 2 + rand() * 3, bottom = Y.spongy - 6 - rand() * 8;
      cell("palisade", roundedPoly([pt(x, top), pt(x + pw, top), pt(x + pw, bottom), pt(x, bottom)], [8, 8, 14, 14]), C.palisade);
      for (let y = top + 11; y < bottom - 8; y += 13) {
        chloro(pt(x + 6.5, y + rand() * 3), 0.1 * (rand() - 0.5));
        chloro(pt(x + pw - 6.5, y + 6 + rand() * 3), 0.1 * (rand() - 0.5));
      }
    }

    // ── Spongy mesophyll: rounded cells, loosely packed, round the vein and above each stoma. ──
    const keepOut = (c: Pt, r: number) =>
      Math.hypot(c.x - BUNDLE.c.x, c.y - BUNDLE.c.y) < BUNDLE.r + r + 4 ||
      STOMATA.some((sx) => Math.abs(c.x - sx) < 30 + r && c.y + r > Y.lower - 52);
    const spongy: Array<{ c: Pt; r: number }> = [];
    for (let tries = 0; tries < 9000 && spongy.length < 70; tries++) {
      const r = 15 + rand() * 9;
      const c = pt(X0 + r * 0.9 + rand() * (X1 - X0 - 1.8 * r), Y.spongy - 2 + r * 0.9 + rand() * (Y.lower - Y.spongy - 1.8 * r));
      if (keepOut(c, r)) continue;
      if (spongy.some((q) => Math.hypot(q.c.x - c.x, q.c.y - c.y) < q.r + r + 1.5)) continue;
      spongy.push({ c, r });
    }
    spongy.forEach((s, i) => {
      cell("spongy", smoothClosed(blobPoints(s.c, s.r * 1.18, s.r * 0.86, 9, 0.16, 30 + i, (i % 5) * 0.6)), C.spongy);
      for (let k = 0; k < 3; k++) {
        const a = rand() * Math.PI * 2;
        chloro(pt(s.c.x + Math.cos(a) * s.r * 0.62, s.c.y + Math.sin(a) * s.r * 0.62), a, 0.9);
      }
    });

    // ── The vascular bundle: a sheath of cells round xylem (upper) and phloem (lower). ──
    const B = BUNDLE.c;
    const nSheath = 18;
    for (let i = 0; i < nSheath; i++) {
      const a = (i / nSheath) * Math.PI * 2;
      const c = pt(B.x + Math.cos(a) * (BUNDLE.r - 9), B.y + Math.sin(a) * (BUNDLE.r - 9) * 0.86);
      cell("vascular-bundle", smoothClosed(blobPoints(c, 11, 9, 8, 0.08, 80 + i, a)), C.sheath);
    }
    // Xylem: wide vessels with thick (lignified) walls.
    const xy = [pt(B.x - 22, B.y - 24), pt(B.x, B.y - 28), pt(B.x + 22, B.y - 24), pt(B.x - 12, B.y - 6), pt(B.x + 12, B.y - 6)];
    xy.forEach((c, i) => cells.push({ t: "path", part: "xylem", d: circleD(c, i < 3 ? 10 : 8.5), fill: C.xylem, stroke: DARK, width: 2.6 }));
    // Phloem: smaller sieve tubes and companion cells.
    const ph = [pt(B.x - 26, B.y + 16), pt(B.x - 13, B.y + 14), pt(B.x, B.y + 13), pt(B.x + 13, B.y + 14), pt(B.x + 26, B.y + 16), pt(B.x - 19, B.y + 28), pt(B.x - 6, B.y + 27), pt(B.x + 7, B.y + 27), pt(B.x + 20, B.y + 28)];
    ph.forEach((c, i) => cells.push({ t: "path", part: "phloem", d: circleD(c, i % 2 ? 5.2 : 6.4), fill: C.phloem, stroke: DARK, width: 1.6 }));

    // ── Lower epidermis, with a gap for each stoma, and its thin cuticle. ──
    const gw = 26;
    row(Y.lower, Y.lowerEnd, "lower-epidermis", STOMATA.map((sx) => [sx - gw, sx + gw] as [number, number]));
    cells.push({ t: "path", part: "cuticle", d: `M${X0} ${Y.lowerEnd + 1.5} H${STOMATA[0] - gw} M${STOMATA[0] + gw} ${Y.lowerEnd + 1.5} H${STOMATA[1] - gw} M${STOMATA[1] + gw} ${Y.lowerEnd + 1.5} H${X1}`, fill: "none", stroke: "#a16207", width: 2.2 });
    // Each stoma: two guard cells (with chloroplasts, thick walls beside the pore) round the pore.
    for (const sx of STOMATA) {
      for (const s of [-1, 1] as const) {
        const c = pt(sx + s * 13, (Y.lower + Y.lowerEnd) / 2 + 2);
        cells.push({ t: "path", part: "guard-cell", d: ellipseD(c, 11, 14), fill: C.guard, stroke: DARK, width: 1.6 });
        cells.push({ t: "path", part: "guard-cell", d: `M${r2(sx + s * 3.6)} ${r2(c.y - 10)} Q${r2(sx + s * 1.6)} ${r2(c.y)} ${r2(sx + s * 3.6)} ${r2(c.y + 10)}`, fill: "none", stroke: DARK, width: 2.6 });
        chloro(pt(c.x + s * 4, c.y - 5), 0.3, 0.75);
        chloro(pt(c.x + s * 4, c.y + 6), -0.3, 0.75);
      }
      // The pore itself, open onto the substomatal air space above it.
      over.push({ t: "path", part: "stoma", d: `M${sx - 2.4} ${Y.lower - 4} H${sx + 2.4} V${Y.lowerEnd + 6} H${sx - 2.4} Z`, fill: C.airSpace, stroke: "none" });
    }

    // ── Gas exchange at the second stoma (optional). ──
    if (gases) {
      const sx = STOMATA[1];
      over.push(...arrowShapes(pt(sx - 34, 432), pt(sx - 3, Y.lower - 26), C.co2, 2.6, "gas-exchange", { head: 12, bend: -8 }));
      over.push(...arrowShapes(pt(sx + 3, Y.lower - 26), pt(sx + 34, 432), C.out, 2.6, "gas-exchange", { head: 12, bend: -8 }));
      over.push({ t: "text", x: sx - 44, y: 428, text: "CO₂", size: 16, anchor: "end", fill: C.co2, part: "gas-exchange" });
      over.push({ t: "text", x: sx + 44, y: 428, text: "O₂, H₂O", size: 16, anchor: "start", fill: C.out, part: "gas-exchange" });
      const mid = arrowMid(pt(sx + 3, Y.lower - 26), pt(sx + 34, 432), -8);
      parts.push({ id: "gas-exchange", name: "CO₂ in; O₂ and water vapour out", anchor: pt(r2(mid.x), r2(mid.y + 14)) });
    }

    // ── Anchors: each on its own shapes, spread so leaders run straight out to the margins. ──
    const pal = palStart + 2 * (pw + pg);
    const lowerCell = (x: number) => pt(x, (Y.lower + Y.lowerEnd) / 2);
    const nearest = (target: Pt) => spongy.reduce((b, s) => (Math.hypot(s.c.x - target.x, s.c.y - target.y) < Math.hypot(b.c.x - target.x, b.c.y - target.y) ? s : b), spongy[0]);
    const sp = nearest(pt(90, 270));
    const chl = palStart + (nPal - 3) * (pw + pg) + pw - 6.5;
    parts.push(
      { id: "cuticle", name: "Cuticle", anchor: pt(70, (Y.cuticle + Y.upper) / 2) },
      { id: "upper-epidermis", name: "Upper epidermis", anchor: pt(600, (Y.upper + Y.palisade) / 2) },
      { id: "palisade", name: "Palisade mesophyll", anchor: pt(pal + pw / 2, 108) },
      { id: "spongy", name: "Spongy mesophyll", anchor: pt(r2(sp.c.x), r2(sp.c.y)) },
      { id: "stoma", name: "Stoma", anchor: pt(STOMATA[0], Y.lowerEnd + 2) },
      { id: "xylem", name: "Xylem", anchor: pt(r2(xy[2].x), r2(xy[2].y)) },
      { id: "phloem", name: "Phloem", anchor: pt(r2(ph[4].x), r2(ph[4].y)) },
      { id: "lower-epidermis", name: "Lower epidermis", anchor: lowerCell(612) },
      { id: "air-space", name: "Air space", anchor: pt(STOMATA[1] + 18, Y.lower - 44) },
      { id: "guard-cell", name: "Guard cell", anchor: pt(STOMATA[1] + 16, (Y.lower + Y.lowerEnd) / 2 + 2) },
      { id: "chloroplast", name: "Chloroplast", anchor: pt(r2(chl), 128) },
      { id: "vascular-bundle", name: "Vascular bundle (vein)", anchor: pt(B.x - (BUNDLE.r - 9), B.y) },
    );
    // The chloroplast anchor on a chloroplast actually drawn there.
    const chlShape = cells.filter((s): s is Extract<FigureShape, { t: "path" }> => s.t === "path" && s.part === "chloroplast");
    const want = parts.find((q) => q.id === "chloroplast")!;
    let best = want.anchor, bestD = Infinity;
    for (const s of chlShape) {
      const m = /^M([\d.-]+) ([\d.-]+)/.exec(s.d);
      if (!m) continue;
      // smoothClosed starts at angle 0 (rx from the centre): the centre is that point minus rx along the rotation.
      const cx = Number(m[1]) - 2.9, cy = Number(m[2]);
      const d = Math.hypot(cx - want.anchor.x, cy - want.anchor.y);
      if (d < bestD) { bestD = d; best = pt(r2(cx), r2(cy)); }
    }
    want.anchor = best;
    const order = leafCrossSection.parts.map((q) => q.id);
    parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    // Chloroplasts last, so each lies inside its cell.
    const isChl = (sh: FigureShape) => sh.part === "chloroplast";
    return { w: W, h: H, shapes: [...back, ...mergeByStyle(cells.filter((sh) => !isChl(sh))), ...mergeByStyle(cells.filter(isChl)), ...over], parts };
  },
};
