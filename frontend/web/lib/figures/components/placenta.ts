import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { arrowShapes, r2, smoothClosed, smoothOpen } from "./bioDraw";
import { keepParts, mergeRuns } from "./bloodVessels";

/**
 * THE FETUS IN THE UTERUS, as the O Level textbook draws it: the muscular uterus wall, the cervix
 * closing its neck above the vagina, the amniotic sac and its fluid round a head-down fetus, the
 * placenta on the uterus wall and the umbilical cord (two arteries, one vein) joining them. The
 * optional inset is the placenta magnified: a villus of fetal capillaries in a space of maternal
 * blood, with arrows for what crosses (oxygen and nutrients to the fetus; carbon dioxide and urea to
 * the mother) — the two bloods never mix.
 */

const C = {
  line: "#44403c",
  wall: "#f9a8b4",
  wallDark: "#be185d",
  cavity: "#fdf2f8",
  fluid: "#dbeafe",
  amnion: "#2563eb",
  placenta: "#fb7185",
  placentaLine: "#9f1239",
  skin: "#fde2cf",
  cord: "#e2e8f0",
  vein: "#dc2626",
  artery: "#2563eb",
  maternal: "#fecaca",
  villus: "#fde4cf",
  inArrow: "#dc2626",
  outArrow: "#2563eb",
} as const;

function boolOf(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    if (/^(true|yes|on|1|show)$/i.test(v.trim())) return true;
    if (/^(false|no|off|0|hide|none)$/i.test(v.trim())) return false;
  }
  return fallback;
}

/** Points along the closed Catmull-Rom curve smoothClosed draws through `pts` (same maths), k per segment. */
function sampleClosed(pts: Pt[], k = 10): Pt[] {
  const n = pts.length, out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    for (let j = 0; j < k; j++) {
      const t = j / k, u = 1 - t;
      out.push({ x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x, y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y });
    }
  }
  return out;
}
const poly = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${r2(p.x)} ${r2(p.y)}`).join(" ") + " Z";
const mirror = (cx: number, half: Array<[number, number]>): Pt[] => [
  ...half.map(([dx, y]) => ({ x: cx + dx, y })),
  ...[...half].reverse().slice(1, -1).map(([dx, y]) => ({ x: cx - dx, y })),
];
/** A cubic Bézier through four points, sampled. */
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 40): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
  });
}
const open = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${r2(p.x)} ${r2(p.y)}`).join(" ");

const PARTS: Array<{ id: string; name: string }> = [
  { id: "placenta", name: "Placenta" },
  { id: "umbilical-cord", name: "Umbilical cord" },
  { id: "umbilical-artery", name: "Umbilical artery" },
  { id: "umbilical-vein", name: "Umbilical vein" },
  { id: "amniotic-sac", name: "Amniotic sac (amnion)" },
  { id: "amniotic-fluid", name: "Amniotic fluid" },
  { id: "fetus", name: "Fetus" },
  { id: "uterus-wall", name: "Uterus wall (muscle)" },
  { id: "cervix", name: "Cervix" },
  { id: "vagina", name: "Vagina" },
  { id: "maternal-blood", name: "Maternal blood space" },
  { id: "placental-villus", name: "Placental villus" },
  { id: "fetal-capillary", name: "Fetal capillary" },
  { id: "exchange-in", name: "O₂ and nutrients to fetus" },
  { id: "exchange-out", name: "CO₂ and urea to mother" },
];

