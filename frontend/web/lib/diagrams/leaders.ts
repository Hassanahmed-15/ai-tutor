import { shapeBoxes } from "../figures/bounds";
import { placeLabels, type PlacedLabel } from "../figures/labels";
import type { FigureDrawing } from "../figures/types";
import { inkIndex, partInkPoints, textGap } from "./ink";

/**
 * LEADERS THAT POINT AT ONE THING. A margin label's leader runs from its column to a dot on its part;
 * where the dot sits decides what the leader passes on the way. A leader laid along the tops of two
 * circulation cells read as pointing at them, and a dot on a block's "A" hid the letter (QA
 * 2026-10-17). This lays the labels out as the image renderer does (lib/diagrams/grammarRender.ts —
 * margins, scale, the label engine of lib/figures/labels.ts with every part's outline an obstacle),
 * measures how far each leader runs over other parts' ink and words, and moves a dot along its own
 * part's ink until its leader is clear. Pure; used by both diagram grammars.
 */

const W = 1000, H = 600;
const measure = (text: string, size: number) => text.length * size * 0.56;

/** The image layout: figure box, scale, and the placed labels (as lib/diagrams/grammarRender.ts draws them). */
export function diagramLabelLayout(drawing: FigureDrawing, labels: Array<{ id: string; name: string }> = drawing.parts.map((p) => ({ id: p.id, name: p.name }))): { fig: { x: number; y: number; w: number; h: number }; k: number; placed: PlacedLabel[] } {
  const named = labels.filter((l) => drawing.parts.some((p) => p.id === l.id));
  // Margins as wide as the longest label needs: a fixed 220 px each side left a wide, short diagram
  // at a third of the frame's height.
  const margin = named.length ? Math.min(220, Math.max(...named.map((l) => Math.min(measure(l.name, 17), 190))) + 46) : 30;
  const k = Math.min((W - margin * 2) / drawing.w, (H - 60) / drawing.h);
  const fig = { x: (W - drawing.w * k) / 2, y: (H - drawing.h * k) / 2, w: drawing.w * k, h: drawing.h * k };
  const obstacles = shapeBoxes(drawing).filter(({ box: b }) => b.w * b.h < drawing.w * drawing.h * 0.45 && b.w > 6 && b.h > 6).map(({ part, box: b, circle }) => ({ id: part, box: { x: fig.x + b.x * k, y: fig.y + b.y * k, w: b.w * k, h: b.h * k }, ...(circle ? { circle: { cx: fig.x + circle.cx * k, cy: fig.y + circle.cy * k, r: circle.r * k } } : {}) }));
  const placed = placeLabels(
    named.map((l, i) => {
      const p = drawing.parts.find((q) => q.id === l.id)!;
      return { id: l.id, text: l.name, anchor: { x: fig.x + p.anchor.x * k, y: fig.y + p.anchor.y * k }, s: i };
    }),
    fig, { x: 12, y: 12, w: W - 24, h: H - 24 }, measure, 17, obstacles,
  );
  return { fig, k, placed };
}

/** Each part's ink (its own included) and every word, rasterised (1 unit cells, dilated) for fast "is this on ink?" checks. */
function inkGrid(drawing: FigureDrawing, tol: number) {
  const gw = Math.ceil(drawing.w) + 24, gh = Math.ceil(drawing.h) + 24, off = 12;
  const ids = [...new Set(drawing.shapes.map((s) => s.part).filter((p): p is string => Boolean(p)))];
  const grids = new Map<string, Uint8Array>(ids.map((id) => [id, new Uint8Array(gw * gh)]));
  const words = new Uint8Array(gw * gh);
  const dot = (g: Uint8Array, x: number, y: number) => {
    const r = Math.ceil(tol);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > tol * tol + 0.5) continue;
      const cx = Math.round(x + dx) + off, cy = Math.round(y + dy) + off;
      if (cx >= 0 && cy >= 0 && cx < gw && cy < gh) g[cy * gw + cx] = 1;
    }
  };
  for (const s of inkIndex(drawing.shapes)) {
    if (s.text) {
      for (let y = Math.floor(s.text.y - tol); y <= s.text.y + s.text.h + tol; y++) for (let x = Math.floor(s.text.x - tol); x <= s.text.x + s.text.w + tol; x++) {
        const cx = x + off, cy = y + off;
        if (cx >= 0 && cy >= 0 && cx < gw && cy < gh) words[cy * gw + cx] = 1;
      }
      continue;
    }
    const g = s.part ? grids.get(s.part) : undefined;
    if (!g) continue;
    for (const run of s.runs) for (let i = 0; i + 1 < run.length; i++) {
      const [a, b] = [run[i], run[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let j = 0; j <= n; j++) dot(g, a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n);
    }
  }
  return (part: string, x: number, y: number, own = true) => {
    const cx = Math.round(x) + off, cy = Math.round(y) + off;
    if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return false;
    const i = cy * gw + cx;
    if (words[i]) return true;
    // Its own ink counts too: a chord's leader laid along the chord reads as underlining it.
    for (const [id, g] of grids) if (g[i] && (own || id !== part)) return true;
    return false;
  };
}

