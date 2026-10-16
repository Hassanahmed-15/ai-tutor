import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { r2, smoothClosed } from "./bioDraw";
import { keepParts, mergeRuns } from "./bloodVessels";

/**
 * A VILLUS OF THE SMALL INTESTINE IN SECTION, as the O/A Level textbook draws it: a finger of the wall
 * covered by an epithelium one cell thick (columnar cells with a microvillus brush border, a goblet
 * cell or two), a capillary network fed by an arteriole and drained by a venule, and the central
 * lacteal running down to the lymph vessels. The surface is built as one curve and every layer is
 * offset from it, so the epithelium has the same thickness everywhere and the brush border sits on
 * its outer face. One villus comes with a magnified view of the epithelial cells (microvilli,
 * mitochondria); two or three villi stand side by side as neighbours.
 */

const C = {
  line: "#44403c",
  epi: "#fde4cf",
  epiNuc: "#7c3aed",
  core: "#fff7ed",
  goblet: "#e0f2fe",
  lacteal: "#fef9c3",
  lactealLine: "#a16207",
  art: "#dc2626",
  cap: "#a855f7",
  ven: "#2563eb",
  mito: "#fdba74",
} as const;

type Sample = { p: Pt; n: Pt; s: number };

function boolOf(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    if (/^(true|yes|on|1|show)$/i.test(v.trim())) return true;
    if (/^(false|no|off|0|hide|none)$/i.test(v.trim())) return false;
  }
  return fallback;
}
function countOf(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.max(1, Math.min(3, Math.round(n))) : 1;
}

type Villus = { cx: number; hwBase: number; hwTop: number; top: number };

/**
 * The gut surface, left to right, sampled every ~3 units: flat between villi, up each villus side,
 * round its tip, down again. Normals point into the tissue.
 */