/** The uterus with the fetus: shapes plus anchors. */
function uterus(s: FigureShape[], cx: number, a: Record<string, Pt>) {
  // Uterus, cervix and vagina as one muscular outline (frontal section).
  const outer = mirror(cx, [[0, 10], [74, 16], [132, 50], [168, 112], [180, 192], [170, 270], [138, 334], [92, 376], [54, 398], [44, 416], [40, 442], [0, 442]]);
  s.push({ t: "path", part: "uterus-wall", d: smoothClosed(outer, 0.9), fill: C.wall, stroke: C.line, width: 2.2 });
  // Cavity (the inside of the uterus).
  const cavityCtl = mirror(cx, [[0, 38], [64, 43], [110, 72], [142, 124], [152, 194], [144, 264], [116, 318], [72, 352], [30, 368], [0, 372]]);
  const cav = sampleClosed(cavityCtl, 12);
  s.push({ t: "path", part: "uterus-wall", d: poly(cav), fill: C.cavity, stroke: C.line, width: 1.6 });
  // Cervical canal and vagina (narrow canal, then the wider vagina below).
  s.push({ t: "path", part: "cervix", d: `M${r2(cx - 60)} 372 Q${r2(cx)} 362 ${r2(cx + 60)} 372 Q${r2(cx + 42)} 390 ${r2(cx + 34)} 412 Q${r2(cx)} 418 ${r2(cx - 34)} 412 Q${r2(cx - 42)} 390 ${r2(cx - 60)} 372 Z`, fill: "#f48fb1", stroke: C.wallDark, width: 1.6 });
  s.push({ t: "path", part: "cervix", d: `M${r2(cx - 5)} 370 L${r2(cx - 5)} 412 L${r2(cx + 5)} 412 L${r2(cx + 5)} 370 Z`, fill: C.cavity, stroke: C.line, width: 1.6 });

  s.push({ t: "path", part: "vagina", d: `M${r2(cx - 5)} 412 Q${r2(cx - 22)} 418 ${r2(cx - 22)} 432 L${r2(cx - 22)} 442 L${r2(cx + 22)} 442 L${r2(cx + 22)} 432 Q${r2(cx + 22)} 418 ${r2(cx + 5)} 412 Z`, fill: C.cavity, stroke: C.line, width: 1.6 });
  // The placenta on the wall at the top (the fundus, a little to the right), the amnion inside everything.
  const centre = { x: cx, y: 200 };
  const ang = (p: Pt) => Math.atan2(p.y - centre.y, p.x - centre.x);
  const pc = -2.0, half = 0.6, thick = 32;
  const bump = (p: Pt) => {
    let d = Math.abs(ang(p) - pc);
    if (d > Math.PI) d = 2 * Math.PI - d;
    const t = Math.max(0, 1 - d / half);
    return t <= 0 ? 0 : Math.sqrt(t * (2 - t));
  };
  const inward = (i: number): Pt => {
    const p = cav[(i - 1 + cav.length) % cav.length], q = cav[(i + 1) % cav.length], m = cav[i];
    const L = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    let n = { x: -(q.y - p.y) / L, y: (q.x - p.x) / L };
    if (n.x * (centre.x - m.x) + n.y * (centre.y - m.y) < 0) n = { x: -n.x, y: -n.y };
    return n;
  };
  const offsetAt = (i: number, d: number): Pt => { const n = inward(i); return { x: cav[i].x + n.x * d, y: cav[i].y + n.y * d }; };
  const amnion = cav.map((p, i) => offsetAt(i, 7 + bump(p) * (thick + 3)));
  // Placenta: from the wall to its fetal face, over the samples where the bump is non-zero.
  const idx = cav.map((p, i) => [i, bump(p)] as const).filter(([, b]) => b > 0.02).map(([i]) => i);
  // Order the indices along the wall (they may wrap past the start of the loop).
  const wrapAt = idx.findIndex((v, k) => k > 0 && v !== idx[k - 1] + 1);
  const ordered = wrapAt > 0 ? [...idx.slice(wrapAt), ...idx.slice(0, wrapAt)] : idx;
  const wallSide = ordered.map((i) => cav[i]);
  const faceSide = ordered.map((i) => offsetAt(i, 2 + bump(cav[i]) * thick)).reverse();
  s.push({ t: "path", part: "amniotic-fluid", d: poly(amnion), fill: C.fluid, stroke: "none" });
  s.push({ t: "path", part: "placenta", d: poly([...wallSide, ...faceSide]), fill: C.placenta, stroke: C.placentaLine, width: 1.8 });
  // Cotyledon grooves across the placenta.
  let grooves = "";
  for (const f of [0.22, 0.4, 0.6, 0.78]) {
    const i = ordered[Math.floor(ordered.length * f)];
    const p = cav[i], q = offsetAt(i, bump(p) * thick * 0.85);
    grooves += `M${r2(p.x)} ${r2(p.y)} L${r2(q.x)} ${r2(q.y)} `;
  }
  s.push({ t: "path", part: "placenta", d: grooves.trim(), stroke: C.placentaLine, width: 1.6, fill: "none" });
  s.push({ t: "path", part: "amniotic-sac", d: poly(amnion), fill: "none", stroke: C.amnion, width: 2.2 });
  // The fetus, head down, facing the student's left, curled: drawn head-up facing right in its own
  // frame (the way it is easiest to proportion), then turned half a circle into the uterus.
  const body = { x: cx + 18, y: 212 }, k = 0.92;
  const T = (x: number, y: number): Pt => ({ x: body.x - k * x, y: body.y - k * y });
  const skin = (d: string) => s.push({ t: "path", part: "fetus", d, fill: C.skin, stroke: C.line, width: 2 });
  // One silhouette for the curled body: back on the left, the leg folded up so the knee meets the chest.
  skin(smoothClosed([
    T(-30, -56), T(-56, -16), T(-64, 36), T(-56, 82), T(-34, 112), T(0, 124), T(34, 126), T(62, 124), T(90, 122), T(98, 108),
    T(80, 98), T(82, 60), T(84, 22), T(72, 2), T(52, -2), T(48, -30), T(36, -52), T(0, -62),
  ], 1));
  // The thigh's edge against the belly and the back of the calf against the thigh.
  s.push({ t: "path", part: "fetus", d: smoothOpen([T(62, 6), T(40, 42), T(14, 84), T(4, 110)], 1), stroke: C.line, width: 1.8, fill: "none" });
  s.push({ t: "path", part: "fetus", d: smoothOpen([T(70, 24), T(64, 64), T(62, 104)], 1), stroke: C.line, width: 1.8, fill: "none" });
  const headC = T(12, -98);
  s.push({ t: "circle", part: "fetus", cx: r2(headC.x), cy: r2(headC.y), r: 58 * k, fill: C.skin, stroke: C.line, width: 2 });
  // Arm folded across the chest, hand by the chin.
  skin(smoothClosed([T(-2, -46), T(16, -36), T(30, -6), T(40, -22), T(50, -46), T(62, -50), T(64, -36), T(50, -6), T(34, 14), T(20, 8), T(0, -24)], 1));
  // Closed eye and ear.
  const eye = T(44, -104), ear = T(-6, -92);
  s.push({ t: "path", part: "fetus", d: `M${r2(eye.x - 7)} ${r2(eye.y)} q7 5 14 0 M${r2(ear.x - 6)} ${r2(ear.y - 8)} a8 9 0 1 0 2 16`, stroke: C.line, width: 1.8, fill: "none" });
  // Umbilical cord: belly → loops left and up → the placenta's fetal face; vein (red) and two arteries (blue).
  const belly = T(58, -8);
  const ei = ordered[Math.floor(ordered.length * 0.45)];
  const end = offsetAt(ei, bump(cav[ei]) * thick - 2);
  const path = cubic(belly, { x: cx - 92, y: 236 }, { x: end.x - 40, y: end.y + 80 }, end, 50);
  s.push({ t: "path", part: "umbilical-cord", d: open(path), stroke: C.line, width: 17, fill: "none" });
  s.push({ t: "path", part: "umbilical-cord", d: open(path), stroke: C.cord, width: 13.5, fill: "none" });
  const twist = (phase: number, amp: number) => path.map((p, i) => {
    const q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
    const L = Math.hypot(q.x - o.x, q.y - o.y) || 1, n = { x: -(q.y - o.y) / L, y: (q.x - o.x) / L };
    const k = amp * Math.sin(i * 0.55 + phase);
    return { x: p.x + n.x * k, y: p.y + n.y * k };
  });
  s.push({ t: "path", part: "umbilical-artery", d: open(twist(0, 4.2)), stroke: C.artery, width: 2, fill: "none" });
  s.push({ t: "path", part: "umbilical-artery", d: open(twist(Math.PI, 4.2)), stroke: C.artery, width: 2, fill: "none" });
  s.push({ t: "path", part: "umbilical-vein", d: open(path), stroke: C.vein, width: 3, fill: "none" });
  // Anchors.
  const leftAt = (pts: Pt[], y: number) => pts.filter((p) => p.x < cx).reduce((b, p) => (Math.abs(p.y - y) < Math.abs(b.y - y) ? p : b), { x: cx, y: 1e9 });
  const wallIn = leftAt(cav, 230), wallOut = leftAt(sampleClosed(outer, 8), 230);
  a["uterus-wall"] = { x: (wallIn.x + wallOut.x) / 2, y: (wallIn.y + wallOut.y) / 2 };
  a["amniotic-sac"] = leftAt(amnion, 300);
  a["amniotic-fluid"] = { x: cx - 74, y: 314 };
  a.fetus = T(-40, 20);
  a.cervix = { x: cx - 30, y: 394 };
  a.vagina = { x: cx - 16, y: 434 };
  const pi = ordered[Math.floor(ordered.length * 0.25)];
  a.placenta = offsetAt(pi, bump(cav[pi]) * thick * 0.5);
  const ci = Math.floor(path.length * 0.5);
  const art = twist(0, 4.2);
  let ai = Math.floor(path.length * 0.72);
  for (let i = ai; i < ai + 12 && i < path.length; i++) if (Math.sin(i * 0.55) > Math.sin(ai * 0.55)) ai = i;
  a["umbilical-cord"] = { x: path[ci].x - 5, y: path[ci].y };
  a["umbilical-artery"] = art[ai];
  a["umbilical-vein"] = path[Math.floor(path.length * 0.3)];
  return { placentaAt: a.placenta, ordered, cav, offsetAt, bump, thick };
}

