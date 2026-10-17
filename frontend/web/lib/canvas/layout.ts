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

import { layoutStructure, runStructure, type DsFrame, type DsLayout } from "./structure";
import { evalExpr } from "./expr";
import { placeLabels } from "../figures/labels";
import { recordFigureCut } from "../figures/cuts";
import { trimToFit } from "../text/fit";
import { partBodies, shapeBoxes } from "../figures/bounds";
import { figureComponent } from "../figures/registry";
import type { FigureDrawing } from "../figures/types";
import { compileDiagram } from "../diagrams/render";
import { PANEL_H, PANEL_W, type AtomMapStage, type Becomes, type CanvasBoardSpec, type CanvasIcon, type CodeStage, type DsKind, type DsOp, type DsStart, type CompareStage, type DiagramStage, type EquationStage, type ExamStage, type FigureStage, type FlowStage, type GraphStage, type IllustrationStage, type MoleculeStage, type SceneStage, type StructureStage } from "./types";

export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

export type Mark =
  | { type: "heading"; id: string; text: string; x: number; y: number; size: number; s: number }
  | { type: "note"; id: string; lines: string[]; x: number; y: number; size: number; s: number; bullet: Pt; /** Rolled off the column when a later note takes its slot (sentence number). */ until?: number }
  | { type: "node"; id: string; cx: number; cy: number; r: number; icon?: CanvasIcon; label: string; sub?: string; color: string; s: number; glow?: string; labelY: number; labelSize: number; becomes?: Becomes }
  | { type: "arrow"; id: string; p0: Pt; c: Pt; p1: Pt; label?: string; labelAt: Pt; s: number; flow: boolean; rate?: string; color: string }
  | { type: "picture"; id: string; rect: Rect; src?: string; paper?: string; s: number; subject: string }
  | { type: "part"; id: string; cx: number; cy: number; name: string; s: number }
  | { type: "callout"; id: string; partId: string; text: string; box: Rect; anchor: Pt; s: number; size: number }
  | { type: "equation"; id: string; tokens: Array<{ id: string; text: string; tex?: string; color: string; w: number; size: number }>; steps: Array<{ s: number; place: Record<string, Pt>; highlight: string[]; caption?: string }>; size: number; captionY: number; center: number; s: number }
  | { type: "graph"; id: string; plot: Rect; spec: GraphStage; s: number; /** A stacked panel: its curve's name as a title; x axis printed on the bottom panel only. */ stacked?: { title: string; showX: boolean } }
  | { type: "column"; id: string; rect: Rect; title: string; icon?: CanvasIcon; color: string; s: number }
  | { type: "item"; id: string; text: string; rect: Rect; color: string; s: number; size: number }
  | { type: "link"; id: string; p0: Pt; p1: Pt; s: number }
  | { type: "box"; id: string; rect: Rect; label?: string; color: string; s: number; icon?: CanvasIcon; size: number; /** Wrapped content lines on a card (a box with no icon). */ detail?: string[]; /** The detail's font size when it was set smaller to fit whole (15 otherwise). */ detailSize?: number }
  | { type: "text"; id: string; rect: Rect; text: string; color: string; s: number; size: number }
  | { type: "figure"; id: string; rect: Rect; scale: number; drawing: FigureDrawing; s: number; asset?: string }
  | { type: "figure-label"; id: string; part: string; lines: string[]; side: "left" | "right"; at: Pt; leader: Pt[]; size: number; s: number }
  | { type: "free-body"; id: string; body: SceneStage["items"][number]; bodyRect: Rect; forces: FreeBodyForce[]; s: number }
  | { type: "electrolytic-cell"; id: string; rect: Rect; parts: { power: SceneStage["items"][number]; electrolyte: SceneStage["items"][number]; anode: SceneStage["items"][number]; cathode: SceneStage["items"][number] }; s: number }
  | { type: "code"; id: string; rect: Rect; lines: string[]; language: string; size: number; lineH: number; gutter: number; steps: CodeStage["steps"]; reveal: "build" | "all"; groups: Array<{ from: number; to: number; label: string; s: number; x: number }>; edits: NonNullable<CodeStage["edits"]>; s: number }
  | { type: "state"; id: string; rect: Rect; steps: CodeStage["steps"]; s: number }
  | { type: "trace"; id: string; rect: Rect; vars: string[]; rows: Array<{ s: number; values: string[] }>; size: number; s: number }
  | { type: "output"; id: string; rect: Rect; text: string; size: number; s: number }
  | { type: "molecule"; id: string; rect: Rect; molecule: MoleculeStage["molecules"][number]; s: number }
  | { type: "atom-map"; id: string; rect: Rect; stage: AtomMapStage; s: number }
  /** A data structure, one frame per step (lib/canvas/structure.ts): the renderer glides between them. */
  | { type: "structure"; id: string; rect: Rect; kind: DsKind; directed: boolean; frames: DsFrame[]; layout: DsLayout; captions: Array<{ s: number; text: string }>; captionY: number; s: number };

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
const FIGURE_STAGE_WITH_NOTES: Rect = { x: 56, y: 108, w: 908, h: 318 };

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
  // One more line before anything is shortened: text is never cut where a line can still hold it
  // (owner, 2026-10-17: no half-cut text). Text the shorten pass already fitted rarely gets here.
  if (lines.length === maxLines + 1) return lines;
  if (lines.length > maxLines) {
    // Never "…" (owner, 2026-10-17: no half-cut text). The cut is recorded so the board writer
    // rewrites the text to fit this exact room before the board ships (lib/canvas/generate.ts), and
    // meanwhile the text ends at a natural break rather than mid-thought.
    const room = lines.slice(0, maxLines).join(" ").length;
    recordFigureCut(text, `${maxLines} line(s) of its box`, room);
    const fitted = trimToFit(text, room);
    const again = wrap(fitted, size, maxW, maxLines + 1);
    return again.length <= maxLines ? again : again.slice(0, maxLines);
  }
  return lines;
}

/**
 * A card's detail, WHOLE where it can be: set at 15 px, and smaller (down to 12) before any word is
 * dropped — a card with room for three lines showed two and cut the rest (QA 2026-10-17). Only text
 * that does not fit even at 12 px is shortened, at a natural break (and recorded for a rewrite).
 */
