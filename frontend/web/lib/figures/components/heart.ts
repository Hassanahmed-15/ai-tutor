import type { FigureComponent, FigureParams, FigurePart, FigureShape, Ink, Pt } from "../types";
import { arrowShapes, r2, roundedPoly, smoothClosed } from "./bioDraw";

/**
 * THE HUMAN HEART IN FRONTAL SECTION, as the Cambridge O/A Level textbooks draw it (the heart's
 * right on the student's left). One muscular wall encloses the four chambers; the septum is the
 * wall between the right and left sides, and the left ventricle's wall is far thicker than the
 * right's. Each ventricle runs up into its artery (pulmonary artery from the right, aorta from the
 * left, each with its semilunar valve); the venae cavae open into the right atrium and the pulmonary
 * veins into the left atrium. The atrioventricular valves (tricuspid, bicuspid) hang into the
 * ventricles on their tendons. A coronary artery leaves the base of the aorta and runs over the
 * heart's surface. Deoxygenated blood (right side) is blue, oxygenated (left side) red.
 */

type Side = "both" | "left" | "right";

function sideOf(v: unknown): Side {
  const s = String(v ?? "").toLowerCase();
  if (/\bright\b/.test(s) && !/\bleft\b/.test(s)) return "right";
  if (/\bleft\b/.test(s) && !/\bright\b/.test(s)) return "left";
  return "both";
}
function boolOf(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    if (/^(true|yes|on|1|show)$/i.test(v.trim())) return true;
    if (/^(false|no|off|0|hide|none)$/i.test(v.trim())) return false;
  }
  return fallback;
}

/** Colours: chambers and vessels by the blood they hold; outlines a fixed dark grey (stays dark on chalk inside pale fills). */
export const HEART_COLOURS = {
  deoxy: "#7fb2f5",
  oxy: "#f58f8f",
  muscle: "#f7d3c6",
  line: "#374151",
  valve: "#fffbeb",
  chord: "#f8fafc",
  // Not re-tinted on chalk on purpose: the artery lies on the pale muscle, where a chalk pastel vanished.
  coronary: "#e11d48",
  coronaryEdge: "#881337",
  highlight: "#d97706",
} as const;
const C = HEART_COLOURS;

const W = 680, H = 460;

/** A colour mixed toward white (k = 0 unchanged, 1 white): the faded side stays opaque, so hidden vessel ends stay hidden. */
function wash(colour: Ink | "none" | undefined, k: number): Ink | "none" | undefined {
  if (!colour || colour === "none" || !colour.startsWith("#") || colour.length !== 7) return colour === "ink" ? "#c7ccd4" : colour;
  const ch = (i: number) => Math.round(parseInt(colour.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, "0");
  return `#${ch(1)}${ch(3)}${ch(5)}`;
}
const pt = (x: number, y: number): Pt => ({ x, y });

/** Dense points along a Catmull-Rom curve through `pts`. */
function curve(pts: Pt[], per = 14): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 1; k <= per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

/** Points round an arc (degrees, y down). */
function arc(c: Pt, r: number, from: number, to: number, n: number): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/**
 * A vessel as a closed outline: the smooth centreline through `route`, `width` wide (optionally
 * tapering to `endWidth`), with flat cut ends. A closed outline (not a wide stroke) so a focused
 * vessel only thickens its edge.
 */
function ribbonD(route: Pt[], width: number, endWidth = width): string {
  const c = curve(route, 16);
  const n = c.length;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const w = (width + (endWidth - width) * (i / Math.max(1, n - 1))) / 2;
    left.push({ x: c[i].x + nx * w, y: c[i].y + ny * w });
    right.push({ x: c[i].x - nx * w, y: c[i].y - ny * w });
  }
  const all = [...left, ...right.reverse()];
  return `M${all.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L")} Z`;
}

