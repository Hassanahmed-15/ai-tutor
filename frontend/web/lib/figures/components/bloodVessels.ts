import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { arrowShapes, r2, rng, smoothClosed } from "./bioDraw";

/**
 * BLOOD VESSELS IN SECTION, as an O/A Level textbook draws them: an artery, a vein and a capillary
 * in transverse section, side by side and roughly to relative scale (thick muscular/elastic wall and
 * narrow lumen; thin wall and wide lumen; a wall one cell thick round a lumen one red cell wide). Each
 * wall is built from its real layers — endothelium, elastic tissue, smooth muscle, collagen outer coat
 * — so a label points at the layer itself. One vessel alone gets a magnified view beside its section:
 * the artery's wall layers as bands, the vein's valve in longitudinal section, the capillary's
 * endothelial cells with red cells in single file.
 */

type Show = "all" | "artery" | "vein" | "capillary";

const C = {
  line: "#44403c",
  lumen: "#fff1f2",
  endo: "#fef3c7",
  endoNuc: "#7c3aed",
  muscle: "#fbcfe8",
  muscleCell: "#f9a8d4",
  muscleLine: "#be185d",
  elastic: "#6d28d9",
  coat: "#fde7c7",
  fibre: "#b7791f",
  rbc: "#f87171",
  rbcPale: "#fecaca",
  flow: "#dc2626",
} as const;

function showOf(v: unknown): Show {
  const s = String(v ?? "").toLowerCase();
  const a = /arter/.test(s), v2 = /vein|venous/.test(s), c = /capill/.test(s);
  if (a && !v2 && !c) return "artery";
  if (v2 && !a && !c) return "vein";
  if (c && !a && !v2) return "capillary";
  return "all";
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

const polar = (c: Pt, r: number, a: number): Pt => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
const circleD = (c: Pt, r: number) => `M${r2(c.x - r)} ${r2(c.y)} a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0 a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0 Z`;
const deg = Math.PI / 180;

/** A closed ring outline whose radius ripples (an elastic lamina, a folded endothelium). */
function wavyRing(c: Pt, r: (a: number) => number, amp: number, waves: number): string {
  const n = waves * 4;
  return smoothClosed(Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return polar(c, r(a) + amp * Math.sin(waves * a), a);
  }));
}
/** A closed outline at radius r(a). */
function ringPath(c: Pt, r: (a: number) => number, n = 36): string {
  return smoothClosed(Array.from({ length: n }, (_, i) => polar(c, r((i / n) * Math.PI * 2), (i / n) * Math.PI * 2)));
}
/** A spindle (smooth muscle cell) centred at p, long axis at angle t. */
function spindle(p: Pt, t: number, len: number, thick: number): string {
  const u = { x: Math.cos(t), y: Math.sin(t) }, n = { x: -u.y, y: u.x };
  const a = { x: p.x - u.x * len / 2, y: p.y - u.y * len / 2 }, b = { x: p.x + u.x * len / 2, y: p.y + u.y * len / 2 };
  return `M${r2(a.x)} ${r2(a.y)} Q${r2(p.x + n.x * thick)} ${r2(p.y + n.y * thick)} ${r2(b.x)} ${r2(b.y)} Q${r2(p.x - n.x * thick)} ${r2(p.y - n.y * thick)} ${r2(a.x)} ${r2(a.y)} Z`;
}
/** A short wavy fibre (collagen) centred at p along angle t. */
function fibre(p: Pt, t: number, len: number): string {
  const u = { x: Math.cos(t), y: Math.sin(t) }, n = { x: -u.y, y: u.x };
  const a = { x: p.x - u.x * len / 2, y: p.y - u.y * len / 2 };
  const q = (k: number, s: number) => ({ x: a.x + u.x * len * k + n.x * s, y: a.y + u.y * len * k + n.y * s });
  const m1 = q(0.25, 2.6), m2 = q(0.5, 0), m3 = q(0.75, -2.6), e = q(1, 0);
  return `M${r2(a.x)} ${r2(a.y)} Q${r2(m1.x)} ${r2(m1.y)} ${r2(m2.x)} ${r2(m2.y)} Q${r2(m3.x)} ${r2(m3.y)} ${r2(e.x)} ${r2(e.y)}`;
}
/** A red blood cell seen face on: a pale centre where it is thinnest. */
function rbcFace(shapes: FigureShape[], c: Pt, r: number, part?: string) {
  const p = part ? { part } : {};
  shapes.push({ t: "circle", cx: r2(c.x), cy: r2(c.y), r, fill: C.rbc, stroke: "#b91c1c", width: 1.6, ...p });
  shapes.push({ t: "circle", cx: r2(c.x), cy: r2(c.y), r: r * 0.42, fill: C.rbcPale, stroke: "none", ...p });
}

