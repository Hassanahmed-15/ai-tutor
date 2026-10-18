import { partBounds } from "../figures/bounds";
import { drawnShapes, TINTS } from "../figures/drawn";
import type { FigureDrawing, FigurePart, FigureShape, Ink } from "../figures/types";
import { WORLD_LAND } from "./worldLand";
import { drawableText } from "./glyphs";
import { collisionElement, geometryElement } from "./grammarKinds";
import { clearAnchor, cropToInk, inkIndex, partInkDistance, rayBlocked, textGap } from "./ink";
import { untangleLeaders } from "./leaders";

/**
 * THE DIAGRAM GRAMMAR. A diagram is described as JSON and drawn by code, so what needs to be exact is
 * exact: the coastlines of a world map come from Natural Earth (lib/diagrams/worldLand.ts), a current
 * follows the latitudes and longitudes it is given, a graph plots its data on real axes, "23 pairs"
 * repeats a shape 23 times, a cross-section stacks its layers. An image model gets none of these right
 * (8 of 10 picture requests in real lectures were rejected — audit 2026-10-17), and free line art from
 * a language model gets proportions and positions only roughly right.
 *
 * Elements, on a w×h canvas (x right, y down):
 *   - any shape of the drawn grammar (lib/figures/drawn.ts): rect, ellipse, circle, line, arrow,
 *     polyline, polygon, curve, text;
 *   - "world": a map of the real coastlines over a lon/lat window, with latitude lines;
 *   - "geoArrow" / "geoPoint" / "band": an arrow along lon/lat points, a place, a latitude belt;
 *   - "plot": axes with ticks and titles, and data as a line, bars, points or an area;
 *   - "layers": a stacked cross-section (soil horizons, tissue layers, the atmosphere);
 *   - "repeat": one shape repeated an exact number of times in a row or grid;
 *   - "geometry" / "collision" (lib/diagrams/grammarKinds.ts): an exact construction (circle, chords,
 *     perpendicular feet, tangents, right angles), and bodies before and after an impact.
 * Parts are named regions the label engine points at. A part drawn by one of these elements gets its
 * anchor from the geometry code drew, whatever the writer said; a part made only of free shapes keeps
 * the writer's anchor only when it lies on the part's own ink.
 *
 * Pure: no model, no I/O. Returns the drawing, what is wrong with the description, and the facts the
 * checks need (counts, written numbers, data).
 */

