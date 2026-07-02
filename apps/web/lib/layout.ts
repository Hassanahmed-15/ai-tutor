/**
 * Deterministic auto-layout for StructuredVisual (packages/lesson-graph).
 *
 * The Lesson Graph schema deliberately carries no positions, colors, or pixel
 * coordinates (README: "nothing may describe HOW to render something"). This is
 * where "what" becomes "where" for the whiteboard renderer — one layout pass that
 * works for any topic's diagram, instead of a hand-positioned component per topic.
 */

export interface VisualElement {
  id: string;
  label: string;
  value?: string | number;
  emphasis?: boolean;
}

export interface VisualRelation {
  from: string;
  to: string;
  kind: string;
  label?: string;
}

export interface DrawCommands {
  primitive: string;
  elements: VisualElement[];
  relations?: VisualRelation[];
}

export type ShapeKind = "rect" | "pill" | "circle";

export interface LaidOutNode {
  id: string;
  label: string;
  value?: string | number;
  emphasis: boolean;
  shape: ShapeKind;
  /** Center x/y and half-extents, in a 0-1000 x 0-560 board coordinate space. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Layer index (0 = leftmost/root), used for color + stagger ordering. */
  layer: number;
}

export interface LaidOutEdge {
  from: LaidOutNode;
  to: LaidOutNode;
  kind: string;
  label?: string;
}

export interface BoardLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
  /** Array layouts pack same-row siblings tightly and edges may span over intermediate
   *  nodes — labels render below the row rather than at the connector midpoint. */
  labelsBelowRow: boolean;
}

const BOARD_W = 1000;
const BOARD_H = 560;

/** Longest-path-from-source layering (Sugiyama-style), good enough for the small (<=8 node) diagrams here. */
function computeLayers(elements: VisualElement[], relations: VisualRelation[]): Map<string, number> {
  const ids = elements.map((e) => e.id);
  const incoming = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const rel of relations) {
    if (incoming.has(rel.to)) incoming.get(rel.to)!.push(rel.from);
  }

  const layer = new Map<string, number>();
  const resolving = new Set<string>();

  function layerOf(id: string): number {
    if (layer.has(id)) return layer.get(id)!;
    if (resolving.has(id)) return 0; // cycle guard
    resolving.add(id);
    const preds = incoming.get(id) ?? [];
    const value = preds.length === 0 ? 0 : Math.max(...preds.map(layerOf)) + 1;
    layer.set(id, value);
    resolving.delete(id);
    return value;
  }

  for (const id of ids) layerOf(id);
  return layer;
}

function shapeFor(relations: VisualRelation[], id: string): ShapeKind {
  const kinds = relations.filter((r) => r.from === id || r.to === id).map((r) => r.kind);
  if (kinds.includes("compares-to")) return "circle";
  if (kinds.includes("contains")) return "rect";
  return "pill";
}

/** Graph/diagram layout: layered left-to-right, evenly spaced within each layer. */
function layoutDiagram(elements: VisualElement[], relations: VisualRelation[]): BoardLayout {
  const layers = computeLayers(elements, relations);
  const maxLayer = Math.max(0, ...Array.from(layers.values()));
  const byLayer = new Map<number, VisualElement[]>();
  for (const el of elements) {
    const l = layers.get(el.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(el);
  }

  // Wide diagrams (many layers/columns) get a wider board so boxes have room to
  // breathe — the SVG viewBox scales to the container, so this costs no screen space.
  const boardW = Math.max(BOARD_W, 170 + maxLayer * 300);
  const padX = 90;
  const padY = 70;
  const usableW = boardW - padX * 2;
  const usableH = BOARD_H - padY * 2;
  // Column width is whatever's left after fitting (maxLayer + 1) columns with a generous
  // gap between them — that gap is where the connector + its label live, so it has to be
  // wide enough for real label text, not just a sliver between box edges.
  const colSpacing = maxLayer === 0 ? usableW : usableW / maxLayer;
  const maxBoxW = Math.max(90, colSpacing - 110);

  const nodes: LaidOutNode[] = [];
  for (const [l, els] of byLayer.entries()) {
    const colX = maxLayer === 0 ? padX + usableW / 2 : padX + (usableW * l) / maxLayer;
    els.forEach((el, i) => {
      const rowY = padY + (usableH * (i + 1)) / (els.length + 1);
      const w = Math.max(90, Math.min(maxBoxW, 70 + el.label.length * 8));
      const h = 78;
      nodes.push({
        id: el.id,
        label: el.label,
        value: el.value,
        emphasis: Boolean(el.emphasis),
        shape: shapeFor(relations, el.id),
        x: colX,
        y: rowY,
        w,
        h,
        layer: l,
      });
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LaidOutEdge[] = relations
    .map((r): LaidOutEdge | null => {
      const from = byId.get(r.from);
      const to = byId.get(r.to);
      if (!from || !to) return null;
      return { from, to, kind: r.kind, label: r.label };
    })
    .filter((e): e is LaidOutEdge => e !== null);

  return { nodes, edges, width: boardW, height: BOARD_H, labelsBelowRow: false };
}

/** Array layout: one row, evenly spaced, order is meaningful (positional semantics). */
function layoutArray(elements: VisualElement[], relations: VisualRelation[]): BoardLayout {
  const padX = 90;
  const usableW = BOARD_W - padX * 2;
  const n = Math.max(1, elements.length);
  const w = Math.min(110, usableW / n - 18);
  const y = BOARD_H / 2;

  const nodes: LaidOutNode[] = elements.map((el, i) => ({
    id: el.id,
    label: el.label,
    value: el.value,
    emphasis: Boolean(el.emphasis),
    shape: "rect",
    x: padX + (usableW * i) / Math.max(1, n - 1 || 1) + (n === 1 ? usableW / 2 - padX : 0),
    y,
    w,
    h: w,
    layer: i,
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LaidOutEdge[] = (relations ?? [])
    .map((r): LaidOutEdge | null => {
      const from = byId.get(r.from);
      const to = byId.get(r.to);
      if (!from || !to) return null;
      return { from, to, kind: r.kind, label: r.label };
    })
    .filter((e): e is LaidOutEdge => e !== null);

  return { nodes, edges, width: BOARD_W, height: BOARD_H, labelsBelowRow: true };
}

export function layoutBoard(commands: DrawCommands): BoardLayout {
  const relations = commands.relations ?? [];
  if (commands.primitive === "array") {
    return layoutArray(commands.elements, relations);
  }
  return layoutDiagram(commands.elements, relations);
}
