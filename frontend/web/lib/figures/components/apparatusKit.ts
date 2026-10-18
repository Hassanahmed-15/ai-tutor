import { solutionColour } from "../colours";
import { fitText } from "../cuts";
import type { FigureShape, Ink, Pt } from "../types";

/**
 * Shared drawing kit for the lab-apparatus figures (distillation, filtration, chromatography, gas
 * collection, heating). Parameter checks that never throw, a few geometry helpers, and the pieces
 * that recur in textbook apparatus: Bunsen burner, tripod, gauze, heat-proof mat, conical flask,
 * beaker. Drawing style follows titration.ts: glass is an ink outline (2.6), liquids are flat colour
 * with an ink surface line, metal/wood use their inks.
 */

export const GLASS_W = 2.6;

export const text = (v: unknown, fallback: string, max = 40) => (typeof v === "string" && v.trim() ? fitText(v.trim(), max) : fallback);
export const num = (v: unknown, fallback: number, lo: number, hi: number) => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return v !== "" && v !== null && v !== undefined && typeof v !== "boolean" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
export function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  const s = String(v ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-");
  return (options as readonly string[]).includes(s) ? (s as T) : fallback;
}
export const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : fallback);

/** Colours of solids (residues, crystals, chips) by name; falls back to the solution colours. */
const SOLIDS: Record<string, string> = {
  sand: "#d6b370", white: "#f5f5f4", grey: "#9ca3af", gray: "#9ca3af", black: "#374151", silver: "#cbd5e1",
  "copper oxide": "#1f2937", chalk: "#f5f5f4", marble: "#e7e5e4", "light blue": "#93c5fd", "dark green": "#166534",
};
export function solidColour(name: unknown, fallback: string): `#${string}` {
  const key = String(name ?? "").toLowerCase().trim();
  if (SOLIDS[key]) return SOLIDS[key] as `#${string}`;
  const colourless = solutionColour("colourless");
  if (key && (solutionColour(key) !== colourless || /^(colourless|clear|water)$/.test(key))) return solutionColour(key);
  return (SOLIDS[fallback] ?? solutionColour(fallback)) as `#${string}`;
}

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const P = (p: Pt) => `${r1(p.x)} ${r1(p.y)}`;
export const poly = (pts: Pt[], close = true) => `M${pts.map(P).join(" L")}${close ? " Z" : ""}`;
export const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });

/** Rotate points about an origin by `deg` degrees (screen coordinates: positive turns clockwise). */
export function rotate(pts: Pt[], o: Pt, deg: number): Pt[] {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map((p) => ({ x: o.x + (p.x - o.x) * c - (p.y - o.y) * s, y: o.y + (p.x - o.x) * s + (p.y - o.y) * c }));
}

/** The part of a convex polygon below a horizontal level (y ≥ level): a liquid in a tilted vessel. */
export function clipBelow(pts: Pt[], level: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ina = a.y >= level, inb = b.y >= level;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (level - a.y) / (b.y - a.y);
      out.push({ x: a.x + (b.x - a.x) * t, y: level });
    }
  }
  return out;
}

/** The two walls of a tube of half-width `half` following a polyline (mitred at bends). */
export function tubeWalls(axis: Pt[], half: number): [Pt[], Pt[]] {
  const normals = axis.slice(1).map((p, i) => {
    const dx = p.x - axis[i].x, dy = p.y - axis[i].y, l = Math.hypot(dx, dy) || 1;
    return { x: -dy / l, y: dx / l };
  });
  const side = (k: number) =>
    axis.map((p, i) => {
      if (i === 0) return add(p, normals[0], k * half);
      if (i === axis.length - 1) return add(p, normals[normals.length - 1], k * half);
      const a = normals[i - 1], b = normals[i];
      const m = { x: a.x + b.x, y: a.y + b.y };
      const dot = (m.x * a.x + m.y * a.y) || 1;
      return add(p, m, (k * half) / dot);
    });
  return [side(1), side(-1)];
}

export const arrowHead = (tip: Pt, dir: Pt, size = 8): string => {
  const l = Math.hypot(dir.x, dir.y) || 1, u = { x: dir.x / l, y: dir.y / l }, n = { x: -u.y, y: u.x };
  const back = add(tip, u, -size);
  return poly([tip, add(back, n, size * 0.55), add(back, n, -size * 0.55)]);
};

/** A flow arrow: shaft plus filled head, all one part. */
export function arrow(shapes: FigureShape[], part: string, from: Pt, to: Pt, ink: Ink = "ink", width = 2) {
  const dir = { x: to.x - from.x, y: to.y - from.y };
  shapes.push({ t: "path", part, d: `M${P(from)} L${P(to)}`, stroke: ink, width, fill: "none" });
  shapes.push({ t: "path", part, d: arrowHead(to, dir, 9), fill: ink, stroke: ink, width: 1 });
}

