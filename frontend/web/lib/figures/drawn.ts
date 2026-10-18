import type { FigureDrawing, FigureShape, Ink, Pt } from "./types";

/**
 * A DIAGRAM FOR ANY TOPIC, DRAWN FROM A CHECKED DESCRIPTION. Where no code-drawn component
 * (lib/figures/registry.ts) and no textbook diagram (lib/figures/library.ts) fits, the board writer
 * describes the figure itself — textbook line art from a small vocabulary of shapes in a fixed soft
 * palette, every part named, with the point a label should touch. This checks it the way the label
 * engine needs it: each part has its own shapes, its anchor lies ON them (on a stroke, or inside a
 * closed shape of its own that no other part's shape covers — not merely inside the part's bounding
 * box, which for a curved part can cover its neighbours), nothing leaves the canvas,
 * no label is baked into the art (labels are placed by lib/figures/labels.ts), and path data is
 * plain geometry. The result is an ordinary FigureDrawing, labelled and revealed like any figure.
 */

/** Soft textbook tints by name (no free colours: one house style across every subject). */
export const TINTS: Record<string, `#${string}`> = {
  blue: "#bfdbfe", green: "#bbf7d0", red: "#fecaca", yellow: "#fef08a", orange: "#fed7aa", purple: "#ddd6fe",
  pink: "#fbcfe8", cyan: "#a5f3fc", brown: "#e7c9a5", grey: "#e5e7eb", sand: "#fde68a", sky: "#e0f2fe",
};
// Strong line colours carry meaning (a warm current red, a cold one blue, a Hadley cell's air): a
// writer's "red" arrow came out black when only ink and muted were allowed (acceptance run 2026-10-17).
const STROKES: Record<string, Ink | "none"> = { ink: "ink", muted: "muted", none: "none", red: "#dc2626", blue: "#2563eb", green: "#16a34a", orange: "#ea580c", purple: "#7c3aed", brown: "#92400e" };

