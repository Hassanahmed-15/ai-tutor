import { compileExpr } from "./expr";
import { repairTex } from "../equationSpec";
import type { SketchColor, SketchCol, SketchItem, SketchShape, SketchStage } from "./types";

/**
 * THE SKETCH BOARD (owner, 2026-10-20): a maths or computer-science board generated live in the
 * Visuals Lab's style. This module reads what the board writer returned and makes it safe to draw —
 * every number clamped, every id unique, every formula compiled, every shape inside its grid — and
 * holds the writer's instructions (SKETCH_GUIDE). Layout is lib/canvas/layout.ts layoutSketch; the
 * renderer is SketchView in components/canvas/CanvasPanel.tsx.
 */

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");

const COLORS: SketchColor[] = ["ink", "muted", "blue", "orange", "green", "pink", "yellow"];
const colorOf = (v: unknown): SketchColor | undefined => {
  const c = text(v, 12).toLowerCase();
  const alias: Record<string, SketchColor> = { red: "pink", purple: "pink", violet: "pink", amber: "orange", gold: "yellow", white: "ink", grey: "muted", gray: "muted", black: "ink", teal: "green", cyan: "blue" };
  return (COLORS as string[]).includes(c) ? (c as SketchColor) : alias[c];
};
const colOf = (v: unknown): SketchCol | undefined => {
  const c = text(v, 8).toLowerCase();
  return c === "left" || c === "right" || c === "full" ? c : undefined;
};

/** The coloured-maths macros the writer may use in TeX: \blue{x^2}, \orange{6x}, … (chalk colours on the slate). */
export const SKETCH_TEX_MACROS: Record<string, string> = {
  "\\blue": "\\textcolor{##60a5fa}{#1}",
  "\\orange": "\\textcolor{##fb923c}{#1}",
  "\\green": "\\textcolor{##4ade80}{#1}",
  "\\pink": "\\textcolor{##f472b6}{#1}",
  "\\yellow": "\\textcolor{##facc15}{#1}",
  "\\muted": "\\textcolor{##a3a3a3}{#1}",
};

/**
 * Words inside maths are written as words: "1101 0110 \\to first digit second digit" set every
 * letter as a red italic variable (QA batch 2, 2026-10-21). A run of ordinary words (3+ letters, not
 * a command, not inside \\text) is wrapped in \\text{…}.
 */
function wordsAsText(tex: string): string {
  const parts = tex.split(/(\\text\{[^}]*\}|\\[a-zA-Z]+)/);
  return parts
    .map((part) => (/^\\/.test(part) ? part : part.replace(/[A-Za-z]{3,}(?:\s+[A-Za-z]{2,})*/g, (w) => (/^(sin|cos|tan|log|ln|exp|lim|max|min|mod|det|arg)$/i.test(w) ? w : `\\text{${w}}`))))
    .join("");
}

/** A formula the board can typeset, or null. */
function texOf(v: unknown): string | null {
  const raw = wordsAsText(text(v, 160).replace(/^\$+|\$+$/g, ""));
  if (!raw) return null;
  // The colour macros are not standard TeX: check the formula with them read as plain groups.
  const plain = raw.replace(/\\(?:blue|orange|green|pink|yellow|muted)\b/g, "");
  const checked = repairTex(plain);
  return "tex" in checked ? raw : null;
}

/** A line of writing, with any $…$ part kept only when it compiles. */
function writing(v: unknown, max: number): string {
  const t = text(v, max);
  return t.replace(/\$([^$]{1,120})\$/g, (whole, inner) => (texOf(inner) ? whole : inner));
}

const GRID_MAX = 24;