/** A red blood cell seen edge on (biconcave: thick rim, thin middle), long axis vertical. */
export function rbcSideD(c: Pt, len: number, thick: number): string {
  const L = len / 2, T = thick / 2;
  const right: Pt[] = [{ x: 0, y: -L }, { x: T * 0.8, y: -L + T * 0.2 }, { x: T, y: -L + T * 0.75 }, { x: T * 0.75, y: -L + T * 1.45 }, { x: T * 0.52, y: -L * 0.3 }, { x: T * 0.5, y: 0 }, { x: T * 0.52, y: L * 0.3 }, { x: T * 0.75, y: L - T * 1.45 }, { x: T, y: L - T * 0.75 }, { x: T * 0.8, y: L - T * 0.2 }];
  const all = [...right, { x: 0, y: L }, ...right.slice(1).reverse().map((p) => ({ x: -p.x, y: p.y }))];
  return smoothClosed(all.map((p) => ({ x: c.x + p.x, y: c.y + p.y })));
}

/**
 * Consecutive paths drawn in the same style become one path (a layer's texture is one shape): the
 * picture is unchanged, and a label's leader meets one texture instead of fifty little obstacles.
 */
export function mergeRuns(shapes: FigureShape[]): FigureShape[] {
  const out: FigureShape[] = [];
  const key = (sh: FigureShape) => (sh.t === "path" ? JSON.stringify([sh.part, sh.fill, sh.stroke, sh.width, sh.dash, sh.opacity]) : "");
  for (const sh of shapes) {
    const last = out[out.length - 1];
    if (sh.t === "path" && last && last.t === "path" && key(sh) === key(last)) out[out.length - 1] = { ...last, d: `${last.d} ${sh.d}` };
    else out.push(sh);
  }
  return out;
}

/** Shapes keep a part id only when that part is built (labelled) in this drawing; the rest are plain art. */
export function keepParts(shapes: FigureShape[], built: Iterable<string>): FigureShape[] {
  const ids = new Set(built);
  return shapes.map((sh) => {
    if (!sh.part || ids.has(sh.part)) return sh;
    const { part: _drop, ...rest } = sh;
    void _drop;
    return rest as FigureShape;
  });
}

type Built = { shapes: FigureShape[]; anchors: Record<string, Pt> };

