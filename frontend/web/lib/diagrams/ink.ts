import type { FigureDrawing, FigureShape } from "../figures/types";

/**
 * WHERE A DIAGRAM'S INK IS. Pure geometry over the drawn shapes: points along every outline (lines,
 * Béziers and arcs sampled), how far a point is from a part's ink, the box the ink covers, and the
 * drawing moved so that box is what fills the frame.
 *
 * Used to hold a writer's label anchor to the part it names (a "Ferrel cell" dot landed in the gap
 * between two cells and its leader crossed the "Polar cell" one — acceptance run 2026-10-17), and to
 * crop a drawing to its art so a diagram drawn in half its canvas is not shown at half size.
 */

type P = [number, number];
type Box = { x: number; y: number; w: number; h: number };

/** Points along a path, in order, with each subpath's start index (for closing and filling). */
export function pathSamples(d: string): { points: P[]; runs: Array<{ from: number; to: number; closed: boolean }> } {
  const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const points: P[] = [];
  const runs: Array<{ from: number; to: number; closed: boolean }> = [];
  let cmd = "M", x = 0, y = 0, sx = 0, sy = 0, i = 0, start = 0;
  let lastCtrl: P | null = null;
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const num = () => Number(tokens[i++]);
  const close = (closed: boolean) => { if (points.length > start) runs.push({ from: start, to: points.length, closed }); start = points.length; };
  const bez = (ctrl: P[], end: P) => {
    const pts = [[x, y] as P, ...ctrl, end];
    for (let j = 1; j <= 12; j++) {
      const t = j / 12;
      let row = pts;
      while (row.length > 1) row = row.slice(1).map((p, k) => [row[k][0] + (p[0] - row[k][0]) * t, row[k][1] + (p[1] - row[k][1]) * t] as P);
      points.push(row[0]);
    }
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") { points.push([sx, sy]); x = sx; y = sy; close(true); lastCtrl = null; continue; }
    if (!isNum()) { i++; continue; }
    const pair = (): P => { const a = num(), b = num(); return rel ? [x + a, y + b] : [a, b]; };
    if (C === "M") {
      close(false);
      [x, y] = pair(); sx = x; sy = y; points.push([x, y]); cmd = rel ? "l" : "L"; lastCtrl = null;
    } else if (C === "L" || C === "T") { [x, y] = pair(); points.push([x, y]); lastCtrl = null; }
    else if (C === "H") { const a = num(); x = rel ? x + a : a; points.push([x, y]); lastCtrl = null; }
    else if (C === "V") { const a = num(); y = rel ? y + a : a; points.push([x, y]); lastCtrl = null; }
    else if (C === "C") { const p1 = pair(), p2 = pair(), p3 = pair(); bez([p1, p2], p3); [x, y] = p3; lastCtrl = p2; }
    else if (C === "S") { const p1: P = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y]; const p2 = pair(), p3 = pair(); bez([p1, p2], p3); [x, y] = p3; lastCtrl = p2; }
    else if (C === "Q") { const p1 = pair(), p2 = pair(); bez([p1], p2); [x, y] = p2; lastCtrl = p1; }
    else if (C === "A") {
      const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = num(), sweep = num();
      const end = pair();
      points.push(...arc(x, y, rx, ry, rot, large === 1, sweep === 1, end[0], end[1]));
      [x, y] = end; lastCtrl = null;
    } else i++;
  }
  close(false);
  return { points, runs };
}

/** Points along an SVG arc (endpoint form, SVG 1.1 F.6.5). */
function arc(x1: number, y1: number, rx: number, ry: number, deg: number, large: boolean, sweep: boolean, x2: number, y2: number): P[] {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x2, y2]];
  const phi = (deg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const fit = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (fit > 1) { rx *= Math.sqrt(fit); ry *= Math.sqrt(fit); }
  const n = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, n / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const t1 = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  let dt = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - t1;
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const out: P[] = [];
  for (let j = 1; j <= 24; j++) {
    const t = t1 + (dt * j) / 24;
    out.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return out;
}

const segDist = (p: P, a: P, b: P) => {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len = vx * vx + vy * vy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
};

function inside(p: P, ring: P[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-9) + xi) hit = !hit;
  }
  return hit;
}