type P = [number, number];
const pt = (v: unknown): P | null => {
  const a = Array.isArray(v) ? v : [obj(v).x, obj(v).y];
  const x = num(a[0], NaN);
  const y = num(a[1], NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

/** A construction the writer names, built exactly by code: "square-on" an edge, a "right-angle" mark. */
function construct(r: Raw): Raw[] {
  const kind = text(r.kind ?? r.type, 14).toLowerCase();
  const pts = arr(r.points).map(pt).filter((q): q is P => Boolean(q));
  if (kind === "square-on" || kind === "square_on" || kind === "squareon") {
    if (pts.length < 2) return [];
    const [a, b] = pts;
    let n: P = [-(b[1] - a[1]), b[0] - a[0]];
    // Outward: away from the point it is told to face away from (the triangle's third corner).
    const away = pt(r.away);
    if (away && (away[0] - a[0]) * n[0] + (away[1] - a[1]) * n[1] > 0) n = [-n[0], -n[1]];
    return [{ ...r, kind: "poly", points: [a, b, [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]] }];
  }
  if (kind === "right-angle" || kind === "right_angle" || kind === "rightangle") {
    if (pts.length < 3) return [];
    const [a, v, b] = pts;
    const len = (p: P) => Math.hypot(p[0] - v[0], p[1] - v[1]) || 1;
    const size = clamp(0.12 * Math.min(len(a), len(b)), 0.25, 0.9);
    const ua: P = [((a[0] - v[0]) / len(a)) * size, ((a[1] - v[1]) / len(a)) * size];
    const ub: P = [((b[0] - v[0]) / len(b)) * size, ((b[1] - v[1]) / len(b)) * size];
    return [{ ...r, kind: "line", label: undefined, points: [[v[0] + ua[0], v[1] + ua[1]], [v[0] + ua[0] + ub[0], v[1] + ua[1] + ub[1]], [v[0] + ub[0], v[1] + ub[1]]] }];
  }
  return [r];
}

/** Moves and scales a drawing (as one) so every shape — where it starts and where it moves to — sits in the grid. */
function fitToGrid(shapes: Raw[], grid: { w: number; h: number }): Raw[] {
  const xs: number[] = [];
  const ys: number[] = [];
  const see = (x: number, y: number) => { if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } };
  for (const r of shapes) {
    for (const q of arr(r.points).map(pt)) if (q) see(q[0], q[1]);
    const x = num(r.x, NaN), y = num(r.y, NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const rad = num(r.r ?? r.radius, 0);
      see(x - rad, y - rad);
      see(x + num(r.w ?? r.width, 0) + rad, y + num(r.h ?? r.height, 0) + rad);
    }
  }
  if (!xs.length) return shapes;
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const m = 0.3;
  if (x0 >= 0 && y0 >= 0 && x1 <= grid.w && y1 <= grid.h) return shapes;
  const k = Math.min(1, (grid.w - 2 * m) / Math.max(1e-6, x1 - x0), (grid.h - 2 * m) / Math.max(1e-6, y1 - y0));
  const ox = m + ((grid.w - 2 * m) - (x1 - x0) * k) / 2 - x0 * k;
  const oy = m + ((grid.h - 2 * m) - (y1 - y0) * k) / 2 - y0 * k;
  const X = (v: unknown) => num(v, 0) * k + ox;
  const Y = (v: unknown) => num(v, 0) * k + oy;
  return shapes.map((r) => {
    const out: Raw = { ...r };
    if (Array.isArray(r.points)) out.points = arr(r.points).map(pt).filter((q): q is P => Boolean(q)).map((q) => [X(q[0]), Y(q[1])]);
    if (r.x !== undefined) out.x = X(r.x);
    if (r.y !== undefined) out.y = Y(r.y);
    for (const key of ["w", "width", "h", "height", "r", "radius"]) if (r[key] !== undefined) out[key] = num(r[key], 0) * k;
    const mv = obj(r.move);
    if (Object.keys(mv).length) {
      const to = pt(mv.to);
      out.move = { ...mv, ...(mv.dx !== undefined ? { dx: num(mv.dx, 0) * k } : {}), ...(mv.dy !== undefined ? { dy: num(mv.dy, 0) * k } : {}), ...(to ? { to: { x: X(to[0]), y: Y(to[1]) } } : {}) };
    }
    return out;
  });
}

/** A shape's bounding box in grid units. */
export function shapeBox(sh: SketchShape): { x: number; y: number; w: number; h: number } | null {
  if (sh.kind === "rect") return { x: sh.x!, y: sh.y!, w: sh.w!, h: sh.h! };
  if (sh.kind === "circle") return { x: sh.x! - sh.r!, y: sh.y! - sh.r!, w: 2 * sh.r!, h: 2 * sh.r! };
  if (sh.kind === "label") return { x: sh.x!, y: sh.y!, w: 0, h: 0 };
  if (!sh.points?.length) return null;
  const xs = sh.points.map((p) => p[0]);
  const ys = sh.points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function parseShape(r: Raw, i: number, grid: { w: number; h: number }, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string, from: number): SketchShape | null {
  const kind = text(r.kind ?? r.type, 8).toLowerCase() as SketchShape["kind"];
  if (!["rect", "poly", "circle", "line", "arrow", "label"].includes(kind)) return null;
  const gx = (v: unknown, f = 0) => clamp(num(v, f), 0, grid.w);
  const gy = (v: unknown, f = 0) => clamp(num(v, f), 0, grid.h);
  const points = arr(r.points)
    .map((p) => (Array.isArray(p) ? p : [obj(p).x, obj(p).y]))
    .map((p) => [gx(p[0]), gy(p[1])] as [number, number])
    .slice(0, 12);
  const base = { id: unique(r.id ?? `shape-${i + 1}`, `shape-${i + 1}`), kind, s: Math.max(from, sentence(r.s ?? r.sentence, from)) };
  const shape: SketchShape = { ...base };
  if (kind === "rect") {
    shape.x = clamp(num(r.x, 0), 0, grid.w - 0.2);
    shape.y = clamp(num(r.y, 0), 0, grid.h - 0.2);
    shape.w = clamp(num(r.w ?? r.width, 1), 0.2, grid.w - shape.x);
    shape.h = clamp(num(r.h ?? r.height, 1), 0.2, grid.h - shape.y);
  } else if (kind === "circle") {
    shape.r = clamp(num(r.r ?? r.radius, 1), 0.2, Math.min(grid.w, grid.h) / 2);
    shape.x = clamp(num(r.x, grid.w / 2), shape.r, grid.w - shape.r);
    shape.y = clamp(num(r.y, grid.h / 2), shape.r, grid.h - shape.r);
  } else if (kind === "label") {
    shape.x = gx(r.x, grid.w / 2);
    shape.y = gy(r.y, grid.h / 2);
  } else {
    if (points.length < (kind === "poly" ? 3 : 2)) return null;
    shape.points = points;
  }
  const color = colorOf(r.color);
  if (color) shape.color = color;
  if (r.fill === true && kind !== "line" && kind !== "arrow" && kind !== "label") shape.fill = true;
  if (r.dashed === true) shape.dashed = true;
  const label = writing(r.label ?? (kind === "label" ? r.text : undefined), 40);
  if (label) shape.label = label;
  else if (kind === "label") return null;
  const move = obj(r.move);
  if (Object.keys(move).length) {
    const rotate = num(move.rotate, 0);
    let dx = num(move.dx, 0);
    let dy = num(move.dy, 0);
    // "to": where the shape's top-left corner ends up (after any quarter turn) — easier to get right
    // than a distance, and code does the arithmetic, including the swapped width and height.
    const to = obj(move.to);
    if (Object.keys(to).length || Array.isArray(move.to)) {
      const tx = Array.isArray(move.to) ? num(move.to[0], NaN) : num(to.x, NaN);
      const ty = Array.isArray(move.to) ? num(move.to[1], NaN) : num(to.y, NaN);
      const b = shapeBox(shape);
      if (b && Number.isFinite(tx) && Number.isFinite(ty)) {
        const quarter = Math.abs(Math.round(rotate / 90)) % 2 === 1;
        const w2 = quarter ? b.h : b.w;
        const h2 = quarter ? b.w : b.h;
        const fx = clamp(tx, 0, grid.w - w2);
        const fy = clamp(ty, 0, grid.h - h2);
        dx = fx + w2 / 2 - (b.x + b.w / 2);
        dy = fy + h2 / 2 - (b.y + b.h / 2);
      }
    }
    if (dx || dy || rotate) shape.move = { s: Math.max(shape.s, sentence(move.s ?? move.sentence, shape.s)), dx: clamp(dx, -grid.w, grid.w), dy: clamp(dy, -grid.h, grid.h), ...(rotate ? { rotate: clamp(rotate, -360, 360) } : {}) };
  }
  if (r.hide !== undefined && r.hide !== null && r.hide !== false) {
    const at = sentence(r.hide, shape.s);
    if (at > shape.s) shape.hide = at;
  }
  return shape;
}

function parseItem(r: Raw, i: number, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string): SketchItem | null {
  const type = text(r.type ?? r.kind, 8).toLowerCase();
  const base = { id: unique(r.id ?? `${type || "item"}-${i + 1}`, `item-${i + 1}`), s: sentence(r.s ?? r.sentence, i) };
  const col = colOf(r.col ?? r.column);
  const a = obj(r.at);
  const at = Object.keys(a).length
    ? (() => {
        const x = clamp(num(a.x, 0), 0, 11), y = clamp(num(a.y, 0), 0, 7.5);
        return { x, y, w: clamp(num(a.w, 4), 1, 12 - x), h: clamp(num(a.h, 3), 0.5, 8 - y) };
      })()
    : undefined;
  const placed = { ...(col ? { col } : {}), ...(at ? { at } : {}) };
  if (type === "text") {
    const t = writing(r.text, 120);
    if (!t) return null;
    const size = text(r.size, 8);
    const color = colorOf(r.color);
    return { ...base, ...placed, type: "text", text: t, ...(size === "big" || size === "small" ? { size } : {}), ...(color ? { color } : {}) };
  }
  if (type === "math") {
    const lines = arr(r.lines)
      .map((l) => (typeof l === "string" ? { tex: l } : obj(l)))
      .map((l, k) => {
        const tex = texOf((l as Raw).tex ?? (l as Raw).text);
        const label = writing((l as Raw).label, 30);
        return tex ? { s: Math.max(base.s, sentence((l as Raw).s ?? (l as Raw).sentence, base.s + k)), tex, ...(label ? { label } : {}) } : null;
      })
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .slice(0, 7);
    if (!lines.length) return null;
    lines.forEach((_, k) => unique(`${base.id}-l${k + 1}`, `${base.id}-l${k + 1}`));
    return { ...base, ...placed, type: "math", lines, ...(r.size === "big" ? { size: "big" as const } : {}) };
  }
  if (type === "shapes") {
    const g = obj(r.grid);
    const grid = { w: clamp(Math.round(num(g.w ?? g.width, 10)), 2, GRID_MAX), h: clamp(Math.round(num(g.h ?? g.height, 8)), 2, GRID_MAX) };
    // Constructions are built by code (a square ON an edge, a right-angle mark), then the whole drawing
    // is moved and scaled into its grid as one — never point by point, which bent shapes at the edge.
    const raw = fitToGrid(arr(r.shapes).map((sh) => obj(sh)).flatMap(construct), grid);
    // The same words written twice ("A OR B" on the wire AND as a free label) is clutter: a free label
    // that repeats another shape's label is dropped (QA batch 7, 2026-10-21).
    const named = new Set(raw.filter((sh) => text(sh.kind ?? sh.type, 8).toLowerCase() !== "label").map((sh) => text(sh.label, 40).toLowerCase()).filter(Boolean));
    const seenFree = new Set<string>();
    const shapes = raw
      .filter((sh) => {
        if (text(sh.kind ?? sh.type, 8).toLowerCase() !== "label") return true;
        const t = text(sh.label ?? sh.text, 40).toLowerCase();
        if (!t || named.has(t) || seenFree.has(t)) return false;
        seenFree.add(t);
        return true;
      })
      .map((sh, k) => parseShape(sh, k, grid, sentence, unique, base.s))
      .filter((sh): sh is SketchShape => Boolean(sh))
      .slice(0, 28);
    if (!shapes.length) return null;
    // One colour per quantity even when the writer gave none: each labelled area its own colour.
    if (!shapes.some((sh) => sh.color)) {
      const palette: SketchColor[] = ["blue", "orange", "green", "pink"];
      let next = 0;
      for (const sh of shapes) {
        if (!sh.label || !["rect", "poly", "circle"].includes(sh.kind)) continue;
        sh.color = palette[next++ % palette.length];
        sh.fill = true;
      }
    }
    return { ...base, ...placed, type: "shapes", grid, shapes, ...(r.showGrid === true || r.grid_visible === true ? { showGrid: true } : {}) };
  }
  if (type === "graph") {
    const range = (v: unknown, f: [number, number]): [number, number] => {
      const a = arr(v);
      const lo = num(a[0], f[0]);
      const hi = num(a[1], f[1]);
      return hi > lo && hi - lo < 1e6 ? [lo, hi] : f;
    };
    const x = range(r.x, [-5, 5]);
    const y = range(r.y, [-5, 5]);
    const curves = arr(r.curves)
      .map((c) => obj(c))
      .map((c, k) => {
        const expr = text(c.expr ?? c.y, 120).replace(/^y\s*=\s*/i, "");
        const compiled = compileExpr(expr);
        if (!compiled || compiled.vars.some((v) => v !== "x")) return null;
        const shift = obj(c.shift);
        const color = colorOf(c.color);
        const label = writing(c.label, 24);
        const cs = Math.max(base.s, sentence(c.s ?? c.sentence, base.s));
        return {
          id: unique(c.id ?? `curve-${k + 1}`, `curve-${k + 1}`),
          expr,
          s: cs,
          ...(color ? { color } : {}),
          ...(c.dashed === true ? { dashed: true } : {}),
          ...(label ? { label } : {}),
          ...(Object.keys(shift).length && (num(shift.dx, 0) || num(shift.dy, 0)) ? { shift: { s: Math.max(cs, sentence(shift.s ?? shift.sentence, cs)), dx: num(shift.dx, 0), dy: num(shift.dy, 0) } } : {}),
        };
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .slice(0, 4);
    const points = arr(r.points)
      .map((p) => obj(p))
      .map((p, k) => {
        const px = num(p.x, NaN);
        const py = num(p.y, NaN);
        if (!Number.isFinite(px) || !Number.isFinite(py) || px < x[0] || px > x[1] || py < y[0] || py > y[1]) return null;
        const color = colorOf(p.color);
        const label = writing(p.label, 22);
        return { id: unique(p.id ?? `point-${k + 1}`, `point-${k + 1}`), x: px, y: py, s: Math.max(base.s, sentence(p.s ?? p.sentence, base.s)), ...(color ? { color } : {}), ...(label ? { label } : {}) };
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 6);
    if (!curves.length && !points.length) return null;
    return { ...base, ...placed, type: "graph", x, y, curves, ...(points.length ? { points } : {}) };
  }
  if (type === "table") {
    const headers = arr(r.headers ?? r.columns).map((h) => writing(h, 18)).filter(Boolean).slice(0, 5);
    if (!headers.length) return null;
    const rows = arr(r.rows)
      .map((row) => (Array.isArray(row) ? { cells: row } : obj(row)))
      .map((row, k) => ({ s: Math.max(base.s, sentence((row as Raw).s ?? (row as Raw).sentence, base.s + k)), cells: headers.map((_, c) => writing(arr((row as Raw).cells)[c], 18)) }))
      .slice(0, 8);
    return { ...base, ...placed, type: "table", headers, rows };
  }
  if (type === "box") {
    const t = writing(r.text, 200);
    if (!t) return null;
    const title = writing(r.title, 30);
    const color = colorOf(r.color);
    return { ...base, ...placed, type: "box", text: t, ...(title ? { title } : {}), ...(color ? { color } : {}) };
  }
  if (type === "code") {
    const lines = arr(r.lines)
      .map((l) => (typeof l === "string" ? l.replace(/\t/g, "    ").replace(/\s+$/, "").slice(0, 60) : ""))
      .slice(0, 14);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.some((l) => l.trim())) return null;
    const steps = arr(r.steps)
      .map((st) => obj(st))
      .map((st, k) => {
        const line = Math.round(num(st.line, 0));
        const note = text(st.note, 36);
        return line >= 1 && line <= lines.length ? { s: Math.max(base.s, sentence(st.s ?? st.sentence, base.s + k)), line, ...(note ? { note } : {}) } : null;
      })
      .filter((st): st is NonNullable<typeof st> => Boolean(st))
      .slice(0, 12);
    return { ...base, ...placed, type: "code", language: text(r.language, 16).toLowerCase() || "python", lines, ...(steps.length ? { steps } : {}) };
  }
  return null;
}

/**
 * Labels written as their own shapes item belong to the drawing they label: a writer that put the
 * squares in one item and "area 9 / area 16 / area 25" in another (same grid) left the labels floating
 * away from their squares (live lecture, 2026-10-20). They are merged into the drawing before it.
 */
function mergeLabelItems(items: Raw[]): Raw[] {
  const out: Raw[] = [];
  for (const it of items) {
    const shapes = arr(it.shapes).map((sh) => obj(sh));
    const onlyLabels = text(it.type ?? it.kind, 8).toLowerCase() === "shapes" && shapes.length > 0 && shapes.every((sh) => text(sh.kind ?? sh.type, 8).toLowerCase() === "label");
    const g = JSON.stringify(obj(it.grid));
    const host = onlyLabels ? [...out].reverse().find((o) => text(o.type ?? o.kind, 8).toLowerCase() === "shapes" && JSON.stringify(obj(o.grid)) === g) : undefined;
    if (host) {
      const at = num(it.s ?? it.sentence, 0);
      host.shapes = [...arr(host.shapes), ...shapes.map((sh) => ({ ...sh, s: sh.s ?? at }))];
    } else out.push({ ...it });
  }
  return out;
}

/** The writer's sketch made safe to draw, or null when nothing on it could be drawn. */
export function validateSketch(r: Raw, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string): SketchStage | null {
  const parsed = mergeLabelItems(arr(r.items).map((it) => obj(it)))
    .map((it, i) => parseItem(obj(it), i, sentence, unique))
    .filter((it): it is SketchItem => Boolean(it));
  // DRAWING FIRST (owner, 2026-10-21: "too much text"): at most two written lines and one box; the
  // explanation is Aria's voice, the board is the picture.
  let texts = 0;
  let boxes = 0;
  const items = parsed
    .filter((it) => (it.type === "text" ? ++texts <= 2 : it.type === "box" ? ++boxes <= 1 : true))
    .map((it) => (it.type === "text" ? { ...it, text: it.text.length > 70 ? `${it.text.slice(0, it.text.lastIndexOf(" ", 66) > 30 ? it.text.lastIndexOf(" ", 66) : 66)}` : it.text } : it))
    .slice(0, 6);
  return items.length ? { kind: "sketch", items } : null;
}

/** The board in words, for the reviewer, the chat and the release checks. */
export function describeSketch(stage: SketchStage): string {
  return stage.items
    .map((it) => {
      switch (it.type) {
        case "text":
          return `Written: ${it.text}`;
        case "math":
          return `Worked maths: ${it.lines.map((l) => `${l.label ? `${l.label}: ` : ""}${l.tex}`).join(" | ")}`;
        case "shapes":
          return `Drawing on a ${it.grid.w}×${it.grid.h} grid: ${it.shapes.map((sh) => `${sh.kind}${sh.label ? ` "${sh.label}"` : ""}${sh.move ? " (moves)" : ""}`).join(", ")}`;
        case "graph":
          return `Graph x ${it.x[0]}..${it.x[1]}, y ${it.y[0]}..${it.y[1]}: ${it.curves.map((c) => `y = ${c.expr}${c.label ? ` (${c.label})` : ""}${c.shift ? " (slides)" : ""}`).join("; ")}${it.points?.length ? `; points ${it.points.map((p) => `(${p.x}, ${p.y})${p.label ? ` ${p.label}` : ""}`).join(", ")}` : ""}`;
        case "table":
          return `Table [${it.headers.join(" | ")}]: ${it.rows.map((r) => r.cells.join(" | ")).join(" / ")}`;
        case "box":
          return `Box${it.title ? ` "${it.title}"` : ""}: ${it.text}`;
        case "code":
          return `${it.language} code:\n${it.lines.join("\n")}`;
      }
    })
    .join("\n");
}

/**
 * What the board writer is told for a sketch board (added to that board's request only, so no other
 * board's instructions change).
 */
export const SKETCH_GUIDE = `SKETCH BOARD — this board is DRAWN, the way a great maths or computer-science teacher draws on a whiteboard while talking, the marker drawing each line and shape on the sentence that needs it. It is a PICTURE that explains the idea, not notes: Aria's voice does the explaining, so the board carries a clean diagram and only a few words. Return "stage": {"kind": "sketch", "items": [...]} with 1 to 5 items, usually ONE or TWO big drawings ("shapes" or "graph") plus at most two short written lines.
PLACE THINGS ANYWHERE: give every item "at": {"x", "y", "w", "h"} on a 12 × 8 grid of the board (x 0–12 across, y 0–8 down) — a big drawing can take most of the board (e.g. {"x": 1, "y": 0, "w": 8, "h": 8}), a short line of writing a strip beside or under it. Items must not overlap. You choose WHAT is drawn, WHERE on the grid and WHEN ("s" = the sentence it appears on). Never give pixel positions.
Items (each {"id", "type", "s", "at"}):
- {"type": "text", "text", "size": "big" | "normal" | "small", "color"}: one SHORT written line (at most 6 words; inline maths as $...$). At most two on a board: the key result, or the one rule to remember.
- {"type": "math", "lines": [{"s", "tex", "label" (optional, a short subgoal like "① Halve b")}]}: worked maths, ONE line per step, each line on the sentence that says it, every line kept on the board under the last. "tex" is KaTeX; colour each quantity with \\blue{...}, \\orange{...}, \\green{...}, \\pink{...} and keep its colour on every line and every item.
- {"type": "shapes", "grid": {"w", "h"} (a small grid, at most 24×24), "showGrid": true when the grid squares ARE the maths (vectors and coordinates in units, areas you count, a number line), "shapes": [...]}: a diagram drawn from shapes on the grid — area models, algebra tiles, a triangle with its squares, number lines, arrays and memory cells, logic layouts, a stack of frames. Shapes: {"id", "kind": "rect" (x, y, w, h) | "poly" (points [[x,y],...]) | "circle" (x, y, r) | "line" (points) | "arrow" (points, head at the last) | "label" (x, y, text in "label") | "square-on" (points [A, B] = one edge, "away": [x, y] the point it faces away from — code builds the exact square on that edge; use it for squares on a triangle's sides) | "right-angle" (points [A, corner, B] — code draws the corner mark), "s", "color", "fill": true for an area, "dashed", "label" (written at its centre), "move": {"s", "to": {"x", "y"} (where its top-left corner ends up, after the turn), "rotate"} (on that sentence the shape slides to "to" and turns — use it when the MOTION IS THE IDEA: a strip moved under a square, triangles rearranged, an element swapped in an array), "hide": sentence (it fades: a gap filled, a value replaced)}. Grid y grows DOWNWARDS. Keep labels inside their shapes and shapes inside the grid, never overlapping unless one is meant to sit on the other. ROOM FOR EVERY WORD: a shape that holds a label is big enough for it (a circle holding a word has r ≥ 1; a two-word label needs a rect, or a "label" beside the shape), labelled shapes stand at least 2 grid units apart, and at most 6 labelled shapes share one drawing — a list of topics or a route through steps is not a drawing: write it as text instead.
- {"type": "graph", "x": [min, max], "y": [min, max], "curves": [{"id", "expr" (in x: + - * / ^, sqrt, sin, cos, tan, exp, log, ln, abs), "s", "color", "dashed", "label", "shift": {"s", "dx", "dy"} (the curve slides — a transformation shown as motion: draw y = x^2 dashed, then shift it onto the new curve)}], "points": [{"id", "x", "y", "label", "color", "s"}]}. Every point you mark must lie on its curve.
- {"type": "table", "headers": [...], "rows": [{"s", "cells": [...]}]}: a trace table, truth table or table of values; each row on the sentence that fills it; values must be the real values.
- {"type": "box", "title", "text", "color"}: a rule or an exam-style question, in a framed box.
- {"type": "code", "language", "lines": [...], "steps": [{"s", "line", "note"}]}: a short listing (≤ 12 lines) with the line being run lit on each sentence.
ONE FIGURE = ONE "shapes" ITEM: a triangle and the squares on its sides are one drawing on one grid, with each label in its shape's own "label" (never a separate item of floating labels). Example — a 3-4-5 right triangle with its squares (grid 16 × 16): {"type": "shapes", "grid": {"w": 16, "h": 16}, "shapes": [{"id": "tri", "kind": "poly", "points": [[6,6],[6,9],[10,9]], "s": 0}, {"id": "right", "kind": "right-angle", "points": [[6,6],[6,9],[10,9]], "s": 0}, {"id": "sq-3", "kind": "square-on", "points": [[6,6],[6,9]], "away": [10,9], "label": "9", "color": "blue", "fill": true, "s": 1}, {"id": "sq-4", "kind": "square-on", "points": [[6,9],[10,9]], "away": [6,6], "label": "16", "color": "orange", "fill": true, "s": 1}, {"id": "sq-5", "kind": "square-on", "points": [[10,9],[6,6]], "away": [6,9], "label": "25", "color": "green", "fill": true, "s": 2}]}.
EVERY SENTENCE CHANGES THE DRAWING: give each narration sentence something that is drawn, moves, slides, turns or fills in on it (a shape, a line, an arrow, a point, a curve sliding, a cell swapping) — like a video of a teacher drawing. Prefer MOTION that shows the idea ("move") over more writing. Labels on a drawing are 1–3 words.
EXACT GEOMETRY: a vector (a, b) is drawn from its start (x, y) to (x + a, y − b) on the grid (y grows downwards); every length, coordinate and count you draw must equal the number you write next to it. Words inside "tex" go in \\text{...}.
RULES: one colour = one quantity everywhere. Every number is exact (code checks "a × b = c"). Nothing decorative: every item teaches. A diagram whose motion IS the explanation (a proof by rearrangement, completing the square, a swap in a sort) uses "move" on the sentence that describes it. Cue targets are item ids, shape ids, and "<math id>-l<n>" for the nth worked line.`;

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
/** TeX as a student reads it, for the number check: "\\frac{3}{4}" → "(3)/(4)", "5^{2}" → "5²". */
export function texToPlain(tex: string): string {
  let s = tex.replace(/\\(?:blue|orange|green|pink|yellow|muted)\b/g, "").replace(/\\(?:left|right)\b/g, "");
  for (let i = 0; i < 4; i++) s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)").replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
  s = s
    .replace(/\^\{(-?\d+)\}|\^(\d)/g, (_, a, b) => [...(a ?? b)].map((c) => SUP[c] ?? c).join(""))
    .replace(/\\times|\\cdot/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\pi\b/g, "π")
    // Signs kept as signs: dropping \pm read "−3 ± 5" as "−35" and failed a right board (maths benchmark R5).
    .replace(/\\pm(?![a-zA-Z])/g, "±")
    .replace(/\\mp(?![a-zA-Z])/g, "∓")
    .replace(/\\(?:neq|ne)(?![a-zA-Z])/g, "≠")
    .replace(/\\approx(?![a-zA-Z])/g, "≈")
    .replace(/\\(?:to|rightarrow)(?![a-zA-Z])/g, "→")
    .replace(/\\(?:text|mathrm|mathbf)\{([^{}]*)\}/g, "$1")
    .replace(/\\[,;:!]|\\quad|\\qquad/g, " ")
    .replace(/\\(?:le|leq)\b/g, "≤")
    .replace(/\\(?:ge|geq)\b/g, "≥")
    .replace(/[{}]/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/** Every piece of writing on a sketch board as plain text (for the number check and the critics). */
export function sketchPlainTexts(stage: SketchStage): string[] {
  const out: string[] = [];
  const writing = (t: string) => t.replace(/\$([^$]+)\$/g, (_, x) => texToPlain(x));
  for (const it of stage.items) {
    if (it.type === "text") out.push(writing(it.text));
    if (it.type === "box") out.push(writing(it.text));
    if (it.type === "math") for (const l of it.lines) out.push(texToPlain(l.tex));
    if (it.type === "table") for (const r of it.rows) out.push(r.cells.join(" "));
    if (it.type === "shapes") for (const sh of it.shapes) if (sh.label) out.push(writing(sh.label));
  }
  return out;
}

/** Graph points that do not lie on any curve drawn with them: a wrong vertex or intercept. */
export function sketchGraphIssues(stage: SketchStage): string[] {
  const issues: string[] = [];
  for (const it of stage.items) {
    if (it.type !== "graph" || !it.points?.length || !it.curves.length) continue;
    const span = it.y[1] - it.y[0];
    for (const p of it.points) {
      const near = it.curves.some((c) => {
        const dx = c.shift ? c.shift.dx : 0;
        const dy = c.shift ? c.shift.dy : 0;
        const fx = compileExpr(c.expr);
        if (!fx) return false;
        const at = (x: number, sx: number, sy: number) => fx.eval({ x: x - sx }) + sy;
        return Math.abs(at(p.x, 0, 0) - p.y) <= span * 0.02 || (c.shift && Math.abs(at(p.x, dx, dy) - p.y) <= span * 0.02);
      });
      if (!near) issues.push(`the point (${p.x}, ${p.y})${p.label ? ` "${p.label}"` : ""} is not on any curve drawn: compute it from the curve`);
    }
  }
  return issues;
}