type Raw = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : Number.NaN);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const slug = (v: unknown) => str(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const r1 = (n: number) => Math.round(n * 10) / 10;
const isObj = (v: unknown): v is Raw => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Strong colours for arrows and data, by meaning: warm currents red, cold blue (one house style). */
export const LINE_COLOURS: Record<string, `#${string}`> = {
  red: "#dc2626", blue: "#2563eb", green: "#16a34a", orange: "#ea580c", purple: "#7c3aed", brown: "#92400e", grey: "#64748b", black: "#1f2937", yellow: "#ca8a04", cyan: "#0891b2", pink: "#db2777",
};
const LAND: `#${string}` = "#d9e8c4";
const OCEAN: `#${string}` = "#e8f3fb";
const tint = (v: unknown, fallback: Ink | "none" = "none"): Ink | "none" => {
  const name = str(v, 12);
  return TINTS[name] ?? (name === "white" ? "paper" : name === "none" ? "none" : fallback);
};
const lineColour = (v: unknown, fallback: Ink = "ink"): Ink => LINE_COLOURS[str(v, 12)] ?? (str(v, 12) === "muted" ? "muted" : fallback);

export type DiagramFacts = {
  /** Each repeat: how many it draws, and the part it belongs to. */
  counts: Array<{ part: string; count: number }>;
  /** Every number the art writes (not axis ticks or latitudes, which are scale). */
  written: string[];
  /** Every data value plotted, x and y. */
  data: number[];
  /** Which special elements the diagram uses. */
  kinds: string[];
};

export type CompiledDiagram = { drawing?: FigureDrawing; issues: string[]; facts: DiagramFacts };

type Box = { x: number; y: number; w: number; h: number };
type Projection = { box: Box; lon: [number, number]; lat: [number, number]; at: (lon: number, lat: number) => [number, number] };

/** Clips a ring to a box (Sutherland–Hodgman): land at the window's edge is cut, not dragged along it. */
function clipRing(points: Array<[number, number]>, b: Box): Array<[number, number]> {
  const edges: Array<{ inside: (p: [number, number]) => boolean; cut: (a: [number, number], c: [number, number]) => [number, number] }> = [
    { inside: (p) => p[0] >= b.x, cut: (a, c) => [b.x, a[1] + ((c[1] - a[1]) * (b.x - a[0])) / (c[0] - a[0])] },
    { inside: (p) => p[0] <= b.x + b.w, cut: (a, c) => [b.x + b.w, a[1] + ((c[1] - a[1]) * (b.x + b.w - a[0])) / (c[0] - a[0])] },
    { inside: (p) => p[1] >= b.y, cut: (a, c) => [a[0] + ((c[0] - a[0]) * (b.y - a[1])) / (c[1] - a[1]), b.y] },
    { inside: (p) => p[1] <= b.y + b.h, cut: (a, c) => [a[0] + ((c[0] - a[0]) * (b.y + b.h - a[1])) / (c[1] - a[1]), b.y + b.h] },
  ];
  let out = points;
  for (const e of edges) {
    if (!out.length) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (e.inside(cur)) {
        if (!e.inside(prev)) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (e.inside(prev)) out.push(e.cut(prev, cur));
    }
  }
  return out;
}

/** A smooth path through points (Catmull–Rom as cubic Béziers), as lib/figures/drawn.ts draws curves. */
function smooth(p: Array<[number, number]>): string {
  if (p.length < 3) return `M${p.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(" L")}`;
  const P = [p[0], ...p, p[p.length - 1]];
  let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    d += ` C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d;
}

/** An arrowhead at `tip`, pointing along from → tip. */
function head(from: [number, number], tip: [number, number], colour: Ink, part?: string, size = 12): FigureShape {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const at = (k: number): [number, number] => [tip[0] - size * Math.cos(a + k), tip[1] - size * Math.sin(a + k)];
  const [l, r] = [at(0.42), at(-0.42)];
  return { t: "path", d: `M${r1(l[0])} ${r1(l[1])} L${r1(tip[0])} ${r1(tip[1])} L${r1(r[0])} ${r1(r[1])} Z`, fill: colour, stroke: "none", ...(part ? { part } : {}) };
}

const latName = (lat: number) => (lat === 0 ? "0°" : `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`);
const tickText = (v: number) => (Math.abs(v) >= 10000 ? v.toLocaleString("en-GB") : String(r1(v)));

/** Offsets a drawn-grammar shape (for "repeat"). */
function shifted(s: Raw, dx: number, dy: number): Raw {
  const out: Raw = { ...s };
  for (const k of ["x", "cx", "x1", "x2"]) if (typeof s[k] === "number") out[k] = (s[k] as number) + dx;
  for (const k of ["y", "cy", "y1", "y2"]) if (typeof s[k] === "number") out[k] = (s[k] as number) + dy;
  if (Array.isArray(s.points)) out.points = (s.points as unknown[]).map((p) => (Array.isArray(p) ? [num(p[0]) + dx, num(p[1]) + dy] : p));
  return out;
}

/** Points ON a drawn-grammar shape, for placing its part's anchor. */
function shapePoints(s: Raw): Array<[number, number]> {
  const t = str(s.t, 10);
  const filled = str(s.fill, 12) !== "" && str(s.fill, 12) !== "none";
  if (t === "rect") {
    const [x, y, w, h] = [num(s.x), num(s.y), num(s.w), num(s.h)];
    return filled ? [[x + w / 2, y + h / 2], [x + w / 2, y + h * 0.12], [x + w / 2, y + h * 0.88], [x + w * 0.12, y + h / 2], [x + w * 0.88, y + h / 2]] : [[x + w / 2, y], [x, y + h / 2], [x + w, y + h / 2], [x + w / 2, y + h]];
  }
  if (t === "circle" || t === "ellipse") {
    const [cx, cy] = [num(s.cx), num(s.cy)];
    const rx = t === "circle" ? num(s.r) : num(s.rx), ry = t === "circle" ? num(s.r) : num(s.ry);
    return filled ? [[cx, cy], [cx, cy - ry * 0.85], [cx, cy + ry * 0.85], [cx - rx * 0.85, cy], [cx + rx * 0.85, cy]] : [[cx, cy - ry], [cx, cy + ry]];
  }
  if (t === "line" || t === "arrow") return [[(num(s.x1) + num(s.x2)) / 2, (num(s.y1) + num(s.y2)) / 2]];
  if (t === "text") return [[num(s.x), num(s.y) - 5]];
  if (Array.isArray(s.points)) {
    const p = (s.points as unknown[]).filter(Array.isArray).map((q) => [num((q as unknown[])[0]), num((q as unknown[])[1])] as [number, number]);
    const closed = t === "polygon" || s.closed === true;
    if (closed && filled && p.length >= 3) {
      const c: [number, number] = [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
      return [c, ...p.map(([x, y]) => [c[0] + (x - c[0]) * 0.8, c[1] + (y - c[1]) * 0.8] as [number, number])];
    }
    return p.length > 2 ? [p[Math.floor(p.length / 2)]] : p;
  }
  return [];
}

/**
 * Drawings this compiler made. The board validator accepts these as they are (a world map has
 * hundreds of shapes, more than a described drawing may have); a model can never forge one, because
 * membership is by object identity, set only here.
 */
const COMPILED = new WeakSet<FigureDrawing>();
/** Parts whose dot is an exact point (a crossing, a map place): never moved to clear a leader. */
const EXACT = new WeakMap<FigureDrawing, Set<string>>();
export const isCompiledDiagram = (drawing: unknown): drawing is FigureDrawing => typeof drawing === "object" && drawing !== null && COMPILED.has(drawing as FigureDrawing);

export function compileDiagram(raw: unknown): CompiledDiagram {
  const r = isObj(raw) ? raw : {};
  const issues: string[] = [];
  const facts: DiagramFacts = { counts: [], written: [], data: [], kinds: [] };
  const w = num(r.w), h = num(r.h);
  if (!(w >= 200 && w <= 900 && h >= 150 && h <= 640)) return { issues: ["the diagram needs w 200-900 and h 150-640"], facts };
  const inside = (x: number, y: number) => x >= -10 && x <= w + 10 && y >= -10 && y <= h + 10;
  const elements = (Array.isArray(r.elements) ? r.elements : Array.isArray(r.shapes) ? r.shapes : []).filter(isObj).slice(0, 120);
  const rawParts = (Array.isArray(r.parts) ? r.parts : []).filter(isObj).slice(0, 10);
  const partIds = new Set(rawParts.map((p) => slug(p.id)).filter(Boolean));
  const partNames = new Map(rawParts.map((p) => [slug(p.id), drawableText(str(p.name, 200))] as const));
  // Parts whose names code writes INTO the art (a circulation cell's name inside its loop, a velocity
  // arrow's value over it): no margin label and no leader for them.
  const selfNamed = new Set<string>();
  const partOf = (v: unknown) => { const id = slug(v); return id && partIds.has(id) ? { part: id } : {}; };
  const shapes: FigureShape[] = [];
  // Points on each part's art, from which its anchor is chosen when the writer gives none.
  const points = new Map<string, Array<[number, number]>>();
  // Parts some element of the grammar placed (a cell, a current, a chord): their anchors are code's.
  const placed = new Set<string>();
  const markAny = (part: unknown, pts: Array<[number, number]>) => {
    const id = slug(part);
    if (!id || !partIds.has(id)) return "";
    points.set(id, [...(points.get(id) ?? []), ...pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))]);
    return id;
  };
  const mark = (part: unknown, ...pts: Array<[number, number]>) => { const id = markAny(part, pts); if (id) placed.add(id); };
  const markFree = (part: unknown, ...pts: Array<[number, number]>) => { markAny(part, pts); };
  let projection: Projection | undefined;
  const drawnRaw: Raw[] = [];
  let writerTexts = 0;
  // The texts the writer drew (code-written ticks, categories and latitudes are not theirs).
  const writerText = new Set<FigureShape>();
  // Free shapes are compiled in order with everything else, so later elements draw on top.
  const flushDrawn = () => {
    if (!drawnRaw.length) return;
    const room = Math.max(0, 10 - writerTexts);
    const compiled = drawnShapes(drawnRaw, w, h, partIds, room);
    writerTexts += compiled.shapes.filter((s) => s.t === "text").length;
    issues.push(...compiled.issues);
    for (const s of compiled.shapes) if (s.t === "text") { writerText.add(s); facts.written.push(...(s.text.match(/\d+(?:\.\d+)?/g) ?? [])); }
    shapes.push(...compiled.shapes);
    drawnRaw.length = 0;
  };

  for (const e of elements) {
    const t = str(e.t, 12);
    if (t === "world") {
      flushDrawn();
      facts.kinds.push("world");
      const box: Box = { x: num(e.x) || 20, y: num(e.y) || 20, w: num(e.w) || w - 40, h: num(e.h) || h - 40 };
      if (!inside(box.x, box.y) || !inside(box.x + box.w, box.y + box.h) || box.w < 120 || box.h < 80) { issues.push("the world map's box must lie on the canvas and be at least 120×80"); continue; }
      const lonR = (Array.isArray(e.lon) ? e.lon : [-180, 180]).map(num) as [number, number];
      const latR = (Array.isArray(e.lat) ? e.lat : [-80, 80]).map(num) as [number, number];
      if (!(lonR[0] >= -180 && lonR[1] <= 180 && lonR[1] - lonR[0] >= 10 && latR[0] >= -90 && latR[1] <= 90 && latR[1] - latR[0] >= 10)) { issues.push("world \"lon\" and \"lat\" must be [min, max] windows of at least 10 degrees within ±180 and ±90"); continue; }
      const at = (lon: number, lat: number): [number, number] => [box.x + ((lon - lonR[0]) / (lonR[1] - lonR[0])) * box.w, box.y + ((latR[1] - lat) / (latR[1] - latR[0])) * box.h];
      projection = { box, lon: lonR, lat: latR, at };
      shapes.push({ t: "path", d: `M${r1(box.x)} ${r1(box.y)} h${r1(box.w)} v${r1(box.h)} h${r1(-box.w)} Z`, fill: OCEAN, stroke: "muted", width: 1.2 });
      for (const ring of WORLD_LAND) {
        const pts: Array<[number, number]> = [];
        for (let i = 0; i < ring.length; i += 2) pts.push(at(ring[i], ring[i + 1]));
        const clipped = clipRing(pts, box);
        if (clipped.length < 3) continue;
        shapes.push({ t: "path", d: `M${clipped.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(" L")} Z`, fill: LAND, stroke: "#7c9a6a", width: 0.8, ...partOf(e.part) });
      }
      const lats = (Array.isArray(e.latitudes) ? e.latitudes : []).map(num).filter((l) => Number.isFinite(l) && l > latR[0] && l < latR[1]).slice(0, 9);
      for (const lat of lats) {
        const [x0, y] = at(lonR[0], lat), [x1] = at(lonR[1], lat);
        shapes.push({ t: "path", d: `M${r1(x0)} ${r1(y)} H${r1(x1)}`, stroke: lat === 0 ? "ink" : "muted", width: lat === 0 ? 1.4 : 1, dash: "5 5", fill: "none" });
        shapes.push({ t: "text", x: r1(x0 + 4), y: r1(y - 4), text: latName(lat), size: 12, anchor: "start", fill: "muted" });
      }
      continue;
    }
    if (t === "geoArrow" || t === "geoarrow" || t === "geoPoint" || t === "geopoint" || t === "band") {
      flushDrawn();
      if (!projection) { issues.push(`"${t}" needs a "world" element before it`); continue; }
      facts.kinds.push(t.toLowerCase());
      const p = projection;
      if (t === "band") {
        const lat = (Array.isArray(e.lat) ? e.lat : []).map(num);
        if (lat.length !== 2 || !lat.every((l) => l >= -90 && l <= 90) || lat[0] === lat[1]) { issues.push(`a band needs "lat": [south, north]`); continue; }
        const [, yN] = p.at(p.lon[0], Math.min(p.lat[1], Math.max(...lat))), [, yS] = p.at(p.lon[0], Math.max(p.lat[0], Math.min(...lat)));
        shapes.push({ t: "path", d: `M${r1(p.box.x)} ${r1(yN)} h${r1(p.box.w)} V${r1(yS)} h${r1(-p.box.w)} Z`, fill: tint(e.fill, TINTS.yellow), stroke: "none", opacity: 0.55, ...partOf(e.part) });
        mark(e.part, [p.box.x + p.box.w * 0.08, (yN + yS) / 2]);
        continue;
      }
      if (t.toLowerCase() === "geopoint") {
        const [x, y] = p.at(num(e.lon), num(e.lat));
        if (!inside(x, y)) { issues.push("a geoPoint lies off the map"); continue; }
        shapes.push({ t: "circle", cx: r1(x), cy: r1(y), r: Math.max(3, Math.min(10, num(e.r) || 5)), fill: lineColour(e.color, "ink"), stroke: "paper", width: 1.2, ...partOf(e.part) });
        mark(e.part, [x, y]);
        continue;
      }
      const lonlat = (Array.isArray(e.points) ? e.points : []).filter(Array.isArray).map((q) => [num((q as unknown[])[0]), num((q as unknown[])[1])] as [number, number]);
      if (lonlat.length < 2 || lonlat.some(([lo, la]) => !(lo >= -180 && lo <= 180 && la >= -90 && la <= 90))) { issues.push(`a geoArrow needs "points": [[lon, lat], …] — at least 2, as longitude then latitude`); continue; }
      const pts = lonlat.map(([lo, la]) => p.at(lo, la));
      if (pts.some(([x, y]) => !inside(x, y))) { issues.push("a geoArrow leaves the map window — keep its points inside the world's lon/lat window"); continue; }
      const colour = lineColour(e.color, "ink");
      const width = Math.max(1.5, Math.min(5, num(e.width) || 3));
      shapes.push({ t: "path", d: smooth(pts), stroke: colour, width, fill: "none", ...(e.dash === true ? { dash: "7 5" } : {}), ...partOf(e.part) });
      shapes.push(head(pts[pts.length - 2], pts[pts.length - 1], colour, slug(e.part) && partIds.has(slug(e.part)) ? slug(e.part) : undefined, 8 + width * 2));
      mark(e.part, pts[Math.floor((pts.length - 1) / 2)]);
      continue;
    }
    if (t === "plot") {
      flushDrawn();
      facts.kinds.push("plot");
      const box: Box = { x: num(e.x), y: num(e.y), w: num(e.w), h: num(e.h) };
      if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || !inside(box.x - 60, box.y) || !inside(box.x + box.w, box.y + box.h + 44) || box.w < 120 || box.h < 90) { issues.push("a plot needs x, y, w, h (at least 120×90), with room for its axis titles: 60 left, 44 below"); continue; }
      const axis = (a: unknown) => {
        const o = isObj(a) ? a : {};
        const min = num(o.min), max = num(o.max);
        const ticks = (Array.isArray(o.ticks) ? o.ticks.map(num) : []).filter(Number.isFinite);
        const step = num(o.step);
        const auto = Number.isFinite(step) && step > 0 && (max - min) / step <= 12 ? Array.from({ length: Math.floor((max - min) / step + 1e-9) + 1 }, (_, i) => min + i * step) : [];
        return { label: str(o.label, 30), min, max, ticks: (ticks.length ? ticks : auto).filter((v) => v >= min - 1e-9 && v <= max + 1e-9).slice(0, 13), categories: (Array.isArray(o.categories) ? o.categories : []).map((c) => str(c, 14)).filter(Boolean).slice(0, 10) };
      };
      const X = axis(e.xAxis ?? e.x_axis), Y = axis(e.yAxis ?? e.y_axis);
      const categorical = X.categories.length > 0;
      if (!(Y.max > Y.min) || (!categorical && !(X.max > X.min))) { issues.push(`a plot's axes need "min" < "max" (or "categories" for a bar chart's x axis)`); continue; }
      const px = (v: number) => box.x + ((v - X.min) / (X.max - X.min)) * box.w;
      const py = (v: number) => box.y + box.h - ((v - Y.min) / (Y.max - Y.min)) * box.h;
      const zeroY = Y.min <= 0 && Y.max >= 0 ? py(0) : box.y + box.h;
      // The x axis is the line y = 0 when the data go negative: a potential φ = −GM/r drawn with its
      // r axis at the bottom read as rising from the axis instead of rising towards zero.
      const axisY = Y.min < 0 && Y.max >= 0 && !categorical ? zeroY : box.y + box.h;
      const above = axisY <= box.y + 1;
      shapes.push({ t: "path", d: `M${r1(box.x)} ${r1(box.y - 6)} V${r1(box.y + box.h)}`, stroke: "ink", width: 1.8, fill: "none" });
      shapes.push({ t: "path", d: `M${r1(box.x)} ${r1(axisY)} H${r1(box.x + box.w + 6)}`, stroke: "ink", width: 1.8, fill: "none" });
      for (const v of Y.ticks) {
        const y = py(v);
        shapes.push({ t: "path", d: `M${r1(box.x - 5)} ${r1(y)} H${r1(box.x)}`, stroke: "ink", width: 1.2, fill: "none" });
        if (v !== Y.min) shapes.push({ t: "path", d: `M${r1(box.x)} ${r1(y)} H${r1(box.x + box.w)}`, stroke: "#e5e7eb", width: 0.8, fill: "none" });
        shapes.push({ t: "text", x: r1(box.x - 8), y: r1(y + 4), text: tickText(v), size: 12, anchor: "end", fill: "muted" });
      }
      const slot = categorical ? box.w / X.categories.length : 0;
      if (categorical) X.categories.forEach((c, i) => shapes.push({ t: "text", x: r1(box.x + slot * (i + 0.5)), y: r1(box.y + box.h + 17), text: c, size: 12, anchor: "middle", fill: "ink" }));
      else for (const v of X.ticks) {
        const x = px(v);
        shapes.push({ t: "path", d: `M${r1(x)} ${r1(axisY)} V${r1(axisY + (above ? -5 : 5))}`, stroke: "ink", width: 1.2, fill: "none" });
        if (v !== 0 || axisY === box.y + box.h) shapes.push({ t: "text", x: r1(x), y: r1(above ? axisY - 9 : axisY + 18), text: tickText(v), size: 12, anchor: "middle", fill: "muted" });
      }
      if (X.label) shapes.push(above
        ? { t: "text", x: r1(box.x + box.w + 8), y: r1(axisY - 26), text: X.label, size: 13, anchor: "end", fill: "ink" }
        : { t: "text", x: r1(box.x + box.w / 2), y: r1(box.y + box.h + 38), text: X.label, size: 13, anchor: "middle", fill: "ink" });
      if (Y.label) shapes.push(above
        ? { t: "text", x: r1(box.x), y: r1(box.y + box.h + 20), text: Y.label, size: 13, anchor: "start", fill: "ink" }
        : { t: "text", x: r1(box.x), y: r1(box.y - 14), text: Y.label, size: 13, anchor: "start", fill: "ink" });
      const series = (Array.isArray(e.series) ? e.series : []).filter(isObj).slice(0, 4);
      // Each line's data, by its part id, for intersections.
      const lines = new Map<string, Array<[number, number]>>();
      if (!series.length) issues.push("a plot needs at least one data \"series\"");
      series.forEach((sr, k) => {
        const kind = str(sr.kind, 8) || "line";
        const colour = lineColour(sr.color, (["blue", "red", "green", "orange"] as const).map((c) => LINE_COLOURS[c])[k]);
        const part = partOf(sr.part);
        if (kind === "bars") {
          const values = (Array.isArray(sr.values) ? sr.values : []).map(num);
          if (!categorical || values.length !== X.categories.length || values.some((v) => !Number.isFinite(v))) { issues.push(`a "bars" series needs one number in "values" per x-axis category (${X.categories.length})`); return; }
          const n = series.filter((q) => str(q.kind, 8) === "bars").length, j = series.filter((q, i) => i < k && str(q.kind, 8) === "bars").length;
          values.forEach((v, i) => {
            if (v < Y.min || v > Y.max) issues.push(`the bar value ${v} is outside the y axis (${Y.min}–${Y.max})`);
            facts.data.push(v);
            const bw = (slot * 0.7) / n, x = box.x + slot * i + slot * 0.15 + j * bw, y = py(Math.max(Y.min, Math.min(Y.max, v)));
            shapes.push({ t: "path", d: `M${r1(x)} ${r1(zeroY)} V${r1(y)} h${r1(bw)} V${r1(zeroY)} Z`, fill: colour, stroke: "ink", width: 1, opacity: 0.85, ...part });
            mark(sr.part, [x + bw / 2, (y + zeroY) / 2]);
          });
          return;
        }
        const data = (Array.isArray(sr.points) ? sr.points : []).filter(Array.isArray).map((q) => [num((q as unknown[])[0]), num((q as unknown[])[1])] as [number, number]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).slice(0, 60);
        if (data.length < 2) { issues.push(`a "${kind}" series needs at least 2 "points": [[x, y], …]`); return; }
        const off = data.filter(([a, b]) => a < X.min - 1e-9 || a > X.max + 1e-9 || b < Y.min - 1e-9 || b > Y.max + 1e-9);
        if (off.length) issues.push(`the data point (${off[0].join(", ")}) is outside the axes — widen the axis or correct the point`);
        facts.data.push(...data.flat());
        if (slug(sr.part)) lines.set(slug(sr.part), [...data].sort((a, b) => a[0] - b[0]));
        const pts = data.sort((a, b) => a[0] - b[0]).map(([a, b]) => [px(a), py(Math.max(Y.min, Math.min(Y.max, b)))] as [number, number]);
        if (kind === "area") shapes.push({ t: "path", d: `M${r1(pts[0][0])} ${r1(zeroY)} L${pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(" L")} L${r1(pts[pts.length - 1][0])} ${r1(zeroY)} Z`, fill: colour, stroke: "none", opacity: 0.25, ...part });
        if (kind === "points") for (const [x, y] of pts) shapes.push({ t: "circle", cx: r1(x), cy: r1(y), r: 4, fill: colour, stroke: "ink", width: 0.8, ...part });
        else shapes.push({ t: "path", d: sr.smooth === false ? `M${pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(" L")}` : smooth(pts), stroke: colour, width: 2.6, fill: "none", ...(sr.dash === true ? { dash: "7 5" } : {}), ...part });
        mark(sr.part, pts[Math.round((pts.length - 1) * 0.6)]);
      });
      // Where two lines cross (an equilibrium, a break-even point), found by code — a writer placed
      // P2 and Q2 off the D2–supply crossing (acceptance run 2026-10-17) — with dashed guides to both
      // axes; the crossing and its axis readings can be named parts.
      for (const cross of (Array.isArray(e.intersections) ? e.intersections : []).filter(isObj).slice(0, 4)) {
        const of = (Array.isArray(cross.of) ? cross.of : []).map(slug);
        const [a, b] = [lines.get(of[0] ?? ""), lines.get(of[1] ?? "")];
        if (!a || !b) { issues.push(`an intersection's "of" must name two line series by their part ids`); continue; }
        let hit: [number, number] | undefined;
        for (let i = 0; i < a.length - 1 && !hit; i++) for (let j = 0; j < b.length - 1 && !hit; j++) {
          const [p, q, r, s] = [a[i], a[i + 1], b[j], b[j + 1]];
          const den = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
          if (Math.abs(den) < 1e-12) continue;
          const u = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / den, v = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / den;
          if (u >= 0 && u <= 1 && v >= 0 && v <= 1) hit = [p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1])];
        }
        if (!hit) { issues.push(`the lines "${of[0]}" and "${of[1]}" do not cross on the plot`); continue; }
        const [hx, hy] = [px(hit[0]), py(hit[1])];
        shapes.push({ t: "path", d: `M${r1(box.x)} ${r1(hy)} H${r1(hx)} V${r1(box.y + box.h)}`, stroke: "muted", width: 1.3, dash: "5 4", fill: "none" });
        shapes.push({ t: "circle", cx: r1(hx), cy: r1(hy), r: 4, fill: "ink", stroke: "none", ...partOf(cross.part) });
        mark(cross.part, [hx, hy]);
        if (slug(cross.xPart) && partIds.has(slug(cross.xPart))) { shapes.push({ t: "circle", cx: r1(hx), cy: r1(box.y + box.h), r: 2.5, fill: "ink", stroke: "none", part: slug(cross.xPart) }); mark(cross.xPart, [hx, box.y + box.h]); }
        if (slug(cross.yPart) && partIds.has(slug(cross.yPart))) { shapes.push({ t: "circle", cx: r1(box.x), cy: r1(hy), r: 2.5, fill: "ink", stroke: "none", part: slug(cross.yPart) }); mark(cross.yPart, [box.x, hy]); }
      }
      continue;
    }
    if (t === "layers") {
      flushDrawn();
      facts.kinds.push("layers");
      const [x, y, lw] = [num(e.x), num(e.y), num(e.w)];
      const layers = (Array.isArray(e.layers) ? e.layers : []).filter(isObj).slice(0, 10);
      const total = layers.reduce((a, l) => a + Math.max(0, num(l.h) || 0), 0);
      if (![x, y, lw].every(Number.isFinite) || layers.length < 2 || !inside(x, y) || !inside(x + lw, y + total) || lw < 60) { issues.push(`"layers" needs x, y, w and 2-10 "layers" [{"h", "fill", "part"}] that fit on the canvas`); continue; }
      const wavy = e.wavy === true;
      let top = y;
      layers.forEach((l, i) => {
        const lh = Math.max(4, num(l.h) || 0);
        const edge = (yy: number, k: number) => (wavy && k > 0 ? Array.from({ length: 13 }, (_, j) => [x + (lw * j) / 12, yy + Math.sin(j * 1.3 + k) * Math.min(5, lh / 6)] as [number, number]) : [[x, yy], [x + lw, yy]] as Array<[number, number]>);
        const upper = edge(top, i), lower = edge(top + lh, i === layers.length - 1 ? 0 : i + 1).reverse();
        shapes.push({ t: "path", d: `M${[...upper, ...lower].map(([a, b]) => `${r1(a)} ${r1(b)}`).join(" L")} Z`, fill: tint(l.fill, TINTS.grey), stroke: "ink", width: 1.2, ...partOf(l.part) });
        const texture = str(l.texture, 8);
        if (texture === "dots") for (let k = 0; k < Math.min(60, Math.floor((lw * lh) / 500)); k++) shapes.push({ t: "circle", cx: r1(x + 6 + ((k * 37) % (lw - 12))), cy: r1(top + 4 + ((k * 23) % Math.max(1, lh - 8))), r: 1.6, fill: "muted", stroke: "none", ...partOf(l.part) });
        if (texture === "lines") for (let yy = top + 6; yy < top + lh - 3; yy += 7) shapes.push({ t: "path", d: `M${r1(x + 4)} ${r1(yy)} H${r1(x + lw - 4)}`, stroke: "muted", width: 0.7, fill: "none", ...partOf(l.part) });
        mark(l.part, [x + lw * 0.5, top + lh / 2]);
        top += lh;
      });
      continue;
    }
    if (t === "circulation") {
      // CIRCULATION CELLS WHOSE TURNING CODE DECIDES. The writer says only where the air (or water,
      // or mantle rock) rises and where it sinks; each cell runs between a rising and a sinking stop
      // and turns the one way that physics allows — up at the rising side, across the top, down at
      // the sinking side, back along the ground. Writers drew the Ferrel and southern Hadley cells
      // turning backwards (acceptance run 2026-10-17); this cannot.
      flushDrawn();
      facts.kinds.push("circulation");
      const [x, y, cw, ch] = [num(e.x), num(e.y), num(e.w), num(e.h)];
      const stops = (Array.isArray(e.stops) ? e.stops : []).filter(isObj).slice(0, 9);
      const cells = (Array.isArray(e.cells) ? e.cells : []).filter(isObj);
      if (![x, y, cw, ch].every(Number.isFinite) || cw < 80 || ch < 50 || !inside(x, y) || !inside(x + cw, y + ch + 40) || stops.length < 2) { issues.push(`"circulation" needs x, y, w, h on the canvas (leave 40 below for its labels) and 2-9 "stops" [{"label", "flow": "rise"|"sink"}]`); continue; }
      const flows = stops.map((st) => (/^ris|^up|ascen/i.test(str(st.flow, 10)) ? "rise" : /^sink|^sank|^down|descen/i.test(str(st.flow, 10)) ? "sink" : ""));
      if (flows.some((f) => !f)) { issues.push(`every circulation stop needs "flow": "rise" or "sink"`); continue; }
      const xs = stops.map((st, i) => { const at = num(st.at); return x + (at >= 0 && at <= 1 ? at : i / (stops.length - 1)) * cw; });
      // Stops are drawn where they are listed, left to right: a writer listed 90°S → 90°N with "at"
      // values running the other way, so the labels read backwards against the cells (2026-10-17).
      if (xs.some((v, i) => i > 0 && v <= xs[i - 1] + 4)) { issues.push(`list the circulation "stops" left to right, in the order they are drawn — their "at" values must increase`); continue; }
      const top = y, ground = y + ch;
      shapes.push({ t: "path", d: `M${r1(x)} ${r1(ground)} H${r1(x + cw)}`, stroke: "ink", width: 2.2, fill: "none" });
      for (let i = 0; i < stops.length - 1; i++) {
        if (flows[i] === flows[i + 1]) { issues.push(`between the stops "${str(stops[i].label, 10)}" and "${str(stops[i + 1].label, 10)}" air must rise at one and sink at the other — a cell needs both`); continue; }
        const cell = cells[i] ?? {};
        const part = slug(cell.part) && partIds.has(slug(cell.part)) ? slug(cell.part) : undefined;
        const colour = lineColour(cell.color, (["red", "green", "blue"] as const).map((c) => LINE_COLOURS[c])[i % 3]);
        const inset = Math.min(10, (xs[i + 1] - xs[i]) * 0.12);
        const [L, R, T, B] = [xs[i] + inset, xs[i + 1] - inset, top + 8, ground - 8];
        const rad = Math.min(16, (R - L) / 4, (B - T) / 4);
        shapes.push({ t: "path", d: `M${r1(L + rad)} ${r1(T)} H${r1(R - rad)} Q${r1(R)} ${r1(T)} ${r1(R)} ${r1(T + rad)} V${r1(B - rad)} Q${r1(R)} ${r1(B)} ${r1(R - rad)} ${r1(B)} H${r1(L + rad)} Q${r1(L)} ${r1(B)} ${r1(L)} ${r1(B - rad)} V${r1(T + rad)} Q${r1(L)} ${r1(T)} ${r1(L + rad)} ${r1(T)} Z`, stroke: colour, width: 2.6, fill: "none", ...(part ? { part } : {}) });
        // Rising on the left → up the left, across the top to the right, down the right, back below.
        const risesLeft = flows[i] === "rise";
        const sides: Array<[[number, number], [number, number]]> = [[[L, (T + B) / 2], [L, (T + B) / 2 + (risesLeft ? -1 : 1)]], [[(L + R) / 2, T], [(L + R) / 2 + (risesLeft ? 1 : -1), T]], [[R, (T + B) / 2], [R, (T + B) / 2 + (risesLeft ? 1 : -1)]], [[(L + R) / 2, B], [(L + R) / 2 + (risesLeft ? -1 : 1), B]]];
        for (const [mid, toward] of sides) {
          const dx = toward[0] - mid[0], dy = toward[1] - mid[1];
          shapes.push(head([mid[0] - dx * 7, mid[1] - dy * 7], [mid[0] + dx * 7, mid[1] + dy * 7], colour, part, 13));
        }
        mark(cell.part, [(L + R) / 2, T]);
        // The cell's name inside its loop, as textbooks print it — not a margin label whose leader
        // runs along the tops of the other cells (QA 2026-10-17).
        const cellName = part ? partNames.get(part) : "";
        if (part && cellName) {
          const room = R - L - 12, size = room > 90 ? 14 : 12;
          const lines: string[] = [];
          for (const word of cellName.split(" ")) {
            const last = lines[lines.length - 1];
            if (last !== undefined && (last.length + 1 + word.length) * size * 0.56 <= room) lines[lines.length - 1] = `${last} ${word}`;
            else lines.push(word);
          }
          const mid = (T + B) / 2 - ((lines.length - 1) * size * 1.2) / 2 + size * 0.35;
          lines.forEach((line, k) => shapes.push({ t: "text", x: r1((L + R) / 2), y: r1(mid + k * size * 1.2), text: line, size, anchor: "middle", fill: colour, part }));
          selfNamed.add(part);
        }
      }
      stops.forEach((st, i) => {
        if (e.pressure !== false) shapes.push({ t: "text", x: r1(xs[i]), y: r1(ground + 17), text: flows[i] === "rise" ? "L" : "H", size: 14, anchor: "middle", fill: "ink" });
        const label = str(st.label, 10);
        if (label) shapes.push({ t: "text", x: r1(xs[i]), y: r1(ground + 34), text: label, size: 12, anchor: "middle", fill: "muted" });
        mark(st.part, [xs[i], ground]);
      });
      continue;
    }
    if (t === "rays") {
      // PARALLEL RAYS THAT LAND WHERE THEY SHOULD. Every ray travels the same way and ends exactly on
      // its hit point; a reflected ray starts there. A writer's rays crossed each other and its
      // reflections floated in mid-air (acceptance run 2026-10-17).
      flushDrawn();
      facts.kinds.push("rays");
      const angle = (num(e.angle) * Math.PI) / 180, length = num(e.length) || 90;
      const hits = (Array.isArray(e.hits) ? e.hits : []).filter(Array.isArray).map((q) => [num((q as unknown[])[0]), num((q as unknown[])[1])] as [number, number]).filter(([a, b]) => inside(a, b)).slice(0, 20);
      if (!Number.isFinite(angle) || hits.length < 1) { issues.push(`"rays" needs "angle" (direction of travel in degrees: 0 right, 90 down) and "hits": [[x, y], …] where each ray lands`); continue; }
      const colour = lineColour(e.color, LINE_COLOURS.orange);
      const part = slug(e.part) && partIds.has(slug(e.part)) ? slug(e.part) : undefined;
      const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
      for (const [hx, hy] of hits) {
        const start: [number, number] = [Math.max(-10, Math.min(w + 10, hx - ux * length)), Math.max(-10, Math.min(h + 10, hy - uy * length))];
        shapes.push({ t: "path", d: `M${r1(start[0])} ${r1(start[1])} L${r1(hx)} ${r1(hy)}`, stroke: colour, width: 2.4, fill: "none", ...(part ? { part } : {}) });
        shapes.push(head(start, [hx, hy], colour, part, 11));
      }
      mark(e.part, ...hits.map(([hx, hy]) => [hx - ux * length * 0.5, hy - uy * length * 0.5] as [number, number]));
      const reflect = isObj(e.reflect) ? e.reflect : undefined;
      if (reflect) {
        const ra = (num(reflect.angle) * Math.PI) / 180, rl = num(reflect.length) || length * 0.6;
        const rc = lineColour(reflect.color, "muted");
        const rp = slug(reflect.part) && partIds.has(slug(reflect.part)) ? slug(reflect.part) : undefined;
        if (!Number.isFinite(ra)) issues.push(`a reflection needs "angle" (direction it leaves in, degrees)`);
        else for (const [hx, hy] of hits.filter((_, i) => reflect.every !== false || i % 2 === 0)) {
          const end: [number, number] = [hx + Math.cos(ra) * rl, hy + Math.sin(ra) * rl];
          shapes.push({ t: "path", d: `M${r1(hx)} ${r1(hy)} L${r1(end[0])} ${r1(end[1])}`, stroke: rc, width: 2, dash: "6 4", fill: "none", ...(rp ? { part: rp } : {}) });
          shapes.push(head([hx, hy], end, rc, rp, 10));
          mark(reflect.part, [hx + Math.cos(ra) * rl * 0.6, hy + Math.sin(ra) * rl * 0.6]);
        }
      }
      continue;
    }
    if (t === "beam") {
      // A BEAM OF PARTICLES MEETING A TARGET, IN EXACT PROPORTIONS: each group of paths comes from the
      // source, reaches the target and leaves at its own turn (0 = straight on, 180 = straight back).
      // The writer gives the numbers ("most pass straight through" — the most paths); code draws them.
      flushDrawn();
      facts.kinds.push("beam");
      const from = Array.isArray(e.from) ? [num(e.from[0]), num(e.from[1])] as [number, number] : [Number.NaN, Number.NaN] as [number, number];
      const at = Array.isArray(e.at) ? [num(e.at[0]), num(e.at[1])] as [number, number] : [Number.NaN, Number.NaN] as [number, number];
      const groups = (Array.isArray(e.groups) ? e.groups : []).filter(isObj).slice(0, 4);
      const total = groups.reduce((a, g) => a + Math.max(0, Math.round(num(g.count)) || 0), 0);
      if (!inside(...from) || !inside(...at) || groups.length < 1 || total < 1 || total > 15) { issues.push(`"beam" needs "from": [x, y], "at": [x, y] on the canvas and "groups": [{"count", "turn", "part"}] with 1-15 paths in all`); continue; }
      const dist = Math.hypot(at[0] - from[0], at[1] - from[1]);
      const [ux, uy] = [(at[0] - from[0]) / dist, (at[1] - from[1]) / dist];
      const spread = Math.min(num(e.spread) || 36, dist * 0.4);
      const after = num(e.length) || dist * 0.75;
      let k = 0;
      groups.forEach((g, gi) => {
        const count = Math.max(0, Math.round(num(g.count)) || 0);
        const turn = Math.max(0, Math.min(180, Math.abs(num(g.turn)) || 0));
        const colour = lineColour(g.color, (["blue", "orange", "red", "green"] as const).map((c) => LINE_COLOURS[c])[gi]);
        const part = slug(g.part) && partIds.has(slug(g.part)) ? slug(g.part) : undefined;
        for (let i = 0; i < count; i++, k++) {
          const off = total === 1 ? 0 : -spread / 2 + (spread * k) / (total - 1);
          const [nx, ny] = [-uy * off, ux * off];
          const start: [number, number] = [from[0] + nx * 0.25, from[1] + ny * 0.25];
          const hit: [number, number] = [at[0] + nx, at[1] + ny];
          const side = i % 2 === 0 ? 1 : -1;
          const a = Math.atan2(uy, ux) + side * (turn * Math.PI) / 180;
          const end: [number, number] = [hit[0] + Math.cos(a) * after * (turn > 90 ? 0.6 : 1), hit[1] + Math.sin(a) * after * (turn > 90 ? 0.6 : 1)];
          shapes.push({ t: "path", d: `M${r1(start[0])} ${r1(start[1])} L${r1(hit[0])} ${r1(hit[1])} L${r1(end[0])} ${r1(end[1])}`, stroke: colour, width: 2, fill: "none", ...(part ? { part } : {}) });
          shapes.push(head(hit, end, colour, part, 10));
          if (i === 0) mark(g.part, [hit[0] + (end[0] - hit[0]) * 0.6, hit[1] + (end[1] - hit[1]) * 0.6]);
        }
        facts.counts.push({ part: part ?? "", count });
      });
      continue;
    }
    if (t === "loop") {
      // A circulation: air in a Hadley cell, a convection current, a sea breeze — a closed loop of
      // flow with arrowheads, turning the way it is given.
      flushDrawn();
      facts.kinds.push("loop");
      const [x, y, lw, lh] = [num(e.x), num(e.y), num(e.w), num(e.h)];
      if (![x, y, lw, lh].every(Number.isFinite) || lw < 30 || lh < 20 || !inside(x, y) || !inside(x + lw, y + lh)) { issues.push(`a "loop" needs x, y, w, h on the canvas (at least 30×20)`); continue; }
      const clockwise = str(e.direction, 12).replace(/[^a-z]/g, "") !== "anticlockwise" && str(e.direction, 12) !== "ccw";
      const colour = lineColour(e.color, "ink");
      const width = Math.max(1.5, Math.min(5, num(e.width) || 2.6));
      const [cx, cy, rx, ry] = [x + lw / 2, y + lh / 2, lw / 2, lh / 2];
      // Four quarter arcs, each ending in an arrowhead, so the direction reads anywhere on the loop.
      const at = (k: number): [number, number] => [cx + rx * Math.cos(k), cy + ry * Math.sin(k)];
      const part = slug(e.part) && partIds.has(slug(e.part)) ? slug(e.part) : undefined;
      for (let q = 0; q < 4; q++) {
        const a0 = (q * Math.PI) / 2 + 0.12, a1 = ((q + 1) * Math.PI) / 2 - 0.12;
        const pts = Array.from({ length: 9 }, (_, i) => at(clockwise ? a0 + ((a1 - a0) * i) / 8 : -(a0 + ((a1 - a0) * i) / 8)));
        shapes.push({ t: "path", d: smooth(pts), stroke: colour, width, fill: "none", ...(part ? { part } : {}) });
        shapes.push(head(pts[7], pts[8], colour, part, 8 + width * 2));
      }
      mark(e.part, at(clockwise ? -Math.PI / 2 : Math.PI / 2), [cx, cy - ry], [cx, cy + ry]);
      continue;
    }
    if (t === "repeat") {
      const count = Math.round(num(e.count));
      const shape = isObj(e.shape) ? e.shape : undefined;
      if (!shape || !(count >= 1 && count <= 60)) { issues.push(`"repeat" needs a "shape" and a "count" of 1-60`); continue; }
      facts.kinds.push("repeat");
      const cols = Math.max(1, Math.min(count, Math.round(num(e.cols)) || count));
      const dx = num(e.dx) || 0, dy = num(e.dy) || 0;
      const part = slug(e.part ?? shape.part);
      facts.counts.push({ part, count });
      for (let i = 0; i < count; i++) {
        const copy = shifted({ ...shape, ...(part ? { part } : {}) }, (i % cols) * dx, Math.floor(i / cols) * (dy || 0));
        drawnRaw.push(copy);
        markFree(part, ...shapePoints(copy));
      }
      continue;
    }
    if (t === "geometry" || t === "collision") {
      flushDrawn();
      facts.kinds.push(t);
      const made = (t === "geometry" ? geometryElement : collisionElement)(e, { inside, partOf, mark, lineColour, tint, written: facts.written, selfLabel: (part) => { const id = slug(part); if (id && partIds.has(id)) selfNamed.add(id); } });
      issues.push(...made.issues);
      shapes.push(...made.shapes);
      continue;
    }
    // Any other element is a shape of the drawn grammar.
    drawnRaw.push(e);
    markFree(e.part, ...shapePoints(e));
  }
  flushDrawn();

  if (shapes.length > 600) issues.push(`the diagram has ${shapes.length} shapes — at most 600`);
  // Names belong to the label engine: a part's name written into the art would be printed twice.
  const names = rawParts.map((p) => str(p.name, 40).toLowerCase()).filter((n) => n.length > 3);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.t === "text" && writerText.has(s) && names.some((n) => s.text.toLowerCase().includes(n.slice(0, 6)))) shapes.splice(i, 1);
  }
  const parts: FigurePart[] = [];
  const bounds = partBounds({ w, h, shapes, parts: [] });
  const seen = new Set<string>();
  // Every word the art writes, in glyphs the board font draws ("OM ⟂ AB" was seven boxes).
  for (const sh of shapes) if (sh.t === "text") sh.text = drawableText(sh.text);
  // Where every shape's ink and every word is, for choosing label points a leader can reach.
  const index = inkIndex(shapes);
  const exact = new Set<string>();
  for (const p of rawParts) {
    if (selfNamed.has(slug(p.id))) continue;
    const full = drawableText(str(p.name, 200));
    const id = slug(p.id), name = full.slice(0, 34);
    if (!id || !name || seen.has(id)) { issues.push(`part "${id || name || "?"}" needs a unique id and a name`); continue; }
    // A name is never cut: one too long goes back to the writer.
    if (full.length > 34) issues.push(`the part name "${full}" is ${full.length} characters — name it in at most 34`);
    seen.add(id);
    // A place on a map is named by where it is: "at": [lon, lat] (a country, an ocean, a city).
    const at = Array.isArray(p.at) && projection ? projection.at(num(p.at[0]), num(p.at[1])) : undefined;
    if (at && inside(at[0], at[1])) { exact.add(id); parts.push({ id, name, anchor: { x: r1(at[0]), y: r1(at[1]) } }); continue; }
    const own = points.get(id) ?? [];
    if (!own.length) { issues.push(`part "${id}" has nothing drawn — give its elements "part": "${id}"${projection ? `, or place it on the map with "at": [lon, lat]` : ""}`); continue; }
    // The writer's own anchor is kept only for a part made of free shapes, and only when it lies ON
    // the part's ink — not merely inside its bounding box, where "Ferrel cell" pointed at the gap
    // between two cells (acceptance run 2026-10-17). A part an element placed is labelled where code
    // drew it; a free anchor off the ink is sent back with the reason.
    const a = isObj(p.anchor) ? { x: num(p.anchor.x), y: num(p.anchor.y) } : undefined;
    const b = bounds.get(id);
    let anchor: { x: number; y: number };
    const onInk = a && Number.isFinite(a.x) && Number.isFinite(a.y) && partInkDistance({ shapes }, id, a.x, a.y, true) <= 6;
    if (a && !placed.has(id) && !onInk) issues.push(`part "${id}"'s anchor (${Math.round(a.x)}, ${Math.round(a.y)}) is not on its own lines or inside its shape — move it onto the part, or leave "anchor" out and code will place it`);
    if (a && onInk && !placed.has(id)) anchor = { x: r1(a.x), y: r1(a.y) };
    else {
      // The point on the part nearest the middle of its points — on the part, never in empty space,
      // and not under another part drawn inside it (a nucleus's label pointed at a chromosome).
      const within = (q: [number, number], o: { x: number; y: number; w: number; h: number }) => q[0] >= o.x && q[0] <= o.x + o.w && q[1] >= o.y && q[1] <= o.y + o.h;
      const others = [...bounds].filter(([k, o]) => k !== id && b && !(o.x <= b.x && o.y <= b.y && o.x + o.w >= b.x + b.w && o.y + o.h >= b.y + b.h)).map(([, o]) => o);
      const free = own.filter((q) => !others.some((o) => within(q, o)));
      // Never on a word (a body's dot sat on its "A"), and preferably where a leader from a margin
      // reaches it without running over other parts' ink.
      const clearOfText = (free.length ? free : own).filter((q) => textGap(index, q[0], q[1]) > 6);
      const pool = clearOfText.length ? clearOfText : free.length ? free : own;
      const cx = own.reduce((s, q) => s + q[0], 0) / own.length, cy = own.reduce((s, q) => s + q[1], 0) / own.length;
      const cost = (q: [number, number]) => Math.min(rayBlocked(index, id, q[0], q[1], "left", w), rayBlocked(index, id, q[0], q[1], "right", w)) * 4 + Math.hypot(q[0] - cx, q[1] - cy);
      const scored = pool.length > 40 ? pool.filter((_, i) => i % Math.ceil(pool.length / 40) === 0) : pool;
      const best = scored.map((q) => ({ q, c: cost(q) })).reduce((m, x) => (x.c < m.c ? x : m)).q;
      anchor = { x: r1(best[0]), y: r1(best[1]) };
    }
    // A point a margin leader reaches without running over other parts or along the part's own edge.
    // Exact single points (a crossing, a place on the map, a geometry point) are never moved.
    // A part drawn as a point (a crossing's dot, a geometry point, a city) is exact: its dot never moves.
    const single = !b || (b.w <= 12 && b.h <= 12);
    if (single) exact.add(id);
    parts.push({ id, name, anchor: single ? anchor : clearAnchor(index, id, anchor, w) });
  }
  // A graph or a map may have one named thing (its curve, its current); anything else needs two.
  if (!parts.length && selfNamed.size) issues.push(`the names written inside the diagram (${[...selfNamed].join(", ")}) are not margin labels — also name at least one other part a label should point at (give a circulation stop a "part", e.g. the ITCZ or a subtropical high)`);
  else if (parts.length < (facts.kinds.some((k) => k === "plot" || k === "world" || k === "circulation") ? 1 : 2) - (selfNamed.size ? 1 : 0)) issues.push("name at least 2 parts");
  if (shapes.length < 3) issues.push("the diagram has fewer than 3 valid shapes");
  if (issues.length) return { issues: [...new Set(issues)].slice(0, 8), facts };
  const drawing: FigureDrawing = { w, h, shapes, parts };
  COMPILED.add(drawing);
  EXACT.set(drawing, exact);
  return { drawing, issues: [], facts };
}

/**
 * A compiled diagram cropped to its art (lib/diagrams/ink.ts cropToInk), still trusted by the
 * validator: a writer who drew in half the canvas no longer gets half the frame.
 */
export function fitCompiledDiagram(drawing: FigureDrawing): FigureDrawing {
  // Cropped first: the labels are then laid out at the scale the student sees, and each dot is moved
  // along its own part until its leader runs over no other part (lib/diagrams/leaders.ts).
  const fitted = untangleLeaders(cropToInk(drawing), EXACT.get(drawing));
  if (isCompiledDiagram(drawing)) { COMPILED.add(fitted); EXACT.set(fitted, EXACT.get(drawing) ?? new Set()); }
  return fitted;
}