const filled = (sh: FigureShape) => "fill" in sh && sh.fill !== undefined && sh.fill !== "none";

function textBox(sh: Extract<FigureShape, { t: "text" }>): Box {
  const w = sh.text.length * sh.size * 0.56;
  const x = sh.anchor === "start" ? sh.x : sh.anchor === "end" ? sh.x - w : sh.x - w / 2;
  return { x, y: sh.y - sh.size * 0.85, w, h: sh.size * 1.1 };
}

/**
 * How far (x, y) is from one shape's ink: 0 on a line, inside a filled shape or on a word. With
 * `interior`, inside any closed outline counts too (a lumen is the space its unfilled ring encloses).
 */
export function shapeDistance(sh: FigureShape, x: number, y: number, interior = false): number {
  const p: P = [x, y];
  if (sh.t === "circle") {
    const d = Math.hypot(x - sh.cx, y - sh.cy);
    return (filled(sh) || interior) && d <= sh.r ? 0 : Math.abs(d - sh.r);
  }
  if (sh.t === "text") {
    const b = textBox(sh);
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w)), dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    return Math.hypot(dx, dy);
  }
  const { points, runs } = pathSamples(sh.d);
  let best = Infinity;
  for (const run of runs) {
    const ring = points.slice(run.from, run.to);
    if (ring.length === 1) best = Math.min(best, Math.hypot(x - ring[0][0], y - ring[0][1]));
    for (let k = 0; k + 1 < ring.length; k++) best = Math.min(best, segDist(p, ring[k], ring[k + 1]));
    // A filled outline counts its inside (a label dot inside a filled organ is on it); closed or
    // not — a path's fill closes it.
    if ((filled(sh) || (interior && run.closed)) && ring.length >= 3 && inside(p, ring)) return 0;
  }
  return best;
}

/** How far (x, y) is from the ink of a part (Infinity when the part has none). */
export function partInkDistance(drawing: Pick<FigureDrawing, "shapes">, part: string, x: number, y: number, interior = false): number {
  let best = Infinity;
  for (const sh of drawing.shapes) if (sh.part === part) best = Math.min(best, shapeDistance(sh, x, y, interior));
  return best;
}

/** The parts nearest a point, nearest first, by the distance to their ink. */
export function nearestParts(drawing: Pick<FigureDrawing, "shapes">, x: number, y: number): Array<{ part: string; distance: number }> {
  const best = new Map<string, number>();
  for (const sh of drawing.shapes) {
    if (!sh.part) continue;
    const d = shapeDistance(sh, x, y);
    if (d < (best.get(sh.part) ?? Infinity)) best.set(sh.part, d);
  }
  return [...best].map(([part, distance]) => ({ part, distance })).sort((a, b) => a.distance - b.distance);
}

/** The box all the ink covers (words by their estimated width). */
export function inkBox(shapes: FigureShape[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const sh of shapes) {
    if (sh.t === "circle") { grow(sh.cx - sh.r, sh.cy - sh.r); grow(sh.cx + sh.r, sh.cy + sh.r); continue; }
    if (sh.t === "text") { const b = textBox(sh); grow(b.x, b.y); grow(b.x + b.w, b.y + b.h); continue; }
    const w = (sh.width ?? 1.6) / 2;
    for (const [x, y] of pathSamples(sh.d).points) { grow(x - w, y - w); grow(x + w, y + w); }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** A path moved by (dx, dy): absolute coordinates shift, relative ones stay (a leading "m" is absolute). */
export function translatePath(d: string, dx: number, dy: number): string {
  const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: string[] = [];
  let cmd = "M", i = 0, first = true;
  const r = (n: number) => String(Math.round(n * 100) / 100);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) { cmd = tokens[i++]; out.push(cmd); if (cmd.toUpperCase() === "Z") continue; }
    if (!isNum()) continue;
    const abs = cmd === cmd.toUpperCase() || (first && cmd === "m");
    const C = cmd.toUpperCase();
    const take = () => Number(tokens[i++]);
    const pairs = (n: number) => { for (let k = 0; k < n; k++) { const a = take(), b = take(); out.push(abs ? `${r(a + dx)} ${r(b + dy)}` : `${r(a)} ${r(b)}`); } };
    // Pairs after a moveto are linetos (the rest of an "m" run is relative).
    if (C === "M") { pairs(1); cmd = cmd === "M" ? "L" : "l"; }
    else if (C === "L" || C === "T") pairs(1);
    else if (C === "H") { const a = take(); out.push(r(abs ? a + dx : a)); }
    else if (C === "V") { const a = take(); out.push(r(abs ? a + dy : a)); }
    else if (C === "C") pairs(3);
    else if (C === "S" || C === "Q") pairs(2);
    else if (C === "A") { out.push(`${take()} ${take()} ${take()} ${take()} ${take()}`); pairs(1); }
    else i++;
    first = false;
  }
  return out.join(" ").replace(/([MLHVCSQTAZmlhvcsqtaz]) /g, "$1");
}