export function fitDetail(text: string, maxW: number, maxH: number): { lines: string[]; size: number } {
  for (const size of [15, 14, 13, 12]) {
    const maxLines = Math.max(1, Math.floor(maxH / (size * 1.27)));
    const lines = wrapWhole(text, size, maxW);
    if (lines.length <= maxLines) return { lines, size };
  }
  const size = 12;
  return { lines: wrap(text, size, maxW, Math.max(1, Math.floor(maxH / (size * 1.27)))), size };
}
function wrapWhole(text: string, size: number, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) <= maxW || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
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
  // Code beside its data structure needs the whole width: that board writes no notes column.
  const split = spec.stage.kind === "code" && Boolean(spec.stage.structure);
  const hasNotes = spec.notes.length > 0 && !split;
  // Labelled textbook figures need horizontal room for the drawing and two boundary-label columns.
  // Putting their notes in the normal left rail made a correct 440 px scientific figure render at
  // roughly 150 CSS pixels. Figure boards therefore use the wide stage and place supporting facts
  // in a compact evidence strip below it.
  const figureWithNotes = hasNotes && (spec.stage.kind === "figure" || spec.stage.kind === "diagram");
  const stage = figureWithNotes ? FIGURE_STAGE_WITH_NOTES : hasNotes ? STAGE : STAGE_WIDE;

  const headingSize = textWidth(spec.heading, HEADING_SIZE) > PANEL_W - 110 ? 28 : HEADING_SIZE;
  // s = -1: the heading is written while Aria is still bridging into the board, before sentence 0.
  marks.push({ type: "heading", id: "heading", text: spec.heading, x: 48, y: 66, size: headingSize, s: -1 });
  targets.heading = { x: 48, y: 66 - headingSize, w: Math.min(PANEL_W - 96, textWidth(spec.heading, headingSize)), h: headingSize * 1.25, s: 0 };

  // THE NOTES COLUMN IS WIPED WHEN FULL, like a teacher's board. What Aria writes as she speaks can be
  // a note for most sentences, so the column holds four at a time, read top to bottom; the fifth note
  // wipes the column and starts again at the top. When the board is complete the last page shows.
  const allNotes = hasNotes ? [...spec.notes].sort((a, b) => a.s - b.s) : [];
  const SLOTS = 4;
  const slots = Math.min(SLOTS, allNotes.length);
  const untilOf = (i: number) => {
    const nextPage = allNotes[(Math.floor(i / SLOTS) + 1) * SLOTS];
    return nextPage ? Math.max(nextPage.s, allNotes[i].s + 1) : undefined;
  };
  if (figureWithNotes) {
    const gap = 18;
    const noteW = (STAGE_WIDE.w - gap * Math.max(0, slots - 1)) / Math.max(1, slots);
    const noteSize = slots >= 4 ? 15 : 17;
    allNotes.forEach((note, i) => {
      const x = STAGE_WIDE.x + (i % SLOTS) * (noteW + gap);
      const y = 474;
      const lines = wrap(note.text, noteSize, noteW - 24, 2);
      const until = untilOf(i);
      marks.push({ type: "note", id: note.id, lines, x: x + 22, y, size: noteSize, s: note.s, bullet: { x: x + 7, y: y - noteSize * 0.34 }, ...(until !== undefined ? { until } : {}) });
      const h = lines.length * noteSize * 1.28;
      targets[note.id] = { x, y: y - noteSize, w: noteW, h: h + 6, s: note.s };
    });
  } else {
    // Fixed slots, each room for two lines, so a note never moves once written.
    const slotH = 2 * NOTE_SIZE * 1.28 + 30;
    allNotes.forEach((note, i) => {
      const y = 140 + (i % SLOTS) * slotH;
      const lines = wrap(note.text, NOTE_SIZE, NOTES_W - 26, 2);
      const until = untilOf(i);
      marks.push({ type: "note", id: note.id, lines, x: NOTES_X + 24, y, size: NOTE_SIZE, s: note.s, bullet: { x: NOTES_X + 7, y: y - NOTE_SIZE * 0.34 }, ...(until !== undefined ? { until } : {}) });
      const h = lines.length * NOTE_SIZE * 1.28;
      targets[note.id] = { x: NOTES_X, y: y - NOTE_SIZE, w: NOTES_W, h: h + 6, s: note.s };
    });
  }

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
    case "figure":
      layoutFigure(spec.stage, stage, marks, add);
      break;
    case "diagram":
      layoutDiagram(spec.stage, stage, marks, add);
      break;
    case "equation":
      layoutEquation(spec.stage, stage, marks, add);
      break;
    case "graph":
      layoutGraph(spec.stage, stage, marks, add, spec.interaction?.kind === "try" ? Object.fromEntries(spec.interaction.controls.map((c) => [c.var, c.value])) : {});
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
    case "molecule":
      layoutMolecules(spec.stage, stage, marks, add);
      break;
    case "exam":
      layoutExam(spec.stage, stage, marks, add);
      break;
    case "atom-map":
      marks.push({ type: "atom-map", id: "atom-map", rect: stage, stage: spec.stage, s: 0 });
      add("atom-map", stage, 0);
      spec.stage.reactants.concat(spec.stage.products).forEach((group) => add(group.id, stage, group.s));
      break;
    case "structure":
      layoutStructureStage(spec.stage, stage, marks, add);
      break;
  }
  targets.stage = { ...stage, s: 0 };
  targets.board = { x: 0, y: 0, w: PANEL_W, h: PANEL_H, s: 0 };
  return { marks, targets, stage };
}

function layoutMolecules(st: MoleculeStage, area: Rect, marks: Mark[], add: Add) {
  const gap = 18;
  const w = (area.w - gap * (st.molecules.length - 1)) / st.molecules.length;
  st.molecules.forEach((molecule, index) => {
    const rect = { x: area.x + index * (w + gap), y: area.y, w, h: area.h };
    marks.push({ type: "molecule", id: molecule.id, rect, molecule, s: molecule.s });
    add(molecule.id, rect, molecule.s);
    molecule.atoms.forEach((atom) => add(atom.id, { x: rect.x + rect.w * (0.5 + atom.x * 0.3) - 22, y: rect.y + rect.h * (0.48 + atom.y * 0.3) - 22, w: 44, h: 44 }, molecule.s));
  });
}

/* ── code ─────────────────────────────────────────────────────────────────────────────────── */

/** Monospace advance, in em. */
const MONO = 0.6;

/**
 * A listing in an editor card, sized so its longest line and all its lines fit; under it, side by
 * side, the trace table and the output when the board has them. Every line is a target, so Aria's
 * pen can point at it and the camera can zoom to it.
 */
function layoutCode(stage: CodeStage, fullArea: Rect, marks: Mark[], add: Add) {
  let st = stage;
  let area = fullArea;
  if (stage.structure) {
    // The code on the left, as wide as its longest line needs at a readable size (40-58% of the
    // board); the structure it changes on the right. The trace table and the subgoal labels give
    // way: the structure shows what the trace would, and the labels would crowd the code.
    const longest = Math.max(8, ...stage.lines.map((l) => l.length));
    const codeW = Math.round(Math.max(fullArea.w * 0.4, Math.min(fullArea.w * 0.58, 38 + longest * MONO * 15 + 48)));
    layoutStructureMark(stage.structure, stage.steps, { x: fullArea.x + codeW + 18, y: fullArea.y, w: fullArea.w - codeW - 18, h: fullArea.h }, marks, add, []);
    area = { ...fullArea, w: codeW };
    st = { ...stage, trace: undefined, groups: undefined };
  }
  const rowH = 24;
  // The bottom row: the Variables panel, the trace, the output — whichever the board has, packed left
  // to right. Short of room, the trace goes first (the live Variables panel says more).
  const stateNames = [...new Set(st.steps.flatMap((p) => (p.state ?? []).map((v) => v.name)))];
  const stateW = stateNames.length ? Math.max(170, ...st.steps.flatMap((p) => (p.state ?? []).map((v) => (v.name.length + v.value.length + 4) * MONO * 16 + 40))) : 0;
  const stateH = stateNames.length ? stateNames.length * 26 + 44 : 0;
  const traceW = st.trace ? Math.min(area.w, Math.max(64, ...st.trace.vars.map((v) => v.length * MONO * 16 + 24), ...st.trace.rows.flatMap((r) => r.values.map((v) => v.length * MONO * 16 + 24))) * st.trace.vars.length + 16) : 0;
  const traceH = st.trace ? (st.trace.rows.length + 1) * rowH + 22 : 0;
  const outputLines = st.output ? st.output.text.split("\n").length : 0;
  const outputW = st.output ? Math.max(200, ...st.output.text.split("\n").map((l) => l.length * MONO * 16 + 36)) : 0;
  const outputH = st.output ? outputLines * 22 + 44 : 0;
  const panels: Array<{ kind: "state" | "trace" | "output"; w: number; h: number }> = [];
  if (stateW) panels.push({ kind: "state", w: stateW, h: stateH });
  if (traceW) panels.push({ kind: "trace", w: traceW, h: traceH });
  if (outputW) panels.push({ kind: "output", w: outputW, h: outputH });
  const fits = () => panels.reduce((t, p) => t + p.w, 0) + 16 * Math.max(0, panels.length - 1) <= area.w;
  if (!fits()) panels.splice(panels.findIndex((p) => p.kind === "trace") >= 0 ? panels.findIndex((p) => p.kind === "trace") : panels.length - 1, 1);
  while (panels.length && !fits()) panels.pop();
  const bottomH = Math.max(0, ...panels.map((p) => p.h));
  const gap = bottomH ? 16 : 0;

  // Subgoal labels sit in a column to the right of the card.
  const groups = st.groups ?? [];
  const groupW = groups.length ? Math.max(...groups.map((g) => g.label.length * 7.6 + 34)) : 0;
  const codeArea = { x: area.x, y: area.y, w: area.w - groupW, h: area.h - bottomH - gap };
  const maxLen = Math.max(8, ...st.lines.map((l) => l.length), ...(st.edits ?? []).map((e) => e.from.length));
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
  const first = st.steps[0]?.s ?? 0;
  marks.push({
    type: "code", id: "code", rect, lines: st.lines, language: st.language, size, lineH, gutter, steps: st.steps,
    reveal: st.reveal ?? "build", groups: groups.map((g) => ({ ...g, x: rect.x + w + 10 })), edits: st.edits ?? [], s: first,
  });
  add("code", rect, first);
  st.lines.forEach((line, i) => {
    const indent = (line.length - line.trimStart().length) * MONO * size;
    add(`line-${i + 1}`, { x: rect.x + gutter + 14 + indent, y: rect.y + 14 + i * lineH, w: Math.max(24, line.trim().length * MONO * size), h: lineH }, first);
  });
  groups.forEach((g, i) => add(`group-${i + 1}`, { x: rect.x + w + 4, y: rect.y + 14 + (g.from - 1) * lineH, w: groupW, h: (g.to - g.from + 1) * lineH }, g.s));

  const by = rect.y + rect.h + gap;
  let x = area.x;
  for (const p of panels) {
    const prect = { x, y: by, w: p.w, h: p.h };
    if (p.kind === "state") {
      const s0 = st.steps.find((q) => q.state)?.s ?? first;
      marks.push({ type: "state", id: "state", rect: prect, steps: st.steps, s: s0 });
      add("state", prect, s0);
    } else if (p.kind === "trace" && st.trace) {
      marks.push({ type: "trace", id: "trace", rect: prect, vars: st.trace.vars, rows: st.trace.rows, size: 16, s: st.trace.rows[0]?.s ?? 0 });
      add("trace", prect, st.trace.rows[0]?.s ?? 0);
    } else if (p.kind === "output" && st.output) {
      marks.push({ type: "output", id: "output", rect: prect, text: st.output.text, size: 16, s: st.output.s });
      add("output", prect, st.output.s);
    }
    x += p.w + 16;
  }
}