/** A valve cusp: a tapered flap from its base on the wall (a→b) to a free tip. */
function cuspD(a: Pt, b: Pt, tip: Pt, bulge = 0): string {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = tip.x - m.x, dy = tip.y - m.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const c1 = { x: a.x + dx * 0.55 + nx * bulge, y: a.y + dy * 0.55 + ny * bulge };
  const c2 = { x: b.x + dx * 0.55 + nx * bulge, y: b.y + dy * 0.55 + ny * bulge };
  return `M${r2(a.x)} ${r2(a.y)} Q${r2(c1.x)} ${r2(c1.y)} ${r2(tip.x)} ${r2(tip.y)} Q${r2(c2.x)} ${r2(c2.y)} ${r2(b.x)} ${r2(b.y)} Z`;
}

/** A semilunar cusp: a small pocket on the artery wall, its open mouth facing up (away from the ventricle). */
function pocketD(wallX: number, top: number, depth: number, dir: 1 | -1): string {
  const bottom = top + depth * 1.25;
  return `M${r2(wallX)} ${r2(top)} C${r2(wallX + dir * 2)} ${r2(bottom)} ${r2(wallX + dir * depth)} ${r2(bottom + 2)} ${r2(wallX + dir * depth * 1.05)} ${r2(top + 2)} Q${r2(wallX + dir * depth * 0.55)} ${r2(top + depth * 0.7)} ${r2(wallX)} ${r2(top + depth * 0.95)} Z`;
}