/** An artery in transverse section: collagen coat, elastic laminae, a thick muscle-and-elastic middle layer, folded endothelium. */
function arteryTS(c: Pt, R: number, seed: number): Built {
  const s: FigureShape[] = [];
  const rand = rng(seed);
  const rMedia = R * 0.84, rIntima = R * 0.46, rLumen = R * 0.4;
  // Outer coat (collagen).
  s.push({ t: "path", part: "collagen", d: circleD(c, R), fill: C.coat, stroke: "ink", width: 2.2 });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.1;
    s.push({ t: "path", part: "collagen", d: fibre(polar(c, (R + rMedia) / 2 + (rand() - 0.5) * R * 0.05, a), a + Math.PI / 2 + (rand() - 0.5) * 0.5, R * 0.1), stroke: C.fibre, width: 1.6, fill: "none" });
  }
  // Middle layer: smooth muscle with elastic fibres.
  s.push({ t: "path", part: "smooth-muscle", d: circleD(c, rMedia), fill: C.muscle, stroke: C.line, width: 1.6 });
  const rows = 3;
  for (let k = 0; k < rows; k++) {
    const rr = rIntima + (rMedia - rIntima) * ((k + 0.5) / rows);
    const n = Math.round((2 * Math.PI * rr) / (R * 0.23));
    for (let i = 0; i < n; i++) {
      const a = ((i + (k % 2) * 0.5) / n) * Math.PI * 2;
      s.push({ t: "path", part: "smooth-muscle", d: spindle(polar(c, rr, a), a + Math.PI / 2, R * 0.16, R * 0.028), fill: C.muscleCell, stroke: C.muscleLine, width: 1.2 });
    }
  }
  // Elastic tissue: the external and internal laminae and fibres between the muscle rows.
  for (const k of [1, 2]) {
    const rr = rIntima + (rMedia - rIntima) * (k / rows);
    s.push({ t: "path", part: "elastic-tissue", d: wavyRing(c, () => rr, R * 0.012, 22), stroke: C.elastic, width: 1.6, fill: "none" });
  }
  s.push({ t: "path", part: "elastic-tissue", d: wavyRing(c, () => rMedia - R * 0.015, R * 0.012, 26), stroke: C.elastic, width: 1.8, fill: "none" });
  s.push({ t: "path", part: "elastic-tissue", d: wavyRing(c, () => rIntima + R * 0.01, R * 0.022, 12), stroke: C.elastic, width: 2.2, fill: "none" });
  // Endothelium, folded (the wall recoils when the section is cut), and the lumen.
  s.push({ t: "path", part: "endothelium", d: wavyRing(c, () => rIntima - R * 0.01, R * 0.02, 12), fill: C.endo, stroke: C.line, width: 1.6 });
  s.push({ t: "path", part: "artery-lumen", d: wavyRing(c, () => rLumen, R * 0.02, 12), fill: C.lumen, stroke: C.line, width: 1.6 });
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2 + 0.04;
    const p = polar(c, rLumen + R * 0.035, a);
    s.push({ t: "path", part: "endothelium", d: spindle(p, a + Math.PI / 2, R * 0.07, R * 0.016), fill: C.endoNuc, stroke: "none" });
  }
  s.push({ t: "path", part: "artery", d: circleD(c, R), fill: "none", stroke: "ink", width: 2.4 });
  return {
    shapes: s,
    anchors: {
      artery: polar(c, R, 228 * deg),
      collagen: polar(c, (R + rMedia) / 2, 200 * deg),
      "smooth-muscle": polar(c, rIntima + (rMedia - rIntima) * 0.5, 172 * deg),
      "elastic-tissue": polar(c, rIntima + (rMedia - rIntima) * (2 / 3), 145 * deg),
      endothelium: polar(c, (rIntima + rLumen) / 2, 158 * deg),
      "artery-lumen": c,
    },
  };
}