/** A shape moved by (dx, dy). */
export function translateShape(sh: FigureShape, dx: number, dy: number): FigureShape {
  if (sh.t === "circle") return { ...sh, cx: sh.cx + dx, cy: sh.cy + dy };
  if (sh.t === "text") return { ...sh, x: sh.x + dx, y: sh.y + dy };
  return { ...sh, d: translatePath(sh.d, dx, dy) };
}

/**
 * THE DRAWING CROPPED TO ITS ART. A writer's 640×400 canvas with the art in 530×255 of it showed the
 * diagram at about half the frame (an ocean-currents map at ~55% width, a three-cell model in half
 * the height — QA 2026-10-17); the board scales a drawing's w×h into its stage, so the canvas is cut
 * to the ink plus a margin. It never zooms past `maxZoom` (a tiny sketch is not blown up), and keeps
 * the original when the art already fills it.
 */
export function cropToInk<T extends FigureDrawing>(drawing: T, pad = 12, maxZoom = 1.8): T {
  const box = inkBox(drawing.shapes);
  if (!box || box.w <= 0 || box.h <= 0) return drawing;
  let x0 = Math.max(-pad, box.x - pad), y0 = Math.max(-pad, box.y - pad);
  let x1 = Math.min(drawing.w + pad, box.x + box.w + pad), y1 = Math.min(drawing.h + pad, box.y + box.h + pad);
  // Anchors are on the art, but a map label's "at" may name a place just off it.
  for (const p of drawing.parts) { x0 = Math.min(x0, p.anchor.x - 4); y0 = Math.min(y0, p.anchor.y - 4); x1 = Math.max(x1, p.anchor.x + 4); y1 = Math.max(y1, p.anchor.y + 4); }
  // At most maxZoom: widen the crop round its centre.
  const minW = drawing.w / maxZoom, minH = drawing.h / maxZoom;
  if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
  if (y1 - y0 < minH) { const c = (y0 + y1) / 2; y0 = c - minH / 2; y1 = c + minH / 2; }
  const w = x1 - x0, h = y1 - y0;
  // Already filling its canvas: nothing to gain.
  if (w >= drawing.w * 0.94 && h >= drawing.h * 0.94) return drawing;
  const dx = -x0, dy = -y0;
  return {
    ...drawing,
    w: Math.round(w * 10) / 10,
    h: Math.round(h * 10) / 10,
    shapes: drawing.shapes.map((s) => translateShape(s, dx, dy)),
    parts: drawing.parts.map((p) => ({ ...p, anchor: { x: Math.round((p.anchor.x + dx) * 10) / 10, y: Math.round((p.anchor.y + dy) * 10) / 10 } })),
  };
}

/* ── what a label's leader would run into ─────────────────────────────────────────────────── */

type Indexed = { part: string; box: Box; runs: P[][]; text?: Box };

/** Every shape's outline sampled once, with its box, for repeated distance queries. */
export function inkIndex(shapes: FigureShape[]): Indexed[] {
  return shapes.map((sh) => {
    if (sh.t === "text") { const b = textBox(sh); return { part: sh.part ?? "", box: b, runs: [], text: b }; }
    if (sh.t === "circle") {
      const ring: P[] = Array.from({ length: 33 }, (_, i) => [sh.cx + sh.r * Math.cos((i * Math.PI) / 16), sh.cy + sh.r * Math.sin((i * Math.PI) / 16)]);
      return { part: sh.part ?? "", box: { x: sh.cx - sh.r, y: sh.cy - sh.r, w: sh.r * 2, h: sh.r * 2 }, runs: [ring] };
    }
    const { points, runs } = pathSamples(sh.d);
    const rs = runs.map((r) => points.slice(r.from, r.to));
    const all = rs.flat();
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    return { part: sh.part ?? "", box: all.length ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } : { x: 0, y: 0, w: 0, h: 0 }, runs: rs };
  });
}

