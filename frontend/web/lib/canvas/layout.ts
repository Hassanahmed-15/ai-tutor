/**
 * THE CANVAS LAYOUT — spec in, positioned marks out. Pure, so it is unit-tested directly.
 *
 * Every position on a canvas board is decided here, never by the model. That is the whole reason the
 * format exists (ANIMATIONS.md: "the model only classifies and supplies content"): a board whose
 * geometry is computed cannot overlap or leave its panel, and every element has bounds the pointer
 * and the camera can aim at without measuring the DOM.
 *
 * A panel is 1000 x 560: heading across the top, a notes column on the left, the stage on the right.
 */

import { PANEL_H, PANEL_W, type Becomes, type CanvasBoardSpec, type CanvasIcon, type CodeStage, type CompareStage, type EquationStage, type FlowStage, type GraphStage, type IllustrationStage, type SceneStage } from "./types";

export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

export type Mark =
  | { type: "heading"; id: string; text: string; x: number; y: number; size: number; s: number }
  | { type: "note"; id: string; lines: string[]; x: number; y: number; size: number; s: number; bullet: Pt }
  | { type: "node"; id: string; cx: number; cy: number; r: number; icon?: CanvasIcon; label: string; sub?: string; color: string; s: number; glow?: string; labelY: number; labelSize: number; becomes?: Becomes }
  | { type: "arrow"; id: string; p0: Pt; c: Pt; p1: Pt; label?: string; labelAt: Pt; s: number; flow: boolean; rate?: string; color: string }
  | { type: "picture"; id: string; rect: Rect; src?: string; paper?: string; s: number; subject: string }
  | { type: "part"; id: string; cx: number; cy: number; name: string; s: number }
  | { type: "callout"; id: string; partId: string; text: string; box: Rect; anchor: Pt; s: number; size: number }
  | { type: "equation"; id: string; tokens: Array<{ id: string; text: string; color: string; w: number; size: number }>; steps: Array<{ s: number; place: Record<string, Pt>; highlight: string[]; caption?: string }>; size: number; captionY: number; center: number; s: number }
  | { type: "graph"; id: string; plot: Rect; spec: GraphStage; s: number }
  | { type: "column"; id: string; rect: Rect; title: string; icon?: CanvasIcon; color: string; s: number }
  | { type: "item"; id: string; text: string; rect: Rect; color: string; s: number; size: number }
  | { type: "link"; id: string; p0: Pt; p1: Pt; s: number }
  | { type: "box"; id: string; rect: Rect; label?: string; color: string; s: number; icon?: CanvasIcon; size: number }
  | { type: "text"; id: string; rect: Rect; text: string; color: string; s: number; size: number }
  | { type: "code"; id: string; rect: Rect; lines: string[]; language: string; size: number; lineH: number; gutter: number; steps: CodeStage["steps"]; s: number }
  | { type: "trace"; id: string; rect: Rect; vars: string[]; rows: Array<{ s: number; values: string[] }>; size: number; s: number }
  | { type: "output"; id: string; rect: Rect; text: string; size: number; s: number };

export type PanelLayout = {
  marks: Mark[];
  /** Every id the pointer or camera may aim at, with its bounds and the sentence it appears on. */
  targets: Record<string, Rect & { s: number }>;
  stage: Rect;
};

export const INK = "#1f2937";
export const PALETTE = ["#0f766e", "#d97706", "#2563eb", "#be123c", "#7c3aed", "#15803d", "#b45309", "#0369a1"];

const HEADING_SIZE = 34;
const NOTE_SIZE = 21;
const NOTES_X = 48;
const NOTES_W = 268;
const STAGE: Rect = { x: 352, y: 108, w: 612, h: 424 };
const STAGE_WIDE: Rect = { x: 56, y: 108, w: 908, h: 424 };