/** A vein in transverse section: slightly collapsed, thin wall (mostly collagen coat), wide lumen. */
function veinTS(c: Pt, rx: number, ry: number, seed: number): Built {
  const s: FigureShape[] = [];
  const rand = rng(seed);
  const wob = Array.from({ length: 7 }, () => rand() * Math.PI * 2);
  const k = (a: number) => 1 + 0.035 * Math.sin(3 * a + wob[0]) + 0.025 * Math.sin(5 * a + wob[1]);
  const at = (inset: number) => (a: number) => {
    const ex = (rx - inset) * Math.cos(a), ey = (ry - inset) * Math.sin(a);
    return Math.hypot(ex, ey) * k(a);
  };
  const scale = Math.min(rx, ry);
  const wCoat = scale * 0.14, wMuscle = scale * 0.08, wEndo = scale * 0.045;
  s.push({ t: "path", part: "collagen", d: ringPath(c, at(0), 40), fill: C.coat, stroke: "ink", width: 2.2 });
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + rand() * 0.08;
    s.push({ t: "path", part: "collagen", d: fibre(polar(c, at(wCoat / 2)(a), a), a + Math.PI / 2, scale * 0.1), stroke: C.fibre, width: 1.6, fill: "none" });
  }
  s.push({ t: "path", part: "smooth-muscle", d: ringPath(c, at(wCoat), 40), fill: C.muscle, stroke: C.line, width: 1.6 });
  s.push({ t: "path", part: "elastic-tissue", d: ringPath(c, at(wCoat + wMuscle * 0.5), 48), stroke: C.elastic, width: 1.6, fill: "none", dash: "7 5" });
  s.push({ t: "path", part: "endothelium", d: ringPath(c, at(wCoat + wMuscle), 40), fill: C.endo, stroke: C.line, width: 1.6 });
  s.push({ t: "path", part: "vein-lumen", d: ringPath(c, at(wCoat + wMuscle + wEndo), 40), fill: C.lumen, stroke: C.line, width: 1.6 });
  for (let i = 0; i < 14; i++) {
    const a = ((i + 0.5) / 14) * Math.PI * 2;
    s.push({ t: "path", part: "endothelium", d: spindle(polar(c, at(wCoat + wMuscle + wEndo * 0.5)(a), a), a + Math.PI / 2, scale * 0.08, wEndo * 0.32), fill: C.endoNuc, stroke: "none" });
  }
  s.push({ t: "path", part: "vein", d: ringPath(c, at(0), 40), fill: "none", stroke: "ink", width: 2.4 });
  return {
    shapes: s,
    anchors: {
      vein: polar(c, at(0)(-40 * deg), -40 * deg),
      collagen: polar(c, at(wCoat * 0.5)(145 * deg), 145 * deg),
      "elastic-tissue": polar(c, at(wCoat + wMuscle * 0.5)(168 * deg), 168 * deg),
      "smooth-muscle": polar(c, at(wCoat + wMuscle * 0.3)(192 * deg), 192 * deg),
      endothelium: polar(c, at(wCoat + wMuscle + wEndo * 0.5)(215 * deg), 215 * deg),
      "vein-lumen": { x: c.x + rx * 0.3, y: c.y + ry * 0.2 },
    },
  };
}

/** A capillary in transverse section: two endothelial cells (one cell thick) round one red cell. */
function capillaryTS(c: Pt, r: number): Built {
  const s: FigureShape[] = [];
  const rl = r * 0.78;
  s.push({ t: "path", part: "endothelium", d: circleD(c, r), fill: C.endo, stroke: C.line, width: 1.8 });
  s.push({ t: "path", part: "capillary-lumen", d: circleD(c, rl), fill: C.lumen, stroke: C.line, width: 1.6 });
  // The two cells' boundaries, one with a small gap (pore) between them.
  for (const a of [28 * deg, 208 * deg]) {
    const p1 = polar(c, rl, a), p2 = polar(c, r, a);
    s.push({ t: "path", part: "endothelium", d: `M${r2(p1.x)} ${r2(p1.y)} L${r2(p2.x)} ${r2(p2.y)}`, stroke: C.line, width: 1.6, fill: "none" });
  }
  const nucA = [115 * deg, 295 * deg];
  for (const a of nucA) {
    const p = polar(c, (r + rl) / 2, a);
    s.push({ t: "path", part: "nucleus", d: spindle(p, a + Math.PI / 2, r * 0.42, r * 0.13), fill: C.endoNuc, stroke: C.line, width: 1.2 });
  }
  rbcFace(s, c, rl * 0.78, "red-blood-cell");
  s.push({ t: "path", part: "capillary", d: circleD(c, r), fill: "none", stroke: "ink", width: 2 });
  return {
    shapes: s,
    anchors: {
      capillary: polar(c, r, -35 * deg),
      endothelium: polar(c, (r + rl) / 2, 15 * deg),
      nucleus: polar(c, (r + rl) / 2, 295 * deg),
      "red-blood-cell": polar(c, rl * 0.6, 160 * deg),
      "capillary-lumen": polar(c, rl * 0.9, 220 * deg),
    },
  };
}