/* ── data structures ──────────────────────────────────────────────────────────────────────── */

/** A structure board: the structure across the stage, each step's note written under it. */
function layoutStructureStage(st: StructureStage, area: Rect, marks: Mark[], add: Add) {
  const captions = st.steps.filter((p) => p.note).map((p) => ({ s: p.s, text: p.note! }));
  layoutStructureMark(st.structure, st.steps, area, marks, add, captions);
}

function layoutStructureMark(start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }>, area: Rect, marks: Mark[], add: Add, captions: Array<{ s: number; text: string }>) {
  // Frames up to the first operation that could not be done: the board is checked before it is kept
  // (lib/canvas/generate.ts), so this only guards a board that slipped through.
  const { frames } = runStructure(start, steps);
  const captionRoom = captions.length ? 44 : 0;
  const inner = { x: area.x, y: area.y, w: area.w, h: area.h - captionRoom };
  const layout = layoutStructure(start, frames, inner);
  const s = frames[0]?.s ?? 0;
  marks.push({ type: "structure", id: "structure", rect: area, kind: start.kind, directed: start.kind === "list" || start.variant === "directed", frames, layout, captions, captionY: area.y + area.h - 12, s });
  add("structure", area, s);
  // Each node is a target where it first appears, so the pen can point at it.
  const seen = new Set<string>();
  layout.frames.forEach((lf) => {
    for (const [id, at] of Object.entries(lf.place)) {
      if (seen.has(id)) continue;
      seen.add(id);
      add(`ds-${id}`, { x: at.x - layout.w / 2, y: at.y - layout.h / 2, w: layout.w, h: layout.h }, lf.s);
    }
  });
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

/** The boxes an arrow's label must not print over: every node's disc and name, every box and text. */
export function textObstacles(ms: Mark[]): Rect[] {
  const out: Rect[] = [];
  for (const m of ms) {
    if (m.type === "node") {
      out.push({ x: m.cx - m.r, y: m.cy - m.r, w: m.r * 2, h: m.r * 2 });
      const w = Math.max(textWidth(m.label, m.labelSize), m.sub ? textWidth(m.sub, 15) : 0);
      out.push({ x: m.cx - w / 2, y: m.labelY - m.labelSize, w, h: m.labelSize * (m.sub ? 2.3 : 1.3) });
    } else if (m.type === "box" || m.type === "text") out.push(m.rect);
  }
  return out;
}

/** Where the line from a box's centre toward `to` leaves the box, `pad` beyond its border. */
function boxEdge(box: Rect, to: Pt, pad: number): Pt {
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const dx = to.x - c.x, dy = to.y - c.y;
  const d = Math.hypot(dx, dy) || 1;
  const t = Math.min(dx ? (box.w / 2) / Math.abs(dx) : Infinity, dy ? (box.h / 2) / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t + (dx / d) * pad, y: c.y + dy * t + (dy / d) * pad };
}

function arrowMarks(arrows: FlowStage["arrows"], centres: Map<string, { c: Pt; r: number; below?: number; box?: Rect }>, bend: (a: Pt, b: Pt) => number, marks: Mark[], add: Add, obstacles: Rect[] = []) {
  const placedLabels: Rect[] = [];
  // An arrow that leaves or arrives through a node's underside clears the node's label as well.
  const clear = (from: { c: Pt; r: number; below?: number }, to: Pt) => {
    const d = Math.hypot(to.x - from.c.x, to.y - from.c.y) || 1;
    return (to.y - from.c.y) / d > 0.45 ? from.below ?? 0 : 0;
  };
  arrows.forEach((arrow, i) => {
    const a = centres.get(arrow.from);
    const b = centres.get(arrow.to);
    if (!a || !b) return;
    // A card is a rectangle: the arrow starts and ends at its border, not inside it over its words.
    const p0 = a.box ? boxEdge(a.box, b.c, 8) : edgePoint(a.c, b.c, a.r, 10 + clear(a, b.c));
    const p1 = b.box ? boxEdge(b.box, a.c, 12) : edgePoint(b.c, a.c, b.r, 16 + clear(b, a.c));
    // Nodes almost touching leave no room for an arrow: a lone arrowhead reads as a mistake.
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 28 || (p1.x - p0.x) * (b.c.x - a.c.x) + (p1.y - p0.y) * (b.c.y - a.c.y) <= 0) return;
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = bend(p0, p1);
    const c = { x: mx - (dy / d) * k, y: my + (dx / d) * k };
    // The label sits beside the curve, at the first spot along it (middle first, either side) where it
    // prints over no node, name, box or other label — an arrow label once covered "Sociologist's
    // values" (audit 2026-10-15). With nowhere free it is left off: the nodes it joins already say enough.
    const side = k >= 0 ? 1 : -1;
    const at = (t: number, sd: number) => {
      const q = { x: (1 - t) * (1 - t) * p0.x + 2 * t * (1 - t) * c.x + t * t * p1.x, y: (1 - t) * (1 - t) * p0.y + 2 * t * (1 - t) * c.y + t * t * p1.y };
      return { x: q.x - (dy / d) * 18 * sd, y: q.y + (dx / d) * 18 * sd + (Math.abs(dx) > Math.abs(dy) ? -4 : 5) };
    };
    const lw = arrow.label ? textWidth(arrow.label, 14) + 16 : 0;
    const boxAt = (pt: Pt): Rect => ({ x: pt.x - lw / 2, y: pt.y - 15, w: lw, h: 22 });
    let labelAt = at(0.5, side);
    let label = Math.hypot(p1.x - p0.x, p1.y - p0.y) > 110 ? arrow.label : undefined;
    if (label) {
      const spot = [0.5, 0.4, 0.6, 0.3, 0.7].flatMap((t) => [at(t, side), at(t, -side)]).find((pt) => ![...obstacles, ...placedLabels].some((r) => overlaps(r, boxAt(pt), 2)));
      if (spot) { labelAt = spot; placedLabels.push(boxAt(spot)); } else label = undefined;
    }
    marks.push({ type: "arrow", id: arrow.id, p0, c, p1, label, labelAt, s: arrow.s, flow: arrow.flow ?? false, rate: arrow.rate, color: arrow.color ?? PALETTE[(i + 2) % PALETTE.length] });
    add(arrow.id, union([{ x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(dx) || 8, h: Math.abs(dy) || 8 }, { x: labelAt.x - 40, y: labelAt.y - 16, w: 80, h: 22 }]), arrow.s);
  });
}