/** How far a point is from any word drawn in the art (its glyph box). */
export function textGap(index: Indexed[], x: number, y: number): number {
  let best = Infinity;
  for (const s of index) if (s.text) best = Math.min(best, Math.hypot(Math.max(s.text.x - x, 0, x - (s.text.x + s.text.w)), Math.max(s.text.y - y, 0, y - (s.text.y + s.text.h))));
  return best;
}

/** Is (x, y) within `tol` of ink (or a word) that does not belong to `part` (any part's, with `own`)? */
export function nearOtherInk(index: Indexed[], part: string, x: number, y: number, tol: number, own = false): boolean {
  for (const s of index) {
    if (!own && s.part && s.part === part) continue;
    if (x < s.box.x - tol || x > s.box.x + s.box.w + tol || y < s.box.y - tol || y > s.box.y + s.box.h + tol) continue;
    if (s.text) return true;
    if (!s.part) continue;
    for (const run of s.runs) for (let k = 0; k + 1 < run.length; k++) if (segDist([x, y], run[k], run[k + 1]) <= tol) return true;
  }
  return false;
}

/**
 * How much of a straight path from (x, y) to the canvas edge on one side runs over other parts' ink
 * or words, in px — the margin leader that would reach the point. A leader along the top edges of
 * two circulation cells read as pointing at them (QA 2026-10-17).
 */
export function rayBlocked(index: Indexed[], part: string, x: number, y: number, side: "left" | "right", w: number): number {
  let blocked = 0;
  const end = side === "left" ? -10 : w + 10;
  // Its own outline counts too past the first few px: a leader laid along the part's own edge (a
  // block's top) reads as underlining it rather than pointing at it.
  for (let px = x + (side === "left" ? -6 : 6); side === "left" ? px > end : px < end; px += side === "left" ? -3 : 3) if (nearOtherInk(index, part, px, y, 2.5, true)) blocked += 3;
  return blocked;
}

/** Points along a part's own ink (every outline sampled), at most `max` of them. */
export function partInkPoints(index: Indexed[], part: string, max = 60): P[] {
  const pts: P[] = [];
  for (const s of index) if (s.part === part && !s.text) for (const run of s.runs) for (let k = 0; k + 1 < run.length; k++) {
    const [a, b] = [run[k], run[k + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
    for (let j = 0; j < n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  const step = Math.max(1, Math.ceil(pts.length / max));
  return pts.filter((_, i) => i % step === 0);
}

/**
 * A label point a margin leader can reach: `anchor` when a straight run to one side is clear (at most
 * `ok` px over ink), else the point on the part's own ink — clear of words — whose run is clearest,
 * nearest the original. A writer's dot on a goblet cell had its leader drawn through the cilia.
 */
export function clearAnchor(index: Indexed[], part: string, anchor: { x: number; y: number }, w: number, ok = 9): { x: number; y: number } {
  const cost = (x: number, y: number) => Math.min(rayBlocked(index, part, x, y, "left", w), rayBlocked(index, part, x, y, "right", w));
  if (cost(anchor.x, anchor.y) <= ok && textGap(index, anchor.x, anchor.y) > 5) return anchor;
  let best = { x: anchor.x, y: anchor.y, c: cost(anchor.x, anchor.y) * 4 + (textGap(index, anchor.x, anchor.y) > 5 ? 0 : 200) };
  for (const [x, y] of partInkPoints(index, part)) {
    if (textGap(index, x, y) <= 6) continue;
    const c = cost(x, y) * 4 + Math.hypot(x - anchor.x, y - anchor.y) * 0.3;
    if (c < best.c) best = { x, y, c };
  }
  return { x: Math.round(best.x * 10) / 10, y: Math.round(best.y * 10) / 10 };
}