/** A vein in longitudinal section with one pocket valve, open to blood flowing towards the heart. */
function veinLS(x: number, y: number, w: number, h: number): Built {
  const s: FigureShape[] = [];
  const coat = h * 0.13, mus = h * 0.06, endo = h * 0.03;
  const band = (y0: number, hh: number, fill: string, part: string) =>
    s.push({ t: "path", part, d: `M${r2(x)} ${r2(y0)} H${r2(x + w)} V${r2(y0 + hh)} H${r2(x)} Z`, fill: fill as never, stroke: C.line, width: 1.6 });
  // Top wall (outside → in) and bottom wall (in → outside).
  band(y, coat, C.coat, "collagen");
  band(y + coat, mus, C.muscle, "smooth-muscle");
  band(y + coat + mus, endo, C.endo, "endothelium");
  const lt = y + coat + mus + endo, lb = y + h - coat - mus - endo;
  s.push({ t: "path", part: "vein-lumen", d: `M${r2(x)} ${r2(lt)} H${r2(x + w)} V${r2(lb)} H${r2(x)} Z`, fill: C.lumen, stroke: "none" });
  band(lb, endo, C.endo, "endothelium");
  band(lb + endo, mus, C.muscle, "smooth-muscle");
  band(lb + endo + mus, coat, C.coat, "collagen");
  for (let i = 0; i < 7; i++) {
    const fx = x + (i + 0.5) * (w / 7);
    s.push({ t: "path", part: "collagen", d: fibre({ x: fx, y: y + coat / 2 }, 0, w / 12), stroke: C.fibre, width: 1.6, fill: "none" });
    if (i < 6) s.push({ t: "path", part: "collagen", d: fibre({ x: fx + w / 14, y: y + h - coat / 2 }, 0, w / 12), stroke: C.fibre, width: 1.6, fill: "none" });
  }
  // The valve: two cusps rooted in the wall, pointing downstream (to the right), leaving a gap.
  const vx = x + w * 0.42, mid = (lt + lb) / 2, gap = (lb - lt) * 0.09, len = w * 0.24;
  // Each cusp is a flap (thick at its root, thin at its free edge) bowing out from the wall.
  const cusp = (wallY: number, dir: 1 | -1) => {
    const p0 = { x: vx, y: wallY }, p1 = { x: vx + len * 0.4, y: wallY + dir * (lb - lt) * 0.08 }, p2 = { x: vx + len * 0.75, y: mid - dir * gap * 2.2 }, p3 = { x: vx + len, y: mid - dir * gap };
    const at = (t: number) => {
      const u = 1 - t;
      return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
    };
    const n = 12, side1: Pt[] = [], side2: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = at(Math.max(0, t - 0.01)), b = at(Math.min(1, t + 0.01)), c = at(t);
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      const th = (lb - lt) * (0.012 * (1 - t) + 0.02) + (t > 0.9 ? 0 : 0);
      side1.push({ x: c.x + nx * th, y: c.y + ny * th });
      side2.push({ x: c.x - nx * th, y: c.y - ny * th });
    }
    return smoothClosed([...side1, ...side2.reverse()]);
  };
  s.push({ t: "path", part: "valve", d: cusp(lt, 1), fill: C.endo, stroke: C.line, width: 2 });
  s.push({ t: "path", part: "valve", d: cusp(lb, -1), fill: C.endo, stroke: C.line, width: 2 });
  // Blood flows through the open valve towards the heart.
  s.push(...arrowShapes({ x: x + w * 0.08, y: mid }, { x: x + w * 0.34, y: mid }, C.flow, 2.4, undefined, { head: 11 }));
  s.push(...arrowShapes({ x: vx + len + w * 0.06, y: mid }, { x: x + w * 0.94, y: mid }, C.flow, 2.4, undefined, { head: 11 }));
  return {
    shapes: s,
    anchors: { valve: { x: vx + len * 0.55, y: lt + (mid - lt) * 0.45 } },
  };
}