/** Average advance of the board font (Nunito SemiBold), in em. Close enough to lay text out. */
const EM = 0.54;
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    w += /[₀-₉⁰-⁹]/.test(ch) ? 0.42
      : /[→←⇌↔⟶]/.test(ch) ? 1.0
      : /[+=−×]/.test(ch) ? 0.62
      : /[A-Z0-9]/.test(ch) ? 0.62
      : /[il.,'’:;|!]/.test(ch) ? 0.28
      : /\s/.test(ch) ? 0.28
      : /[mwMW]/.test(ch) ? 0.82
      : EM;
  }
  return w * size;
}

export function wrap(text: string, size: number, maxW: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) <= maxW || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]?$/, "")}…`;
    return kept;
  }
  return lines;
}

const colorAt = (i: number, given?: string) => (given && /^#[0-9a-f]{3,8}$/i.test(given) ? given : PALETTE[i % PALETTE.length]);
const union = (rects: Rect[]): Rect => {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

export function layoutPanel(spec: CanvasBoardSpec): PanelLayout {
  const marks: Mark[] = [];
  const targets: PanelLayout["targets"] = {};
  const hasNotes = spec.notes.length > 0;
  const stage = hasNotes ? STAGE : STAGE_WIDE;

  const headingSize = textWidth(spec.heading, HEADING_SIZE) > PANEL_W - 110 ? 28 : HEADING_SIZE;
  // s = -1: the heading is written while Aria is still bridging into the board, before sentence 0.
  marks.push({ type: "heading", id: "heading", text: spec.heading, x: 48, y: 66, size: headingSize, s: -1 });
  targets.heading = { x: 48, y: 66 - headingSize, w: Math.min(PANEL_W - 96, textWidth(spec.heading, headingSize)), h: headingSize * 1.25, s: 0 };

  let y = 140;
  spec.notes.slice(0, 4).forEach((note) => {
    const lines = wrap(note.text, NOTE_SIZE, NOTES_W - 26, 2);
    marks.push({ type: "note", id: note.id, lines, x: NOTES_X + 24, y, size: NOTE_SIZE, s: note.s, bullet: { x: NOTES_X + 7, y: y - NOTE_SIZE * 0.34 } });
    const h = lines.length * NOTE_SIZE * 1.28;
    targets[note.id] = { x: NOTES_X, y: y - NOTE_SIZE, w: NOTES_W, h: h + 6, s: note.s };
    y += h + 30;
  });

  const add = (id: string, rect: Rect, s: number) => {
    targets[id] = { ...rect, s };
  };
  switch (spec.stage.kind) {
    case "flow":
      layoutFlow(spec.stage, stage, marks, add);
      break;
    case "illustration":
      layoutIllustration(spec.stage, stage, marks, add);
      break;
    case "equation":
      layoutEquation(spec.stage, stage, marks, add);
      break;
    case "graph":
      layoutGraph(spec.stage, stage, marks, add);
      break;
    case "compare":
      layoutCompare(spec.stage, stage, marks, add);
      break;
    case "scene":
      layoutScene(spec.stage, stage, marks, add);
      break;
    case "code":
      layoutCode(spec.stage, stage, marks, add);
      break;
  }
  targets.stage = { ...stage, s: 0 };
  targets.board = { x: 0, y: 0, w: PANEL_W, h: PANEL_H, s: 0 };
  return { marks, targets, stage };
}

/* ── code ─────────────────────────────────────────────────────────────────────────────────── */

/** Monospace advance, in em. */
const MONO = 0.6;

/**
 * A listing in an editor card, sized so its longest line and all its lines fit; under it, side by
 * side, the trace table and the output when the board has them. Every line is a target, so Aria's
 * pen can point at it and the camera can zoom to it.
 */
function layoutCode(st: CodeStage, area: Rect, marks: Mark[], add: Add) {
  const rowH = 24;
  const traceH = st.trace ? (st.trace.rows.length + 1) * rowH + 22 : 0;
  const outputLines = st.output ? st.output.text.split("\n").length : 0;
  const outputH = st.output ? outputLines * 22 + 44 : 0;
  const bottomH = Math.max(traceH, outputH);
  const gap = bottomH ? 16 : 0;
  const codeArea = { x: area.x, y: area.y, w: area.w, h: area.h - bottomH - gap };
  const maxLen = Math.max(8, ...st.lines.map((l) => l.length));
  const gutter = st.lines.length >= 10 ? 46 : 38;
  const size = Math.max(12, Math.min(20, Math.floor(Math.min((codeArea.w - gutter - 36) / (maxLen * MONO), (codeArea.h - 28) / (st.lines.length * 1.5)))));
  const lineH = Math.round(size * 1.5);
  // Wide enough for the longest line, and for each step's note written beside the line it explains.
  const noteRoom = Math.max(0, ...st.steps.filter((p) => p.note).map((p) => gutter + 14 + (st.lines[Math.min(...p.lines) - 1]?.length ?? 0) * MONO * size + 22 + (p.note!.length + 2) * Math.max(12, size * 0.78) * 0.56 + 14));
  const w = Math.min(codeArea.w, Math.max(320, gutter + maxLen * MONO * size + 48, noteRoom));
  const h = st.lines.length * lineH + 28;
  // A short listing sits in the middle of its area rather than hugging the top of the board.
  const slack = Math.max(0, area.h - (h + gap + bottomH));
  const rect = { x: codeArea.x, y: codeArea.y + Math.round(slack * 0.4), w, h };
  marks.push({ type: "code", id: "code", rect, lines: st.lines, language: st.language, size, lineH, gutter, steps: st.steps, s: st.steps[0]?.s ?? 0 });
  add("code", rect, st.steps[0]?.s ?? 0);
  st.lines.forEach((line, i) => {
    const indent = (line.length - line.trimStart().length) * MONO * size;
    add(`line-${i + 1}`, { x: rect.x + gutter + 14 + indent, y: rect.y + 14 + i * lineH, w: Math.max(24, line.trim().length * MONO * size), h: lineH }, st.steps[0]?.s ?? 0);
  });
  const by = rect.y + rect.h + gap;
  let x = area.x;
  if (st.trace) {
    const colW = Math.max(64, ...st.trace.vars.map((v) => v.length * MONO * 16 + 24), ...st.trace.rows.flatMap((r) => r.values.map((v) => v.length * MONO * 16 + 24)));
    const tw = Math.min(area.w * (st.output ? 0.56 : 1), colW * st.trace.vars.length + 16);
    const trect = { x, y: by, w: tw, h: traceH };
    marks.push({ type: "trace", id: "trace", rect: trect, vars: st.trace.vars, rows: st.trace.rows, size: 16, s: st.trace.rows[0]?.s ?? 0 });
    add("trace", trect, st.trace.rows[0]?.s ?? 0);
    x += tw + 16;
  }
  if (st.output) {
    const ow = Math.min(area.x + area.w - x, Math.max(220, ...st.output.text.split("\n").map((l) => l.length * MONO * 16 + 36)));
    const orect = { x, y: by, w: ow, h: outputH };
    marks.push({ type: "output", id: "output", rect: orect, text: st.output.text, size: 16, s: st.output.s });
    add("output", orect, st.output.s);
  }
}

/* ── flow ─────────────────────────────────────────────────────────────────────────────────── */

type Add = (id: string, rect: Rect, s: number) => void;

function nodeMark(node: FlowStage["nodes"][number], i: number, cx: number, cy: number, r: number, add: Add, maxLabelW = 220): Mark {
  // A name wider than the room its node has is set smaller rather than run into its neighbour.
  const labelSize = Math.max(14, Math.min(r > 50 ? 22 : 19, Math.floor((maxLabelW / Math.max(1, textWidth(node.label, 1))))));
  const labelY = cy + r + labelSize + 6;
  const labelW = Math.max(textWidth(node.label, labelSize), node.sub ? textWidth(node.sub, 15) : 0);
  add(node.id, union([{ x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, { x: cx - labelW / 2, y: labelY - labelSize, w: labelW, h: labelSize * (node.sub ? 2.2 : 1.3) }]), node.s);
  return { type: "node", id: node.id, cx, cy, r, icon: node.icon, label: node.label, sub: node.sub, color: colorAt(i, node.color), s: node.s, glow: node.glow, labelY, labelSize, becomes: node.becomes };
}

function edgePoint(from: Pt, to: Pt, r: number, pad = 10): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / d) * (r + pad), y: from.y + (dy / d) * (r + pad) };
}

function arrowMarks(arrows: FlowStage["arrows"], centres: Map<string, { c: Pt; r: number; below?: number }>, bend: (a: Pt, b: Pt) => number, marks: Mark[], add: Add) {
  // An arrow that leaves or arrives through a node's underside clears the node's label as well.
  const clear = (from: { c: Pt; r: number; below?: number }, to: Pt) => {
    const d = Math.hypot(to.x - from.c.x, to.y - from.c.y) || 1;
    return (to.y - from.c.y) / d > 0.45 ? from.below ?? 0 : 0;
  };
  arrows.forEach((arrow, i) => {
    const a = centres.get(arrow.from);
    const b = centres.get(arrow.to);
    if (!a || !b) return;
    const p0 = edgePoint(a.c, b.c, a.r, 10 + clear(a, b.c));
    const p1 = edgePoint(b.c, a.c, b.r, 16 + clear(b, a.c));
    // Nodes almost touching leave no room for an arrow: a lone arrowhead reads as a mistake.
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 28 || (p1.x - p0.x) * (b.c.x - a.c.x) + (p1.y - p0.y) * (b.c.y - a.c.y) <= 0) return;
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = bend(p0, p1);
    const c = { x: mx - (dy / d) * k, y: my + (dx / d) * k };
    // The label sits at the curve's midpoint, nudged off the line on the outside of the bend.
    const mid = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y };
    const side = k >= 0 ? 1 : -1;
    const labelAt = { x: mid.x - (dy / d) * 18 * side, y: mid.y + (dx / d) * 18 * side + (Math.abs(dx) > Math.abs(dy) ? -4 : 5) };
    // A short arrow has no room for a label beside it; the nodes it joins already say enough.
    const label = Math.hypot(p1.x - p0.x, p1.y - p0.y) > 110 ? arrow.label : undefined;
    marks.push({ type: "arrow", id: arrow.id, p0, c, p1, label, labelAt, s: arrow.s, flow: arrow.flow ?? false, rate: arrow.rate, color: arrow.color ?? PALETTE[(i + 2) % PALETTE.length] });
    add(arrow.id, union([{ x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(dx) || 8, h: Math.abs(dy) || 8 }, { x: labelAt.x - 40, y: labelAt.y - 16, w: 80, h: 22 }]), arrow.s);
  });
}

function layoutFlow(stage: FlowStage, box: Rect, marks: Mark[], add: Add) {
  const nodes = stage.nodes.slice(0, 7);
  const centres = new Map<string, { c: Pt; r: number; below?: number }>();
  const nodeMarks: Mark[] = [];
  const place = (node: FlowStage["nodes"][number], i: number, cx: number, cy: number, r: number, maxLabelW?: number) => {
    centres.set(node.id, { c: { x: cx, y: cy }, r, below: node.sub ? 48 : 28 });
    nodeMarks.push(nodeMark(node, i, cx, cy, r, add, maxLabelW));
  };

  if (stage.arrangement === "inputs-core-outputs") {
    const core = nodes.find((n) => n.role === "core") ?? nodes[Math.floor(nodes.length / 2)];
    const inputs = nodes.filter((n) => n !== core && n.role !== "output");
    const outputs = nodes.filter((n) => n !== core && n.role === "output");
    const column = (list: typeof nodes, x: number) => {
      const r = list.length > 3 ? 30 : 36;
      const span = box.h - 70;
      list.forEach((node, k) => {
        const cy = box.y + 20 + (span * (k + 0.5)) / list.length;
        // Three or more in a column leave no room for a second line under each; the label carries it.
        place(list.length >= 3 ? { ...node, sub: undefined } : node, nodes.indexOf(node), x, cy, r);
      });
    };
    column(inputs, box.x + 58);
    place(core, nodes.indexOf(core), box.x + box.w / 2, box.y + box.h / 2 - 22, 66);
    column(outputs, box.x + box.w - 58);
  } else if (stage.arrangement === "cycle") {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2 - 14;
    const rx = box.w / 2 - 80;
    const ry = box.h / 2 - 78;
    nodes.forEach((node, i) => {
      const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
      place(node, i, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 36);
    });
  } else {
    // chain: one row up to four, otherwise a snake over two rows.
    const perRow = nodes.length <= 4 ? nodes.length : Math.ceil(nodes.length / 2);
    const rows = Math.ceil(nodes.length / perRow);
    nodes.forEach((node, i) => {
      const row = Math.floor(i / perRow);
      let col = i % perRow;
      if (row % 2 === 1) col = perRow - 1 - col;
      const cx = box.x + (box.w * (col + 0.5)) / perRow;
      const cy = rows === 1 ? box.y + box.h / 2 - 20 : box.y + 70 + row * (box.h / 2);
      // Four or more side by side leave no room for a second line under each.
      const crowded = perRow >= 4;
      place(crowded ? { ...node, sub: undefined } : node, i, cx, cy, rows === 1 ? 42 : 34, box.w / perRow - 14);
    });
  }

  const bend = stage.arrangement === "cycle" ? () => -26 : (a: Pt, b: Pt) => (Math.abs(a.y - b.y) < 10 ? 0 : a.y < b.y ? 14 : -14);
  arrowMarks(stage.arrows, centres, bend, marks, add);
  marks.push(...nodeMarks);
}

/* ── illustration ─────────────────────────────────────────────────────────────────────────── */

function layoutIllustration(stage: IllustrationStage, box: Rect, marks: Mark[], add: Add) {
  const w = Math.min(box.w, (box.h - 10) * 1.5);
  const h = w / 1.5;
  const rect = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2 - 4, w, h };
  marks.push({ type: "picture", id: "picture", rect, src: stage.src, paper: stage.paper, s: 0, subject: stage.subject });
  add("picture", rect, 0);

  const placed: Rect[] = [];
  const parts = stage.parts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const points = new Map<string, Pt>();
  for (const part of parts) {
    const cx = rect.x + (part.x as number) * rect.w;
    const cy = rect.y + (part.y as number) * rect.h;
    points.set(part.id, { x: cx, y: cy });
    marks.push({ type: "part", id: part.id, cx, cy, name: part.name, s: part.s });
    // A part's target is a region around its point, big enough to read as "this bit" when zoomed to.
    add(part.id, { x: cx - 34, y: cy - 34, w: 68, h: 68 }, part.s);
    placed.push({ x: cx - 8, y: cy - 8, w: 16, h: 16 });
  }

  const size = 18;
  for (const id of stage.labels.slice(0, 3)) {
    const part = parts.find((p) => p.id === id);
    const at = part && points.get(part.id);
    if (!part || !at) continue;
    const bw = textWidth(part.name, size) + 26;
    const bh = 32;
    let best: Rect | null = null;
    let bestScore = Infinity;
    for (let ring = 0; ring < 3 && !best; ring++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const dist = 80 + ring * 45;
        const cx = at.x + Math.cos(a) * dist;
        const cy = at.y + Math.sin(a) * dist * 0.75;
        const cand = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
        if (cand.x < box.x - 20 || cand.x + cand.w > PANEL_W - 12 || cand.y < box.y - 6 || cand.y + cand.h > PANEL_H - 10) continue;
        if (placed.some((r) => overlaps(r, cand, 6))) continue;
        // Prefer the picture's margins over its middle, and short leaders over long ones.
        const outside = cand.x + cand.w < rect.x + 30 || cand.x > rect.x + rect.w - 30 || cand.y + cand.h < rect.y + 30 || cand.y > rect.y + rect.h - 30;
        const score = dist + (outside ? 0 : 60);
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    if (!best) continue;
    placed.push(best);
    marks.push({ type: "callout", id: `${part.id}-label`, partId: part.id, text: part.name, box: best, anchor: at, s: part.s, size });
    add(`${part.id}-label`, best, part.s);
  }
}

/* ── equation ─────────────────────────────────────────────────────────────────────────────── */

function layoutEquation(stage: EquationStage, box: Rect, marks: Mark[], add: Add) {
  const tokens = stage.tokens.slice(0, 16);
  const steps = stage.steps.length ? stage.steps : [{ s: 0, order: tokens.map((t) => t.id) }];
  const hosted = new Map(tokens.filter((t) => t.on && tokens.some((h) => h.id === t.on && !h.on)).map((t) => [t.id, t.on as string]));
  const inRow = (id: string) => !hosted.has(id);
  const gap = 12;
  const widest = Math.max(...steps.map((step) => step.order.filter(inRow).reduce((w, id) => w + textWidth(tokens.find((t) => t.id === id)?.text ?? "", 1) + gap / 44, 0)));
  const size = Math.max(24, Math.min(46, Math.floor((box.w - 40) / Math.max(1, widest))));
  const small = Math.round(size * 0.5);
  const center = box.x + box.w / 2;
  const baseY = box.y + box.h * 0.44;
  const measured = tokens.map((t, i) => {
    const tokenSize = hosted.has(t.id) ? small : size;
    const color = t.color && /^#/.test(t.color) ? t.color : /[→=⇌]/.test(t.text) || /^[+−-]$/.test(t.text) ? "#64748b" : PALETTE[i % PALETTE.length];
    return { id: t.id, text: t.text, color, w: textWidth(t.text, tokenSize), size: tokenSize };
  });
  const laidSteps = steps.map((step) => {
    const order = step.order.filter((id) => measured.some((t) => t.id === id));
    const row = order.filter(inRow);
    const total = row.reduce((w, id) => w + measured.find((t) => t.id === id)!.w, 0) + gap * Math.max(0, row.length - 1);
    let x = center - total / 2;
    const place: Record<string, Pt> = {};
    for (const id of row) {
      const t = measured.find((m) => m.id === id)!;
      place[id] = { x, y: baseY };
      x += t.w + gap;
    }
    // A hosted token sits centred over its host, when both are in this step.
    for (const id of order.filter((o) => hosted.has(o))) {
      const host = place[hosted.get(id)!];
      const hostW = measured.find((m) => m.id === hosted.get(id))!.w;
      const t = measured.find((m) => m.id === id)!;
      if (host) place[id] = { x: host.x + hostW / 2 - t.w / 2, y: baseY - size * 1.05 };
    }
    return { s: step.s, place, highlight: step.highlight ?? [], caption: step.caption };
  });
  marks.push({ type: "equation", id: "equation", tokens: measured, steps: laidSteps, size, captionY: baseY + 86, center, s: laidSteps[0]?.s ?? 0 });
  const first = laidSteps[0];
  for (const t of measured) {
    const step = laidSteps.find((st) => st.place[t.id]);
    const p = step?.place[t.id];
    if (p) add(t.id, { x: p.x - 4, y: p.y - t.size, w: t.w + 8, h: t.size * 1.3 }, step!.s);
  }
  add("equation", { x: box.x + 10, y: baseY - size * 1.6, w: box.w - 20, h: size * 1.9 + 32 }, first.s);
}

/* ── graph ────────────────────────────────────────────────────────────────────────────────── */

function layoutGraph(stage: GraphStage, box: Rect, marks: Mark[], add: Add) {
  const plot = { x: box.x + 70, y: box.y + 16, w: box.w - 96, h: box.h - 88 };
  marks.push({ type: "graph", id: "graph", plot, spec: stage, s: Math.min(...stage.curves.map((c) => c.s), 0) });
  add("graph", { x: box.x, y: box.y, w: box.w, h: box.h }, 0);
  for (const curve of stage.curves) add(curve.id, plot, curve.s);
  for (const marker of stage.markers ?? []) add(marker.id, plot, marker.s);
  for (const guide of stage.guides ?? []) {
    const gx = plot.x + ((guide.x - stage.x.min) / (stage.x.max - stage.x.min || 1)) * plot.w;
    add(guide.id, { x: gx - 30, y: plot.y, w: 60, h: plot.h }, guide.s);
  }
}

/** Board coordinates of a graph value — shared by the renderer and the pointer. */
export function graphPoint(plot: Rect, spec: GraphStage, x: number, y: number): Pt {
  const fx = (x - spec.x.min) / (spec.x.max - spec.x.min || 1);
  const fy = (y - spec.y.min) / (spec.y.max - spec.y.min || 1);
  return { x: plot.x + fx * plot.w, y: plot.y + plot.h - Math.max(-0.05, Math.min(1.08, fy)) * plot.h };
}

/* ── compare ──────────────────────────────────────────────────────────────────────────────── */

function layoutCompare(stage: CompareStage, box: Rect, marks: Mark[], add: Add) {
  const colW = (box.w - 70) / 2;
  const sides = [
    { side: stage.left, x: box.x, color: colorAt(0, stage.left.color) },
    { side: stage.right, x: box.x + colW + 70, color: colorAt(3, stage.right.color) },
  ];
  const itemAnchors = new Map<string, { left: Pt; right: Pt; s: number }>();
  for (const { side, x, color } of sides) {
    const rect = { x, y: box.y, w: colW, h: box.h - 10 };
    const firstS = Math.min(...side.items.map((i) => i.s), 99);
    marks.push({ type: "column", id: side.id, rect, title: side.title, icon: side.icon, color, s: Number.isFinite(firstS) ? Math.max(0, firstS - 1) : 0 });
    add(side.id, rect, Math.max(0, firstS - 1));
    const size = 19;
    let y = box.y + 92;
    for (const item of side.items.slice(0, 4)) {
      const lines = wrap(item.text, size, colW - 40, 2);
      const h = lines.length * size * 1.3 + 22;
      const r = { x: x + 14, y, w: colW - 28, h };
      marks.push({ type: "item", id: item.id, text: lines.join("\n"), rect: r, color, s: item.s, size });
      add(item.id, r, item.s);
      itemAnchors.set(item.id, { left: { x: r.x, y: r.y + h / 2 }, right: { x: r.x + r.w, y: r.y + h / 2 }, s: item.s });
      y += h + 12;
    }
  }
  for (const [i, link] of (stage.links ?? []).entries()) {
    const a = itemAnchors.get(link.from);
    const b = itemAnchors.get(link.to);
    if (!a || !b) continue;
    marks.push({ type: "link", id: `link-${i}`, p0: a.right, p1: b.left, s: Math.max(a.s, b.s) });
  }
}

/* ── scene ────────────────────────────────────────────────────────────────────────────────── */

export function sceneCell(cell: string, span: string | undefined, box: Rect): Rect {
  const m = /^([A-F])([1-4])$/i.exec(cell.trim());
  const col = m ? m[1].toUpperCase().charCodeAt(0) - 65 : 0;
  const row = m ? Number(m[2]) - 1 : 0;
  const s = /^([1-6])x([1-4])$/.exec(span ?? "") ?? ["", "1", "1"];
  const cw = box.w / 6;
  const ch = box.h / 4;
  const w = Math.min(Number(s[1]), 6 - col);
  const h = Math.min(Number(s[2]), 4 - row);
  return { x: box.x + col * cw + 6, y: box.y + row * ch + 6, w: w * cw - 12, h: h * ch - 12 };
}

function layoutScene(stage: SceneStage, box: Rect, marks: Mark[], add: Add) {
  const centres = new Map<string, { c: Pt; r: number; below?: number }>();
  const itemMarks: Mark[] = [];
  stage.items.slice(0, 12).forEach((item, i) => {
    const rect = sceneCell(item.cell, item.span, box);
    const color = colorAt(i, item.color);
    if (item.kind === "icon") {
      const r = Math.min(rect.w, rect.h - 30) / 2 - 4;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + r + 4;
      itemMarks.push({ type: "node", id: item.id, cx, cy, r, icon: item.icon, label: item.label ?? "", color, s: item.s, labelY: cy + r + 22, labelSize: 17, becomes: item.becomes });
      centres.set(item.id, { c: { x: cx, y: cy }, r, below: item.label ? 26 : 0 });
      add(item.id, rect, item.s);
    } else if (item.kind === "box") {
      itemMarks.push({ type: "box", id: item.id, rect, label: item.label, color, s: item.s, icon: item.icon, size: 18 });
      centres.set(item.id, { c: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, r: Math.min(rect.w, rect.h) / 2 });
      add(item.id, rect, item.s);
    } else {
      itemMarks.push({ type: "text", id: item.id, rect, text: item.label ?? "", color, s: item.s, size: 20 });
      centres.set(item.id, { c: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, r: 20 });
      add(item.id, rect, item.s);
    }
  });
  arrowMarks(stage.arrows, centres, (a, b) => (Math.abs(a.y - b.y) < 10 ? 0 : 12), marks, add);
  marks.push(...itemMarks);
}

/* ── the world ────────────────────────────────────────────────────────────────────────────── */

export type PanelPlacement = { x: number; y: number; scale: number };

const WORLD_GAP_X = 1260;
const WORLD_GAP_Y = 820;
const PER_ROW = 3;

/**
 * Where each panel sits on the world. Top-level panels snake along rows of three, so the camera
 * always flies to a neighbour; a panel `inside` an element of an earlier one is scaled into that
 * element's bounds, which turns "look inside it" into a zoom.
 */
export function placePanels(panels: Array<{ key: string; inside?: { beat: string; id: string }; layout: PanelLayout }>): Record<string, PanelPlacement> {
  const out: Record<string, PanelPlacement> = {};
  let k = 0;
  for (const panel of panels) {
    const parent = panel.inside ? out[panel.inside.beat] : undefined;
    const parentLayout = panel.inside ? panels.find((p) => p.key === panel.inside!.beat)?.layout : undefined;
    const target = parentLayout?.targets[panel.inside?.id ?? ""];
    if (parent && target) {
      // Grow a small target (a point on a picture) into a region, then fit the panel in it.
      const region = {
        x: target.x + target.w / 2 - Math.max(target.w, 150) / 2,
        y: target.y + target.h / 2 - Math.max(target.h, 84) / 2,
        w: Math.max(target.w, 150),
        h: Math.max(target.h, 84),
      };
      const scale = Math.min(region.w / PANEL_W, region.h / PANEL_H) * 0.92;
      const cx = region.x + region.w / 2;
      const cy = region.y + region.h / 2;
      out[panel.key] = {
        x: parent.x + (cx - (PANEL_W * scale) / 2) * parent.scale,
        y: parent.y + (cy - (PANEL_H * scale) / 2) * parent.scale,
        scale: scale * parent.scale,
      };
      continue;
    }
    const row = Math.floor(k / PER_ROW);
    let col = k % PER_ROW;
    if (row % 2 === 1) col = PER_ROW - 1 - col;
    out[panel.key] = { x: col * WORLD_GAP_X, y: row * WORLD_GAP_Y, scale: 1 };
    k += 1;
  }
  return out;
}

/** A panel-local rect in world coordinates. */
export function toWorld(rect: Rect, at: PanelPlacement): Rect {
  return { x: at.x + rect.x * at.scale, y: at.y + rect.y * at.scale, w: rect.w * at.scale, h: rect.h * at.scale };
}
