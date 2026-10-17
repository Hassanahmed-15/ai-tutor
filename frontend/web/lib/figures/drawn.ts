import { partBounds } from "./bounds";
import type { FigureDrawing, FigureShape, Ink } from "./types";

/**
 * A DIAGRAM FOR ANY TOPIC, DRAWN FROM A CHECKED DESCRIPTION. Where no code-drawn component
 * (lib/figures/registry.ts) and no textbook diagram (lib/figures/library.ts) fits, the board writer
 * describes the figure itself — textbook line art from a small vocabulary of shapes in a fixed soft
 * palette, every part named, with the point a label should touch. This checks it the way the label
 * engine needs it: each part has its own shapes, its anchor lies on them, nothing leaves the canvas,
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
  const bounds = partBounds(drawing);
  for (const p of parts) {
    const b = bounds.get(p.id);
    if (!b) { issues.push(`part "${p.id}" has no shapes — give its shapes "part": "${p.id}"`); continue; }
    if (p.anchor.x < b.x - 6 || p.anchor.x > b.x + b.w + 6 || p.anchor.y < b.y - 6 || p.anchor.y > b.y + b.h + 6) issues.push(`part "${p.id}"'s anchor (${Math.round(p.anchor.x)}, ${Math.round(p.anchor.y)}) is not on its own shapes — put it on the part`);
  }
  if (shapes.length < 3) issues.push("the drawing has fewer than 3 valid shapes");
  // A "diagram" of plain boxes and rings with the words outside is a flow chart drawn badly: an
  // impact chain came out as five empty rectangles (audit 2026-10-17). A drawing must draw the THING
  // — outlines, curves, structures — or the board should be a flow, where words sit inside boxes.
  const words = shapes.filter((sh) => sh.t === "text").length;
  if (boxy >= 4 && organic === 0 && words === 0) issues.push("BOX DIAGRAM: these are plain boxes and rings with nothing drawn and no words inside — a flow board shows this better; draw the actual structure instead");
  return issues.length ? { issues: [...new Set(issues)].slice(0, 6) } : { drawing, issues: [] };
}

/** The board writer's instructions for a generated diagram. */
export const DRAWN_GUIDE = `Draw it as clean TEXTBOOK LINE ART in "stage": {"kind": "figure", "component": "drawn", "drawing": {"w": 600, "h": 420, "shapes": [...], "parts": [...]}, "parts": [{"id", "name", "s", "say"}]}.
- shapes (x right, y down, inside w×h): {"t": "rect", "x", "y", "w", "h", "rx"} | {"t": "ellipse", "cx", "cy", "rx", "ry"} | {"t": "circle", "cx", "cy", "r"} | {"t": "line", "x1", "y1", "x2", "y2"} | {"t": "arrow", "x1", "y1", "x2", "y2"} | {"t": "polyline"|"polygon", "points": [[x, y], …]} | {"t": "curve", "points": [[x, y], …], "closed": true|false} (a smooth outline through the points — use it for organic shapes: cells, leaves, organs, rivers, landforms) | {"t": "text", "x", "y", "text"} (≤ 12 characters, only signs/letters/values such as "+", "N", "H₂O" — never a part's name).
- style on any shape: "fill": blue|green|red|yellow|orange|purple|pink|cyan|brown|grey|sand|sky|white|none, "stroke": ink|muted|none|red|blue|green|orange|purple|brown, "width" 1-4, "dash": true, "part": <part id>.
- Draw the standard textbook view, proportioned and recognisable, filling most of the canvas; outlines in ink, regions in soft tints; 8-80 shapes. Big shapes first, details on top.
- drawing.parts: 3-8 {"id", "name", "anchor": {"x", "y"}}; every part's shapes carry "part": its id, and its anchor lies ON those shapes (where a label's dot should touch). The board's "parts" then label them by id, as for any figure.`;