/** A magnified block of artery wall: lumen at the top, then each layer as a band (for labelling). */
function arteryWall(x: number, y: number, w: number, h: number): Built {
  const s: FigureShape[] = [];
  const lumenH = h * 0.1, endoH = h * 0.06, mediaH = h * 0.5, coatH = h - lumenH - endoH - mediaH;
  const rect = (y0: number, hh: number, fill: string, part: string, stroke = true) =>
    s.push({ t: "path", part, d: `M${r2(x)} ${r2(y0)} H${r2(x + w)} V${r2(y0 + hh)} H${r2(x)} Z`, fill: fill as never, stroke: stroke ? C.line : "none", width: 1.6 });
  const wave = (yy: number, amp: number, period: number, part: string, width = 1.8) => {
    let d = `M${r2(x)} ${r2(yy)}`;
    for (let px = x; px < x + w - 0.1; px += period) d += ` q${r2(period / 4)} ${r2(-amp)} ${r2(period / 2)} 0 q${r2(period / 4)} ${r2(amp)} ${r2(period / 2)} 0`;
    s.push({ t: "path", part, d, stroke: C.elastic, width, fill: "none" });
  };
  const y1 = y + lumenH, y2 = y1 + endoH, y3 = y2 + mediaH;
  rect(y, lumenH, C.lumen, "artery-lumen");
  rect(y1, endoH, C.endo, "endothelium");
  for (let i = 0; i < 6; i++) s.push({ t: "path", part: "endothelium", d: spindle({ x: x + (i + 0.5) * (w / 6), y: y1 + endoH / 2 }, 0, w / 9, endoH * 0.28), fill: C.endoNuc, stroke: "none" });
  rect(y2, mediaH, C.muscle, "smooth-muscle");
  const rows = 4;
  for (let k = 0; k < rows; k++) {
    const yy = y2 + mediaH * ((k + 0.5) / rows);
    for (let i = 0; i < 5; i++) {
      const cx = x + ((i + 0.5 + (k % 2) * 0.5) / 5.5) * w;
      s.push({ t: "path", part: "smooth-muscle", d: spindle({ x: cx, y: yy }, 0, w / 6.2, mediaH * 0.07), fill: C.muscleCell, stroke: C.muscleLine, width: 1.2 });
    }
  }
  wave(y2 + 3, 2.6, w / 8, "elastic-tissue", 2.2);
  for (const k of [1, 2, 3]) wave(y2 + mediaH * (k / rows), 2.2, w / 10, "elastic-tissue");
  wave(y3 - 3, 2.2, w / 10, "elastic-tissue", 2);
  rect(y3, coatH, C.coat, "collagen");
  for (let k = 0; k < 2; k++) for (let i = 0; i < 6; i++) {
    s.push({ t: "path", part: "collagen", d: fibre({ x: x + ((i + 0.5 + (k % 2) * 0.4) / 6.4) * w, y: y3 + coatH * (0.3 + 0.4 * k) }, (k ? -1 : 1) * 0.25, w / 8), stroke: C.fibre, width: 1.6, fill: "none" });
  }
  s.push({ t: "path", d: `M${r2(x)} ${r2(y)} H${r2(x + w)} V${r2(y + h)} H${r2(x)} Z`, fill: "none", stroke: "ink", width: 2 });
  return {
    shapes: s,
    anchors: {
      "artery-lumen": { x: x + w * 0.85, y: y + lumenH / 2 },
      endothelium: { x: x + w * 0.9, y: y1 + endoH / 2 },
      "smooth-muscle": { x: x + w * 0.88, y: y2 + mediaH * 0.375 },
      "elastic-tissue": { x: x + w * 0.9, y: y2 + mediaH * 0.75 },
      collagen: { x: x + w * 0.86, y: y3 + coatH * 0.5 },
    },
  };
}

