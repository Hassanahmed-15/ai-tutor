/**
 * A closed scene grammar for textbook vector diagrams. The model fills this in; code draws it.
 * No raw SVG, no scripts — every element is one of the kinds below.
 */

export const DIAGRAM_STYLE_VERSION = "vector-2";

export type DiagramBase = "world-map" | "cross-section" | "body" | "plant" | "none";
export type DiagramShapeKind = "rect" | "ellipse" | "polygon" | "rod";
export type RepeatLayout = "row" | "grid" | "ring";
export type SeriesStyle = "line" | "points" | "both";

export type DiagramPt = { x: number; y: number };
export type DiagramGeo = { lon: number; lat: number };
export type DiagramAnchor = DiagramPt | DiagramGeo | { id: string };

export type DiagramStyle = {
  fill?: string;
  stroke?: string;
  width?: number;
  dash?: boolean;
};

type Common = {
  id: string;
  s: number;
  part?: string;
};

export type RegionEl = Common & DiagramStyle & {
  t: "region";
  shape: DiagramShapeKind;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  points?: DiagramPt[];
  r?: number;
};

export type LineEl = Common & DiagramStyle & {
  t: "line";
  points: DiagramPt[];
  curve?: boolean;
  closed?: boolean;
};

export type ArrowEl = Common & DiagramStyle & {
  t: "arrow";
  from: DiagramAnchor;
  to: DiagramAnchor;
  curved?: boolean;
  label?: string;
};

export type LabelEl = Common & {
  t: "label";
  text: string;
  at: DiagramAnchor;
  leader?: boolean;
};

export type GroupEl = Common & {
  t: "group";
  elements: DiagramElement[];
};