/**
 * The longest stretch, in px, over which each label's leader runs ALONG other parts' ink or words (the
 * last 6 px, reaching the dot, excepted). Crossing a line costs a few px; lying along one is what reads
 * as pointing at it.
 */
export function leaderOverlaps(placed: PlacedLabel[], fig: { x: number; y: number }, k: number, onOther: (part: string, x: number, y: number) => boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const label of placed) {
    let over = 0, run = 0;
    for (let i = 0; i + 1 < label.leader.length; i++) {
      const [a, b] = [label.leader[i], label.leader[i + 1]];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const stop = i + 2 === label.leader.length ? Math.max(0, len - 6) : len;
      for (let t = 0; t < stop; t += 1) {
        const x = (a.x + ((b.x - a.x) * t) / (len || 1) - fig.x) / k, y = (a.y + ((b.y - a.y) * t) / (len || 1) - fig.y) / k;
        if (onOther(label.id, x, y)) { run += 1; over = Math.max(over, run); } else run = 0;
      }
    }
    out.set(label.id, over);
  }
  return out;
}

/**
 * The drawing with each label's dot moved, along its own part's ink and clear of words, until its
 * leader no longer runs over other parts (more than `ok` px) — or as clear as the part allows. Parts
 * listed in `fixed` (an exact point: a crossing, a place) keep their dots.
 */
export function untangleLeaders<T extends FigureDrawing>(drawing: T, fixed: Set<string> = new Set(), ok = 10): T {
  if (drawing.parts.length === 0) return drawing;
  const index = inkIndex(drawing.shapes);
  const first = diagramLabelLayout(drawing);
  const onOther = inkGrid(drawing, Math.max(2, 2 / first.k));
  const score = (d: FigureDrawing) => {
    const { fig, k, placed } = diagramLabelLayout(d);
    const over = leaderOverlaps(placed, fig, k, onOther);
    let total = 0;
    // A dot on a word, or where another part's line meets this one (the chord's dot at A, on the
    // circle), is ambiguous.
    const crowded = (p: { id: string; anchor: { x: number; y: number } }) => [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]].some(([dx, dy]) => onOther(p.id, p.anchor.x + dx / k, p.anchor.y + dy / k, false));
    for (const p of d.parts) total += Math.max(0, (over.get(p.id) ?? 0) - ok) + (textGap(index, p.anchor.x, p.anchor.y) * k < 4 ? 40 : 0) + (!fixed.has(p.id) && crowded(p) ? 15 : 0);
    return { total, over };
  };
  let current: FigureDrawing = drawing;
  let best = score(current);
  for (let pass = 0; pass < 2 && best.total > 0; pass++) {
    for (const part of drawing.parts) {
      if (fixed.has(part.id)) continue;
      const own = current.parts.find((p) => p.id === part.id)!;
      const bad = (best.over.get(part.id) ?? 0) > ok || textGap(index, own.anchor.x, own.anchor.y) * first.k < 4 || [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]].some(([dx, dy]) => onOther(part.id, own.anchor.x + dx / first.k, own.anchor.y + dy / first.k, false));
      if (!bad) continue;
      const candidates = partInkPoints(index, part.id, 64)
        .filter(([x, y]) => textGap(index, x, y) * first.k >= 5)
        .sort((a, b) => Math.hypot(a[0] - own.anchor.x, a[1] - own.anchor.y) - Math.hypot(b[0] - own.anchor.x, b[1] - own.anchor.y));
      for (const [x, y] of candidates) {
        const trial = { ...current, parts: current.parts.map((p) => (p.id === part.id ? { ...p, anchor: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } } : p)) };
        const s = score(trial);
        if (s.total < best.total) { best = s; current = trial; }
        if ((s.over.get(part.id) ?? 0) <= ok && s.total === best.total) break;
      }
    }
  }
  // A leader still running along other ink is often pushed there by its neighbours in the label
  // column (labels stack by their dots' heights): moving ANOTHER part's dot reorders the column.
  if (best.total > 0) {
    for (const other of drawing.parts) {
      if (fixed.has(other.id) || best.total === 0) continue;
      const pts = partInkPoints(index, other.id, 24).filter(([x, y]) => textGap(index, x, y) * first.k >= 5);
      for (const [x, y] of pts) {
        const trial = { ...current, parts: current.parts.map((p) => (p.id === other.id ? { ...p, anchor: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } } : p)) };
        const s = score(trial);
        if (s.total < best.total) { best = s; current = trial; }
      }
    }
  }
  return current === drawing ? drawing : ({ ...drawing, parts: current.parts } as T);
}