function surface(x0: number, x1: number, ys: number, villi: Villus[]): Sample[] {
  const pts: Pt[] = [];
  const line = (a: Pt, b: Pt) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
    for (let i = 0; i < n; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  };
  const arc = (c: Pt, r: number, a0: number, a1: number) => {
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / 3));
    for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
  };
  const f = 18; // fillet radius where a villus meets the flat surface
  let x = x0;
  for (const v of villi) {
    const lb = v.cx - v.hwBase, rb = v.cx + v.hwBase, capY = v.top + v.hwTop;
    line({ x, y: ys }, { x: lb - f, y: ys });
    arc({ x: lb - f, y: ys - f }, f, Math.PI / 2, 0);
    line({ x: lb, y: ys - f }, { x: v.cx - v.hwTop, y: capY });
    arc({ x: v.cx, y: capY }, v.hwTop, Math.PI, 2 * Math.PI);
    line({ x: v.cx + v.hwTop, y: capY }, { x: rb, y: ys - f });
    arc({ x: rb + f, y: ys - f }, f, Math.PI, Math.PI / 2);
    x = rb + f;
  }
  line({ x, y: ys }, { x: x1, y: ys });
  pts.push({ x: x1, y: ys });
  let s = 0;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (i) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    return { p, n: { x: -(b.y - a.y) / L, y: (b.x - a.x) / L }, s };
  });
}
const off = (q: Sample, d: number): Pt => ({ x: q.p.x + q.n.x * d, y: q.p.y + q.n.y * d });
const poly = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${r2(p.x)} ${r2(p.y)}`).join(" ");
const ellipse = (c: Pt, rx: number, ry: number, rot: number): string => smoothClosed(Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2, x = rx * Math.cos(a), y = ry * Math.sin(a);
  return { x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) };
}));

type Anchors = Record<string, Pt>;

/** The wall block: epithelium (with brush border and goblet cells), the tissue under it, and the base vessels. */
function wall(shapes: FigureShape[], x0: number, x1: number, ys: number, yBottom: number, villi: Villus[]): { anchors: Anchors; samples: Sample[]; et: number } {
  const et = 19;
  const sm = surface(x0, x1, ys, villi);
  const outer = sm.map((q) => q.p), inner = sm.map((q) => off(q, et));
  // Tissue under the epithelium (lamina propria and submucosa).
  shapes.push({ t: "path", d: `${poly(inner)} L${r2(x1)} ${r2(yBottom)} L${r2(x0)} ${r2(yBottom)} Z`, fill: C.core, stroke: C.line, width: 1.6 });
  // Epithelium: one band of columnar cells.
  shapes.push({ t: "path", part: "epithelium", d: `${poly(outer)} ${poly([...inner].reverse()).replace(/^M/, "L")} Z`, fill: C.epi, stroke: C.line, width: 1.6 });
  const total = sm[sm.length - 1].s;
  const cellW = 12;
  let walls = "", nuclei = "", brush = "";
  let next = cellW, k = 0;
  const gobletAt = new Set<number>();
  // Goblet cells: two on each villus side, none on the flat stretches.
  for (const v of villi) {
    const side = sm.filter((q) => q.p.y < ys - 60 && q.p.y > v.top + v.hwTop && Math.abs(q.p.x - v.cx) < v.hwBase + 2);
    const left = side.filter((q) => q.p.x < v.cx), right = side.filter((q) => q.p.x > v.cx);
    if (left.length) gobletAt.add(Math.round(left[Math.floor(left.length * 0.3)].s / cellW));
    if (right.length) gobletAt.add(Math.round(right[Math.floor(right.length * 0.3)].s / cellW));
  }
  const goblets: Sample[] = [];
  for (const q of sm) {
    if (q.s >= next && q.s < total - 4) {
      k++;
      next += cellW;
      const a = q.p, b = off(q, et);
      walls += `M${r2(a.x)} ${r2(a.y)} L${r2(b.x)} ${r2(b.y)} `;
      const mid = sm.find((m) => m.s >= q.s - cellW / 2) ?? q;
      if (gobletAt.has(k)) goblets.push(mid);
      else nuclei += `${ellipse(off(mid, et * 0.62), 4.6, 2.4, Math.atan2(mid.n.y, mid.n.x))} `;
    }
  }
  // Brush border: microvilli as fine projections on the outer face.
  for (let i = 0; i < sm.length; i += 1) {
    const q = sm[i];
    if (q.p.x <= x0 + 1 || q.p.x >= x1 - 1) continue;
    const t = { x: q.p.x - q.n.x * 5, y: q.p.y - q.n.y * 5 };
    brush += `M${r2(q.p.x)} ${r2(q.p.y)} L${r2(t.x)} ${r2(t.y)} `;
  }
  shapes.push({ t: "path", part: "epithelium", d: walls.trim(), stroke: C.line, width: 1.2, fill: "none" });
  if (nuclei) shapes.push({ t: "path", part: "epithelium", d: nuclei.trim(), fill: C.epiNuc, stroke: "none" });
  shapes.push({ t: "path", part: "microvilli", d: brush.trim(), stroke: "#b45309", width: 1.2, fill: "none" });
  for (const g of goblets) {
    const c = off(g, et * 0.48);
    shapes.push({ t: "path", part: "goblet-cell", d: ellipse(c, et * 0.44, 6, Math.atan2(g.n.y, g.n.x)), fill: C.goblet, stroke: C.line, width: 1.6 });
  }
  const anchors: Anchors = {};
  if (goblets.length) anchors["goblet-cell"] = off(goblets[0], et * 0.48);
  return { anchors, samples: sm, et };
}

/** The vessels inside one villus: arteriole up one side, a capillary network over the lacteal, venule down the other. */
function villusVessels(shapes: FigureShape[], v: Villus, ys: number, yArt: number, yVen: number, yLym: number): Anchors {
  const et = 19;
  const capY = v.top + v.hwTop;
  const ax = v.cx - v.hwTop + et + 12, vx = v.cx + v.hwTop - et - 12;
  const axB = v.cx - v.hwBase + et + 14, vxB = v.cx + v.hwBase - et - 14;
  const topY = v.top + et + 14;
  // Lacteal: a blind-ended tube in the middle, running down to the lymph vessel.
  const lw = 10;
  const tube = `M${r2(v.cx - lw)} ${r2(yLym)} L${r2(v.cx - lw)} ${r2(capY - 4)} A${lw} ${lw} 0 0 1 ${r2(v.cx + lw)} ${r2(capY - 4)} L${r2(v.cx + lw)} ${r2(yLym)}`;
  shapes.push({ t: "path", part: "lacteal", d: tube, fill: C.lacteal, stroke: "none" });
  shapes.push({ t: "path", part: "lacteal", d: tube, fill: "none", stroke: C.lactealLine, width: 1.8 });
  // Arteriole (red) rising on the left, venule (blue) falling on the right.
  shapes.push({ t: "path", part: "arteriole", d: `M${r2(axB)} ${r2(yArt)} L${r2(axB)} ${r2(ys - 20)} L${r2(ax)} ${r2(capY + 6)} Q${r2(ax)} ${r2(topY)} ${r2(v.cx - 12)} ${r2(topY - 2)}`, stroke: C.art, width: 5, fill: "none" });
  shapes.push({ t: "path", part: "venule", d: `M${r2(v.cx + 12)} ${r2(topY - 2)} Q${r2(vx)} ${r2(topY)} ${r2(vx)} ${r2(capY + 6)} L${r2(vxB)} ${r2(ys - 20)} L${r2(vxB)} ${r2(yVen)}`, stroke: C.ven, width: 5.5, fill: "none" });
  // The capillary network: loops from arteriole to venule, passing in front of the lacteal.
  const xAt = (y: number, left: boolean) => {
    const t = Math.max(0, Math.min(1, (y - (capY + 6)) / (ys - 20 - (capY + 6))));
    return left ? ax + (axB - ax) * t : vx + (vxB - vx) * t;
  };
  let red = "", mid = "", blue = "";
  const levels = [0.08, 0.26, 0.44, 0.62, 0.8].map((f) => capY + 10 + f * (ys - 40 - capY));
  levels.forEach((y, i) => {
    const xl = xAt(y, true), xr = xAt(y + 8, false), m1 = xl + (xr - xl) / 3, m2 = xl + (2 * (xr - xl)) / 3;
    const dip = i % 2 ? 7 : -7;
    red += `M${r2(xl)} ${r2(y)} Q${r2((xl + m1) / 2)} ${r2(y + dip)} ${r2(m1)} ${r2(y + 2)} `;
    mid += `M${r2(m1)} ${r2(y + 2)} Q${r2((m1 + m2) / 2)} ${r2(y - dip)} ${r2(m2)} ${r2(y + 5)} `;
    blue += `M${r2(m2)} ${r2(y + 5)} Q${r2((m2 + xr) / 2)} ${r2(y + 8 + dip)} ${r2(xr)} ${r2(y + 8)} `;
  });
  // Cross-links between neighbouring loops make it a network, not a ladder.
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i], y1 = levels[i + 1];
    const xa = xAt(y0, true) + (xAt(y0 + 8, false) - xAt(y0, true)) * (i % 2 ? 0.26 : 0.72);
    mid += `M${r2(xa)} ${r2(y0 + 3)} Q${r2(xa + 8)} ${r2((y0 + y1) / 2)} ${r2(xa)} ${r2(y1 + 3)} `;
  }
  shapes.push({ t: "path", part: "capillary", d: red.trim(), stroke: "#ef4444", width: 2.6, fill: "none" });
  shapes.push({ t: "path", part: "capillary", d: mid.trim(), stroke: C.cap, width: 2.6, fill: "none" });
  shapes.push({ t: "path", part: "capillary", d: blue.trim(), stroke: "#3b82f6", width: 2.6, fill: "none" });
  const lv = levels[1];
  return {
    lacteal: { x: v.cx, y: capY + 4 },
    arteriole: { x: axB, y: ys - 34 },
    venule: { x: vxB, y: ys - 34 },
    capillaryLeft: { x: xAt(lv, true) + 14, y: lv + 2 },
    capillaryRight: { x: xAt(lv + 8, false) - 12, y: lv + 7 },
  };
}

/** A magnified strip of three epithelial cells: microvilli, mitochondria, nucleus. */
function epitheliumInset(shapes: FigureShape[], x: number, y: number, cw: number, ch: number): Anchors {
  const n = 3, mvH = 20;
  for (let i = 0; i < n; i++) {
    const cx0 = x + i * cw;
    shapes.push({ t: "path", part: "epithelium", d: `M${r2(cx0)} ${r2(y)} H${r2(cx0 + cw)} V${r2(y + ch)} H${r2(cx0)} Z`, fill: C.epi, stroke: C.line, width: 1.8 });
    let mv = "";
    const m = 7, mw = cw / m;
    for (let j = 0; j < m; j++) {
      const l = cx0 + j * mw + mw * 0.18, r = cx0 + (j + 1) * mw - mw * 0.18;
      mv += `M${r2(l)} ${r2(y)} V${r2(y - mvH + (r - l) / 2)} A${r2((r - l) / 2)} ${r2((r - l) / 2)} 0 0 1 ${r2(r)} ${r2(y - mvH + (r - l) / 2)} V${r2(y)} `;
    }
    shapes.push({ t: "path", part: "microvilli", d: mv.trim(), fill: C.epi, stroke: C.line, width: 1.6 });
    shapes.push({ t: "path", part: "nucleus", d: ellipse({ x: cx0 + cw / 2, y: y + ch * 0.72 }, cw * 0.24, ch * 0.13, 0), fill: C.epiNuc, stroke: C.line, width: 1.6 });
    let mito = "";
    for (const [fx, fy, rot] of [[0.3, 0.2, 0.4], [0.68, 0.28, -0.5], [0.4, 0.42, -0.2], [0.72, 0.5, 0.6]] as const) {
      mito += `${ellipse({ x: cx0 + cw * fx, y: y + ch * fy }, 8.5, 4.2, rot)} `;
    }
    shapes.push({ t: "path", part: "mitochondria", d: mito.trim(), fill: C.mito, stroke: "#c2410c", width: 1.4 });
  }
  return {
    microvilli: { x: x + cw * 2.5, y: y - mvH * 0.55 },
    mitochondria: { x: x + cw * 2 + cw * 0.72, y: y + ch * 0.5 },
    nucleus: { x: x + cw * 2.5 + cw * 0.12, y: y + ch * 0.72 },
  };
}

const PARTS: Array<{ id: string; name: string }> = [
  { id: "epithelium", name: "Epithelium (one cell thick)" },
  { id: "microvilli", name: "Microvilli" },
  { id: "capillary", name: "Capillary network" },
  { id: "lacteal", name: "Lacteal" },
  { id: "arteriole", name: "Arteriole" },
  { id: "venule", name: "Venule" },
  { id: "goblet-cell", name: "Goblet cell (secretes mucus)" },
  { id: "mitochondria", name: "Mitochondria" },
  { id: "nucleus", name: "Nucleus" },
];

export const villus: FigureComponent = {
  name: "villus",
  title: "A villus of the small intestine in section: epithelium one cell thick with microvilli, capillary network, lacteal, arteriole and venule",
  params: `count (1–3 villi side by side; default 1). inset (true/false: a magnified view of the epithelial cells with microvilli and mitochondria beside a single villus; default true when count is 1).`,
  match: /(?<!\b(chorionic|placental|arachnoid) )\bvill(us|i)\b|\b(ileum|small intestine)\b(?=[\s\S]{0,160}\b(absor\w*|surface area|lacteal|microvilli)\b)|\babsor\w*\b(?=[\s\S]{0,120}\b(ileum|small intestine)\b)|\blacteals?\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const count = countOf(params.count ?? params.villi);
    const inset = count === 1 && boolOf(params.inset, true);
    const shapes: FigureShape[] = [];
    const ys = 312, yArt = 344, yVen = 366, yLym = 392, yBottom = 412;
    const pitch = 182;
    const hwBase = 70, hwTop = 62, top = 26;
    const blockW = inset ? 340 : Math.max(560, count * pitch + 60);
    const x0 = 6, x1 = blockW - 6;
    const first = (blockW - (count - 1) * pitch) / 2;
    const villi: Villus[] = Array.from({ length: count }, (_, i) => ({ cx: first + i * pitch, hwBase, hwTop, top }));
    // Base vessels run along the bottom of the block, feeding and draining every villus.
    const wallOut = wall(shapes, x0, x1, ys, yBottom, villi);
    shapes.push({ t: "path", part: "lacteal", d: `M${x0} ${yLym - 7} H${x1} V${yLym + 7} H${x0} Z`, fill: C.lacteal, stroke: C.lactealLine, width: 1.8 });
    const vs = villi.map((v) => villusVessels(shapes, v, ys, yArt, yVen, yLym - 6));
    shapes.push({ t: "path", part: "arteriole", d: `M${x0} ${yArt} H${x1}`, stroke: C.art, width: 5, fill: "none" });
    shapes.push({ t: "path", part: "venule", d: `M${x0} ${yVen} H${x1}`, stroke: C.ven, width: 5.5, fill: "none" });
    // Close the block's cut ends.
    shapes.push({ t: "path", d: `M${x0} ${ys} V${yBottom} H${x1} V${ys}`, stroke: C.line, width: 1.8, fill: "none" });
    const anchors: Anchors = {};
    const L = vs[0], R = vs[vs.length - 1], vL = villi[0], vR = villi[villi.length - 1];
    const sideAt = (v: Villus, left: boolean, yy: number): Sample | undefined =>
      wallOut.samples.find((q) => Math.abs(q.p.y - yy) < 2 && (left ? q.p.x < v.cx && q.p.x > v.cx - v.hwBase - 4 : q.p.x > v.cx && q.p.x < v.cx + v.hwBase + 4));
    const epiQ = sideAt(vL, true, top + hwTop + 24);
    if (epiQ) anchors.epithelium = off(epiQ, wallOut.et * 0.5);
    anchors.lacteal = L.lacteal;
    anchors.arteriole = L.arteriole;
    if (wallOut.anchors["goblet-cell"]) anchors["goblet-cell"] = wallOut.anchors["goblet-cell"];
    let w = blockW;
    if (inset) {
      // Left-hand labels for the villus; the magnified cells take the right margin.
      anchors.capillary = L.capillaryLeft;
      anchors.venule = { x: x0 + 20, y: yVen };
      anchors.arteriole = { x: x0 + 20, y: yArt };
      const ix = 400, iy = 92, cw = 62, ch = 150;
      const zq = sideAt(vR, false, top + hwTop + 30);
      if (zq) {
        const zc = off(zq, 2);
        shapes.push({ t: "path", d: `M${r2(zc.x - 12)} ${r2(zc.y - 14)} h24 v28 h-24 Z`, fill: "none", stroke: "muted", width: 1.6, dash: "4 3" });
        shapes.push({ t: "path", d: `M${r2(zc.x + 12)} ${r2(zc.y - 14)} L${ix} ${iy - 22} M${r2(zc.x + 12)} ${r2(zc.y + 14)} L${ix} ${iy + ch}`, fill: "none", stroke: "muted", width: 1.6, dash: "4 3" });
      }
      Object.assign(anchors, epitheliumInset(shapes, ix, iy, cw, ch));
      w = ix + 3 * cw + 16;
    } else {
      const mq = sideAt(vR, false, top + hwTop + 40);
      if (mq) anchors.microvilli = { x: mq.p.x - mq.n.x * 3, y: mq.p.y - mq.n.y * 3 };
      anchors.capillary = R.capillaryRight;
      anchors.venule = R.venule;
    }
    const parts: FigurePart[] = PARTS.filter((p) => anchors[p.id]).map((p) => ({ id: p.id, name: p.name, anchor: { x: r2(anchors[p.id].x), y: r2(anchors[p.id].y) } }));
    return { w: Math.max(560, Math.min(760, w)), h: 420, shapes: mergeRuns(keepParts(shapes, parts.map((p) => p.id))), parts };
  },
};