/** The exchange inset: a placental villus with fetal capillaries in maternal blood. */
function exchangeInset(s: FigureShape[], x: number, y: number, w: number, h: number, a: Record<string, Pt>) {
  const plate = 34, wallH = 34;
  s.push({ t: "path", part: "maternal-blood", d: `M${x} ${y} H${x + w} V${y + h} H${x} Z`, fill: C.maternal, stroke: C.line, width: 2 });
  // Fetal side (chorionic plate) at the top, with the umbilical vessels' branches.
  s.push({ t: "path", d: `M${x} ${y} H${x + w} V${y + plate} H${x} Z`, fill: C.placenta, stroke: C.line, width: 1.6 });
  // Maternal side (uterus wall) at the bottom, with a maternal artery and vein opening into the space.
  s.push({ t: "path", d: `M${x} ${y + h - wallH} H${x + w} V${y + h} H${x} Z`, fill: C.wall, stroke: C.line, width: 1.6 });
  s.push({ t: "path", d: `M${x + w * 0.18} ${y + h} V${y + h - wallH}`, stroke: C.vein, width: 7, fill: "none" });
  s.push({ t: "path", d: `M${x + w * 0.82} ${y + h - wallH} V${y + h}`, stroke: C.artery, width: 7, fill: "none" });
  // Maternal vessels open into the space through the wall (blood in from an artery, out by a vein).
  s.push({ t: "path", d: `M${x + w * 0.16} ${y + h} V${y + h - wallH - 12}`, stroke: C.line, width: 11, fill: "none" });
  s.push({ t: "path", d: `M${x + w * 0.16} ${y + h} V${y + h - wallH - 12}`, stroke: C.vein, width: 7, fill: "none" });
  s.push({ t: "path", d: `M${x + w * 0.84} ${y + h} V${y + h - wallH - 12}`, stroke: C.line, width: 11, fill: "none" });
  s.push({ t: "path", d: `M${x + w * 0.84} ${y + h} V${y + h - wallH - 12}`, stroke: C.artery, width: 7, fill: "none" });
  // One villus hanging into the maternal blood, a capillary loop inside it.
  const vx = x + w * 0.36, vTop = y + plate, vBot = y + h - wallH - 30, vw = 40;
  const villusD = `M${vx - vw} ${vTop} V${vBot - vw} A${vw} ${vw} 0 0 0 ${vx + vw} ${vBot - vw} V${vTop} Z`;
  s.push({ t: "path", part: "placental-villus", d: villusD, fill: C.villus, stroke: C.line, width: 2 });
  const cin = vx - 15, cout = vx + 15;
  // Umbilical artery branch brings fetal blood in (blue); it leaves oxygenated in the vein branch (red).
  s.push({ t: "path", part: "fetal-capillary", d: `M${x - 14} ${y + plate * 0.4} H${cin} V${vBot - vw}`, stroke: C.artery, width: 5, fill: "none" });
  s.push({ t: "path", part: "fetal-capillary", d: `M${cin} ${vBot - vw} A15 15 0 0 0 ${cout} ${vBot - vw}`, stroke: "#7c3aed", width: 5, fill: "none" });
  s.push({ t: "path", part: "fetal-capillary", d: `M${cout} ${vBot - vw} V${y + plate * 0.62} H${x + w + 16}`, stroke: C.vein, width: 5, fill: "none" });
  // What crosses, on the villus's right: in from the mother (to the left), out to the mother (to the right).
  const rows = [0.18, 0.38, 0.6, 0.8].map((f) => vTop + 24 + (vBot - vw - vTop - 24) * f);
  const right = x + w - 12;
  rows.forEach((yy, i) => {
    const into = i < 2;
    const from = into ? { x: right, y: yy } : { x: vx + vw + 4, y: yy };
    const to = into ? { x: vx + vw + 4, y: yy } : { x: right, y: yy };
    s.push(...arrowShapes(from, to, into ? C.inArrow : C.outArrow, 2.4, into ? "exchange-in" : "exchange-out", { head: 11 }));
    s.push({ t: "text", x: (right + vx + vw) / 2 + 30, y: yy - 7, text: ["O₂", "glucose", "CO₂", "urea"][i], size: 16, anchor: "middle", fill: "ink", part: into ? "exchange-in" : "exchange-out" });
  });
  a["maternal-blood"] = { x: x + w - 34, y: vBot - 6 };
  a["placental-villus"] = { x: vx + vw * 0.72, y: vBot - vw * 0.32 };
  a["fetal-capillary"] = { x: x + w + 10, y: y + plate * 0.62 };
  a["exchange-in"] = { x: (right + vx + vw) / 2 - 18, y: rows[1] };
  a["exchange-out"] = { x: (right + vx + vw) / 2 - 18, y: rows[3] };
}

