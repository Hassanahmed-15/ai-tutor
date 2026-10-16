import type { FigureComponent, FigurePart, FigureParams, FigureShape, Pt } from "../types";
import { arrowShapes, r2, smoothClosed, smoothOpen } from "./bioDraw";
import { bool } from "./mathsKit";

/**
 * A WIND-POLLINATED FLOWER (a grass floret), as the O/A Level textbook draws it to contrast with an
 * insect-pollinated flower: no petals (small green bracts instead — no colour, scent or nectar), long
 * flexible filaments that hang the large anthers OUTSIDE the flower to shake pollen into the wind,
 * and large feathery stigmas, also outside, to catch pollen from the air. The ovary sits at the base
 * between the bracts. With showPollen, small light smooth pollen grains drift from an anther.
 */

const W = 640, H = 440;
const C = {
  bract: "#bbf7d0",
  vein: "#166534",
  ovary: "#fde68a",
  anther: "#facc15",
  pollen: "#fef08a",
  wind: "#64748b",
} as const;
/** Outlines inside pale fills: a fixed dark that stays dark on the chalkboard too. */
const DARK = "#374151";

const P = (p: Pt) => `${r2(p.x)} ${r2(p.y)}`;

/** A pointed leaf-like bract from base to tip, bulging to one side by `bulge` (the other side less). */
function bract(base: Pt, tip: Pt, bulge: number): string {
  const L = Math.hypot(tip.x - base.x, tip.y - base.y) || 1, nx = -(tip.y - base.y) / L, ny = (tip.x - base.x) / L;
  const at = (t: number, off: number) => ({ x: base.x + (tip.x - base.x) * t + nx * off, y: base.y + (tip.y - base.y) * t + ny * off });
  return smoothClosed([at(0, -bulge * 0.3), at(0.35, -bulge * 0.42), at(0.75, -bulge * 0.22), at(1, 0), at(0.75, bulge * 0.5), at(0.35, bulge * 0.8), at(0, bulge * 0.45)], 0.9);
}

/** Points along a smooth open curve through `pts` (Catmull-Rom), for barbs and anchors. */
function sample(pts: Pt[], n: number): Pt[] {
  const out: Pt[] = [];
  const seg = pts.length - 1;
  for (let k = 0; k <= n; k++) {
    const f = Math.min(seg - 1e-6, (k / n) * seg), i = Math.floor(f), t = f - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(seg, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
    out.push({ x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) });
  }
  return out;
}