/** A capillary in longitudinal section: flattened endothelial cells, a gap between two, red cells in single file. */
function capillaryLS(x: number, y: number, w: number, h: number): Built {
  const s: FigureShape[] = [];
  const t = h * 0.16;
  const cells = 3, cw = w / cells, gapW = 5;
  s.push({ t: "path", part: "capillary-lumen", d: `M${r2(x)} ${r2(y + t)} H${r2(x + w)} V${r2(y + h - t)} H${r2(x)} Z`, fill: C.lumen, stroke: "none" });
  for (const top of [true, false]) {
    for (let i = 0; i < cells; i++) {
      const x0 = x + i * cw + (i ? gapW / 2 : 0), x1 = x + (i + 1) * cw - (i < cells - 1 ? gapW / 2 : 0);
      const y0 = top ? y : y + h - t;
      s.push({ t: "path", part: "endothelium", d: `M${r2(x0)} ${r2(y0)} H${r2(x1)} V${r2(y0 + t)} H${r2(x0)} Z`, fill: C.endo, stroke: C.line, width: 1.6 });
      const nx = (x0 + x1) / 2 + (top ? -1 : 1) * cw * 0.12;
      s.push({ t: "path", part: "nucleus", d: spindle({ x: nx, y: y0 + t / 2 }, 0, cw * 0.4, t * 0.3), fill: C.endoNuc, stroke: C.line, width: 1.2 });
      // The gap between this cell and the next: tissue fluid and small molecules pass through.
      if (i < cells - 1) s.push({ t: "path", part: "pore", d: `M${r2(x1)} ${r2(y0)} H${r2(x1 + gapW)} V${r2(y0 + t)} H${r2(x1)} Z`, fill: C.lumen, stroke: "none" });
    }
  }
  // Red cells pass in single file, squeezed slightly (seen edge on, biconcave).
  const rbcH = h - 2 * t - 10;
  for (let i = 0; i < 4; i++) {
    const cx = x + w * (0.14 + i * 0.24), cy = y + h / 2;
    s.push({ t: "path", part: "red-blood-cell", d: rbcSideD({ x: cx, y: cy }, rbcH, rbcH * 0.3), fill: C.rbc, stroke: "#b91c1c", width: 1.6 });
  }
  return {
    shapes: s,
    anchors: {
      pore: { x: x + cw, y: y + h - t / 2 },
      endothelium: { x: x + w * 0.88, y: y + t / 2 },
      nucleus: { x: x + cw * 2.62 + 1, y: y + h - t / 2 },
      "red-blood-cell": { x: x + w * 0.86, y: y + h / 2 },
    },
  };
}

const PARTS: Array<{ id: string; name: string }> = [
  { id: "artery", name: "Artery" },
  { id: "vein", name: "Vein" },
  { id: "capillary", name: "Capillary" },
  { id: "artery-lumen", name: "Narrow lumen" },
  { id: "vein-lumen", name: "Wide lumen" },
  { id: "capillary-lumen", name: "Lumen" },
  { id: "endothelium", name: "Endothelium" },
  { id: "elastic-tissue", name: "Elastic tissue" },
  { id: "smooth-muscle", name: "Smooth muscle" },
  { id: "collagen", name: "Outer coat (collagen)" },
  { id: "valve", name: "Valve" },
  { id: "red-blood-cell", name: "Red blood cell" },
  { id: "nucleus", name: "Endothelial cell nucleus" },
  { id: "pore", name: "Gap between cells" },
];
const NAME = new Map(PARTS.map((p) => [p.id, p.name]));