export const placenta: FigureComponent = {
  name: "placenta",
  title: "Fetus in the uterus: placenta, umbilical cord (arteries and vein), amniotic sac and fluid, uterus wall, cervix and vagina, with an optional inset of exchange across the placenta",
  params: `inset (true/false, default false: add a magnified placenta — a villus with fetal capillaries in maternal blood, arrows for O₂ and nutrients to the fetus and CO₂ and urea to the mother).`,
  match: /\bplacenta\b|\bplacental\b(?!\s+mammals?)|\bumbilical (cord|arter(y|ies)|vein)\b|\bamniotic (fluid|sac)\b|\bamnion\b|\b(f|foe)tus(es)?\b(?=[\s\S]{0,160}\b(uterus|womb|placenta|amniotic)\b)|\b(uterus|womb)\b(?=[\s\S]{0,160}\b(f|foe)tus\b)|\bchorionic vill(us|i)\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const inset = boolOf(params.inset ?? params.exchange, false);
    const s: FigureShape[] = [];
    const a: Record<string, Pt> = {};
    const cx = inset ? 200 : 280;
    const u = uterus(s, cx, a);
    let w = 560;
    if (inset) {
      const ix = 440, iy = 112, iw = 290, ih = 300;
      exchangeInset(s, ix, iy, iw, ih, a);
      // Which bit of the placenta is magnified.
      const zi = u.ordered[Math.floor(u.ordered.length * 0.88)];
      const z = u.offsetAt(zi, u.bump(u.cav[zi]) * u.thick * 0.5);
      s.push({ t: "circle", cx: r2(z.x), cy: r2(z.y), r: 11, fill: "none", stroke: "muted", width: 1.8, dash: "4 3" });
      s.push({ t: "path", d: `M${r2(z.x + 10)} ${r2(z.y - 4)} L${ix} ${iy} M${r2(z.x + 8)} ${r2(z.y + 8)} L${ix} ${iy + ih}`, stroke: "muted", width: 1.6, dash: "5 4", fill: "none" });
      w = ix + iw + 20;
    }
    const parts: FigurePart[] = PARTS.filter((p) => a[p.id]).map((p) => ({ id: p.id, name: p.name, anchor: { x: r2(a[p.id].x), y: r2(a[p.id].y) } }));
    return { w, h: 446, shapes: mergeRuns(keepParts(s, parts.map((p) => p.id))), parts };
  },
};