function layoutFlow(stage: FlowStage, box: Rect, marks: Mark[], add: Add) {
  const nodes = stage.nodes.slice(0, 7);
  const centres = new Map<string, { c: Pt; r: number; below?: number; box?: Rect }>();
  const nodeMarks: Mark[] = [];
  const place = (node: FlowStage["nodes"][number], i: number, cx: number, cy: number, r: number, maxLabelW?: number) => {
    /*
     * A STEP WITH NOTHING TO PICTURE IS A CARD, NOT AN EMPTY RING. A node with no icon was drawn as
     * a circle with a dot in it — a circle-theorems board showed five of them named "Chord AB",
     * "Circle symmetry", "Diameter", which looked like a diagram and drew nothing (owner, QA
     * 2026-10-17). Its words now sit inside a card, detail and all; nodes with a real icon, or that
     * change into something or glow with a variable, keep their picture.
     */
    const original = stage.nodes.find((n) => n.id === node.id) ?? node;
    if (!node.icon && !node.becomes && !node.glow) {
      const room = maxLabelW ?? 2 * Math.min(cx - box.x, box.x + box.w - cx) - 10;
      const w = Math.max(110, Math.min(220, room));
      const labelSize = Math.max(13, Math.min(18, Math.floor((w - 18) / Math.max(1, textWidth(node.label, 1)))));
      const fit = original.sub ? fitDetail(original.sub, w - 20, 3 * 19) : undefined;
      const detail = fit?.lines;
      const h = Math.max(58, 40 + (detail?.length ?? 0) * (fit?.size ?? 15) * 1.27 + 8);
      const card = { x: cx - w / 2, y: cy - h / 2, w, h };
      nodeMarks.push({ type: "box", id: node.id, rect: card, label: node.label, color: colorAt(i, node.color), s: node.s, size: labelSize, ...(detail?.length ? { detail, detailSize: fit!.size } : {}) });
      centres.set(node.id, { c: { x: cx, y: cy }, r: Math.min(w, h) / 2, box: card });
      add(node.id, card, node.s);
      return;
    }
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
        // A second line under each node only where the column has room for it; the label carries it otherwise.
        place(list.length >= 3 && span / list.length < 118 ? { ...node, sub: undefined } : node, nodes.indexOf(node), x, cy, r);
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
    // chain: one row up to four, otherwise a snake over two rows. Four or more nodes carrying a detail
    // line snake over two rows too: in one row there is no room for it, and dropping it lost the
    // figures Aria quotes (a psychology flow lost every sub and arrow label, audit 2026-10-17).
    const detailed = nodes.length >= 4 && nodes.some((n) => n.sub);
    const perRow = nodes.length <= 4 && !detailed ? nodes.length : Math.ceil(nodes.length / 2);
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
  arrowMarks(stage.arrows, centres, bend, marks, add, textObstacles(nodeMarks));
  marks.push(...nodeMarks);
}

/* ── illustration ─────────────────────────────────────────────────────────────────────────── */

/**
 * A code-drawn figure (lib/figures): scaled into the stage between two label columns, every part's
 * anchor mapped exactly onto the board, labels placed textbook-style (lib/figures/labels.ts). Each
 * labelled part is a pen target at its anchor, revealed on its own sentence.
 */
function layoutDiagram(stage: DiagramStage, box: Rect, marks: Mark[], add: Add) {
  const drawing = stage.drawing ?? compileDiagram(stage.spec);
  layoutFigure({ kind: "figure", component: "drawn", params: {}, parts: stage.parts, drawing }, box, marks, add);
}

function layoutFigure(stage: FigureStage, box: Rect, marks: Mark[], add: Add) {
  // A library diagram (lib/figures/library.ts) is a picture with exact anchors: the same label path
  // as a code-drawn figure, with the art drawn from its file instead of from shapes.
  const component = stage.asset || stage.drawing ? undefined : figureComponent(stage.component);
  if (!stage.asset && !stage.drawing && !component) return;
  const drawing: FigureDrawing = stage.asset
    ? { w: stage.asset.w, h: stage.asset.h, shapes: [], parts: stage.asset.parts, credit: stage.asset.credit }
    : stage.drawing ?? component!.build(stage.params);
  const anchors = new Map(drawing.parts.map((p) => [p.id, p.anchor]));
  const shown = stage.parts.filter((p) => anchors.has(p.id));
  const size = shown.length > 6 ? 15 : 17;
  // Each margin is as wide as the labels that will stand in it (sides as lib/figures/labels.ts picks
  // them), so the figure gets all the room the labels do not need.
  const leftSide = shown.filter((p) => anchors.get(p.id)!.x < drawing.w / 2);
  const rightSide = shown.filter((p) => anchors.get(p.id)!.x >= drawing.w / 2);
  while (Math.abs(leftSide.length - rightSide.length) > 1) {
    const [from, to] = leftSide.length > rightSide.length ? [leftSide, rightSide] : [rightSide, leftSide];
    from.sort((a, b) => Math.abs(anchors.get(a.id)!.x - drawing.w / 2) - Math.abs(anchors.get(b.id)!.x - drawing.w / 2));
    to.push(from.shift()!);
  }
  const marginFor = (list: typeof shown) => (list.length ? Math.min(220, Math.max(...list.map((p) => Math.min(textWidth(p.name, size), 190))) + 46) : 16);
  const left = component?.selfLabelled ? 16 : marginFor(leftSide), right = component?.selfLabelled ? 16 : marginFor(rightSide);
  const room = { w: box.w - left - right, h: box.h - 24 };
  const scale = Math.min(room.w / drawing.w, room.h / drawing.h);
  const rect = { x: box.x + left + (room.w - drawing.w * scale) / 2, y: box.y + 4 + (room.h - drawing.h * scale) / 2, w: drawing.w * scale, h: drawing.h * scale };
  const onBoard = (p: Pt): Pt => ({ x: rect.x + p.x * scale, y: rect.y + p.y * scale });
  marks.push({ type: "figure", id: "figure", rect, scale, drawing, s: 0, ...(stage.asset ? { asset: stage.asset.id } : {}) });
  add("figure", rect, 0);
  // Every other part's outline is an obstacle a leader must not cross (lib/figures/bounds.ts); parts
  // that span most of the figure (wires, a stand) are left out, or nothing could reach in.
  const obstacles = shapeBoxes(drawing).filter(({ box: b }) => b.w * b.h < drawing.w * drawing.h * 0.45 && b.w > 6 && b.h > 6).map(({ part, box: b, circle }) => ({ id: part, box: { x: rect.x + b.x * scale, y: rect.y + b.y * scale, w: b.w * scale, h: b.h * scale }, ...(circle ? { circle: { cx: rect.x + circle.cx * scale, cy: rect.y + circle.cy * scale, r: circle.r * scale } } : {}) }));
  if (component?.selfLabelled) {
    // Its own cards are the labels: only pen targets on each part, revealed on its sentence. The
    // target is the part as drawn — its card, its words (lib/figures/bounds.ts partBodies) — so the
    // pen frames what it names; the anchor is a leader's end on the part's EDGE, and a box round it
    // sat beside the words (2026-10-16). A part with nothing drawn keeps the anchor.
    const bodies = partBodies(drawing, textWidth);
    // The pen's own outline (components/canvas/LessonCanvas.tsx Pen) adds 7 more: a card is framed
    // close round its border, not loosely (a timeline card's box sat ~20 px off it).
    const pad = 2;
    for (const p of shown) {
      const b = bodies.get(p.id);
      if (b) add(p.id, { x: rect.x + b.x * scale - pad, y: rect.y + b.y * scale - pad, w: b.w * scale + pad * 2, h: b.h * scale + pad * 2 }, p.s);
      else { const a = onBoard(anchors.get(p.id)!); add(p.id, { x: a.x - 16, y: a.y - 16, w: 32, h: 32 }, p.s); }
    }
    return;
  }
  const placed = placeLabels(shown.map((p) => ({ id: p.id, text: p.name, anchor: onBoard(anchors.get(p.id)!), s: p.s })), rect, box, textWidth, size, obstacles);
  for (const l of placed) {
    marks.push({ type: "figure-label", id: `label-${l.id}`, part: l.id, lines: l.lines, side: l.side, at: l.at, leader: l.leader, size: l.size, s: l.s });
    const a = l.leader[l.leader.length - 1];
    add(l.id, { x: a.x - 16, y: a.y - 16, w: 32, h: 32 }, l.s);
  }
}

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

  // Every label the board names is drawn (the validator allows 6): a student must see each part a
  // "label/identify" lesson asks for. Smaller type when more than three share the picture.
  const size = stage.labels.length > 3 ? 15 : 18;
  for (const id of stage.labels.slice(0, 6)) {
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

/**
 * A LaTeX term's width in em, estimated (KaTeX lays it out only in a browser, and layout is pure):
 * a fraction is as wide as its wider part, a power or index is small, a command is one symbol, and
 * the operators carry KaTeX's spacing. The renderer fits the real typesetting into this slot.
 */
export function texEm(s: string, script = false): number {
  let w = 0;
  let i = 0;
  const group = (): string => {
    while (s[i] === " ") i++;
    if (s[i] === "{") {
      const start = i + 1;
      for (let depth = 0; i < s.length; i++) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}" && --depth === 0) return s.slice(start, i++);
      }
      return s.slice(start);
    }
    if (s[i] === "\\") {
      const m = /^\\(?:[a-zA-Z]+|.)/.exec(s.slice(i));
      const cmd = m ? m[0] : "\\";
      i += cmd.length;
      return cmd;
    }
    return s[i++] ?? "";
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      const name = m ? m[1] : "";
      i += m ? m[0].length : 1;
      if (name === "frac" || name === "dfrac" || name === "tfrac") w += Math.max(texEm(group(), true), texEm(group(), true)) * 0.72 + 0.25;
      else if (name === "sqrt") {
        if (s[i] === "[") i = s.indexOf("]", i) < 0 ? s.length : s.indexOf("]", i) + 1;
        w += texEm(group()) + 0.75;
      } else if (["text", "mathrm", "textbf", "mathbf", "operatorname", "textit"].includes(name)) w += textWidth(group(), 1);
      else if (["left", "right", "big", "Big", "bigl", "bigr", "displaystyle"].includes(name)) continue;
      else if (name === "quad") w += 1;
      else if (name === "," || name === ";" || name === ":" || name === " " || name === "!") w += 0.22;
      else if (["times", "cdot", "pm", "mp", "div", "le", "ge", "leq", "geq", "neq", "approx", "to", "rightarrow", "Rightarrow", "equiv", "implies"].includes(name)) w += 1.05;
      else w += 0.62;
    } else if (c === "^" || c === "_") {
      i++;
      w += texEm(group(), true) * 0.7;
    } else if (c === "{") w += texEm(group());
    else if (c === "}" || c === " ") i++;
    else if (/[+=<>−-]/.test(c)) {
      // Inside a fraction or a power the operators lose their spacing: just the glyph.
      w += script ? 0.8 : 1.1;
      i++;
    } else {
      w += textWidth(c, 1) * 1.05;
      i++;
    }
  }
  return w;
}