export type RepeatEl = Common & DiagramStyle & {
  t: "repeat";
  n: number;
  layout: RepeatLayout;
  of: RegionEl;
  gap?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export type AxisEl = Common & {
  t: "axis";
  x: number;
  y: number;
  w: number;
  h: number;
  xLabel: string;
  yLabel: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export type SeriesEl = Common & DiagramStyle & {
  t: "series";
  axis: string;
  points: Array<{ x: number; y: number; label?: string }>;
  style?: SeriesStyle;
};

export type BandsEl = Common & {
  t: "bands";
  orientation: "h" | "v";
  x: number;
  y: number;
  w: number;
  h: number;
  bands: Array<{ id: string; name: string; from: number; to: number; fill?: string; s?: number; part?: string }>;
};

export type InsetEl = Common & {
  t: "inset";
  x: number;
  y: number;
  w: number;
  h: number;
  of?: string;
  label?: string;
};

export type MapMarkEl = Common & DiagramStyle & {
  t: "map-mark";
  lon: number;
  lat: number;
  kind?: "dot" | "arrow";
  toLon?: number;
  toLat?: number;
  label?: string;
};

export type DiagramElement = RegionEl | LineEl | ArrowEl | LabelEl | GroupEl | RepeatEl | AxisEl | SeriesEl | BandsEl | InsetEl | MapMarkEl;

export type DiagramSpec = {
  v: 1;
  w: number;
  h: number;
  base?: DiagramBase;
  elements: DiagramElement[];
};

const BASES = new Set<DiagramBase>(["world-map", "cross-section", "body", "plant", "none"]);
const SHAPES = new Set<DiagramShapeKind>(["rect", "ellipse", "polygon", "rod"]);
const LAYOUTS = new Set<RepeatLayout>(["row", "grid", "ring"]);
const KINDS = new Set(["region", "line", "arrow", "label", "group", "repeat", "axis", "series", "bands", "inset", "map-mark"]);

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const slug = (v: unknown, fallback = ""): string => {
  const s = typeof v === "string" ? v : "";
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || fallback;
};
const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, max = 80): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const bool = (v: unknown) => v === true;

function pt(v: unknown): DiagramPt | null {
  const p = Array.isArray(v) ? { x: num(v[0], NaN), y: num(v[1], NaN) } : obj(v);
  const x = num((p as DiagramPt).x, NaN);
  const y = num((p as DiagramPt).y, NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function anchor(v: unknown): DiagramAnchor | null {
  if (typeof v === "string") {
    const id = slug(v);
    return id ? { id } : null;
  }
  const r = obj(v);
  if (typeof r.id === "string" && slug(r.id)) return { id: slug(r.id) };
  if (r.lon !== undefined || r.lat !== undefined) return { lon: num(r.lon), lat: num(r.lat) };
  return pt(v);
}

function styleOf(r: Record<string, unknown>): DiagramStyle {
  return {
    ...(str(r.fill, 24) ? { fill: str(r.fill, 24) } : {}),
    ...(str(r.stroke, 24) ? { stroke: str(r.stroke, 24) } : {}),
    ...(Number.isFinite(num(r.width, NaN)) ? { width: Math.max(0.5, Math.min(6, num(r.width))) } : {}),
    ...(bool(r.dash) ? { dash: true } : {}),
  };
}

function common(r: Record<string, unknown>, fallback: string, depth: number): Common {
  return {
    id: slug(r.id, fallback),
    s: Math.max(0, Math.min(40, Math.round(num(r.s ?? r.sentence, 0)))),
    ...(str(r.part, 40) ? { part: str(r.part, 40) } : {}),
  };
}

function parseRegion(r: Record<string, unknown>, fallback: string, depth: number): RegionEl | null {
  const shape = (SHAPES.has(str(r.shape, 12) as DiagramShapeKind) ? str(r.shape, 12) : "rect") as DiagramShapeKind;
  const points = arr(r.points).map(pt).filter((p): p is DiagramPt => Boolean(p)).slice(0, 32);
  if (shape === "polygon" && points.length < 3) return null;
  return {
    t: "region",
    ...common(r, fallback, depth),
    ...styleOf(r),
    shape,
    x: num(r.x),
    y: num(r.y),
    w: Math.max(1, num(r.w, 20)),
    h: Math.max(1, num(r.h, 20)),
    cx: num(r.cx, num(r.x) + num(r.w, 20) / 2),
    cy: num(r.cy, num(r.y) + num(r.h, 20) / 2),
    rx: Math.max(1, num(r.rx, num(r.w, 20) / 2)),
    ry: Math.max(1, num(r.ry, num(r.h, 20) / 2)),
    r: Math.max(1, num(r.r, 8)),
    ...(points.length ? { points } : {}),
  };
}

function parseElement(raw: unknown, fallback: string, depth: number): DiagramElement | null {
  if (depth > 4) return null;
  const r = obj(raw);
  const t = str(r.t ?? r.kind, 16);
  if (!KINDS.has(t)) return null;
  if (t === "region") return parseRegion(r, fallback, depth);
  if (t === "line") {
    const points = arr(r.points).map(pt).filter((p): p is DiagramPt => Boolean(p)).slice(0, 48);
    if (points.length < 2) return null;
    return { t: "line", ...common(r, fallback, depth), ...styleOf(r), points, curve: bool(r.curve), closed: bool(r.closed) };
  }
  if (t === "arrow") {
    const from = anchor(r.from);
    const to = anchor(r.to);
    if (!from || !to) return null;
    return { t: "arrow", ...common(r, fallback, depth), ...styleOf(r), from, to, curved: bool(r.curved), ...(str(r.label, 28) ? { label: str(r.label, 28) } : {}) };
  }
  if (t === "label") {
    const text = str(r.text ?? r.name, 34);
    const at = anchor(r.at ?? r.anchor);
    if (!text || !at) return null;
    return { t: "label", ...common(r, fallback, depth), text, at, leader: r.leader !== false };
  }
  if (t === "group") {
    const elements = arr(r.elements).map((el, i) => parseElement(el, `${fallback}-g${i + 1}`, depth + 1)).filter((el): el is DiagramElement => Boolean(el)).slice(0, 40);
    if (!elements.length) return null;
    return { t: "group", ...common(r, fallback, depth), elements };
  }
  if (t === "repeat") {
    const of = parseRegion(obj(r.of ?? r.item), `${fallback}-item`, depth + 1);
    const n = Math.max(1, Math.min(80, Math.round(num(r.n, 1))));
    if (!of) return null;
    const layout = (LAYOUTS.has(str(r.layout, 8) as RepeatLayout) ? str(r.layout, 8) : "grid") as RepeatLayout;
    return {
      t: "repeat",
      ...common(r, fallback, depth),
      ...styleOf(r),
      n,
      layout,
      of,
      gap: Math.max(0, num(r.gap, 4)),
      x: num(r.x),
      y: num(r.y),
      w: Math.max(10, num(r.w, 120)),
      h: Math.max(10, num(r.h, 80)),
    };
  }
  if (t === "axis") {
    return {
      t: "axis",
      ...common(r, fallback, depth),
      x: num(r.x, 50),
      y: num(r.y, 30),
      w: Math.max(40, num(r.w, 500)),
      h: Math.max(40, num(r.h, 300)),
      xLabel: str(r.xLabel ?? obj(r.x).label, 28) || "x",
      yLabel: str(r.yLabel ?? obj(r.y).label, 28) || "y",
      xMin: num(r.xMin ?? obj(r.x).min, 0),
      xMax: num(r.xMax ?? obj(r.x).max, 10),
      yMin: num(r.yMin ?? obj(r.y).min, 0),
      yMax: num(r.yMax ?? obj(r.y).max, 10),
    };
  }
  if (t === "series") {
    const points = arr(r.points).map((p) => {
      const q = Array.isArray(p) ? { x: num(p[0], NaN), y: num(p[1], NaN) } : obj(p);
      const x = num((q as DiagramPt).x, NaN);
      const y = num((q as { y?: unknown }).y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const label = str((q as { label?: unknown }).label, 20);
      return { x, y, ...(label ? { label } : {}) };
    }).filter((p): p is { x: number; y: number; label?: string } => Boolean(p)).slice(0, 40);
    if (points.length < 2) return null;
    const style = str(r.style, 8);
    return {
      t: "series",
      ...common(r, fallback, depth),
      ...styleOf(r),
      axis: slug(r.axis, "axis"),
      points,
      style: style === "points" || style === "line" || style === "both" ? style : "both",
    };
  }
  if (t === "bands") {
    const bands = arr(r.bands).map((b, i) => {
      const q = obj(b);
      const name = str(q.name ?? q.label, 28);
      if (!name) return null;
      return {
        id: slug(q.id, `band-${i + 1}`),
        name,
        from: num(q.from),
        to: num(q.to, 1),
        ...(str(q.fill, 24) ? { fill: str(q.fill, 24) } : {}),
        s: Math.max(0, Math.round(num(q.s, 0))),
        ...(str(q.part, 40) ? { part: str(q.part, 40) } : {}),
      };
    }).filter((b): b is NonNullable<typeof b> => Boolean(b)).slice(0, 12);
    if (bands.length < 2) return null;
    return {
      t: "bands",
      ...common(r, fallback, depth),
      orientation: str(r.orientation, 2) === "v" ? "v" : "h",
      x: num(r.x),
      y: num(r.y),
      w: Math.max(20, num(r.w, 200)),
      h: Math.max(20, num(r.h, 200)),
      bands,
    };
  }
  if (t === "inset") {
    return {
      t: "inset",
      ...common(r, fallback, depth),
      x: num(r.x),
      y: num(r.y),
      w: Math.max(20, num(r.w, 80)),
      h: Math.max(20, num(r.h, 80)),
      ...(slug(r.of) ? { of: slug(r.of) } : {}),
      ...(str(r.label, 24) ? { label: str(r.label, 24) } : {}),
    };
  }
  if (t === "map-mark") {
    return {
      t: "map-mark",
      ...common(r, fallback, depth),
      ...styleOf(r),
      lon: num(r.lon),
      lat: num(r.lat),
      kind: str(r.kind, 8) === "arrow" ? "arrow" : "dot",
      ...(r.toLon !== undefined ? { toLon: num(r.toLon) } : {}),
      ...(r.toLat !== undefined ? { toLat: num(r.toLat) } : {}),
      ...(str(r.label, 28) ? { label: str(r.label, 28) } : {}),
    };
  }
  return null;
}

/**
 * Parse unknown JSON into a DiagramSpec. Invalid pieces are dropped, never thrown: a partial
 * diagram still ships. Returns null only when nothing drawable remains.
 */
export function parseDiagramSpec(raw: unknown): DiagramSpec | null {
  const r = obj(raw);
  const inner = r.elements || r.base ? r : obj(r.spec ?? r.diagram ?? r.drawing);
  const w = Math.max(200, Math.min(800, num(inner.w, 640)));
  const h = Math.max(150, Math.min(600, num(inner.h, 400)));
  const baseRaw = str(inner.base, 20) as DiagramBase;
  const base = BASES.has(baseRaw) ? baseRaw : "none";
  const seen = new Set<string>();
  const elements = arr(inner.elements)
    .map((el, i) => parseElement(el, `el-${i + 1}`, 0))
    .filter((el): el is DiagramElement => Boolean(el))
    .map((el) => {
      let id = el.id;
      if (!id || seen.has(id)) id = `${el.id || "el"}-${seen.size + 1}`;
      seen.add(id);
      return { ...el, id };
    })
    .slice(0, 80);
  if (!elements.length && base === "none") return null;
  return { v: 1, w, h, base, elements };
}

/** A region's box in diagram units: for an ellipse, the box its text can sit in. */
export function regionBox(el: RegionEl): { x: number; y: number; w: number; h: number } {
  if (el.shape === "ellipse") {
    const rx = el.rx ?? el.r ?? (el.w ?? 20) / 2, ry = el.ry ?? el.r ?? (el.h ?? 20) / 2;
    const cx = el.cx ?? (el.x ?? 0) + rx, cy = el.cy ?? (el.y ?? 0) + ry;
    return { x: cx - rx * 0.72, y: cy - ry * 0.72, w: rx * 1.44, h: ry * 1.44 };
  }
  if (el.shape === "polygon" && el.points?.length) {
    const xs = el.points.map((p) => p.x), ys = el.points.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: el.x ?? 0, y: el.y ?? 0, w: el.w ?? 20, h: el.h ?? 20 };
}

/** Text width in diagram units, the estimate the checks use. */
const textW = (text: string, size: number) => text.length * size * 0.56;

/**
 * The lines a box's name takes INSIDE the box at this size (one, or two split at a space), or null
 * when it does not fit — then it stays a margin label on a leader.
 */
export function boxLabelLines(text: string, box: { w: number; h: number }, size = 13): string[] | null {
  const room = box.w - 14;
  if (box.w < 40 || box.h < size + 6) return null;
  if (textW(text, size) <= room) return [text];
  if (box.h < size * 2.4 + 6) return null;
  const words = text.split(/\s+/);
  let best: string[] | null = null;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    if (lines.every((l) => textW(l, size) <= room) && (!best || Math.max(...lines.map((l) => l.length)) < Math.max(...best.map((l) => l.length)))) best = lines;
  }
  return best;
}

/**
 * THE BOX A LABEL NAMES AND SITS IN. A label pointed at a region by id is that box's name: it is
 * written inside it (lib/diagrams/render.ts) instead of in the margin on a leader that crossed the
 * neighbouring boxes — "the labelling is so bad" (2026-10-17). Polygons keep the margin.
 */
export function inBoxRegion(label: LabelEl, regions: Map<string, RegionEl>): RegionEl | null {
  if (!("id" in label.at)) return null;
  const region = regions.get(label.at.id);
  if (!region || region.shape === "polygon") return null;
  const box = regionBox(region);
  return boxLabelLines(label.text, box) || boxLabelLines(label.text, box, 11) ? region : null;
}

/**
 * WHERE A LABEL IS WRITTEN — where the board model put it, not in the margin:
 * - "box": it names a box (by id, or placed inside it) and fits inside — written in the box;
 * - "here": placed at a point on the drawing — written at that point;
 * - "margin": pinned to a line or a mark (or a box too small for it) — the margin, on a leader.
 * Every label used to default to the margin, so "A3" written inside its byte box and "0 bytes"
 * beside its row were moved to the board's edge on long leaders across the drawing (2026-10-17).
 */
export function labelPlacement(label: LabelEl, regions: Map<string, RegionEl>): { place: "box"; region: RegionEl } | { place: "here" | "margin" } {
  const byId = inBoxRegion(label, regions);
  if (byId) return { place: "box", region: byId };
  if ("id" in label.at) return { place: "margin" };
  if ("lon" in label.at) return { place: label.leader === false ? "here" : "margin" };
  // A label given a point is written AT that point — never re-centred in the box around it: four
  // lines a model placed one under another in one box were all centred onto the same spot (the
  // "Assuming a Finite List" board, 2026-10-17).
  return { place: "here" };
}

export function flattenElements(elements: DiagramElement[]): DiagramElement[] {
  const out: DiagramElement[] = [];
  const walk = (list: DiagramElement[]) => {
    for (const el of list) {
      if (el.t === "group") walk(el.elements);
      else out.push(el);
    }
  };
  walk(elements);
  return out;
}

/** Every number written in the spec (labels, series points, repeat counts, map labels). */
export function numbersInSpec(spec: DiagramSpec): number[] {
  const found: number[] = [];
  const take = (text: string) => {
    const plain = text.replace(/(\d),(\d{3})/g, "$1$2");
    for (const m of plain.match(/-?\d+(?:\.\d+)?/g) ?? []) found.push(Number(m));
  };
  const walk = (el: DiagramElement) => {
    if (el.t === "label") take(el.text);
    if (el.t === "arrow" && el.label) take(el.label);
    if (el.t === "map-mark" && el.label) take(el.label);
    if (el.t === "repeat") found.push(el.n);
    if (el.t === "series") el.points.forEach((p) => { found.push(p.x, p.y); if (p.label) take(p.label); });
    if (el.t === "axis") { take(el.xLabel); take(el.yLabel); found.push(el.xMin, el.xMax, el.yMin, el.yMax); }
    if (el.t === "bands") el.bands.forEach((b) => take(b.name));
    if (el.t === "group") el.elements.forEach(walk);
    if (el.part) take(el.part);
  };
  spec.elements.forEach(walk);
  return found;
}
