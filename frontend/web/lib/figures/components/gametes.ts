import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { r2, rng, smoothClosed, smoothOpen } from "./bioDraw";

/**
 * HUMAN GAMETES. The sperm cell drawn head-up: the acrosome (a cap of digestive enzymes) over the
 * haploid nucleus, the midpiece packed with a spiral of mitochondria, and the flagellum. The egg
 * cell: the jelly coat round the cell membrane, cytoplasm holding energy stores (yolk droplets),
 * and the haploid nucleus. Side by side they are drawn at different magnifications (a human egg is
 * about 0.1 mm across, a sperm head about 5 µm long), which a note under the figure says.
 */

type Show = "sperm" | "egg" | "both";
const showOf = (v: unknown): Show => {
  const s = String(v ?? "").toLowerCase();
  const sperm = /sperm|male/.test(s), egg = /egg|ov(um|a)|female|oocyte/.test(s);
  return sperm && !egg ? "sperm" : egg && !sperm ? "egg" : "both";
};

const C = { acrosome: "#bbf7d0", acrosomeEdge: "#16a34a", nucleus: "#c4b5fd", head: "#e0f2fe", mid: "#fef3c7", mito: "#fca5a5", mitoEdge: "#dc2626", jelly: "#bae6fd", cyto: "#fef3c7", yolk: "#fbbf24", yolkEdge: "#d97706" } as const;

/** Points round an ellipse rotated by `rot` (radians). */
const ellipsePts = (c: Pt, rx: number, ry: number, rot = 0, n = 10): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, x = rx * Math.cos(a), y = ry * Math.sin(a);
    return { x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) };
  });

/** The sperm, head up, its top at `top`, scaled by k; `side` says which edge each anchor sits on. */
function sperm(cx: number, top: number, k: number, side: (id: string) => 1 | -1, tail: number): { shapes: FigureShape[]; parts: FigurePart[] } {
  const shapes: FigureShape[] = [];
  const parts: FigurePart[] = [];
  const P = (dx: number, dy: number): Pt => ({ x: cx + dx * k, y: top + dy * k });
  const mirror = (half: Array<[number, number]>): Pt[] => [...half.map(([x, y]) => P(x, y)), ...half.slice(1, -1).reverse().map(([x, y]) => P(-x, y))];
  // Head: a flattened oval, a little pointed at the front, narrowing to the neck.
  const head = mirror([[0, 0], [20, 8], [30, 34], [30, 62], [22, 90], [9, 106], [0, 110]]);
  shapes.push({ t: "path", d: smoothClosed(head), fill: C.head, stroke: "ink", width: 2.2 });
  // Acrosome: the cap over the front of the nucleus.
  const acro = mirror([[0, 4], [17, 10], [26, 30], [25, 44], [12, 34], [0, 31]]);
  shapes.push({ t: "path", d: smoothClosed(acro), fill: C.acrosome, stroke: C.acrosomeEdge, width: 2, part: "acrosome" });
  // Haploid nucleus: large and condensed, filling most of the head.
  shapes.push({ t: "path", d: smoothClosed(ellipsePts(P(0, 68), 22 * k, 33 * k)), fill: C.nucleus, stroke: "ink", width: 2, part: "sperm-nucleus" });
  // Midpiece: a short cylinder wrapped in a spiral of mitochondria.
  const m0 = 108, m1 = 196, mw = 13;
  shapes.push({ t: "path", d: `M${r2(cx - mw * k)} ${r2(top + (m0 + 4) * k)} Q${r2(cx)} ${r2(top + (m0 - 2) * k)} ${r2(cx + mw * k)} ${r2(top + (m0 + 4) * k)} V${r2(top + (m1 - 4) * k)} Q${r2(cx)} ${r2(top + (m1 + 4) * k)} ${r2(cx - mw * k)} ${r2(top + (m1 - 4) * k)} Z`, fill: C.mid, stroke: "ink", width: 2.2, part: "midpiece" });
  const mitoYs: number[] = [];
  for (let y = m0 + 14; y <= m1 - 10; y += 12) mitoYs.push(y);
  mitoYs.forEach((y, i) => shapes.push({ t: "path", d: smoothClosed(ellipsePts(P(0, y), 10.5 * k, 4.2 * k, i % 2 ? 0.42 : -0.42)), fill: C.mito, stroke: C.mitoEdge, width: 1.6, part: "mitochondria" }));
  // Flagellum: a tapering wave.
  const wave: Pt[] = [];
  for (let s = 0; s <= 1.0001; s += 0.025) wave.push({ x: cx + Math.sin(s * Math.PI * 2.6) * (4 + 24 * s) * k, y: top + (m1 + 2) * k + s * tail });
  shapes.push({ t: "path", d: smoothOpen(wave), stroke: "ink", width: 2.6, fill: "none", part: "flagellum" });

  const at = (id: string, name: string, dx: number, dy: number) => parts.push({ id, name, anchor: { x: r2(cx + side(id) * dx * k), y: r2(top + dy * k) } });
  at("acrosome", "Acrosome (enzymes)", 18, 20);
  at("sperm-nucleus", "Haploid nucleus", 19, 72);
  at("midpiece", "Midpiece", mw, m0 + 9);
  const mid = mitoYs[Math.floor(mitoYs.length * 0.6)] ?? m0 + 50;
  at("mitochondria", "Mitochondria", 6, mid);
  // The flagellum's anchor on its wave, on the chosen side's crest.
  const crest = wave.reduce((b, p) => (side("flagellum") * (p.x - cx) > side("flagellum") * (b.x - cx) && p.y < top + (m1 + 2) * k + tail * 0.75 ? p : b), wave[0]);
  parts.push({ id: "flagellum", name: "Flagellum (tail)", anchor: { x: r2(crest.x), y: r2(crest.y) } });
  return { shapes, parts };
}