/** A step's terms on one line, or split onto two before an "=" (or a "+"/"−") near the middle when too wide. */
function wrapRow(row: string[], width: (id: string) => number, isBreak: (id: string) => 0 | 1 | 2, maxW: number, gap: number): string[][] {
  const total = row.reduce((w, id) => w + width(id), 0) + gap * Math.max(0, row.length - 1);
  if (total <= maxW || row.length < 2) return [row];
  let best = 1;
  let bestScore = Infinity;
  let acc = 0;
  for (let k = 1; k < row.length; k++) {
    acc += width(row[k - 1]) + gap;
    const kind = isBreak(row[k]);
    const score = Math.abs(acc - total / 2) - (kind === 2 ? total * 0.25 : kind === 1 ? total * 0.1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return [row.slice(0, best), row.slice(best)];
}

function layoutEquation(stage: EquationStage, box: Rect, marks: Mark[], add: Add) {
  const tokens = stage.tokens.slice(0, 16);
  const steps = stage.steps.length ? stage.steps : [{ s: 0, order: tokens.map((t) => t.id) }];
  const hosted = new Map(tokens.filter((t) => t.on && tokens.some((h) => h.id === t.on && !h.on)).map((t) => [t.id, t.on as string]));
  const inRow = (id: string) => !hosted.has(id);
  // A sign on its own is typeset without the spacing it gets inside an expression: just its glyph.
  const em = new Map(tokens.map((t) => [t.id, t.tex ? (/^\s*(?:[=+<>−-]|\\times|\\cdot|\\to|\\rightarrow)\s*$/.test(t.tex) ? 0.8 : texEm(t.tex)) : textWidth(t.text, 1)]));
  const maxW = box.w - 40;
  const gapEm = 12 / 44;
  const rows = steps.map((step) => step.order.filter((id) => em.has(id) && inRow(id)));
  const rowEm = (row: string[]) => row.reduce((w, id) => w + em.get(id)!, 0) + gapEm * Math.max(0, row.length - 1);
  const widest = Math.max(1, ...rows.map(rowEm));
  // One line as large as fits (down to 26); a step still too wide goes onto two lines, and the size
  // then fits the widest LINE (down to 18) — a long equation shrinks or wraps, never overflows.
  let size = Math.max(26, Math.min(46, Math.floor(maxW / widest)));
  const breakOf = (id: string): 0 | 1 | 2 => {
    const text = tokens.find((t) => t.id === id)?.text ?? "";
    return /^[=→⇌]$/.test(text) ? 2 : /^[+−-]$/.test(text) ? 1 : 0;
  };
  const wrapAt = (sz: number) => rows.map((row) => wrapRow(row, (id) => em.get(id)! * sz, breakOf, maxW, gapEm * sz));
  let lined = wrapAt(size);
  const widestLine = Math.max(1, ...lined.flat().map(rowEm));
  if (widestLine * size > maxW) {
    size = Math.max(18, Math.floor(maxW / widestLine));
    lined = wrapAt(size);
  }
  const gap = gapEm * size;
  const small = Math.round(size * 0.5);
  const center = box.x + box.w / 2;
  const tall = tokens.some((t) => /\\[dt]?frac|\\sqrt/.test(t.tex ?? ""));
  const lineGap = size * (tall ? 1.95 : 1.6);
  const twoLines = lined.some((l) => l.length > 1);
  const baseY = box.y + box.h * 0.44;
  const measured = tokens.map((t, i) => {
    const tokenSize = hosted.has(t.id) ? small : size;
    const color = t.color && /^#/.test(t.color) ? t.color : /[→=⇌]/.test(t.text) || /^[+−-]$/.test(t.text) ? "#64748b" : PALETTE[i % PALETTE.length];
    return { id: t.id, text: t.text, ...(t.tex ? { tex: t.tex } : {}), color, w: (em.get(t.id) ?? 0) * tokenSize, size: tokenSize };
  });
  // A WORKED CALCULATION BUILDS DOWN THE BOARD. When most of a step's terms are new (k² = 9, then
  // 18 × 9 = 162) it is the next line of working, not the same equation rearranged: each step is
  // written on its own line below the last, and every line stays (one step replacing the last left
  // a board showing only "0.28 250 plants", audit 2026-10-17). Rearrangements keep their animation.
  const fresh = steps.slice(1).map((step, k) => { const prev = new Set(steps[k].order); const own = step.order.filter(inRow); return own.length ? own.filter((id) => !prev.has(id)).length / own.length : 0; });
  if (steps.length > 1 && fresh.reduce((a, b) => a + b, 0) / fresh.length >= 0.5) {
    const rowsN = lined.reduce((n, l) => n + l.length, 0);
    const rowSize = Math.max(16, Math.min(size, Math.floor((box.h - 20) / (rowsN * (tall ? 1.95 : 1.55)))));
    const rowGap = rowSize * (tall ? 1.95 : 1.55);
    const rowGapEm = gapEm * rowSize;
    // A step that adds no new term (the same "−GM/r" again, for "Earth values") is not written out
    // again: the working showed one line three times (QA 2026-10-17). It highlights its terms instead.
    const seenIds = new Set<string>();
    const writes = steps.map((step) => { const own = step.order.filter(inRow); const adds = own.some((id) => !seenIds.has(id)); own.forEach((id) => seenIds.add(id)); return adds; });
    const relined = rows.map((row, k) => (writes[k] ? wrapRow(row, (id) => em.get(id)! * rowSize, breakOf, maxW, rowGapEm) : []));
    const height = relined.reduce((n, l) => n + l.length, 0) * rowGap;
    let y = box.y + Math.max(rowSize, (box.h - height) / 2 + rowSize);
    const sized = tokens.map((t, i) => ({ ...measured[i], w: (em.get(t.id) ?? 0) * (hosted.has(t.id) ? Math.round(rowSize * 0.5) : rowSize), size: hosted.has(t.id) ? Math.round(rowSize * 0.5) : rowSize }));
    steps.forEach((step, k) => {
      if (!writes[k]) return;
      const place: Record<string, Pt> = {};
      for (const line of relined[k]) {
        const total = line.reduce((w, id) => w + sized.find((t) => t.id === id)!.w, 0) + rowGapEm * Math.max(0, line.length - 1);
        let x = center - total / 2;
        for (const id of line) { place[id] = { x, y }; x += sized.find((m) => m.id === id)!.w + rowGapEm; }
        y += rowGap;
      }
      for (const id of step.order.filter((o) => hosted.has(o))) {
        const host = place[hosted.get(id)!];
        const t = sized.find((m) => m.id === id)!;
        if (host) place[id] = { x: host.x + sized.find((m) => m.id === hosted.get(id))!.w / 2 - t.w / 2, y: host.y - rowSize * 1.05 };
      }
      const own = sized.filter((t) => place[t.id]);
      marks.push({ type: "equation", id: k ? `equation-${k + 1}` : "equation", tokens: own, steps: [{ s: step.s, place, highlight: [] }], size: rowSize, captionY: box.y + box.h + 400, center, s: step.s });
      for (const t of own) if (!(t.id in place) || k === steps.findIndex((st) => st.order.includes(t.id))) add(t.id, { x: place[t.id].x - 4, y: place[t.id].y - t.size, w: t.w + 8, h: t.size * 1.3 }, step.s);
    });
    add("equation", { x: box.x + 10, y: box.y, w: box.w - 20, h: box.h }, steps[0].s);
    return;
  }
  const laidSteps = steps.map((step, k) => {
    const order = step.order.filter((id) => measured.some((t) => t.id === id));
    const place: Record<string, Pt> = {};
    const lines = lined[k];
    lines.forEach((line, n) => {
      const total = line.reduce((w, id) => w + measured.find((t) => t.id === id)!.w, 0) + gap * Math.max(0, line.length - 1);
      let x = center - total / 2;
      const y = lines.length > 1 ? baseY + (n - 0.5) * lineGap : baseY;
      for (const id of line) {
        place[id] = { x, y };
        x += measured.find((m) => m.id === id)!.w + gap;
      }
    });
    // A hosted token sits centred over its host, when both are in this step.
    for (const id of order.filter((o) => hosted.has(o))) {
      const host = place[hosted.get(id)!];
      const hostW = measured.find((m) => m.id === hosted.get(id))!.w;
      const t = measured.find((m) => m.id === id)!;
      if (host) place[id] = { x: host.x + hostW / 2 - t.w / 2, y: host.y - size * 1.05 };
    }
    return { s: step.s, place, highlight: step.highlight ?? [], caption: step.caption };
  });
  const below = twoLines ? lineGap / 2 : 0;
  marks.push({ type: "equation", id: "equation", tokens: measured, steps: laidSteps, size, captionY: baseY + below + Math.max(70, size * (tall ? 1.6 : 1.3) + 30), center, s: laidSteps[0]?.s ?? 0 });
  const first = laidSteps[0];
  for (const t of measured) {
    const step = laidSteps.find((st) => st.place[t.id]);
    const p = step?.place[t.id];
    if (p) add(t.id, { x: p.x - 4, y: p.y - t.size * (tall ? 1.15 : 1), w: t.w + 8, h: t.size * (tall ? 1.7 : 1.3) }, step!.s);
  }
  add("equation", { x: box.x + 10, y: baseY - below - size * 1.6, w: box.w - 20, h: size * 1.9 + below * 2 + 32 }, first.s);
}

/* ── graph ────────────────────────────────────────────────────────────────────────────────── */

function layoutGraph(stage: GraphStage, box: Rect, marks: Mark[], add: Add, vars: Record<string, number> = {}) {
  const plot = { x: box.x + 70, y: box.y + 16, w: box.w - 96, h: box.h - 88 };
  add("graph", { x: box.x, y: box.y, w: box.w, h: box.h }, 0);
  const panels = graphPanels(stage, vars);
  if (panels) {
    const gap = 26;
    const h = (plot.h - gap * (panels.length - 1)) / panels.length;
    panels.forEach((panel, i) => {
      const r = { x: plot.x, y: plot.y + i * (h + gap), w: plot.w, h };
      const last = i === panels.length - 1;
      marks.push({ type: "graph", id: i ? `graph-${i}` : "graph", plot: r, spec: panel, s: Math.min(...panel.curves.map((c) => c.s), 0), stacked: { title: panel.y.label, showX: last } });
      for (const curve of panel.curves) add(curve.id, r, curve.s);
      for (const marker of panel.markers ?? []) add(marker.id, r, marker.s);
    });
    for (const guide of stage.guides ?? []) {
      const gx = plot.x + ((guide.x - stage.x.min) / (stage.x.max - stage.x.min || 1)) * plot.w;
      add(guide.id, { x: gx - 30, y: plot.y, w: 60, h: plot.h }, guide.s);
    }
    return;
  }
  marks.push({ type: "graph", id: "graph", plot, spec: stage, s: Math.min(...stage.curves.map((c) => c.s), 0) });
  for (const curve of stage.curves) add(curve.id, plot, curve.s);
  for (const marker of stage.markers ?? []) add(marker.id, plot, marker.s);
  for (const guide of stage.guides ?? []) {
    const gx = plot.x + ((guide.x - stage.x.min) / (stage.x.max - stage.x.min || 1)) * plot.w;
    add(guide.id, { x: gx - 30, y: plot.y, w: 60, h: plot.h }, guide.s);
  }
}

/**
 * STACKED GRAPHS. x, v and a of SHM drawn on one y axis (±0.05 m, ±0.52 m/s, ±5.5 m/s²) left x
 * looking flat (audit 2026-10-15) — the exam convention is one panel per quantity on a shared time
 * axis, each with its own scale. Curves whose sizes differ by more than 4× are split that way; each
 * panel gets its curve's own range (sampled at the try-it defaults) and the curve's name as its axis
 * label. Curves of one size stay on one plot. Null = draw the stage as one plot.
 */
export function graphPanels(stage: GraphStage, vars: Record<string, number> = {}): GraphStage[] | null {
  if (stage.curves.length < 2) return null;
  const ranges = stage.curves.map((c) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 120; i++) {
      const x = stage.x.min + ((stage.x.max - stage.x.min) * i) / 120;
      const y = evalExpr(c.expr, { ...vars, x }, NaN);
      if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    }
    return Number.isFinite(lo) ? { lo, hi, size: Math.max(Math.abs(lo), Math.abs(hi)) } : null;
  });
  if (ranges.some((r) => !r || r.size === 0)) return null;
  const sizes = ranges.map((r) => r!.size);
  if (Math.max(...sizes) / Math.min(...sizes) <= 4) return null;
  return stage.curves.map((curve, i) => {
    const { lo, hi, size } = ranges[i]!;
    const pad = size * 0.15;
    const min = lo >= 0 ? 0 : lo - pad;
    const max = hi <= 0 ? 0 : hi + pad;
    return {
      ...stage,
      y: { label: curve.label || stage.y.label, min, max },
      curves: [curve],
      markers: stage.markers?.filter((m) => m.curve === curve.id),
      guides: stage.guides?.map((g) => (i ? { ...g, label: "" } : g)),
      trace: stage.trace?.curve === curve.id ? stage.trace : undefined,
    };
  });
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
  // Columns as tall as what they hold, centred: two items in full-height columns left half of each
  // empty (audit 2026-10-17). Few items are written a little larger.
  const most = Math.max(...sides.map(({ side }) => Math.min(4, side.items.length)), 1);
  const size = most <= 3 ? 21 : 19;
  const itemH = (text: string) => wrap(text, size, colW - 40, 2).length * size * 1.3 + 22;
  const contentH = Math.max(...sides.map(({ side }) => side.items.slice(0, 4).reduce((sum, item) => sum + itemH(item.text) + 12, 0)));
  const colH = Math.min(box.h - 10, Math.max(220, 92 + contentH + 20));
  const top = box.y + Math.max(0, (box.h - 10 - colH) / 2);
  for (const { side, x, color } of sides) {
    const rect = { x, y: top, w: colW, h: colH };
    const firstS = Math.min(...side.items.map((i) => i.s), 99);
    marks.push({ type: "column", id: side.id, rect, title: side.title, icon: side.icon, color, s: Number.isFinite(firstS) ? Math.max(0, firstS - 1) : 0 });
    add(side.id, rect, Math.max(0, firstS - 1));
    let y = top + 92;
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

/* ── exam ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * An exam question as the paper prints it: the question card with its marks, then the mark scheme
 * written point by point as Aria says each one (a tick and its mark), then the mistake that loses
 * marks in red. Text is wrapped whole and the sizes shrink until everything fits — nothing is cut.
 */
function layoutExam(stage: ExamStage, box: Rect, marks: Mark[], add: Add) {
  const markInk = "#be123c";
  const tickInk = "#15803d";
  const points = stage.points.slice(0, 6);
  const two = points.length > 3 && stage.scheme !== "levels";
  const colGap = 16;
  const colW = two ? (box.w - colGap) / 2 : box.w;
  const fit = (size: number) => {
    const q = wrap(`${stage.question}`, size + 1, box.w - 150, 6);
    const qH = q.length * (size + 1) * 1.3 + 24;
    const rows = points.map((p) => wrap(stage.scheme === "levels" ? `▸ ${p.text}` : `✓ ${p.text}  [1]`, size, colW - 36, 3));
    const rowH = rows.map((r) => r.length * size * 1.3 + 20);
    const colsH = two ? Math.max(rowH.slice(0, Math.ceil(points.length / 2)).reduce((a, b) => a + b + 10, 0), rowH.slice(Math.ceil(points.length / 2)).reduce((a, b) => a + b + 10, 0)) : rowH.reduce((a, b) => a + b + 10, 0);
    const lost = stage.lostMarks ? wrap(`✗ Loses marks: ${stage.lostMarks.text}`, size, box.w - 36, 3) : [];
    const lostH = lost.length ? lost.length * size * 1.3 + 20 : 0;
    return { size, q, qH, rows, rowH, lost, lostH, total: qH + 34 + colsH + (lostH ? lostH + 12 : 0) };
  };
  let f = fit(21);
  for (const size of [20, 19, 18, 17, 16, 15, 14]) if (f.total > box.h) f = fit(size);
  let y = box.y;
  // The question, with its marks at the right as the paper prints them.
  const qRect = { x: box.x, y, w: box.w, h: f.qH };
  marks.push({ type: "item", id: "exam-question", text: f.q.join("\n"), rect: qRect, color: "#1d4ed8", s: 0, size: f.size + 1 });
  add("exam-question", qRect, 0);
  const marksRect = { x: box.x + box.w - 120, y: y + 6, w: 110, h: 30 };
  marks.push({ type: "text", id: "exam-marks", text: `[${stage.marks} mark${stage.marks === 1 ? "" : "s"}]`, rect: marksRect, color: markInk, s: 0, size: 18 });
  add("exam-marks", marksRect, 0);
  y += f.qH + 8;
  const cmdRect = { x: box.x, y, w: Math.min(box.w, textWidth(`Command word: ${stage.commandWord}`, 16) + 20), h: 22 };
  marks.push({ type: "text", id: "command-word", text: `Command word: ${stage.commandWord}`, rect: cmdRect, color: markInk, s: 0, size: 16 });
  add("command-word", cmdRect, 0);
  y += 26;
  // The mark scheme, one row per mark.
  const half = Math.ceil(points.length / 2);
  const colY = [y, y];
  points.forEach((p, i) => {
    const col = two && i >= half ? 1 : 0;
    const r = { x: box.x + col * (colW + colGap), y: colY[col], w: colW, h: f.rowH[i] };
    marks.push({ type: "item", id: p.id, text: f.rows[i].join("\n"), rect: r, color: tickInk, s: p.s, size: f.size });
    add(p.id, r, p.s);
    colY[col] += f.rowH[i] + 10;
  });
  y = Math.max(...colY) + 2;
  if (stage.lostMarks && f.lost.length) {
    const r = { x: box.x, y, w: box.w, h: f.lostH };
    marks.push({ type: "item", id: stage.lostMarks.id, text: f.lost.join("\n"), rect: r, color: markInk, s: stage.lostMarks.s, size: f.size });
    add(stage.lostMarks.id, r, stage.lostMarks.s);
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
  const fbd = freeBodyParts(stage);
  if (fbd) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const bodyRect = { x: cx - 80, y: cy - 50, w: 160, h: 100 };
    // Arrow lengths follow the stated sizes (bigger force, longer arrow) so balance is visible.
    const max = Math.max(0, ...fbd.forces.map((f) => f.newtons ?? 0));
    const room = { up: cy - 50 - box.y - 40, down: box.y + box.h - (cy + 50) - 40, left: cx - 80 - box.x - 30, right: box.x + box.w - (cx + 80) - 30 };
    const forces: FreeBodyForce[] = fbd.forces.map((f) => {
      const full = Math.max(60, room[f.dir]);
      const len = max > 0 && f.newtons ? Math.max(50, full * (f.newtons / max)) : Math.min(full, 140);
      const start = f.dir === "up" ? { x: cx, y: cy - 50 } : f.dir === "down" ? { x: cx, y: cy + 50 } : f.dir === "left" ? { x: cx - 80, y: cy } : { x: cx + 80, y: cy };
      const end = f.dir === "up" ? { x: cx, y: start.y - len } : f.dir === "down" ? { x: cx, y: start.y + len } : f.dir === "left" ? { x: start.x - len, y: cy } : { x: start.x + len, y: cy };
      return { ...f, start, end };
    });
    // Two forces on one side (lift and normal both up) sit side by side, not on one line.
    for (const dir of ["up", "down", "left", "right"] as const) {
      const same = forces.filter((f) => f.dir === dir);
      same.forEach((f, i) => {
        const off = (i - (same.length - 1) / 2) * 44;
        if (dir === "up" || dir === "down") { f.start = { ...f.start, x: f.start.x + off }; f.end = { ...f.end, x: f.end.x + off }; }
        else { f.start = { ...f.start, y: f.start.y + off }; f.end = { ...f.end, y: f.end.y + off }; }
      });
    }
    marks.push({ type: "free-body", id: "free-body", body: fbd.body, bodyRect, forces, s: fbd.body.s });
    add(fbd.body.id, bodyRect, fbd.body.s);
    for (const f of forces) add(f.item.id, { x: Math.min(f.start.x, f.end.x) - 24, y: Math.min(f.start.y, f.end.y) - 24, w: Math.abs(f.end.x - f.start.x) + 48, h: Math.abs(f.end.y - f.start.y) + 48 }, f.item.s);
    add("free-body", box, 0);
    return;
  }
  const apparatus = electrolyticCellParts(stage);
  if (apparatus) {
    const beaker = { x: box.x + box.w * 0.22, y: box.y + box.h * 0.25, w: box.w * 0.56, h: box.h * 0.68 };
    const power = { x: box.x + box.w * 0.37, y: box.y + 8, w: box.w * 0.26, h: 68 };
    const anode = { x: beaker.x + beaker.w * 0.19, y: beaker.y + 48, w: 56, h: beaker.h - 78 };
    const cathode = { x: beaker.x + beaker.w * 0.70, y: beaker.y + 48, w: 56, h: beaker.h - 78 };
    const electrolyte = { x: beaker.x + 16, y: beaker.y + beaker.h * 0.48, w: beaker.w - 32, h: beaker.h * 0.46 - 10 };
    marks.push({ type: "electrolytic-cell", id: "electrolytic-cell", rect: box, parts: apparatus, s: Math.min(apparatus.power.s, apparatus.electrolyte.s, apparatus.anode.s, apparatus.cathode.s) });
    add(apparatus.power.id, power, apparatus.power.s);
    add(apparatus.anode.id, anode, apparatus.anode.s);
    add(apparatus.cathode.id, cathode, apparatus.cathode.s);
    add(apparatus.electrolyte.id, electrolyte, apparatus.electrolyte.s);
    add("electrolytic-cell", box, 0);
    return;
  }
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
      // A box with no icon is a card: its title, and its detail wrapped beneath — never an empty ring.
      const fit = !item.icon && item.detail ? fitDetail(item.detail, rect.w - 24, rect.h - 60) : undefined;
      const detail = fit?.lines;
      // A card is as tall as what it says, centred in its cells: a two-row box holding one line left
      // most of itself empty (audit 2026-10-17). Icon boxes keep their room for the icon.
      const needed = item.icon ? rect.h : Math.max(64, 46 + (detail?.length ?? 0) * (fit?.size ?? 15) * 1.27 + 14);
      const card = needed < rect.h - 24 ? { x: rect.x, y: rect.y + (rect.h - needed) / 2, w: rect.w, h: needed } : rect;
      itemMarks.push({ type: "box", id: item.id, rect: card, label: item.label, color, s: item.s, icon: item.icon, size: 18, ...(detail?.length ? { detail, detailSize: fit!.size } : {}) });
      centres.set(item.id, { c: { x: card.x + card.w / 2, y: card.y + card.h / 2 }, r: Math.min(card.w, card.h) / 2, ...(item.icon ? {} : { box: card }) });
      add(item.id, card, item.s);
    } else {
      itemMarks.push({ type: "text", id: item.id, rect, text: item.label ?? "", color, s: item.s, size: 20 });
      centres.set(item.id, { c: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, r: 20 });
      add(item.id, rect, item.s);
    }
  });
  arrowMarks(stage.arrows, centres, (a, b) => (Math.abs(a.y - b.y) < 10 ? 0 : 12), marks, add, textObstacles(itemMarks));
  marks.push(...itemMarks);
}