/** A feathery stigma: an axis with fine branches on both sides, longest near the base. */
function featheryStigma(axis: Pt[]): FigureShape[] {
  const pts = sample(axis, 40);
  const barbs: string[] = [];
  for (let k = 13; k < pts.length - 1; k++) {
    const a = pts[k - 1], b = pts[k + 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L, nx = -dy, ny = dx;
    const len = 17 - (k / pts.length) * 9;
    for (const s of [1, -1]) {
      // Each branch leans towards the stigma's tip, curving slightly.
      const end = { x: pts[k].x + (nx * s * 0.8 + dx * 0.6) * len, y: pts[k].y + (ny * s * 0.8 + dy * 0.6) * len };
      const mid = { x: pts[k].x + nx * s * len * 0.5 + dx * len * 0.15, y: pts[k].y + ny * s * len * 0.5 + dy * len * 0.15 };
      barbs.push(`M${P(pts[k])} Q${P(mid)} ${P(end)}`);
    }
  }
  return [
    { t: "path", d: barbs.join(" "), fill: "none", stroke: "ink", width: 1.2, part: "stigma" },
    { t: "path", d: smoothOpen(axis), fill: "none", stroke: "ink", width: 2.2, part: "stigma" },
  ];
}

/** A grass anther: two long pollen sacs side by side, hanging from the filament at its middle. */
function anther(top: Pt, len: number, tilt: number): FigureShape[] {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const at = (x: number, y: number): Pt => ({ x: top.x + x * c - y * s, y: top.y + x * s + y * c });
  const sac = (dx: number) => smoothClosed([at(dx, -4), at(dx + 6, len * 0.2), at(dx + 6.5, len * 0.6), at(dx + 3, len), at(dx - 1, len * 0.9), at(dx - 1.5, len * 0.4)], 0.9);
  return [
    { t: "path", d: sac(-6), fill: C.anther, stroke: "ink", width: 1.8, part: "anther" },
    { t: "path", d: sac(1), fill: C.anther, stroke: "ink", width: 1.8, part: "anther" },
  ];
}

export const windFlower: FigureComponent = {
  name: "windFlower",
  title: "Wind-pollinated flower (grass): no petals, small green bracts, long filaments hanging the anthers outside the flower, large feathery stigmas outside to catch pollen, the ovary at the base",
  params: `showPollen (true default: small, light, smooth pollen grains blowing from an anther in the wind | false: the flower alone).`,
  match: /\bwind[- ]pollinat\w*\b|\bpollinat\w* by (?:the )?wind\b|\banemophil\w*\b|\bgrass (?:flower|floret)s?\b|\bfeathery stigmas?\b/i,
  parts: [
    { id: "anther", name: "Anther (hangs outside)" },
    { id: "filament", name: "Long filament" },
    { id: "stigma", name: "Feathery stigma" },
    { id: "ovary", name: "Ovary" },
    { id: "bract", name: "Bract (no petals)" },
    { id: "pollen", name: "Pollen (small, light, smooth)" },
    { id: "wind", name: "Wind carries pollen" },
  ],
  build(params: FigureParams) {
    const showPollen = bool(params?.showPollen ?? params?.pollen, true);
    const shapes: FigureShape[] = [];
    const ov = { x: 320, y: 318 };

    // Stalk and the bracts: two small lower bracts (glumes) and the two that enclose the flower.
    shapes.push({ t: "path", d: `M${ov.x} ${H - 8} Q${ov.x - 4} ${ov.y + 70} ${ov.x} ${ov.y + 30}`, fill: "none", stroke: "ink", width: 7, part: "bract" });
    shapes.push({ t: "path", d: `M${ov.x} ${H - 8} Q${ov.x - 4} ${ov.y + 70} ${ov.x} ${ov.y + 30}`, fill: "none", stroke: C.bract, width: 3.5, part: "bract" });
    const bracts: Array<[Pt, Pt, number]> = [
      [{ x: ov.x - 2, y: ov.y + 66 }, { x: ov.x - 60, y: ov.y - 10 }, -16],
      [{ x: ov.x + 2, y: ov.y + 66 }, { x: ov.x + 58, y: ov.y - 4 }, 16],
      [{ x: ov.x - 2, y: ov.y + 40 }, { x: ov.x - 52, y: ov.y - 110 }, -24],
      [{ x: ov.x + 2, y: ov.y + 40 }, { x: ov.x + 46, y: ov.y - 96 }, 22],
    ];
    for (const [b, t, bulge] of bracts) {
      shapes.push({ t: "path", d: bract(b, t, bulge), fill: C.bract, stroke: "ink", width: 1.8, part: "bract" });
      shapes.push({ t: "path", d: `M${P(b)} Q${P({ x: (b.x + t.x) / 2 + bulge * 0.15, y: (b.y + t.y) / 2 })} ${P(t)}`, fill: "none", stroke: C.vein, width: 1.2, opacity: 0.7, part: "bract" });
    }

    // The ovary at the base of the flower, between the bracts.
    shapes.push({ t: "path", d: smoothClosed([{ x: ov.x, y: ov.y - 24 }, { x: ov.x + 15, y: ov.y - 8 }, { x: ov.x + 13, y: ov.y + 12 }, { x: ov.x, y: ov.y + 20 }, { x: ov.x - 13, y: ov.y + 12 }, { x: ov.x - 15, y: ov.y - 8 }], 0.95), fill: C.ovary, stroke: DARK, width: 1.8, part: "ovary" });

    // Two large feathery stigmas, out of the flower and up into the air.
    const leftAxis: Pt[] = [{ x: ov.x - 4, y: ov.y - 22 }, { x: ov.x - 16, y: ov.y - 90 }, { x: ov.x - 58, y: ov.y - 170 }, { x: ov.x - 120, y: ov.y - 228 }, { x: ov.x - 160, y: ov.y - 262 }];
    const rightAxis: Pt[] = [{ x: ov.x + 4, y: ov.y - 22 }, { x: ov.x + 14, y: ov.y - 92 }, { x: ov.x + 52, y: ov.y - 176 }, { x: ov.x + 110, y: ov.y - 236 }, { x: ov.x + 150, y: ov.y - 268 }];
    shapes.push(...featheryStigma(leftAxis), ...featheryStigma(rightAxis));

    // Three stamens: long, thin, flexible filaments arching out of the flower, the anthers dangling
    // outside it where the wind shakes them.
    const stamens: Array<{ path: Pt[]; tilt: number; len: number }> = [
      { path: [{ x: ov.x - 6, y: ov.y + 14 }, { x: ov.x - 30, y: ov.y - 50 }, { x: ov.x - 96, y: ov.y - 84 }, { x: ov.x - 150, y: ov.y - 60 }, { x: ov.x - 168, y: ov.y - 20 }], tilt: 0.12, len: 62 },
      { path: [{ x: ov.x + 6, y: ov.y + 14 }, { x: ov.x + 30, y: ov.y - 46 }, { x: ov.x + 100, y: ov.y - 76 }, { x: ov.x + 150, y: ov.y - 52 }, { x: ov.x + 164, y: ov.y - 12 }], tilt: -0.1, len: 62 },
      { path: [{ x: ov.x - 2, y: ov.y + 16 }, { x: ov.x - 50, y: ov.y + 4 }, { x: ov.x - 96, y: ov.y + 16 }, { x: ov.x - 110, y: ov.y + 50 }], tilt: 0.05, len: 56 },
    ];
    const antherTops: Pt[] = [];
    for (const st of stamens) {
      shapes.push({ t: "path", d: smoothOpen(st.path), fill: "none", stroke: "ink", width: 2, part: "filament" });
      const end = st.path[st.path.length - 1];
      antherTops.push(end);
      shapes.push(...anther({ x: end.x, y: end.y - 8 }, st.len, st.tilt));
    }

    const parts: FigurePart[] = [];
    if (showPollen) {
      // Small, light, smooth grains blowing away from the right-hand anther.
      const a = antherTops[1];
      const grains: Pt[] = [[34, 6], [52, -16], [70, 10], [88, -28], [104, -4], [120, -40], [136, -16], [60, 40], [96, 30]].map(([dx, dy]) => ({ x: a.x + dx, y: a.y + 30 + dy }));
      for (const g of grains) shapes.push({ t: "circle", cx: r2(g.x), cy: r2(g.y), r: 4.5, fill: C.pollen, stroke: "ink", width: 1.3, part: "pollen" });
      // The wind: a soft arrow blowing across, past the anthers.
      const wf = { x: a.x - 6, y: a.y + 104 }, wt = { x: W - 14, y: a.y + 64 };
      shapes.push(...arrowShapes(wf, wt, C.wind, 2.4, "wind", { head: 13, bend: -14, dash: "8 6" }));
      parts.push(
        { id: "pollen", name: "Pollen (small, light, smooth)", anchor: { x: r2(grains[5].x), y: r2(grains[5].y) } },
        { id: "wind", name: "Wind carries pollen", anchor: { x: r2(wt.x - 30), y: r2(wt.y + 3) } },
      );
    }
    const fl = sample(stamens[0].path, 10)[6];
    const sg = sample(leftAxis, 20)[15];
    parts.unshift(
      { id: "anther", name: "Anther (hangs outside)", anchor: { x: r2(antherTops[0].x - 2), y: r2(antherTops[0].y + 28) } },
      { id: "filament", name: "Long filament", anchor: { x: r2(fl.x), y: r2(fl.y) } },
      { id: "stigma", name: "Feathery stigma", anchor: { x: r2(sg.x), y: r2(sg.y) } },
      { id: "ovary", name: "Ovary", anchor: { x: ov.x + 7, y: ov.y + 2 } },
      { id: "bract", name: "Bract (no petals)", anchor: { x: ov.x + 40, y: ov.y + 22 } },
    );
    return { w: W, h: H, shapes, parts };
  },
};