export const heart: FigureComponent = {
  name: "heart",
  title: "Labelled frontal section of the human heart: four chambers in one muscular wall, septum, thick left-ventricle wall, venae cavae, pulmonary artery and veins, aorta, tricuspid, bicuspid and semilunar valves, tendons and a coronary artery",
  params: `side ("both" default, "left" or "right" of the HEART — the right side is drawn on the student's left; the other side is faded). highlight (optional part id to emphasise, e.g. "aorta", "left-ventricle"). arrows (true to draw the path of blood through the heart; default false). coronary (false hides the coronary artery; default true).`,
  match: /\bheart\b(?!\s+rate)(?=[\s\S]{0,240}\b(chamber|atrium|atria|ventricle|aorta|vena cava|pulmonary|valve|septum|cardiac)\b)|\b(right|left) (atrium|ventricle)\b|\baorta\b(?=[\s\S]{0,80}\b(heart|ventricle|valve)\b)|\bvessel\w* (of|from|to) the heart\b|\bheart (structure|diagram|chambers?|valves?)\b/i,
  parts: [
    { id: "right-atrium", name: "Right atrium" },
    { id: "right-ventricle", name: "Right ventricle" },
    { id: "left-atrium", name: "Left atrium" },
    { id: "left-ventricle", name: "Left ventricle" },
    { id: "septum", name: "Septum" },
    { id: "vena-cava", name: "Vena cava" },
    { id: "pulmonary-artery", name: "Pulmonary artery" },
    { id: "pulmonary-vein", name: "Pulmonary vein" },
    { id: "aorta", name: "Aorta" },
    { id: "tricuspid", name: "Tricuspid valve" },
    { id: "bicuspid", name: "Bicuspid (mitral) valve" },
    { id: "semilunar", name: "Semilunar valve" },
    { id: "aortic-valve", name: "Aortic (semilunar) valve" },
    { id: "chordae-tendineae", name: "Chordae tendineae (tendons)" },
    { id: "coronary-artery", name: "Coronary artery" },
    { id: "muscular-wall", name: "Muscular wall" },
    { id: "inferior-vena-cava", name: "Inferior vena cava" },
  ],
  build(params: FigureParams) {
    const p = params ?? {};
    const side = sideOf(p.side ?? p.highlight);
    const arrows = boolOf(p.arrows ?? p.flow, false);
    const coronary = boolOf(p.coronary ?? p.coronaryArteries, true);
    const known = new Set(heart.parts.map((q) => q.id));
    const hl = String(p.highlight ?? "").trim().toLowerCase().replace(/\s+/g, "-");
    const highlight = known.has(hl) ? hl : "";
    const dimRight = side === "left" ? 0.4 : 1, dimLeft = side === "right" ? 0.4 : 1;

    const shapes: FigureShape[] = [];
    const add = (sh: FigureShape, dim = 1) => {
      const s = { ...sh } as FigureShape;
      if (dim < 1) { s.fill = wash(s.fill, 0.62); s.stroke = wash(s.stroke, 0.55); }
      if (highlight && s.part === highlight && s.stroke && s.stroke !== "none") { s.stroke = C.highlight; s.width = Math.max(3, s.width ?? 2); }
      shapes.push(s);
    };
    const solid = (part: string | undefined, d: string, fill: Ink, dim = 1, width = 2.2, stroke: Ink = C.line) => add({ t: "path", d, fill, stroke, width, ...(part ? { part } : {}) }, dim);
    /** Lumen-coloured patch with no outline: opens a vessel or valve into its chamber (covers the outlines across the mouth). */
    const open = (d: string, fill: Ink, dim = 1) => add({ t: "path", d, fill, stroke: "none" }, dim);

    // ── Geometry (student's left = heart's right). ──
    // Right atrium, the right ventricle with its outflow up to the pulmonary artery, the septum,
    // the left ventricle with its outflow up to the aorta, and the left atrium.
    const RA = [pt(196, 214), pt(199, 186), pt(216, 169), pt(246, 165), pt(268, 178), pt(274, 212), pt(270, 244), pt(236, 254), pt(204, 246)];
    const LA = [pt(400, 212), pt(404, 182), pt(426, 167), pt(462, 165), pt(488, 178), pt(494, 212), pt(488, 244), pt(452, 254), pt(414, 248)];
    const RV = [pt(198, 270), pt(290, 270), pt(290, 156), pt(322, 156), pt(324, 270), pt(330, 330), pt(346, 398), pt(306, 400), pt(258, 386), pt(220, 360), pt(202, 326), pt(196, 296)];
    const LV = [pt(352, 156), pt(386, 156), pt(388, 270), pt(470, 270), pt(484, 290), pt(486, 336), pt(472, 380), pt(442, 414), pt(408, 428), pt(388, 420), pt(372, 374), pt(360, 322), pt(352, 270)];
    const SEPTUM = [pt(322, 154), pt(352, 154), pt(352, 270), pt(360, 322), pt(372, 374), pt(390, 422), pt(370, 420), pt(346, 398), pt(330, 330), pt(324, 270)];
    // The heart's outer surface: thin over the right side, thick over the left ventricle, apex low on the left side.
    const BODY = [
      pt(180, 214), pt(186, 176), pt(208, 155), pt(244, 150), pt(274, 156), pt(300, 146), pt(340, 144), pt(380, 146), pt(404, 154),
      pt(436, 150), pt(478, 151), pt(504, 166), pt(514, 196), pt(512, 232), pt(504, 258), pt(518, 290), pt(524, 336), pt(512, 382),
      pt(486, 420), pt(446, 446), pt(408, 456), pt(374, 446), pt(332, 420), pt(280, 408), pt(232, 392), pt(200, 366), pt(184, 330),
      pt(180, 292), pt(186, 262), pt(180, 240),
    ];

    // Vessel centrelines. Each vessel runs on into its chamber; the chamber, drawn over it, hides the
    // end, and an outline-free patch then opens the mouth (so a vessel joins its chamber, never floats).
    const aortaRoute = [pt(369, 190), pt(369, 140), pt(369, 100), ...arc(pt(416, 92), 47, 180, 360, 8).slice(1), pt(463, 130), pt(463, 168)];
    const paRoute = [pt(306, 196), pt(306, 150), pt(306, 116)];
    const rpaRoute = [pt(306, 122), pt(292, 106), pt(250, 101), pt(180, 102), pt(108, 108)];
    const lpaRoute = [pt(306, 122), pt(326, 106), pt(380, 100), pt(470, 100), pt(560, 104), pt(612, 112)];
    const svcRoute = [pt(224, 0), pt(224, 120), pt(224, 190)];
    const ivcRoute = [pt(216, 234), pt(190, 240), pt(164, 258), pt(148, 292), pt(140, 340), pt(140, 460)];
    const pv1 = [pt(462, 198), pt(530, 194), pt(600, 186), pt(680, 180)];
    const pv2 = [pt(462, 230), pt(530, 232), pt(600, 236), pt(680, 240)];

    const parts: FigurePart[] = [];

    // 1. Behind the heart: the aorta's arch and its descending part (the wall hides where it passes behind),
    // with the three arch branches to the head and arms, cut short.
    const stubs = [392, 416, 440].map((x) => {
      const dx = x - 416;
      return { x, mid: 92 - Math.sqrt(47 * 47 - dx * dx), outer: 92 - Math.sqrt(63 * 63 - dx * dx) };
    });
    for (const st of stubs) solid("aorta", ribbonD([pt(st.x, st.mid), pt(st.x, 4)], 13), C.oxy, dimLeft, 1.8);
    solid("aorta", ribbonD(aortaRoute, 32), C.oxy, dimLeft);
    for (const st of stubs) open(ribbonD([pt(st.x, st.mid), pt(st.x, st.outer - 5)], 11.2), C.oxy, dimLeft);

    // 2. The muscular wall: one continuous organ.
    solid("muscular-wall", smoothClosed(BODY), C.muscle, 1, 2.4);

    // 3. The coronary artery on the surface: from the base of the aorta, over the left atrium and
    // down the left ventricle's outer wall towards the apex, branching into the muscle.
    if (coronary) {
      const main = [pt(386, 134), pt(410, 147), pt(454, 154), pt(494, 162), pt(503, 182), pt(500, 222), pt(496, 252), pt(508, 290), pt(510, 336), pt(498, 380), pt(470, 416), pt(436, 434)];
      solid("coronary-artery", ribbonD(main, 7, 4), C.coronary, dimLeft, 1.6, C.coronaryEdge);
      for (const br of [[pt(508, 300), pt(496, 316), pt(492, 336)], [pt(503, 362), pt(488, 372), pt(484, 390)], [pt(484, 402), pt(468, 404), pt(458, 414)]]) {
        solid("coronary-artery", ribbonD(br, 4.2, 2.6), C.coronary, dimLeft, 1.6, C.coronaryEdge);
      }
    }

    // 4. Vessels in front of the wall: the pulmonary artery (in front of the aorta), the venae cavae, the pulmonary veins.
    solid("pulmonary-artery", ribbonD(rpaRoute, 22, 20), C.deoxy, dimRight);
    solid("pulmonary-artery", ribbonD(lpaRoute, 22, 20), C.deoxy, dimRight);
    solid("pulmonary-artery", ribbonD(paRoute, 32), C.deoxy, dimRight);
    open(ribbonD([pt(306, 140), pt(306, 117)], 29.8), C.deoxy, dimRight);
    open(ribbonD([pt(306, 124), pt(320, 109), pt(340, 103)], 19.4), C.deoxy, dimRight);
    open(ribbonD([pt(306, 124), pt(292, 109), pt(272, 103)], 19.4), C.deoxy, dimRight);
    solid("vena-cava", ribbonD(svcRoute, 30), C.deoxy, dimRight);
    solid("inferior-vena-cava", ribbonD(ivcRoute, 28), C.deoxy, dimRight);
    solid("pulmonary-vein", ribbonD(pv1, 20), C.oxy, dimLeft);
    solid("pulmonary-vein", ribbonD(pv2, 20), C.oxy, dimLeft);

    // 5. Chambers, and the septum between the two sides.
    solid("right-atrium", smoothClosed(RA), C.deoxy, dimRight);
    solid("left-atrium", smoothClosed(LA), C.oxy, dimLeft);
    solid("right-ventricle", roundedPoly(RV, [16, 8, 4, 4, 8, 40, 14, 30, 40, 30, 30, 20]), C.deoxy, dimRight);
    solid("left-ventricle", roundedPoly(LV, [4, 4, 8, 12, 18, 30, 30, 30, 24, 16, 40, 30, 8]), C.oxy, dimLeft);
    add({ t: "path", part: "septum", d: roundedPoly(SEPTUM, [4, 4, 8, 30, 20, 8, 6, 14, 40, 8]), fill: C.muscle, stroke: "none" });

    // 6. Open each vessel into its chamber.
    open(ribbonD([pt(369, 172), pt(369, 128)], 29.8), C.oxy, dimLeft);
    open(ribbonD([pt(306, 172), pt(306, 138)], 29.8), C.deoxy, dimRight);
    open(ribbonD([pt(224, 150), pt(224, 184)], 27.8), C.deoxy, dimRight);
    open(ribbonD([pt(212, 235), pt(186, 241)], 25.8), C.deoxy, dimRight);
    open(ribbonD([pt(482, 197), pt(504, 196)], 17.8), C.oxy, dimLeft);
    open(ribbonD([pt(482, 230), pt(504, 231)], 17.8), C.oxy, dimLeft);

    // 7. Papillary muscles (the tendons' anchors) rising from each ventricle's floor: a mound whose base
    // sinks into the wall, filled without an outline and then outlined on its two sides only.
    const papilla = (base: Pt, tip: Pt, w: number, dim: number) => {
      const l = pt(base.x - w, base.y + 18), r = pt(base.x + w, base.y + 18);
      const sides = `M${r2(l.x)} ${r2(l.y)} Q${r2(tip.x - w * 0.6)} ${r2(tip.y + 8)} ${r2(tip.x)} ${r2(tip.y)} Q${r2(tip.x + w * 0.6)} ${r2(tip.y + 8)} ${r2(r.x)} ${r2(r.y)}`;
      add({ t: "path", d: `${sides} Z`, fill: C.muscle, stroke: "none" }, dim);
      add({ t: "path", d: sides, fill: "none", stroke: C.line, width: 1.8 }, dim);
    };
    papilla(pt(236, 366), pt(240, 340), 10, dimRight);
    papilla(pt(300, 392), pt(298, 352), 10, dimRight);
    papilla(pt(406, 414), pt(408, 374), 10, dimLeft);
    papilla(pt(466, 372), pt(454, 346), 9, dimLeft);

    // 8. Atrioventricular openings and their valves, the tendons tying the cusps to the papillae.
    open(roundedPoly([pt(214, 244), pt(258, 244), pt(258, 276), pt(214, 276)], 2), C.deoxy, dimRight);
    open(roundedPoly([pt(424, 244), pt(468, 244), pt(468, 276), pt(424, 276)], 2), C.oxy, dimLeft);
    const chord = (from: Pt, to: Pt, dim: number) => add({ t: "path", part: "chordae-tendineae", d: `M${r2(from.x)} ${r2(from.y)} L${r2(to.x)} ${r2(to.y)}`, stroke: C.chord, width: 1.8, fill: "none" }, dim);
    const triTipL = pt(234, 312), triTipR = pt(252, 306);
    const biTipL = pt(434, 306), biTipR = pt(458, 312);
    for (const [a, b] of [[triTipL, pt(238, 342)], [triTipL, pt(242, 342)], [triTipR, pt(296, 354)], [triTipR, pt(300, 354)]] as const) chord(a, b, dimRight);
    for (const [a, b] of [[biTipL, pt(406, 376)], [biTipL, pt(410, 376)], [biTipR, pt(452, 348)], [biTipR, pt(456, 348)]] as const) chord(a, b, dimLeft);
    solid("tricuspid", cuspD(pt(206, 258), pt(216, 260), triTipL, -4), C.valve, dimRight, 1.8);
    solid("tricuspid", cuspD(pt(256, 260), pt(266, 258), triTipR, 4), C.valve, dimRight, 1.8);
    solid("bicuspid", cuspD(pt(416, 258), pt(426, 260), biTipL, -4), C.valve, dimLeft, 1.8);
    solid("bicuspid", cuspD(pt(466, 260), pt(476, 258), biTipR, 4), C.valve, dimLeft, 1.8);

    // 9. Semilunar valves: two pocket cusps at the base of each artery.
    solid("semilunar", pocketD(291, 146, 13, 1), C.valve, dimRight, 1.8);
    solid("semilunar", pocketD(321, 146, 13, -1), C.valve, dimRight, 1.8);
    solid("aortic-valve", pocketD(354, 146, 14, 1), C.valve, dimLeft, 1.8);
    solid("aortic-valve", pocketD(384, 146, 14, -1), C.valve, dimLeft, 1.8);

    // 10. The path of blood (optional): body → right atrium → right ventricle → lungs; lungs → left atrium → left ventricle → body.
    if (arrows) {
      const flow = (a: Pt, b: Pt, dim: number, bend = 0) => { for (const sh of arrowShapes(a, b, C.line, 2.4, undefined, { head: 11, bend })) add(sh, dim); };
      flow(pt(224, 64), pt(224, 102), dimRight);
      flow(pt(140, 456), pt(140, 414), dimRight);
      flow(pt(243, 186), pt(243, 300), dimRight);
      flow(pt(270, 360), pt(300, 300), dimRight, -10);
      flow(pt(306, 246), pt(306, 186), dimRight);
      flow(pt(204, 102), pt(166, 103), dimRight);
      flow(pt(510, 103), pt(570, 107), dimRight);
      flow(pt(600, 186), pt(546, 192), dimLeft);
      flow(pt(600, 236), pt(546, 233), dimLeft);
      flow(pt(446, 186), pt(446, 300), dimLeft);
      flow(pt(420, 380), pt(372, 290), dimLeft, 10);
      flow(pt(369, 232), pt(369, 180), dimLeft);
      flow(pt(463, 112), pt(463, 150), dimLeft);
    }

    parts.push(
      { id: "right-atrium", name: "Right atrium", anchor: pt(222, 204) },
      { id: "right-ventricle", name: "Right ventricle", anchor: pt(212, 318) },
      { id: "left-atrium", name: "Left atrium", anchor: pt(468, 214) },
      { id: "left-ventricle", name: "Left ventricle", anchor: pt(470, 300) },
      { id: "septum", name: "Septum", anchor: pt(340, 300) },
      { id: "vena-cava", name: "Vena cava", anchor: pt(224, 52) },
      { id: "pulmonary-artery", name: "Pulmonary artery", anchor: pt(134, 105) },
      { id: "pulmonary-vein", name: "Pulmonary vein", anchor: pt(636, 183) },
      { id: "aorta", name: "Aorta", anchor: pt(440, 52) },
      { id: "tricuspid", name: "Tricuspid valve", anchor: pt(214, 274) },
      { id: "bicuspid", name: "Bicuspid (mitral) valve", anchor: pt(470, 274) },
      { id: "semilunar", name: "Semilunar valve", anchor: pt(294, 156) },
      { id: "aortic-valve", name: "Aortic (semilunar) valve", anchor: pt(381, 156) },
      { id: "chordae-tendineae", name: "Chordae tendineae (tendons)", anchor: pt(425, 331) },
      ...(coronary ? [{ id: "coronary-artery", name: "Coronary artery", anchor: pt(510, 320) }] : []),
      { id: "muscular-wall", name: "Muscular wall", anchor: pt(496, 350) },
      { id: "inferior-vena-cava", name: "Inferior vena cava", anchor: pt(140, 372) },
    );
    return { w: W, h: H, shapes, parts };
  },
};