/** Bubbles / granules / lumps: a few circles. */
export function dots(shapes: FigureShape[], part: string, pts: Pt[], r: number, fill: Ink | "none", stroke: Ink | "none" = "ink", width = 1.2) {
  for (const p of pts) shapes.push({ t: "circle", part, cx: r1(p.x), cy: r1(p.y), r, fill, stroke, width });
}

/** Heat-proof mat on the bench. */
export function mat(shapes: FigureShape[], part: string, cx: number, y: number, half: number) {
  shapes.push({ t: "path", part, d: `M${cx - half} ${y} h${half * 2} v12 h${-half * 2} z`, fill: "wood", stroke: "ink", width: 2 });
  return { x: cx + half - 18, y: y + 6 };
}

export type Flame = "blue" | "yellow" | "none";

/**
 * Bunsen burner standing on `baseY`: base, gas inlet, collar with air hole (open for a blue
 * flame, closed for a yellow one), barrel, and the flame from the barrel top up to `flameTop`.
 */
export function bunsen(shapes: FigureShape[], ids: { burner: string; airHole: string; flame: string }, cx: number, baseY: number, barrelTop: number, flame: Flame, flameTop: number) {
  // Base and gas inlet.
  shapes.push({ t: "path", part: ids.burner, d: `M${cx - 42} ${baseY} Q${cx - 40} ${baseY - 16} ${cx - 12} ${baseY - 18} H${cx + 12} Q${cx + 40} ${baseY - 16} ${cx + 42} ${baseY} Z`, fill: "metal", stroke: "ink", width: 2 });
  shapes.push({ t: "path", part: ids.burner, d: `M${cx - 30} ${baseY - 9} h-24 v-7 h24`, fill: "metal", stroke: "ink", width: 1.8 });
  // Barrel.
  shapes.push({ t: "path", part: ids.burner, d: `M${cx - 9} ${baseY - 18} V${barrelTop} H${cx + 9} V${baseY - 18}`, fill: "metal", stroke: "ink", width: 2 });
  // Collar with the air hole.
  const collarTop = baseY - 46, collarBottom = baseY - 26;
  shapes.push({ t: "path", part: ids.airHole, d: `M${cx - 12} ${collarTop} h24 v${collarBottom - collarTop} h-24 z`, fill: "metal", stroke: "ink", width: 2 });
  const open = flame !== "yellow";
  shapes.push({ t: "path", part: ids.airHole, d: `M${cx - 5} ${collarTop + 5} h10 v10 h-10 z`, fill: open ? "#1f2937" : "metal", stroke: "ink", width: 1.4 });
  // Flame.
  const h = barrelTop - flameTop;
  if (flame === "blue") {
    shapes.push({ t: "path", part: ids.flame, d: `M${cx - 9} ${barrelTop} C${cx - 12} ${barrelTop - h * 0.45} ${cx - 3} ${flameTop + h * 0.2} ${cx} ${flameTop} C${cx + 3} ${flameTop + h * 0.2} ${cx + 12} ${barrelTop - h * 0.45} ${cx + 9} ${barrelTop} Z`, fill: "#93c5fd", stroke: "#2563eb", width: 1.6, opacity: 0.9 });
    shapes.push({ t: "path", part: ids.flame, d: `M${cx - 5} ${barrelTop} C${cx - 6} ${barrelTop - h * 0.3} ${cx - 1} ${barrelTop - h * 0.5} ${cx} ${barrelTop - h * 0.55} C${cx + 1} ${barrelTop - h * 0.5} ${cx + 6} ${barrelTop - h * 0.3} ${cx + 5} ${barrelTop} Z`, fill: "#1d4ed8", stroke: "none", opacity: 0.85 });
  } else if (flame === "yellow") {
    shapes.push({ t: "path", part: ids.flame, d: `M${cx - 9} ${barrelTop} C${cx - 20} ${barrelTop - h * 0.4} ${cx - 4} ${flameTop + h * 0.35} ${cx - 6} ${flameTop + h * 0.12} C${cx - 1} ${flameTop + h * 0.2} ${cx} ${flameTop} ${cx + 3} ${flameTop} C${cx + 4} ${flameTop + h * 0.3} ${cx + 20} ${barrelTop - h * 0.45} ${cx + 9} ${barrelTop} Z`, fill: "#facc15", stroke: "#ea580c", width: 1.6, opacity: 0.92 });
  }
  return {
    burner: { x: cx - 9, y: (barrelTop + collarTop) / 2 },
    airHole: { x: cx - 12, y: (collarTop + collarBottom) / 2 },
    flame: { x: cx, y: flame === "none" ? barrelTop : barrelTop - h * 0.4 },
  };
}

/** Tripod seen side-on: top ring at `topY`, three legs to the bench. */
export function tripod(shapes: FigureShape[], part: string, cx: number, topY: number, footY: number, half: number) {
  shapes.push({ t: "path", part, d: `M${cx - half} ${topY} h${half * 2} v6 h${-half * 2} z`, fill: "metal", stroke: "ink", width: 2 });
  shapes.push({ t: "path", part, d: `M${cx - half + 6} ${topY + 6} L${cx - half - 14} ${footY} M${cx + half - 6} ${topY + 6} L${cx + half + 14} ${footY} M${cx + 4} ${topY + 6} L${cx + 6} ${footY - 6}`, fill: "none", stroke: "ink", width: 4 });
  return { x: cx - half - 14 + 14 * 0.35, y: topY + 6 + (footY - topY - 6) * 0.65 };
}