/**
 * FREE-BODY DIAGRAMS, DRAWN BY CODE. A force's direction follows from what it is — weight down,
 * normal reaction and upthrust up, friction against the push — so a scene with a "body" and named
 * forces is drawn as the exam diagram: one object, one arrow per force from its edge, each arrow as
 * long as its stated size ("Weight 20 N"). A generated picture gets arrow directions wrong; this
 * cannot. An id or label ending in -up/-down/-left/-right overrides the direction.
 */
export type FreeBodyDir = "up" | "down" | "left" | "right";
export type FreeBodyForce = { item: SceneStage["items"][number]; dir: FreeBodyDir; newtons?: number; start: Pt; end: Pt };
const BODY = /\b(body|object|block|box|crate|car|ball|mass|trolley|person|skydiver|parachutist|cyclist|load|book|lift|boat|rocket|aircraft|plane)\b/i;
const FORCES: Array<[RegExp, FreeBodyDir | "drag" | "friction"]> = [
  [/\b(weight|gravity|gravitational)\b/i, "down"],
  [/\b(normal|reaction|support)\b/i, "up"],
  [/\b(upthrust|buoyan\w*|lift[\s-]*force|lift)\b/i, "up"],
  [/\btension\b/i, "up"],
  [/\b(thrust|driving|applied|push|pull|engine)\b/i, "right"],
  [/\bfriction\b/i, "friction"],
  [/\b(drag|air[\s-]*resistance|water[\s-]*resistance|resistive)\b/i, "drag"],
];
export function freeBodyParts(stage: SceneStage): { body: SceneStage["items"][number]; forces: Array<Omit<FreeBodyForce, "start" | "end">> } | null {
  const text = (i: SceneStage["items"][number]) => `${i.id.replace(/[-_]/g, " ")} ${i.label ?? ""}`;
  const forceOf = (i: SceneStage["items"][number]) => FORCES.find(([re]) => re.test(text(i)))?.[1];
  const forceItems = stage.items.filter((i) => forceOf(i) && !/^(body|object)$/i.test(i.id));
  const body = stage.items.find((i) => !forceItems.includes(i) && (i.id === "body" || BODY.test(text(i))));
  if (!body || forceItems.length < 2 || !forceItems.some((i) => forceOf(i) === "down")) return null;
  // Horizontal motion when something pushes it along; otherwise it is falling, and drag acts up.
  const pushed = forceItems.some((i) => forceOf(i) === "right");
  const forces = forceItems.slice(0, 6).map((item) => {
    const kind = forceOf(item)!;
    const explicit = /[-_ ](up|down|left|right)$/i.exec(item.id)?.[1] ?? /\((up|down|left|right)(?:wards)?\)/i.exec(item.label ?? "")?.[1];
    const dir = (explicit?.toLowerCase() as FreeBodyDir | undefined) ?? (kind === "friction" ? "left" : kind === "drag" ? (pushed ? "left" : "up") : kind);
    const n = /(\d+(?:\.\d+)?)\s*(k?N)\b/.exec(item.label ?? "");
    const newtons = n ? Number(n[1]) * (n[2] === "kN" ? 1000 : 1) : undefined;
    return { item, dir, ...(newtons ? { newtons } : {}) };
  });
  return { body, forces };
}

/** Recognise the canonical parts of an electrolytic cell even when generation fell back to a scene. */
export function electrolyticCellParts(stage: SceneStage) {
  const find = (pattern: RegExp) => stage.items.find((item) => pattern.test(`${item.id} ${item.label ?? ""}`));
  const power = find(/power[\s-]*supply|battery|d\.?c\.?[\s-]*supply/i);
  const electrolyte = find(/electrolyte|ionic[\s-]*(?:solution|melt)|molten/i);
  const anode = find(/\banode\b/i);
  const cathode = find(/\bcathode\b/i);
  return power && electrolyte && anode && cathode ? { power, electrolyte, anode, cathode } : null;
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