/** The egg cell centred at c with jelly-coat radius R. */
function egg(c: Pt, R: number, balanced = false): { shapes: FigureShape[]; parts: FigurePart[] } {
  const shapes: FigureShape[] = [];
  const parts: FigurePart[] = [];
  const rm = R * 0.84; // the cell membrane inside its jelly coat
  shapes.push({ t: "circle", cx: c.x, cy: c.y, r: R, fill: C.jelly, stroke: "muted", width: 1.8, opacity: 0.55, part: "jelly-coat" });
  shapes.push({ t: "circle", cx: c.x, cy: c.y, r: rm, fill: C.cyto, stroke: "none", part: "cytoplasm" });
  shapes.push({ t: "circle", cx: c.x, cy: c.y, r: rm, fill: "none", stroke: "ink", width: 2.4, part: "egg-membrane" });
  const nuc = { x: c.x - rm * 0.12, y: c.y - rm * 0.06 }, nr = rm * 0.27;
  shapes.push({ t: "circle", cx: r2(nuc.x), cy: r2(nuc.y), r: r2(nr), fill: C.nucleus, stroke: "ink", width: 2.2, part: "egg-nucleus" });
  // Yolk droplets scattered through the cytoplasm, clear of the nucleus and of the leaders' paths.
  const anchors = { nucleus: { x: nuc.x + nr - 4, y: nuc.y }, cytoplasm: { x: c.x + rm * 0.5, y: c.y + rm * 0.42 } };
  const rand = rng(7);
  const drops: Array<{ x: number; y: number; r: number }> = [];
  for (let tries = 0; tries < 900 && drops.length < 34; tries++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (rm - 14), r = 4.5 + rand() * 3.5;
    const p = { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
    if (Math.hypot(p.x - nuc.x, p.y - nuc.y) < nr + r + 8) continue;
    if (drops.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < q.r + r + 7)) continue;
    // Leave a clear lane to the right of the nucleus and of the cytoplasm anchor for their leaders.
    if (p.x > anchors.nucleus.x - 4 && Math.abs(p.y - anchors.nucleus.y) < r + 9) continue;
    if (p.x > anchors.cytoplasm.x - 12 && Math.abs(p.y - anchors.cytoplasm.y) < r + 12) continue;
    drops.push({ ...p, r });
  }
  for (const q of drops) shapes.push({ t: "circle", cx: r2(q.x), cy: r2(q.y), r: r2(q.r), fill: C.yolk, stroke: C.yolkEdge, width: 1.6, opacity: 0.85, part: "yolk" });
  // The yolk anchor on the droplet nearest the egg's upper right.
  const target = { x: c.x + rm * 0.6, y: c.y - rm * 0.5 };
  const yolk = drops.reduce((b, q) => (Math.hypot(q.x - target.x, q.y - target.y) < Math.hypot(b.x - target.x, b.y - target.y) ? q : b), drops[0] ?? { x: target.x, y: target.y, r: 5 });
  const ang = (deg: number, r: number): Pt => ({ x: r2(c.x + Math.cos((deg * Math.PI) / 180) * r), y: r2(c.y + Math.sin((deg * Math.PI) / 180) * r) });
  // Drawn alone, the outer layers are labelled on the left so the labels balance.
  parts.push({ id: "jelly-coat", name: "Jelly coat", anchor: ang(balanced ? 218 : -38, (R + rm) / 2) });
  parts.push({ id: "egg-membrane", name: "Cell membrane", anchor: ang(balanced ? 160 : -12, rm) });
  parts.push({ id: "yolk", name: "Energy store (yolk droplets)", anchor: { x: r2(yolk.x + yolk.r * 0.5), y: r2(yolk.y) } });
  parts.push({ id: "egg-nucleus", name: "Haploid nucleus", anchor: { x: r2(anchors.nucleus.x), y: r2(anchors.nucleus.y) } });
  parts.push({ id: "cytoplasm", name: "Cytoplasm", anchor: { x: r2(anchors.cytoplasm.x), y: r2(anchors.cytoplasm.y) } });
  return { shapes, parts };
}