/** Wire gauze lying on the tripod (drawn as a thin mesh strip). */
export function gauze(shapes: FigureShape[], part: string, cx: number, y: number, half: number) {
  shapes.push({ t: "path", part, d: `M${cx - half} ${y - 4} h${half * 2} v4 h${-half * 2} z`, fill: "paper", stroke: "ink", width: 1.6 });
  let mesh = "";
  for (let x = cx - half + 6; x < cx + half; x += 8) mesh += `M${x} ${y - 4} l3 4 `;
  shapes.push({ t: "path", part, d: mesh, fill: "none", stroke: "ink", width: 0.9, opacity: 0.7 });
  return { x: cx + half - 10, y: y - 2 };
}

/** Conical flask: neck from `neckTop` to `neckTop + neck`, then straight sloping walls to `base`. */
export function conicalFlask(cx: number, neckTop: number, base: number, neckHalf = 16, baseHalf = 60, neck = 26) {
  const neckBottom = neckTop + neck;
  const wall = (y: number, side: -1 | 1) => cx + side * (neckHalf + ((y - neckBottom) / (base - neckBottom)) * (baseHalf - neckHalf));
  const outline = `M${cx - neckHalf} ${neckTop} V${neckBottom} L${cx - baseHalf} ${base} H${cx + baseHalf} L${cx + neckHalf} ${neckBottom} V${neckTop}`;
  const lip = `M${cx - neckHalf - 4} ${neckTop} h8 M${cx + neckHalf - 4} ${neckTop} h8`;
  /** Liquid from `level` (a y) down to the base. */
  const liquid = (level: number) => {
    const y = Math.max(level, neckBottom);
    return poly([{ x: wall(y, -1), y }, { x: wall(y, 1), y }, { x: wall(base - 1.5, 1), y: base - 1.5 }, { x: wall(base - 1.5, -1), y: base - 1.5 }]);
  };
  return { outline, lip, wall, liquid, neckBottom };
}

/** Beaker: straight sides, flat base, a small pouring lip at the top left. */
export function beaker(cx: number, top: number, base: number, half: number) {
  const outline = `M${cx - half - 7} ${top - 3} Q${cx - half} ${top} ${cx - half} ${top + 8} V${base - 6} Q${cx - half} ${base} ${cx - half + 6} ${base} H${cx + half - 6} Q${cx + half} ${base} ${cx + half} ${base - 6} V${top}`;
  const liquid = (level: number) => `M${cx - half + 1.5} ${level} H${cx + half - 1.5} V${base - 6} Q${cx + half - 1.5} ${base - 1.5} ${cx + half - 6} ${base - 1.5} H${cx - half + 6} Q${cx - half + 1.5} ${base - 1.5} ${cx - half + 1.5} ${base - 6} Z`;
  return { outline, liquid };
}

/** A liquid surface line (meniscus) between two walls. */
export const surface = (x1: number, x2: number, y: number) => `M${r1(x1)} ${r1(y)} Q${r1((x1 + x2) / 2)} ${r1(y + 3)} ${r1(x2)} ${r1(y)}`;

/** Move a path drawn with this kit's commands (absolute M L H V Q C A Z; relative ones unchanged) by (dx, dy). */
export function translatePath(d: string, dx: number, dy: number): string {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: string[] = [];
  let cmd = "";
  let idx = 0; // index of the number within the current command's argument group
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, A: 7, T: 2, S: 4 };
  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) { cmd = t; idx = 0; out.push(t); continue; }
    const n = parseFloat(t);
    const k = arity[cmd];
    if (!k) { out.push(t); continue; } // relative command or Z: unchanged
    const i = idx % k;
    idx++;
    let v = n;
    if (cmd === "H") v = n + dx;
    else if (cmd === "V") v = n + dy;
    else if (cmd === "A") v = i === 5 ? n + dx : i === 6 ? n + dy : n;
    else v = i % 2 === 0 ? n + dx : n + dy;
    out.push(String(r1(v)));
  }
  return out.join(" ").replace(/ ([A-Za-z])/g, " $1");
}

/** Move every shape and anchor of a drawing by (dx, dy). */
export function shiftDrawing(shapes: FigureShape[], parts: Array<{ anchor: Pt }>, dx: number, dy: number) {
  for (const s of shapes) {
    if (s.t === "path") s.d = translatePath(s.d, dx, dy);
    else if (s.t === "circle") { s.cx = r1(s.cx + dx); s.cy = r1(s.cy + dy); }
    else { s.x = r1(s.x + dx); s.y = r1(s.y + dy); }
  }
  for (const p of parts) p.anchor = { x: r1(p.anchor.x + dx), y: r1(p.anchor.y + dy) };
}