type Raw = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const slug = (v: unknown) => str(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The shapes of a described drawing, checked: anything off the canvas or malformed is dropped, styles
 * come only from the house palette. Shared by drawnFigure and the diagram grammar (lib/diagrams/grammar.ts).
 */
export function drawnShapes(rawShapes: Raw[], w: number, h: number, partIds: Set<string>, maxTexts = 8): { shapes: FigureShape[]; issues: string[]; boxy: number; organic: number } {
  const issues: string[] = [];
  const inside = (x: number, y: number) => x >= -10 && x <= w + 10 && y >= -10 && y <= h + 10;
  const shapes: FigureShape[] = [];
  let texts = 0;
  let boxy = 0, organic = 0;
  for (const s of rawShapes.slice(0, 160)) {
    if (!s || typeof s !== "object") continue;
    const part = slug(s.part);
    const style = {
      ...(part && partIds.has(part) ? { part } : {}),
      fill: (TINTS[str(s.fill, 12)] ?? (str(s.fill, 12) === "ink" ? "ink" : str(s.fill, 12) === "white" ? "paper" : "none")) as Ink | "none",
      stroke: STROKES[str(s.stroke, 8)] ?? "ink",
      width: Math.max(0.8, Math.min(4, num(s.width) || 2)),
      ...(s.dash === true ? { dash: "6 5" } : {}),
    };
    const pts = (v: unknown): Array<[number, number]> => (Array.isArray(v) ? (v as unknown[]).map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] as [number, number] : [Number.NaN, Number.NaN] as [number, number])).filter(([x, y]) => inside(x, y)).slice(0, 60) : []);
    const t = str(s.t, 10);
    if (t === "rect" || t === "ellipse" || t === "circle") boxy++;
    else if (t === "curve" || t === "path" || t === "polyline" || t === "polygon") organic++;
    let d = "";
    if (t === "rect") {
      const [x, y, rw, rh, rx] = [num(s.x), num(s.y), num(s.w), num(s.h), Math.max(0, num(s.rx) || 0)];
      if (inside(x, y) && inside(x + rw, y + rh) && rw > 0 && rh > 0) d = rx ? `M${x + rx} ${y} H${x + rw - rx} Q${x + rw} ${y} ${x + rw} ${y + rx} V${y + rh - rx} Q${x + rw} ${y + rh} ${x + rw - rx} ${y + rh} H${x + rx} Q${x} ${y + rh} ${x} ${y + rh - rx} V${y + rx} Q${x} ${y} ${x + rx} ${y} Z` : `M${x} ${y} h${rw} v${rh} h${-rw} Z`;
    } else if (t === "ellipse" || t === "circle") {
      const [cx, cy] = [num(s.cx), num(s.cy)];
      const rx = t === "circle" ? num(s.r) : num(s.rx), ry = t === "circle" ? num(s.r) : num(s.ry);
      if (inside(cx - rx, cy - ry) && inside(cx + rx, cy + ry) && rx > 0 && ry > 0) {
        if (t === "circle") { shapes.push({ t: "circle", cx, cy, r: rx, ...style }); continue; }
        d = `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
      }
    } else if (t === "line" || t === "arrow") {
      const [x1, y1, x2, y2] = [num(s.x1), num(s.y1), num(s.x2), num(s.y2)];
      if (inside(x1, y1) && inside(x2, y2)) {
        d = `M${x1} ${y1} L${x2} ${y2}`;
        if (t === "arrow") {
          const a = Math.atan2(y2 - y1, x2 - x1), L = 11;
          const hx = (k: number) => x2 - L * Math.cos(a + k), hy = (k: number) => y2 - L * Math.sin(a + k);
          shapes.push({ t: "path", d, ...style, fill: "none" });
          d = `M${hx(0.45)} ${hy(0.45)} L${x2} ${y2} L${hx(-0.45)} ${hy(-0.45)} Z`;
          shapes.push({ t: "path", d, ...style, fill: style.stroke === "none" ? "ink" : (style.stroke as Ink) });
          continue;
        }
      }
    } else if (t === "polyline" || t === "polygon") {
      const p = pts(s.points);
      if (p.length >= 2) d = `M${p.map(([x, y]) => `${x} ${y}`).join(" L")}${t === "polygon" ? " Z" : ""}`;
    } else if (t === "curve") {
      // A smooth curve through the given points (Catmull–Rom as cubic Béziers): leaves, organs, rivers.
      const p = pts(s.points);
      if (p.length >= 3) {
        const closed = s.closed === true;
        const P = closed ? [p[p.length - 1], ...p, p[0], p[1]] : [p[0], ...p, p[p.length - 1]];
        d = `M${p[0][0]} ${p[0][1]}`;
        for (let i = 1; i < P.length - 2; i++) {
          const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
          d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
        }
        if (closed) d += " Z";
      }
    } else if (t === "path") {
      const raw = str(s.d, 3000);
      if (/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(raw)) d = raw;
      else issues.push("path data may only contain path commands and numbers");
    } else if (t === "text") {
      const text = str(s.text, 12);
      const [x, y] = [num(s.x), num(s.y)];
      if (!text || !inside(x, y)) continue;
      // Past 8 marks the rest are dropped, not the drawing: every attempt at an immune-response
      // board failed on its text and the student got a plain flow (audit 2026-10-17).
      if (++texts > maxTexts) continue;
      shapes.push({ t: "text", x, y, text, size: Math.max(10, Math.min(22, num(s.size) || 14)), anchor: "middle", ...(part ? { part } : {}), fill: "ink" });
      continue;
    }
    if (d) shapes.push({ t: "path", d, ...style });
  }
  return { shapes, issues, boxy, organic };
}

export function drawnFigure(raw: unknown): { drawing?: FigureDrawing; issues: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const issues: string[] = [];
  const w = num(r.w), h = num(r.h);
  if (!(w >= 200 && w <= 800 && h >= 150 && h <= 600)) return { issues: ["drawing needs w 200-800 and h 150-600"] };
  const inside = (x: number, y: number) => x >= -10 && x <= w + 10 && y >= -10 && y <= h + 10;
  const rawShapes = Array.isArray(r.shapes) ? (r.shapes as Raw[]) : [];
  if (rawShapes.length < 3 || rawShapes.length > 160) issues.push("use 3 to 160 shapes");
  const rawParts = Array.isArray(r.parts) ? (r.parts as Raw[]) : [];
  const partIds = new Set(rawParts.map((p) => slug(p?.id)).filter(Boolean));
  const { shapes, boxy, organic, issues: shapeIssues } = drawnShapes(rawShapes, w, h, partIds);
  issues.push(...shapeIssues);
  // Names belong to the label engine: a part's name written into the art would be printed twice.
  const names = rawParts.map((p) => str(p?.name, 40).toLowerCase()).filter(Boolean);
  const baked = shapes.filter((s) => s.t === "text" && names.some((n) => n.length > 3 && s.text.toLowerCase().includes(n.slice(0, 6))));
  // A name written into the art is removed — the label engine writes it — rather than failing the drawing.
  for (const b of baked) shapes.splice(shapes.indexOf(b), 1);
  const parts: FigureDrawing["parts"] = [];
  const seen = new Set<string>();
  for (const p of rawParts.slice(0, 12)) {
    const id = slug(p?.id), name = str(p?.name, 34);
    const a = (p?.anchor ?? {}) as Raw;
    const anchor = { x: num(a.x), y: num(a.y) };
    if (!id || !name || seen.has(id) || !inside(anchor.x, anchor.y)) { issues.push(`part "${id || name || "?"}" needs a unique id, a name and an anchor on the canvas`); continue; }
    seen.add(id);
    parts.push({ id, name, anchor });
  }
  if (parts.length < 2) issues.push("name at least 2 parts");
  const drawing: FigureDrawing = { w, h, shapes, parts };
  for (const p of parts) {
    const fit = anchorFit(shapes, p.id, p.anchor);
    if (!fit) { issues.push(`part "${p.id}" has no shapes — give its shapes "part": "${p.id}"`); continue; }
    if (fit.distance <= ON_PART) continue;
    // A few pixels off its own line: code moves it onto the nearest point of the part (always the
    // right part). Farther off, the writer likely tagged the wrong shapes — it must fix the drawing.
    if (fit.distance <= SNAP_ANCHOR) { p.anchor = { x: Math.round(fit.nearest.x * 10) / 10, y: Math.round(fit.nearest.y * 10) / 10 }; continue; }
    issues.push(`part "${p.id}"'s anchor (${Math.round(p.anchor.x)}, ${Math.round(p.anchor.y)}) is not on its own shapes (${Math.round(fit.distance)} px off; the nearest point of "${p.id}" is (${Math.round(fit.nearest.x)}, ${Math.round(fit.nearest.y)})) — put it ON the part's line, or inside its own closed shape`);
  }
  if (shapes.length < 3) issues.push("the drawing has fewer than 3 valid shapes");
  // A "diagram" of plain boxes and rings with the words outside is a flow chart drawn badly: an
  // impact chain came out as five empty rectangles (audit 2026-10-17). A drawing must draw the THING
  // — outlines, curves, structures — or the board should be a flow, where words sit inside boxes.
  const words = shapes.filter((sh) => sh.t === "text").length;
  if (boxy >= 4 && organic === 0 && words === 0) issues.push("BOX DIAGRAM: these are plain boxes and rings with nothing drawn and no words inside — a flow board shows this better; draw the actual structure instead");
  return issues.length ? { issues: [...new Set(issues)].slice(0, 6) } : { drawing, issues: [] };
}

/** An anchor this close to its part's own geometry is on it; within SNAP_ANCHOR code moves it on. */
const ON_PART = 3;
const SNAP_ANCHOR = 16;

type Polyline = { pts: Array<[number, number]>; closed: boolean };

/**
 * How far an anchor is from its part's OWN geometry, and the nearest point of it. 0 when it is on a
 * stroke of the part or inside a closed shape of the part that no other part's shape covers there —
 * covered meaning drawn later on top, or nested inside (a smaller closed shape of another part). An
 * open line has no inside, so a curved part's bounding box no longer counts. null: the part has no shapes.
 */
export function anchorFit(shapes: FigureShape[], partId: string, anchor: Pt): { distance: number; nearest: Pt } | null {
  const own = shapes.map((sh, k) => ({ sh, k })).filter(({ sh }) => sh.part === partId);
  if (!own.length) return null;
  const geo = shapes.map(shapeGeometry);
  let best = { distance: Infinity, nearest: anchor };
  for (const { sh, k } of own) {
    const g = geo[k];
    const half = (sh.t === "text" ? 0 : sh.width ?? 2) / 2;
    for (const line of g.lines) {
      const near = nearestOnPolyline(line.pts, anchor);
      const d = Math.max(0, near.d - half);
      if (d < best.distance) best = { distance: d, nearest: near.at };
    }
    if (!g.inside(anchor)) continue;
    const covered = geo.some((o, j) => j !== k && shapes[j].part !== partId && o.closedArea > 0 && o.inside(anchor) && (shapes[j].part || (shapes[j].fill ?? "none") !== "none") && (j > k || o.closedArea < g.closedArea));
    if (!covered) return { distance: 0, nearest: anchor };
  }
  return best;
}

function shapeGeometry(sh: FigureShape): { lines: Polyline[]; inside: (p: Pt) => boolean; closedArea: number } {
  if (sh.t === "circle") {
    const pts: Array<[number, number]> = Array.from({ length: 49 }, (_, i) => [sh.cx + sh.r * Math.cos((i / 48) * Math.PI * 2), sh.cy + sh.r * Math.sin((i / 48) * Math.PI * 2)]);
    return { lines: [{ pts, closed: true }], inside: (p) => (p.x - sh.cx) ** 2 + (p.y - sh.cy) ** 2 <= sh.r ** 2, closedArea: Math.PI * sh.r * sh.r };
  }
  if (sh.t === "text") {
    const w = sh.text.length * sh.size * 0.55;
    const x0 = sh.anchor === "middle" ? sh.x - w / 2 : sh.anchor === "end" ? sh.x - w : sh.x;
    const y0 = sh.y - sh.size;
    const pts: Array<[number, number]> = [[x0, y0], [x0 + w, y0], [x0 + w, sh.y], [x0, sh.y], [x0, y0]];
    return { lines: [{ pts, closed: true }], inside: (p) => p.x >= x0 && p.x <= x0 + w && p.y >= y0 && p.y <= sh.y, closedArea: 0 };
  }
  const lines = pathPolylines(sh.d);
  const closed = lines.filter((l) => l.closed && l.pts.length >= 3);
  const area = closed.reduce((sum, l) => sum + Math.abs(polygonArea(l.pts)), 0);
  return { lines, inside: (p) => closed.some((l) => insidePolygon(l.pts, p)), closedArea: area };
}

function polygonArea(pts: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

function insidePolygon(pts: Array<[number, number]>, p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearestOnPolyline(pts: Array<[number, number]>, p: Pt): { d: number; at: Pt } {
  let best = { d: Infinity, at: p };
  if (pts.length === 1) return { d: Math.hypot(pts[0][0] - p.x, pts[0][1] - p.y), at: { x: pts[0][0], y: pts[0][1] } };
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len)) : 0;
    const at = { x: ax + t * dx, y: ay + t * dy };
    const d = Math.hypot(at.x - p.x, at.y - p.y);
    if (d < best.d) best = { d, at };
  }
  return best;
}

/** A path's outline as polylines (curves and arcs sampled), each marked closed when it ends in Z. */
export function pathPolylines(d: string): Polyline[] {
  const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: Polyline[] = [];
  let cur: Polyline | null = null;
  let cmd = "M", x = 0, y = 0, sx = 0, sy = 0, i = 0;
  let ctrl: [number, number] | null = null;
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const to = (px: number, py: number) => {
    if (!cur) { cur = { pts: [[x, y]], closed: false }; out.push(cur); }
    cur.pts.push([px, py]);
  };
  const bezier = (ctrlPts: Array<[number, number]>) => {
    const p0: [number, number] = [x, y];
    for (let j = 1; j <= 16; j++) {
      const t = j / 16;
      let row = [p0, ...ctrlPts];
      while (row.length > 1) row = row.slice(1).map((q, k) => [row[k][0] + (q[0] - row[k][0]) * t, row[k][1] + (q[1] - row[k][1]) * t] as [number, number]);
      to(row[0][0], row[0][1]);
    }
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd !== cmd.toUpperCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      if (cur) { cur.closed = true; cur.pts.push([sx, sy]); }
      cur = null; x = sx; y = sy; ctrl = null;
      while (isNum()) i++;
      continue;
    }
    if (!isNum()) { i++; continue; }
    const pair = (): [number, number] => { const a = num(), b = num(); return rel ? [x + a, y + b] : [a, b]; };
    if (C === "M") { [x, y] = pair(); sx = x; sy = y; cur = { pts: [[x, y]], closed: false }; out.push(cur); cmd = rel ? "l" : "L"; ctrl = null; }
    else if (C === "L" || C === "T") { const p = pair(); to(p[0], p[1]); [x, y] = p; ctrl = null; }
    else if (C === "H") { const a = num(); x = rel ? x + a : a; to(x, y); ctrl = null; }
    else if (C === "V") { const a = num(); y = rel ? y + a : a; to(x, y); ctrl = null; }
    else if (C === "C") { const p1 = pair(), p2 = pair(), p3 = pair(); bezier([p1, p2, p3]); [x, y] = p3; ctrl = p2; }
    else if (C === "S") { const p2 = pair(), p3 = pair(); const p1: [number, number] = ctrl ? [2 * x - ctrl[0], 2 * y - ctrl[1]] : [x, y]; bezier([p1, p2, p3]); [x, y] = p3; ctrl = p2; }
    else if (C === "Q") { const p1 = pair(), p2 = pair(); bezier([p1, p2]); [x, y] = p2; ctrl = null; }
    else if (C === "A") {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
      const p = pair();
      for (const q of arcPoints(x, y, rx, ry, rot, large === 1, sweep === 1, p[0], p[1])) to(q[0], q[1]);
      [x, y] = p; ctrl = null;
    } else i++;
    if (![x, y].every(Number.isFinite)) break;
  }
  return out;
}

/** Points along an SVG arc (endpoint parameterisation, SVG 1.1 F.6.5). */
function arcPoints(x1: number, y1: number, rx: number, ry: number, deg: number, large: boolean, sweep: boolean, x2: number, y2: number): Array<[number, number]> {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x2, y2]];
  const phi = (deg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const fit = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (fit > 1) { rx *= Math.sqrt(fit); ry *= Math.sqrt(fit); }
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp) / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const t1 = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  let dt = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - t1;
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const out: Array<[number, number]> = [];
  for (let j = 1; j <= 24; j++) {
    const t = t1 + (dt * j) / 24;
    out.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return out;
}

/** The board writer's instructions for a generated diagram. */
export const DRAWN_GUIDE = `Draw it as clean TEXTBOOK LINE ART in "stage": {"kind": "figure", "component": "drawn", "drawing": {"w": 600, "h": 420, "shapes": [...], "parts": [...]}, "parts": [{"id", "name", "s", "say"}]}.
- shapes (x right, y down, inside w×h): {"t": "rect", "x", "y", "w", "h", "rx"} | {"t": "ellipse", "cx", "cy", "rx", "ry"} | {"t": "circle", "cx", "cy", "r"} | {"t": "line", "x1", "y1", "x2", "y2"} | {"t": "arrow", "x1", "y1", "x2", "y2"} | {"t": "polyline"|"polygon", "points": [[x, y], …]} | {"t": "curve", "points": [[x, y], …], "closed": true|false} (a smooth outline through the points — use it for organic shapes: cells, leaves, organs, rivers, landforms) | {"t": "text", "x", "y", "text"} (≤ 12 characters, only signs/letters/values such as "+", "N", "H₂O" — never a part's name).
- style on any shape: "fill": blue|green|red|yellow|orange|purple|pink|cyan|brown|grey|sand|sky|white|none, "stroke": ink|muted|none|red|blue|green|orange|purple|brown, "width" 1-4, "dash": true, "part": <part id>.
- Draw the standard textbook view, proportioned and recognisable, filling most of the canvas; outlines in ink, regions in soft tints; 8-80 shapes. Big shapes first, details on top.
- drawing.parts: 3-8 {"id", "name", "anchor": {"x", "y"}}; every part's shapes carry "part": its id, and its anchor lies ON those shapes (where a label's dot should touch): on the part's own line (for a line, arrow or open curve, ON the line itself), or inside its own closed shape away from any other part drawn inside or over it. The board's "parts" then label them by id, as for any figure.`;