export const gametes: FigureComponent = {
  name: "gametes",
  title: "Human gametes: a sperm cell (acrosome, haploid nucleus, midpiece of mitochondria, flagellum) and an egg cell (jelly coat, cell membrane, cytoplasm with energy stores, haploid nucleus)",
  params: `show ("both" default: sperm and egg side by side, not to scale, with a note of their real sizes | "sperm" | "egg").`,
  match: /\bgametes?\b|\bsperm (cells?|structure)\b|\begg cells?\b|\bova\b|\bovum\b|\bacrosome\b|\bspermatozo(a|on)\b|\bsperm\b(?=[\s\S]{0,120}\b(egg|ovum|flagellum|midpiece|acrosome|haploid|adapt\w*)\b)|\b(male|female) sex cells?\b/i,
  parts: [
    { id: "acrosome", name: "Acrosome (enzymes)" },
    { id: "sperm-nucleus", name: "Haploid nucleus" },
    { id: "midpiece", name: "Midpiece" },
    { id: "mitochondria", name: "Mitochondria" },
    { id: "flagellum", name: "Flagellum (tail)" },
    { id: "jelly-coat", name: "Jelly coat" },
    { id: "egg-membrane", name: "Cell membrane" },
    { id: "cytoplasm", name: "Cytoplasm" },
    { id: "yolk", name: "Energy store (yolk droplets)" },
    { id: "egg-nucleus", name: "Haploid nucleus" },
  ],
  build(params: FigureParams) {
    const show = showOf(params.show ?? params.cell ?? params.view);
    if (show === "sperm") {
      // Alone, the sperm is drawn larger and labelled on both sides.
      const right = new Set(["sperm-nucleus", "mitochondria"]);
      const s = sperm(280, 14, 1.05, (id) => (right.has(id) ? 1 : -1), 220);
      return { w: 560, h: 450, shapes: s.shapes, parts: s.parts };
    }
    if (show === "egg") {
      const e = egg({ x: 280, y: 222 }, 210, true);
      return { w: 560, h: 444, shapes: e.shapes, parts: e.parts };
    }
    const s = sperm(100, 16, 1, () => -1, 204);
    const e = egg({ x: 492, y: 206 }, 182);
    const note: FigureShape = { t: "text", x: 690, y: 438, text: "Not to scale: egg ≈ 0.1 mm across; sperm head ≈ 0.005 mm long", size: 15, anchor: "end", fill: "muted" };
    return { w: 700, h: 450, shapes: [...s.shapes, ...e.shapes, note], parts: [...s.parts, ...e.parts] };
  },
};