export const bloodVessels: FigureComponent = {
  name: "bloodVessels",
  title: "Transverse sections of an artery, a vein and a capillary to relative scale: wall layers (endothelium, elastic tissue, smooth muscle, collagen coat), lumen sizes and a vein valve",
  params: `show ("all" default: artery, vein and capillary side by side | "artery": section plus the wall layers magnified | "vein": section plus a valve in longitudinal section | "capillary": section plus a longitudinal view with red cells in single file). valve (true/false: add the vein's valve in longitudinal section to "all"; default false for "all", always shown for "vein").`,
  match: /\bblood vessels?\b|\b(arter(y|ies)|arterioles?)\b(?=[\s\S]{0,200}\b(veins?|venules?|capillar(y|ies))\b)|\b(veins?|capillar(y|ies))\b(?=[\s\S]{0,200}\barter(y|ies)\b)|\b(structure|walls?|lumen|layers|section) of (an? |the )?(arter(y|ies)|veins?|capillar(y|ies))\b|(?<!\b(pulmonary|coronary|renal|hepatic|umbilical|leaf|leaves|mid-?rib) )\b(arter(y|ies)|veins?|capillar(y|ies))\b(?!\s+(action|tube|rise|attraction))(?=[\s\S]{0,120}\b(lumen|endothelium|elastic (tissue|fibres?|walls?)|smooth muscle|muscular walls?|one cell thick|thick walls?|thin walls?)\b)/i,
  parts: PARTS,
  build(params: FigureParams) {
    const show = showOf(params.show ?? params.vessel ?? params.view);
    const shapes: FigureShape[] = [];
    const anchors: Record<string, Pt> = {};
    const take = (b: Built, ids: string[]) => {
      shapes.push(...b.shapes);
      for (const id of ids) if (b.anchors[id] && !anchors[id]) anchors[id] = b.anchors[id];
    };
    let w = 720, h = 300;
    if (show === "all") {
      const valve = boolOf(params.valve, false);
      w = 640;
      const cy = 128;
      take(arteryTS({ x: 126, y: cy }, 114, 3), ["artery", "artery-lumen", "endothelium", "elastic-tissue", "smooth-muscle", "collagen"]);
      take(veinTS({ x: 384, y: cy }, 124, 84, 5), ["vein", "vein-lumen"]);
      take(capillaryTS({ x: 584, y: cy + 14 }, 36), ["capillary", "red-blood-cell"]);
      if (valve) {
        take(veinLS(260, 252, 300, 110), ["valve"]);
        h = 376;
      } else h = 260;
    } else if (show === "artery") {
      w = 600; h = 330;
      const c = { x: 150, y: 165 };
      const ts = arteryTS(c, 140, 3);
      shapes.push(...ts.shapes);
      anchors.artery = ts.anchors.artery;
      // A wedge of the wall, magnified beside the section.
      const bx = 380, by = 22, bw = 200, bh = 286;
      const wedgeA = polar(c, 140, -22 * deg), wedgeB = polar(c, 140, 22 * deg);
      shapes.push({ t: "path", d: `M${r2(c.x)} ${r2(c.y)} L${r2(wedgeA.x)} ${r2(wedgeA.y)} A140 140 0 0 1 ${r2(wedgeB.x)} ${r2(wedgeB.y)} Z`, fill: "none", stroke: "muted", width: 1.6, dash: "5 4" });
      shapes.push({ t: "path", d: `M${r2(wedgeA.x)} ${r2(wedgeA.y)} L${bx} ${by} M${r2(wedgeB.x)} ${r2(wedgeB.y)} L${bx} ${by + bh}`, fill: "none", stroke: "muted", width: 1.6, dash: "5 4" });
      take(arteryWall(bx, by, bw, bh), ["artery-lumen", "endothelium", "smooth-muscle", "elastic-tissue", "collagen"]);
    } else if (show === "vein") {
      w = 640; h = 320;
      const ts = veinTS({ x: 170, y: 160 }, 150, 112, 5);
      take(ts, ["vein", "vein-lumen", "collagen", "smooth-muscle", "endothelium", "elastic-tissue"]);
      take(veinLS(368, 90, 256, 150), ["valve"]);
    } else {
      w = 600; h = 300;
      // Section on the left (labelled from the left), a longitudinal view on the right (labelled from the right).
      const ts = capillaryTS({ x: 150, y: 150 }, 120);
      ts.anchors.capillary = polar({ x: 150, y: 150 }, 120, 215 * deg);
      ts.anchors["capillary-lumen"] = polar({ x: 150, y: 150 }, 120 * 0.78 * 0.9, 150 * deg);
      ts.anchors["red-blood-cell"] = polar({ x: 150, y: 150 }, 120 * 0.78 * 0.55, 185 * deg);
      take(ts, ["capillary", "capillary-lumen", "red-blood-cell"]);
      take(capillaryLS(330, 84, 250, 132), ["endothelium", "nucleus", "pore"]);
      shapes.push({ t: "path", part: "capillary", d: `M330 84 H580 M330 216 H580`, stroke: "ink", width: 2, fill: "none" });
    }
    const parts: FigurePart[] = PARTS.filter((p) => anchors[p.id]).map((p) => ({ id: p.id, name: NAME.get(p.id)!, anchor: { x: r2(anchors[p.id].x), y: r2(anchors[p.id].y) } }));
    return { w, h, shapes: mergeRuns(keepParts(shapes, parts.map((p) => p.id))), parts };
  },
};
