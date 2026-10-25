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

import { stackView, type StackView } from "./callStack";
import { layoutStructure, runStructure, type DsFrame, type DsLayout } from "./structure";
import { evalExpr } from "./expr";
import { placeLabels } from "../figures/labels";
import { recordFigureCut } from "../figures/cuts";
import { trimToFit } from "../text/fit";
import { fitText } from "./renderFit";
import { partBodies, shapeBoxes } from "../figures/bounds";
import { figureComponent } from "../figures/registry";
import type { FigureDrawing } from "../figures/types";
import { compileDiagram } from "../diagrams/render";
import { sequenceGeometry, type SequenceGeometry } from "./sequence";
import { ganttGeometry, mappingGeometry, memoryGeometry, statesGeometry, type GanttGeometry, type MappingGeometry, type MemoryGeometry, type StatesGeometry } from "./osDiagrams";
import { PANEL_H, PANEL_W, type AtomMapStage, type Becomes, type CanvasBoardSpec, type CanvasIcon, type CodeStage, type DsKind, type DsOp, type DsStart, type CompareStage, type DiagramStage, type EquationStage, type ExamStage, type FigureStage, type FlowNode, type FlowStage, type GraphStage, type IllustrationStage, type MoleculeStage, type SceneStage, type SketchItem, type SketchShape as SketchShapeT, type SketchStage, type StructureStage } from "./types";

export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

export type Mark =
  | { type: "heading"; id: string; text: string; x: number; y: number; size: number; s: number }
  | { type: "note"; id: string; lines: string[]; x: number; y: number; size: number; s: number; bullet: Pt; /** Rolled off the column when a later note takes its slot (sentence number). */ until?: number; /** An equation, typeset by KaTeX within `w`. */ tex?: string; w?: number }
  | { type: "node"; id: string; cx: number; cy: number; r: number; icon?: CanvasIcon; label: string; sub?: string; color: string; s: number; glow?: string; labelY: number; labelSize: number; becomes?: Becomes }
  | { type: "arrow"; id: string; p0: Pt; c: Pt; p1: Pt; label?: string; labelAt: Pt; s: number; flow: boolean; rate?: string; color: string }
  | { type: "picture"; id: string; rect: Rect; src?: string; paper?: string; s: number; subject: string }
  | { type: "part"; id: string; cx: number; cy: number; name: string; s: number }
  | { type: "callout"; id: string; partId: string; text: string; box: Rect; anchor: Pt; s: number; size: number }
  | { type: "equation"; id: string; tokens: Array<{ id: string; text: string; tex?: string; color: string; w: number; size: number }>; steps: Array<{ s: number; place: Record<string, Pt>; highlight: string[]; caption?: string }>; size: number; captionY: number; center: number; s: number; /** Wiped with its page of working when the next page starts (sentence number). */ until?: number }
  | { type: "graph"; id: string; plot: Rect; spec: GraphStage; s: number; /** A stacked panel: its curve's name as a title; x axis printed on the bottom panel only. */ stacked?: { title: string; showX: boolean } }
  | { type: "column"; id: string; rect: Rect; title: string; icon?: CanvasIcon; color: string; s: number }
  | { type: "item"; id: string; text: string; rect: Rect; color: string; s: number; size: number }
  | { type: "link"; id: string; p0: Pt; p1: Pt; s: number }
  | { type: "box"; id: string; rect: Rect; label?: string; color: string; s: number; icon?: CanvasIcon; size: number; /** Wrapped content lines on a card (a box with no icon). */ detail?: string[]; /** The detail's font size when it was set smaller to fit whole (15 otherwise). */ detailSize?: number }
  | { type: "text"; id: string; rect: Rect; text: string; color: string; s: number; size: number }
  | { type: "figure"; id: string; rect: Rect; scale: number; drawing: FigureDrawing; s: number; asset?: string; timing?: Record<string, number> }
  | { type: "figure-label"; id: string; part: string; lines: string[]; side: "left" | "right"; at: Pt; leader: Pt[]; size: number; s: number }
  | { type: "free-body"; id: string; body: SceneStage["items"][number]; bodyRect: Rect; forces: FreeBodyForce[]; s: number }
  | { type: "electrolytic-cell"; id: string; rect: Rect; parts: { power: SceneStage["items"][number]; electrolyte: SceneStage["items"][number]; anode: SceneStage["items"][number]; cathode: SceneStage["items"][number] }; s: number }
  | { type: "code"; id: string; rect: Rect; lines: string[]; language: string; size: number; lineH: number; gutter: number; steps: CodeStage["steps"]; reveal: "build" | "all"; groups: Array<{ from: number; to: number; label: string; s: number; x: number }>; edits: NonNullable<CodeStage["edits"]>; s: number }
  | { type: "state"; id: string; rect: Rect; steps: CodeStage["steps"]; s: number; /** Drawn beside the code as pencil memory boxes. */ pencil?: boolean }
  | { type: "stack"; id: string; rect: Rect; view: StackView; boxes: Record<string, Rect>; s: number }
  | { type: "sketch"; id: string; rect: Rect; items: SketchPlaced[]; s: number }
  | { type: "trace"; id: string; rect: Rect; vars: string[]; rows: Array<{ s: number; values: string[] }>; size: number; s: number }
  | { type: "output"; id: string; rect: Rect; text: string; size: number; s: number }
  | { type: "molecule"; id: string; rect: Rect; molecule: MoleculeStage["molecules"][number]; s: number }
  | { type: "atom-map"; id: string; rect: Rect; stage: AtomMapStage; s: number }
  /** A data structure, one frame per step (lib/canvas/structure.ts): the renderer glides between them. */
  | { type: "structure"; id: string; rect: Rect; kind: DsKind; directed: boolean; frames: DsFrame[]; layout: DsLayout; captions: Array<{ s: number; text: string }>; captionY: number; s: number }
  /** A message sequence (lib/canvas/sequence.ts): lifelines and time-ordered arrows, placed by code. */
  | { type: "sequence"; id: string; rect: Rect; geometry: SequenceGeometry; s: number }
  /** The operating-systems pictures (lib/canvas/osDiagrams.ts): a lifecycle, an address space, a CPU schedule. */
  | { type: "os-states"; id: string; rect: Rect; geometry: StatesGeometry; s: number }
  | { type: "os-memory"; id: string; rect: Rect; geometry: MemoryGeometry; s: number }
  | { type: "os-gantt"; id: string; rect: Rect; geometry: GanttGeometry; s: number }
  | { type: "os-mapping"; id: string; rect: Rect; geometry: MappingGeometry; s: number };

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
/** A maths/CS figure at full height, its notes in a column on the right (owner, 2026-10-21: "diagrams big enough"). */
const FIGURE_BESIDE_NOTES: Rect = { x: 40, y: 96, w: 652, h: 452 };
const RIGHT_NOTES_X = 716;
const RIGHT_NOTES_W = 248;
/** Maths and computer-science figures, which may take the full-height layout when it draws them bigger. */
const MATHS_FIGURES = new Set(["circleTheorem", "dotPlot", "triangle", "vectors", "parallelLines", "bearings", "shapes3d", "pythagorasProof", "pythagorasGarfield", "pythagorasSimilar", "pythagorasSquares", "areaModel", "logicCircuit", "coordinateGrid", "functionGraph", "calculusKit", "argand", "boxPlot", "cumulativeFrequency", "fractionModel"]);

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

/**
 * A "word" wider than its whole line — working written without spaces, "0.50(4.0)+1.0(0)=0.50(−1.0)+1.0v"
 * — ran out of its card (audit 2026-10-17). It is broken where working reads naturally: after "=",
 * ";", "," or before "+", "−", "×"; failing that, between characters.
 */
export function splitLong(word: string, size: number, maxW: number): string[] {
  if (textWidth(word, size) <= maxW) return [word];
  const parts: string[] = [];
  let rest = word;
  while (rest && textWidth(rest, size) > maxW) {
    let fit = 1;
    while (fit < rest.length && textWidth(rest.slice(0, fit + 1), size) <= maxW) fit++;
    let cut = -1;
    // A natural break first: after an arrow, slash or punctuation ("Saturn→ | Uranus", not "Uran | us"),
    // before an operator.
    for (let i = fit; i > fit * 0.35; i--) {
      if (/[=;,:)\]→⇒⟶\/]/.test(rest[i - 1]) || /[+−\-×÷(]/.test(rest[i])) { cut = i; break; }
    }
    if (cut < 0 && /[A-Za-z]/.test(rest[fit - 1] ?? "") && /[A-Za-z]/.test(rest[fit] ?? "")) {
      // Inside a word: a proper hyphen, and never a stub of one or two letters on either side
      // ("unbalanc | ed" read as two words on a card; 2026-10-18).
      let at = fit - 1;
      while (at > 3 && textWidth(`${rest.slice(0, at)}-`, size) > maxW) at--;
      if (rest.length - at < 3) at = Math.max(3, rest.length - 3);
      parts.push(`${rest.slice(0, at)}-`);
      rest = rest.slice(at);
      continue;
    }
    if (cut < 0) cut = fit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}
const fittedWords = (text: string, size: number, maxW: number) =>
  text.split(/\s+/).filter(Boolean).flatMap((w) => splitLong(w, size, maxW));

export function wrap(text: string, size: number, maxW: number, maxLines = 2): string[] {
  const words = fittedWords(text, size, maxW);
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
  // Smaller before any word is broken: the largest size at which every word fits its line whole
  // ("unbalanced", not "unbalanc | ed" on a narrow card; 2026-10-18).
  const whole = (size: number) => text.split(/\s+/).every((w) => textWidth(w, size) <= maxW);
  for (const size of [15, 14, 13, 12, 11]) {
    const maxLines = Math.max(1, Math.floor(maxH / (size * 1.27)));
    if (!whole(size)) continue;
    const lines = wrapWhole(text, size, maxW);
    if (lines.length <= maxLines) return { lines, size };
  }
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
  for (const word of fittedWords(text, size, maxW)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) <= maxW || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Text the layout left off for want of room — an arrow's label, a node's second line, a callout, a
 * term past the last that fits. Nothing used to report these, so a board could lose words silently;
 * the board writer is now told (lib/canvas/generate.ts) and the bench counts them.
 */
let drops: string[] = [];
export function recordLayoutDrop(what: string): void {
  if (drops.length < 40) drops.push(what);
}
/** What was left off since the last call. */
export function takeLayoutDrops(): string[] {
  const out = drops;
  drops = [];
  return out;
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
  // So does code with its working beside it (the call stack, the pencil variables): with a notes column
  // too, a four-line loop was written at 12 px (CS round, 2026-10-22).
  const split = spec.stage.kind === "code" && (Boolean(spec.stage.structure) || spec.stage.steps.some((p) => p.stack?.length || p.state?.length));
  // Working beside its figure needs the whole width too: its lines are the notes (no notes column).
  const working = spec.stage.kind === "equation" && Boolean(spec.stage.figure);
  const hasNotes = spec.notes.length > 0 && !split && !working;
  // Labelled textbook figures need horizontal room for the drawing and two boundary-label columns.
  // Putting their notes in the normal left rail made a correct 440 px scientific figure render at
  // roughly 150 CSS pixels. Figure boards therefore use the wide stage and place supporting facts
  // in a compact evidence strip below it.
  // A big lifecycle (five states or more) or mappings side by side need the width too: six thread states beside
  // the notes column put two transition labels on each other (2026-10-25).
  const figureWithNotes = hasNotes && (spec.stage.kind === "figure" || spec.stage.kind === "diagram" || (spec.stage.kind === "states" && spec.stage.states.length >= 5) || (spec.stage.kind === "mapping" && spec.stage.groups.length >= 2));
  // A square or tall maths figure under a heading and a notes strip came out a quarter of the board
  // wide (QA 2026-10-21): it takes the full height, notes on the right, when that draws it at least
  // 12% bigger. Other subjects' figures keep the strip.
  const besideNotes = (() => {
    if (!figureWithNotes || spec.stage.kind !== "figure" || !MATHS_FIGURES.has(spec.stage.component)) return false;
    const strip = figureFit(spec.stage, FIGURE_STAGE_WITH_NOTES);
    const beside = figureFit(spec.stage, FIGURE_BESIDE_NOTES);
    return Boolean(strip && beside && beside.scale > strip.scale * 1.12);
  })();
  const stage = besideNotes ? FIGURE_BESIDE_NOTES : figureWithNotes ? FIGURE_STAGE_WITH_NOTES : hasNotes ? STAGE : STAGE_WIDE;

  // The heading steps down until it fits the board's width (a 60-character heading at 28 px reached
  // the edge); it is never cut.
  let headingSize = HEADING_SIZE;
  while (headingSize > 22 && textWidth(spec.heading, headingSize) > PANEL_W - 110) headingSize -= 2;
  // s = -1: the heading is written while Aria is still bridging into the board, before sentence 0.
  marks.push({ type: "heading", id: "heading", text: spec.heading, x: 48, y: 66, size: headingSize, s: -1 });
  targets.heading = { x: 48, y: 66 - headingSize, w: Math.min(PANEL_W - 96, textWidth(spec.heading, headingSize)), h: headingSize * 1.25, s: 0 };

  // THE NOTES COLUMN IS WIPED WHEN FULL, like a teacher's board. What Aria writes as she speaks can be
  // a note for most sentences, so the column holds four at a time, read top to bottom; the fifth note
  // wipes the column and starts again at the top. When the board is complete the last page shows.
  const allNotes = hasNotes ? [...spec.notes].sort((a, b) => a.s - b.s) : [];
  const SLOTS = 4;
  const slots = Math.min(SLOTS, allNotes.length);
  // A page wiped on the sentence it was written is never drawn: two pages due on one sentence were
  // printed on top of each other ("Rapid, brief vs slower, lasting" over "Both coordinate responses";
  // live test, 2026-10-17). The later page wins.
  const untilOf = (i: number) => {
    const nextPage = allNotes[(Math.floor(i / SLOTS) + 1) * SLOTS];
    return nextPage ? Math.max(nextPage.s, allNotes[i].s) : undefined;
  };
  if (figureWithNotes && !besideNotes) {
    const gap = 18;
    const noteW = (STAGE_WIDE.w - gap * Math.max(0, slots - 1)) / Math.max(1, slots);
    const noteSize = slots >= 4 ? 15 : 17;
    allNotes.forEach((note, i) => {
      const x = STAGE_WIDE.x + (i % SLOTS) * (noteW + gap);
      const y = 474;
      const { lines, size: sz } = note.tex ? { lines: [note.text], size: noteSize } : noteLines(note.text, noteSize, noteW - 24);
      const until = untilOf(i);
      marks.push({ type: "note", id: note.id, lines, x: x + 22, y, size: sz, s: note.s, bullet: { x: x + 7, y: y - sz * 0.34 }, ...(until !== undefined ? { until } : {}), ...(note.tex ? { tex: note.tex, w: noteW - 24 } : {}) });
      const h = lines.length * sz * 1.28;
      targets[note.id] = { x, y: y - noteSize, w: noteW, h: h + 6, s: note.s };
    });
  } else {
    // Fixed slots, each room for two lines, so a note never moves once written.
    const slotH = 2 * NOTE_SIZE * 1.28 + 30;
    const nx = besideNotes ? RIGHT_NOTES_X : NOTES_X;
    const nw = besideNotes ? RIGHT_NOTES_W : NOTES_W;
    allNotes.forEach((note, i) => {
      const y = 140 + (i % SLOTS) * slotH;
      // An equation is typeset on one line, scaled to the column (KaTeX); words wrap as before.
      const { lines, size: sz } = note.tex ? { lines: [note.text], size: NOTE_SIZE } : noteLines(note.text, NOTE_SIZE, nw - 26);
      const until = untilOf(i);
      marks.push({ type: "note", id: note.id, lines, x: nx + 24, y, size: sz, s: note.s, bullet: { x: nx + 7, y: y - sz * 0.34 }, ...(until !== undefined ? { until } : {}), ...(note.tex ? { tex: note.tex, w: nw - 26 } : {}) });
      const h = lines.length * sz * 1.28;
      targets[note.id] = { x: nx, y: y - NOTE_SIZE, w: nw, h: h + 6, s: note.s };
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
      if (spec.stage.figure) {
        // WORKING BESIDE ITS FIGURE: the figure on the left, the lines of working written on the right
        // as Aria says them (owner, 2026-10-22: a graph or drawing while the working is shown).
        const gap = 24;
        const figW = Math.round(stage.w * 0.5);
        layoutFigure(spec.stage.figure, { x: stage.x, y: stage.y, w: figW, h: stage.h }, marks, add);
        layoutEquation(spec.stage, { x: stage.x + figW + gap, y: stage.y, w: stage.w - figW - gap, h: stage.h }, marks, add);
      } else layoutEquation(spec.stage, stage, marks, add);
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
    case "sketch":
      layoutSketch(spec.stage, stage, marks, add, spec.notes.map((n) => n.text));
      break;
    case "sequence": {
      const geometry = sequenceGeometry(spec.stage, stage, textWidth);
      const s = Math.min(...geometry.lanes.map((l) => l.s));
      marks.push({ type: "sequence", id: "sequence", rect: stage, geometry, s });
      add("sequence", stage, s);
      for (const l of geometry.lanes) add(`lane-${l.id}`, { ...l.head, h: geometry.lifeline.bottom - l.head.y }, l.s);
      for (const m of geometry.messages) {
        const x = Math.min(m.p0.x, m.p1.x), y = Math.min(m.p0.y, m.labelAt.y - m.labelSize);
        add(`msg-${m.id}`, { x, y, w: Math.abs(m.p1.x - m.p0.x), h: Math.max(m.p1.y, m.detailAt?.y ?? m.p1.y) + 10 - y }, m.s);
      }
      break;
    }
    case "states": {
      const geometry = statesGeometry(spec.stage, stage, textWidth);
      const s = Math.min(...geometry.states.map((st) => st.s));
      marks.push({ type: "os-states", id: "states", rect: stage, geometry, s });
      add("states", stage, s);
      for (const st of geometry.states) add(`state-${st.id}`, { x: st.cx - st.rx, y: st.cy - st.ry, w: st.rx * 2, h: st.ry * 2 }, st.s);
      for (const t of geometry.transitions) {
        const xs = t.samples.map((p) => p.x), ys = t.samples.map((p) => p.y);
        add(`tr-${t.id}`, union([{ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, ...(t.labelBox ? [t.labelBox] : [])]), t.s);
      }
      for (const tk of geometry.tokens) {
        const first = tk.stops[0];
        if (first) add(`token-${tk.id}`, { x: first.x - tk.w / 2, y: first.y - tk.h / 2, w: tk.w, h: tk.h }, first.s);
      }
      break;
    }
    case "memory": {
      const geometry = memoryGeometry(spec.stage, stage, textWidth);
      const s = Math.min(...geometry.blocks.map((b) => b.s));
      marks.push({ type: "os-memory", id: "memory", rect: stage, geometry, s });
      add("memory", stage, s);
      for (const c of geometry.columns) add(`col-${c.id}`, c.rect, c.s);
      for (const b of geometry.blocks) add(`seg-${b.id}`, b.rect, b.s);
      break;
    }
    case "gantt": {
      const geometry = ganttGeometry(spec.stage, stage, textWidth);
      const s = Math.min(...geometry.slots.map((sl) => sl.s));
      marks.push({ type: "os-gantt", id: "gantt", rect: stage, geometry, s });
      add("gantt", stage, s);
      for (const sl of geometry.slots) add(sl.id, sl.rect, sl.s);
      if (geometry.queue) add("queue", { x: geometry.queue.caption.x, y: geometry.queue.y, w: stage.w, h: geometry.queue.chipH }, Math.min(...geometry.queue.states.map((q) => q.s)));
      break;
    }
    case "mapping": {
      const geometry = mappingGeometry(spec.stage, stage, textWidth);
      const s = Math.min(...geometry.items.map((it) => it.s));
      marks.push({ type: "os-mapping", id: "mapping", rect: stage, geometry, s });
      add("mapping", stage, s);
      for (const g of geometry.groups) add(`map-${g.id}`, g.frame, g.s);
      for (const it of geometry.items) add(`item-${it.id}`, it.rect, it.s);
      break;
    }
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
 * A value written in the code font so it fits `width` (and a row `height`): one line at the largest
 * size from `max` down to 11 px; else two lines broken after a comma (or a space), down to 9 px. A
 * colours dictionary drawn at an 11 px floor ran off the board (owner, 2026-10-23).
 */
export function fitValue(value: string, width: number, height: number, max = 16): { lines: string[]; size: number } {
  const one = Math.floor(width / Math.max(1, value.length * MONO));
  if (one >= 11) return { lines: [value], size: Math.min(max, one) };
  const cuts = [...value.matchAll(/,\s*|\s+/g)].map((m) => m.index! + m[0].length).filter((c) => c < value.length);
  const at = cuts.length ? cuts.reduce((best, c) => (Math.abs(c - value.length / 2) < Math.abs(best - value.length / 2) ? c : best)) : Math.ceil(value.length / 2);
  const lines = [value.slice(0, at).trimEnd(), value.slice(at).trimStart()].filter(Boolean);
  const longest = Math.max(...lines.map((l) => l.length));
  const size = Math.max(9, Math.min(max, Math.floor(width / Math.max(1, longest * MONO)), Math.floor(height / 2.3)));
  return { lines, size };
}

/** The smallest code size while the longest line fits at it; below that, CODE_FLOOR_SIZE at most. */
export const CODE_MIN_SIZE = 12;
export const CODE_FLOOR_SIZE = 10;

/**
 * A listing in an editor card, sized so its longest line and all its lines fit; under it, side by
 * side, the trace table and the output when the board has them. Every line is a target, so Aria's
 * pen can point at it and the camera can zoom to it.
 */
function layoutCode(stage: CodeStage, fullArea: Rect, marks: Mark[], add: Add) {
  let st = stage;
  let area = fullArea;
  // A recursive function: the code on the left, its call stack beside it — one box per call, newest at
  // the bottom, a finished call crossed out (lib/canvas/callStack.ts). The boxes show what each call
  // holds, so the Variables panel gives way to them.
  const calls = !stage.structure && stage.steps.some((p) => p.stack) ? stackView(stage.steps) : null;
  if (calls) {
    const longest = Math.max(8, ...calls.frames.map((f) => f.call.length), ...calls.snaps.flatMap((sn) => sn.active.map((a) => (a.value ?? "").length)));
    const colW = Math.round(Math.min(fullArea.w * 0.38, Math.max(200, longest * MONO * 15 + 36)));
    const rect = { x: fullArea.x + fullArea.w - colW, y: fullArea.y, w: colW, h: fullArea.h };
    const head = 26;
    const gap = 20;
    const n = calls.frames.length;
    const boxH = Math.max(44, Math.min(70, (rect.h - head - gap * (n - 1)) / n));
    const boxes: Record<string, Rect> = {};
    calls.frames.forEach((f, i) => (boxes[f.id] = { x: rect.x, y: rect.y + head + i * (boxH + gap), w: colW, h: boxH }));
    const s0 = calls.snaps[0].s;
    marks.push({ type: "stack", id: "stack", rect, view: calls, boxes, s: s0 });
    add("stack", rect, s0);
    for (const f of calls.frames) add(f.id, boxes[f.id], calls.snaps.find((sn) => sn.active.some((a) => a.id === f.id))?.s ?? s0);
    area = { ...fullArea, w: fullArea.w - colW - 22 };
    // The code must stay readable beside the stack: when the subgoal labels would squeeze it below its
    // natural size, they give way (as they do beside a data structure).
    const groupW = stage.groups?.length ? Math.max(...stage.groups.map((g) => g.label.length * 7.6 + 34)) : 0;
    const natural = 38 + Math.max(8, ...stage.lines.map((l) => l.length)) * MONO * 15 + 48;
    st = { ...stage, steps: stage.steps.map((p) => ({ ...p, state: undefined })), ...(area.w - groupW < natural ? { groups: undefined } : {}) };
  }
  if (stage.structure) {
    // The code on the left, as wide as its longest line needs at a readable size (40-58% of the
    // board); the structure it changes on the right. The trace table and the subgoal labels give
    // way: the structure shows what the trace would, and the labels would crowd the code.
    const longest = Math.max(8, ...stage.lines.map((l) => l.length));
    // Up to 58% of the board at a readable size; a listing whose longest line cannot fit there even at
    // the 12 px floor takes up to two thirds (its text ran into the structure, owner 2026-10-23).
    const atFloor = 46 + longest * MONO * CODE_MIN_SIZE + 48;
    const codeW = Math.round(Math.max(fullArea.w * 0.4, Math.min(atFloor > fullArea.w * 0.58 ? fullArea.w * 0.66 : fullArea.w * 0.58, 38 + longest * MONO * 15 + 48)));
    const side = { x: fullArea.x + codeW + 18, y: fullArea.y, w: fullArea.w - codeW - 18, h: fullArea.h };
    // The algorithm's bookkeeping (its stack, visited set) goes under the structure it describes: under
    // a sixteen-line listing it ran off the board (CS round, 2026-10-22).
    const names = [...new Set(stage.steps.flatMap((p) => (p.state ?? []).map((v) => v.name)))];
    const stateH = names.length ? Math.min(side.h * 0.42, names.length * 46 + 40) : 0;
    layoutStructureMark(stage.structure, stage.steps, { ...side, h: side.h - stateH - (stateH ? 12 : 0) }, marks, add, []);
    if (stateH) {
      const rect = { x: side.x, y: side.y + side.h - stateH, w: side.w, h: stateH };
      const s0 = stage.steps.find((p) => p.state)?.s ?? (stage.steps[0]?.s ?? 0);
      marks.push({ type: "state", id: "state", rect, steps: stage.steps, s: s0, pencil: true });
      add("state", rect, s0);
    }
    area = { ...fullArea, w: codeW };
    st = { ...stage, trace: undefined, groups: undefined, steps: stage.steps.map((p) => ({ ...p, state: undefined })) };
  }
  // THE VARIABLES BESIDE THE CODE (owner, 2026-10-22: pencil "sketches … alongside the code"): with no
  // call stack or structure there, the variables stand in that column as pencil memory boxes, each with
  // the values it held before crossed out beside it — the way a teacher traces a program on the board
  // (components/canvas/CanvasPanel.tsx StateView). Too little room, and they stay under the code.
  const sideNames = !calls && !stage.structure ? [...new Set(st.steps.flatMap((p) => (p.state ?? []).map((v) => v.name)))] : [];
  if (sideNames.length) {
    const longestName = Math.max(...sideNames.map((n) => n.length));
    const longestValue = Math.max(1, ...st.steps.flatMap((p) => (p.state ?? []).map((v) => v.value.length)));
    const colW = Math.round(Math.min(fullArea.w * 0.42, Math.max(240, (longestName + 3 * longestValue + 6) * MONO * 16 + 60)));
    const natural = 38 + Math.max(8, ...stage.lines.map((l) => l.length)) * MONO * 15 + 48;
    // Beside the code only when the code still fits at its smallest size: a 72-character line squeezed
    // to 505 px was drawn over the variables' names (owner, 2026-10-23).
    const atFloor = 46 + Math.max(8, ...stage.lines.map((l) => l.length)) * MONO * CODE_MIN_SIZE + 48;
    if (fullArea.w - colW - 22 >= Math.max(atFloor, Math.min(natural, fullArea.w * 0.55))) {
      const rowsH = sideNames.length * 46 + 40;
      const rect = { x: fullArea.x + fullArea.w - colW, y: fullArea.y + Math.max(0, Math.round((fullArea.h - rowsH) * 0.3)), w: colW, h: Math.min(fullArea.h, rowsH) };
      const s0 = st.steps.find((q) => q.state)?.s ?? (st.steps[0]?.s ?? 0);
      marks.push({ type: "state", id: "state", rect, steps: st.steps, s: s0, pencil: true });
      add("state", rect, s0);
      area = { ...area, w: area.w - colW - 22 };
      // The subgoal labels give way when they would squeeze the code below its natural size.
      const groupW = st.groups?.length ? Math.max(...st.groups.map((g) => g.label.length * 7.6 + 34)) : 0;
      st = { ...st, steps: st.steps.map((p) => ({ ...p, state: undefined })), ...(area.w - groupW < natural ? { groups: undefined } : {}) };
    }
  }
  const rowH = 24;
  // The bottom row: the Variables panel, the trace, the output — whichever the board has, packed left
  // to right. Short of room, the trace goes first (the live Variables panel says more).
  const stateNames = [...new Set(st.steps.flatMap((p) => (p.state ?? []).map((v) => v.name)))];
  const stateW = stateNames.length ? Math.max(170, ...st.steps.flatMap((p) => (p.state ?? []).map((v) => (v.name.length + v.value.length + 4) * MONO * 16 + 40))) : 0;
  // Pencil memory boxes need taller rows than the old table (components/canvas/CanvasPanel.tsx PencilStateView).
  const stateH = stateNames.length ? stateNames.length * 46 + 40 : 0;
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
  // A step's note can be shown as a pill above the listing: room is kept for it, so it never sits on
  // the heading's rule (QA batch 5, 2026-10-21).
  const notePill = st.steps.some((p) => p.note) ? 30 : 0;
  const codeArea = { x: area.x, y: area.y + notePill, w: area.w - groupW, h: area.h - bottomH - gap - notePill };
  const maxLen = Math.max(8, ...st.lines.map((l) => l.length), ...(st.edits ?? []).map((e) => e.from.length));
  const gutter = st.lines.length >= 10 ? 46 : 38;
  // The size the longest line (and every line) fits at, 22 px at most. Below 12 px only when nothing
  // larger fits — down to 10 px rather than past the card (owner, 2026-10-23: code ran off its card
  // into the structure). CodeView clips at the card's edge as the last resort.
  const fitSize = Math.floor(Math.min((codeArea.w - gutter - 36) / (maxLen * MONO), (codeArea.h - 28) / (st.lines.length * 1.5)));
  const size = Math.max(CODE_FLOOR_SIZE, Math.min(22, fitSize));
  const lineH = Math.round(size * 1.5);
  // Wide enough for the longest line, and for each step's note written beside the line it explains;
  // never wider than its area (a line that still does not fit is clipped at the card, CodeView).
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
      marks.push({ type: "state", id: "state", rect: prect, steps: st.steps, s: s0, pencil: true });
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

/* ── sketch boards ─────────────────────────────────────────────────────────────────────────── */

/** One sketch item where it is drawn: its box, and the sizes code chose for its writing. */
export type SketchPlaced = {
  item: SketchItem;
  rect: Rect;
  /** Font size of its writing (text, math, table, code, box). */
  size: number;
  /** Wrapped lines (text and box). */
  lines?: string[];
  /** Math: height of one worked line and the width of its subgoal-label column. */
  lineH?: number;
  labelW?: number;
};

const SKETCH_SIZES = { big: 30, normal: 24, small: 19 } as const;
/** "half of $\\orange{6}$" → its width at `size`: TeX by its em estimate, the rest by the font. */
function writingWidth(t: string, size: number): number {
  let w = 0;
  t.split(/(\$[^$]+\$)/).forEach((part) => {
    if (/^\$[^$]+\$$/.test(part)) w += texEm(part.slice(1, -1).replace(/\\(?:blue|orange|green|pink|yellow|muted)\b/g, "")) * size * 1.05;
    else w += textWidth(part, size);
  });
  return w;
}
function wrapWriting(t: string, size: number, width: number): string[] {
  const words = t.split(/(\$[^$]+\$|\s+)/).filter((w) => w && !/^\s+$/.test(w));
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && writingWidth(next, size) > width) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [t];
}

/** The natural size of one item at column width `w` (font scale k). */
function sketchSize(item: SketchItem, w: number, k: number): { h: number; size: number; lines?: string[]; lineH?: number; labelW?: number; w?: number } {
  switch (item.type) {
    case "text": {
      const size = SKETCH_SIZES[item.size ?? "normal"] * k;
      const lines = wrapWriting(item.text, size, w);
      return { h: lines.length * size * 1.32, size, lines };
    }
    case "math": {
      const labels = item.lines.some((l) => l.label);
      const widest = Math.max(...item.lines.map((l) => texEm(l.tex.replace(/\\(?:blue|orange|green|pink|yellow|muted)\b/g, ""))));
      const fitSize = (room: number) => {
        let sz = (item.size === "big" ? 34 : 28) * k;
        while (sz > 16 && widest * sz * 1.05 > room) sz -= 1;
        return sz;
      };
      // Step labels sit beside the working when both fit at a readable size; otherwise each label goes
      // on its own line above its step (a long line once shrank its label to unreadable, 2026-10-20).
      // Measured at the size it is drawn (19), with room to spare; a label wider than its column, or
      // one that squeezes the maths, goes above its step instead (a long label was written over its
      // maths, QA batch 4, 2026-10-21).
      const labelNeed = labels ? Math.max(...item.lines.map((l) => (l.label ? writingWidth(l.label, 19) * 1.15 : 0))) + 22 : 0;
      let labelW = labels ? Math.min(w * 0.42, labelNeed) : 0;
      let size = fitSize(w - labelW);
      const stacked = labels && (size < 24 * k || labelNeed > w * 0.42);
      if (stacked) {
        labelW = 0;
        size = fitSize(w);
      }
      // A fraction stands a full line taller than text: its denominator hung into the next step's
      // label ("S = n(a + l)/2" over "four-term example"; maths benchmark, 2026-10-21).
      const frac = item.lines.some((l) => /\\[dt]?frac/.test(l.tex));
      const tall = frac || item.lines.some((l) => /\\sqrt|\^/.test(l.tex));
      const lineH = size * (frac ? 2.45 : tall ? 1.95 : 1.7) + (stacked ? 30 * k : 0);
      return { h: item.lines.length * lineH, size, lineH, labelW };
    }
    case "shapes": {
      const aspect = item.grid.h / item.grid.w;
      const h = Math.min(w * aspect, 400 * k);
      return { h, size: 18 * k, w: h / aspect };
    }
    case "graph":
      return { h: Math.min(w * 0.72, 360 * k), size: 14 * k };
    case "table": {
      let size = 18 * k;
      const colW = w / item.headers.length;
      const widest = Math.max(...item.headers.map((h) => writingWidth(h, size)), ...item.rows.flatMap((r) => r.cells.map((c) => writingWidth(c, size))));
      while (size > 12 && widest > colW - 14) { size -= 1; }
      return { h: (item.rows.length + 1) * size * 1.95 + 4, size };
    }
    case "box": {
      const size = 21 * k;
      const lines = wrapWriting(item.text, size, w - 30);
      return { h: 22 + (item.title ? 22 * k : 0) + lines.length * size * 1.38 + 8, size, lines };
    }
    case "code": {
      const longest = Math.max(8, ...item.lines.map((l) => l.length));
      // 10 px rather than past the item's edge (owner, 2026-10-23); the renderer clips the rest.
      const size = Math.max(CODE_FLOOR_SIZE, Math.min(20 * k, (w - 70) / (longest * MONO)));
      const lineH = size * 1.55;
      return { h: item.lines.length * lineH + 26, size, lineH };
    }
  }
}

/**
 * A sketch board's items placed in code: "full" items take a whole row; the others share a band of a
 * left and a right column (writing left, drawings right unless the writer said otherwise). A board
 * that would not fit is scaled down as one, never cropped, never overlapped.
 */
/**
 * FREE PLACEMENT (owner, 2026-10-21: "draw anywhere on the board"): every item at the spot the writer
 * gave on a 12 × 8 grid. Each fits inside its spot (a drawing keeps its proportions, writing shrinks
 * only as needed); an item that would land on another moves to the nearest free spot, else shrinks.
 */
/** Each item where the writer put it, or null when something would have to be left off. */
/** The smallest writing a sketch may show (px): below it the board is sent back (owner: "very very small"). */
export const SKETCH_MIN_TEXT = 13;

function placeSketchFreely(stage: SketchStage, area: Rect): SketchPlaced[] | null {
  const gx = area.w / 12;
  const gy = area.h / 8;
  const placed: SketchPlaced[] = [];
  const hits = (r: Rect) => placed.some((p) => r.x < p.rect.x + p.rect.w + 8 && p.rect.x < r.x + r.w + 8 && r.y < p.rect.y + p.rect.h + 8 && p.rect.y < r.y + r.h + 8);
  const inside = (r: Rect) => r.x >= area.x - 0.5 && r.y >= area.y - 0.5 && r.x + r.w <= area.x + area.w + 0.5 && r.y + r.h <= area.y + area.h + 0.5;
  for (const item of stage.items) {
    const at = item.at!;
    const box = { x: area.x + at.x * gx, y: area.y + at.y * gy, w: at.w * gx, h: at.h * gy };
    let k = 1;
    let sz = sketchSize(item, box.w, k);
    // Writing never shrinks below 80%: the bipartite lecture's "K(m,n) has m × n edges" was set at half size,
    // unreadable (2026-10-25). Writing that still does not fit takes more room below instead.
    const writing = item.type === "text" || item.type === "box" || item.type === "table" || item.type === "math";
    const floor = writing ? 0.8 : 0.5;
    while (sz.h > box.h && k > floor) {
      k -= 0.05;
      sz = sketchSize(item, box.w, k);
    }
    if (writing && sz.h > box.h) box.h = sz.h;
    let w = sz.w ?? box.w;
    let h = Math.min(sz.h, box.h);
    if (sz.w !== undefined && sz.h > box.h) {
      // A drawing taller than its spot: scaled down as one, keeping its shape.
      const f = box.h / sz.h;
      w = sz.w * f;
      h = box.h;
    }
    let rect: Rect = { x: box.x + (box.w - w) / 2, y: box.y, w, h };
    const asked = { x: rect.x, y: rect.y };
    // A drawing that only touches its neighbour (writing in the next grid cell) is drawn a little
    // smaller in its own spot — it was halved, a proof's circle shrank to an eighth of the board.
    if ((item.type === "shapes" || item.type === "graph") && (hits(rect) || !inside(rect))) {
      for (const f of [0.94, 0.88, 0.8, 0.72]) {
        const cand = { x: rect.x + (rect.w * (1 - f)) / 2, y: rect.y, w: rect.w * f, h: rect.h * f };
        if (!hits(cand) && inside(cand)) {
          rect = cand;
          k *= f;
          break;
        }
      }
    }
    if (hits(rect) || !inside(rect)) {
      // The nearest free spot: rings of grid steps around where it was asked to go.
      let best: Rect | null = null;
      for (let ring = 1; ring <= 10 && !best; ring++)
        for (const [dx, dy] of [[0, ring], [ring, 0], [-ring, 0], [0, -ring], [ring, ring], [-ring, ring], [ring, -ring], [-ring, -ring]]) {
          const cand = { ...rect, x: rect.x + dx * gx * 0.5, y: rect.y + dy * gy * 0.5 };
          if (!hits(cand) && inside(cand)) { best = cand; break; }
        }
      if (best) rect = best;
      else {
        // Nowhere free. Writing is left off rather than printed over something (the board is drawing
        // first; Aria says it). A drawing is halved and put at the first free spot down the board.
        // Never silently: a proof's worked lines were left off this way (maths benchmark, 2026-10-21) —
        // the sketch is laid out in bands instead (layoutSketch), where everything is fitted.
        if (item.type === "text" || item.type === "box" || item.type === "math" || item.type === "table") return null;
        rect = { ...rect, w: rect.w / 2, h: rect.h / 2 };
        k *= 0.5;
        let free = false;
        for (let y = area.y; y + rect.h <= area.y + area.h; y += gy / 2) {
          const cand = { ...rect, y };
          if (!hits(cand)) { rect = cand; free = true; break; }
        }
        if (!free) return null;
      }
    }
    const final = sketchSize(item, rect.w, k);
    // Faults a reader would see, reported so the writer redraws (generate.ts "text-dropped"): writing set too
    // small to read, and a part moved far from where it was drawn (it no longer sits with what it labels).
    const words = item.type === "text" || item.type === "box" ? item.text : item.type === "math" ? item.lines.map((l) => l.tex).join(" ") : item.id;
    if (writing && final.size < SKETCH_MIN_TEXT) recordLayoutDrop(`the writing "${words.slice(0, 40)}" would be ${Math.round(final.size)} px, too small to read (write less, or give it more room)`);
    if ((item.type === "shapes" || item.type === "graph") && k < 0.7) recordLayoutDrop(`the drawing "${item.id}" had to be shrunk to ${Math.round(k * 100)}% to fit (give it more room, or put fewer parts beside it)`);
    if (Math.hypot(rect.x - asked.x, rect.y - asked.y) > Math.max(gx, gy) * 1.5) recordLayoutDrop(`"${item.id}" had no room where it was drawn and was moved away from it (make the parts smaller, or leave room between them)`);
    placed.push({ item, rect: { ...rect, h: Math.min(rect.h, Math.max(final.h, item.type === "shapes" || item.type === "graph" ? rect.h : 0)) }, size: final.size, lines: final.lines, lineH: final.lineH, labelW: final.labelW });
  }
  return placed;
}

/** Letters, digits and maths only, for comparing two pieces of writing. */
const gist = (t: string) => t.toLowerCase().replace(/\$|\\[a-z]+/g, "").replace(/[^a-z0-9∠°=+−\-×÷²³]/g, "");

/**
 * A sketch's writing that only repeats a note is left off ("Goal: ∠ACB = 90°" was written twice on one
 * board), and a line labelled with nothing but its two end letters ("OA", "CB") is left unlabelled when
 * those points are lettered — it said nothing and crowded the drawing (maths benchmark, 2026-10-21).
 */
function tidySketch(stage: SketchStage, notes: string[]): SketchStage {
  const said = notes.map(gist).filter((n) => n.length >= 4);
  const items = stage.items
    .filter((it) => !(it.type === "text" && said.some((n) => { const g = gist(it.text); return g.length >= 4 && (n.includes(g) || g.includes(n)); })))
    .map((it) => {
      if (it.type !== "shapes") return it;
      const letters = new Set(it.shapes.filter((sh) => sh.kind === "label" && sh.label && /^[A-Z]$/.test(sh.label.trim())).map((sh) => sh.label!.trim()));
      const shapes = it.shapes.map((sh) => {
        const name = sh.label?.trim() ?? "";
        if ((sh.kind === "line" || sh.kind === "arrow") && /^[A-Z]{2}$/.test(name) && letters.has(name[0]) && letters.has(name[1])) return { ...sh, label: undefined };
        return sh;
      });
      return { ...it, shapes };
    });
  return items.length ? { ...stage, items } : stage;
}

/**
 * A drawing written in exactly the same place, on the same grid, as an earlier one is drawn ON it: the
 * dashed "missing A–D" edge was its own drawing over the first graph, was moved to a free corner by the
 * layout, and floated there alone (bipartite lecture, 2026-10-25). Its shapes join the earlier drawing.
 */
export function mergeSketchOverlays(stage: SketchStage): SketchStage {
  const items: SketchItem[] = [];
  const same = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  for (const it of stage.items) {
    if (it.type === "shapes" && it.at) {
      const base = items.find((b): b is Extract<SketchItem, { type: "shapes" }> => b.type === "shapes" && Boolean(b.at) && same(b.at!, it.at!) && b.grid.w === it.grid.w && b.grid.h === it.grid.h);
      if (base) {
        const ids = new Set(base.shapes.map((sh) => sh.id));
        base.shapes = [...base.shapes, ...it.shapes.map((sh) => ({ ...sh, id: ids.has(sh.id) ? `${it.id}-${sh.id}` : sh.id, s: Math.max(sh.s, it.s) }))];
        continue;
      }
      items.push({ ...it, shapes: [...it.shapes] });
      continue;
    }
    items.push(it);
  }
  return items.length === stage.items.length ? stage : { ...stage, items };
}

function layoutSketch(rawStage: SketchStage, area: Rect, marks: Mark[], add: Add, notes: string[] = []) {
  const stage = mergeSketchOverlays(tidySketch(rawStage, notes));
  const freely = stage.items.length && stage.items.every((it) => it.at) ? placeSketchFreely(stage, area) : null;
  if (freely) {
    const placed = freely;
    for (const p of placed) if (p.item.type === "shapes") p.item = { ...p.item, shapes: clearSketchLabels(p.item, p.rect, p.size) };
    const first = Math.min(...stage.items.map((it) => it.s));
    marks.push({ type: "sketch", id: "sketch", rect: area, items: placed, s: first });
    add("sketch", area, first);
    registerSketchTargets(placed, add);
    return;
  }
  // The parts did not fit where they were drawn, so they are stacked in bands below — smaller than asked.
  if (stage.items.length && stage.items.every((it) => it.at)) recordLayoutDrop("the sketch's parts did not fit where they were drawn, so they were stacked and shrunk (draw fewer parts, with more room between them)");
  const visual = (it: SketchItem) => it.type === "shapes" || it.type === "graph" || it.type === "code";
  const colOf = (it: SketchItem) => it.col ?? (visual(it) ? "right" : "left");
  type Band = { full?: SketchItem; left: SketchItem[]; right: SketchItem[] };
  const bands: Band[] = [];
  for (const it of stage.items) {
    if (colOf(it) === "full") bands.push({ full: it, left: [], right: [] });
    else {
      let band = bands[bands.length - 1];
      if (!band || band.full) bands.push((band = { left: [], right: [] }));
      band[colOf(it) as "left" | "right"].push(it);
    }
  }
  const gap = 20;
  const colGap = 30;
  const plan = (k: number) => {
    const placed: SketchPlaced[] = [];
    let y = 0;
    for (const band of bands) {
      if (band.full) {
        const sz = sketchSize(band.full, area.w, k);
        const w = sz.w ?? area.w;
        placed.push({ item: band.full, rect: { x: area.x + (area.w - w) / 2, y, w, h: sz.h }, size: sz.size, lines: sz.lines, lineH: sz.lineH, labelW: sz.labelW });
        y += sz.h + gap;
        continue;
      }
      const both = band.left.length && band.right.length;
      // A drawing gets the wider column; writing alone takes the board.
      const leftW = both ? (band.right.some(visual) ? area.w * 0.44 : area.w * 0.5) - colGap / 2 : area.w;
      const rightW = both ? area.w - leftW - colGap : area.w;
      let bottom = y;
      for (const [list, x0, w] of [[band.left, area.x, leftW], [band.right, both ? area.x + leftW + colGap : area.x, rightW]] as Array<[SketchItem[], number, number]>) {
        let cy = y;
        for (const it of list) {
          const sz = sketchSize(it, w, k);
          const iw = sz.w ?? w;
          placed.push({ item: it, rect: { x: x0 + (w - iw) / 2, y: cy, w: iw, h: sz.h }, size: sz.size, lines: sz.lines, lineH: sz.lineH, labelW: sz.labelW });
          cy += sz.h + gap;
        }
        bottom = Math.max(bottom, cy);
      }
      y = bottom;
    }
    return { placed, h: Math.max(0, y - gap) };
  };
  let k = 1;
  let result = plan(k);
  while (result.h > area.h && k > 0.55) {
    k -= 0.05;
    result = plan(k);
  }
  // Still too tall: the whole board shrinks as one, about its top-left — nothing is ever drawn off the
  // board (a vectors sketch lost its last two items below the board's edge, QA batch 2, 2026-10-21).
  if (result.h > area.h) {
    const f = area.h / result.h;
    for (const p of result.placed) {
      p.rect = { x: area.x + (p.rect.x - area.x) * f + (area.w * (1 - f)) / 2, y: p.rect.y * f, w: p.rect.w * f, h: p.rect.h * f };
      p.size *= f;
      if (p.lineH) p.lineH *= f;
      if (p.labelW) p.labelW *= f;
    }
    result = { ...result, h: area.h };
  }
  // A short board sits a little above the middle of its area, like a teacher's writing.
  const top = area.y + Math.max(0, (area.h - result.h) * 0.35);
  for (const p of result.placed) p.rect = { ...p.rect, y: p.rect.y + top };
  // Free labels never sit on a line or on another label: each is nudged to the nearest clear spot.
  for (const p of result.placed) if (p.item.type === "shapes") p.item = { ...p.item, shapes: clearSketchLabels(p.item, p.rect, p.size) };
  const first = Math.min(...stage.items.map((it) => it.s));
  marks.push({ type: "sketch", id: "sketch", rect: area, items: result.placed, s: first });
  add("sketch", area, first);
  registerSketchTargets(result.placed, add);
}

/** Every sketch item, worked line and shape as a target the camera and Dot can find. */
function registerSketchTargets(placedItems: SketchPlaced[], add: Add) {
  for (const p of placedItems) {
    add(p.item.id, p.rect, p.item.s);
    if (p.item.type === "math") p.item.lines.forEach((l, i) => add(`${p.item.id}-l${i + 1}`, { x: p.rect.x, y: p.rect.y + i * (p.lineH ?? 40), w: p.rect.w, h: p.lineH ?? 40 }, l.s));
    if (p.item.type === "shapes") {
      const it = p.item;
      const kx = p.rect.w / it.grid.w;
      const ky = p.rect.h / it.grid.h;
      for (const sh of it.shapes) {
        const pts = sh.points ?? (sh.kind === "circle" ? [[sh.x! - sh.r!, sh.y! - sh.r!], [sh.x! + sh.r!, sh.y! + sh.r!]] : sh.kind === "rect" ? [[sh.x!, sh.y!], [sh.x! + sh.w!, sh.y! + sh.h!]] : [[sh.x! - 0.5, sh.y! - 0.4], [sh.x! + 0.5, sh.y! + 0.4]]);
        const xs = pts.map((q) => q[0]);
        const ys = pts.map((q) => q[1]);
        const at = { x: p.rect.x + Math.min(...xs) * kx, y: p.rect.y + Math.min(...ys) * ky, w: Math.max(8, (Math.max(...xs) - Math.min(...xs)) * kx), h: Math.max(8, (Math.max(...ys) - Math.min(...ys)) * ky) };
        add(sh.id, at, sh.s);
        // Where it travels, on the sentence it moves: the camera frames the motion (camera.ts).
        if (sh.move) add(`${sh.id}-move`, union([at, { ...at, x: at.x + sh.move.dx * kx, y: at.y + sh.move.dy * ky }]), sh.move.s);
      }
    }
  }
}

type Seg = [number, number, number, number];
/** The outline segments of a sketch shape, in grid units (where it starts and where it ends up). */
function sketchSegments(sh: SketchShapeT): Seg[] {
  const pts: Array<[number, number]> | null =
    sh.kind === "rect" ? [[sh.x!, sh.y!], [sh.x! + sh.w!, sh.y!], [sh.x! + sh.w!, sh.y! + sh.h!], [sh.x!, sh.y! + sh.h!]]
    : sh.kind === "circle" ? Array.from({ length: 16 }, (_, i) => [sh.x! + Math.cos((i / 16) * 2 * Math.PI) * sh.r!, sh.y! + Math.sin((i / 16) * 2 * Math.PI) * sh.r!] as [number, number])
    : sh.points ?? null;
  if (!pts || pts.length < 2) return [];
  const closed = sh.kind === "rect" || sh.kind === "circle" || sh.kind === "poly";
  const segs: Seg[] = [];
  const shifts: Array<[number, number]> = [[0, 0], ...(sh.move && !sh.move.rotate ? [[sh.move.dx, sh.move.dy] as [number, number]] : [])];
  for (const [dx, dy] of shifts)
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      segs.push([a[0] + dx, a[1] + dy, b[0] + dx, b[1] + dy]);
    }
  return segs;
}
function segHitsBox(g: Seg, b: Rect): boolean {
  // Sampled: exact enough at board scale, and simple.
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const x = g[0] + (g[2] - g[0]) * t, y = g[1] + (g[3] - g[1]) * t;
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
  }
  return false;
}
/**
 * EVERY LABEL ON A SKETCH HAS ITS OWN CLEAR SPOT (owner, 2026-10-21: "a lot of text overlap"). One
 * pass places them all, each kept off every line, every other shape's body and every label placed
 * before it (grid units; `labelAt` on each labelled shape, read by SketchView):
 *   1. a shape's label inside it, when it fits at a readable size (13 px or more);
 *   2. a line's or arrow's label beside its longest stretch, never across it;
 *   3. a label too big for its shape OUTSIDE it — below, above, right or left — not written across
 *      its outline ("advanced methods" in a circle a third its width, with arrows through it);
 *   4. free labels where the writer put them, or the nearest clear spot.
 * Nothing clear within reach: the label keeps its first spot (the live board's TextDeconflict is the
 * last word).
 */
function clearSketchLabels(item: Extract<SketchItem, { type: "shapes" }>, rect: Rect, size: number): SketchShapeT[] {
  const kx = rect.w / item.grid.w;
  const ky = rect.h / item.grid.h;
  const labelSize = Math.max(13, Math.min(22, size * (rect.w / 420 + 0.4)));
  const segs = item.shapes.filter((sh) => sh.kind !== "label").map((sh) => ({ id: sh.id, segs: sketchSegments(sh) }));
  const bodyOf = (sh: SketchShapeT): Rect | null => {
    if (sh.kind === "rect") return { x: sh.x!, y: sh.y!, w: sh.w!, h: sh.h! };
    if (sh.kind === "circle") return { x: sh.x! - sh.r!, y: sh.y! - sh.r!, w: sh.r! * 2, h: sh.r! * 2 };
    if (sh.kind === "poly" && sh.points?.length) {
      const xs = sh.points.map((q) => q[0]), ys = sh.points.map((q) => q[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    return null;
  };
  const bodies = item.shapes.flatMap((sh) => { const b = bodyOf(sh); return b ? [{ id: sh.id, b }] : []; });
  const boxAt = (x: number, y: number, label: string, px: number): Rect => {
    const w = (writingWidth(label, px) + 8) / kx;
    const h = (px * 1.3) / ky;
    return { x: x - w / 2, y: y - h / 2, w, h };
  };
  const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const taken: Rect[] = [];
  /**
   * Clear of every line but `own`'s and every label, inside the grid. A label written OUTSIDE its
   * shape also keeps off its own outline and off every shape's body; a label over a filled area is
   * otherwise fine (in a square tiled by triangles, every spot is inside some body).
   */
  // `avoidBodies`: also off every shape's body — a line's label or a free label written over a box or
  // circle ("1000" on the phone's box, TCP lecture 2026-10-24).
  // `inside`: a free label written inside a box (a document's fields inside its frame) stays inside that box,
  // and the box is not in its way (NoSQL lecture, 2026-10-24: the fields were pushed across the frame's edge).
  const free = (b: Rect, own: string, outside = false, avoidBodies = outside, inside?: { id: string; b: Rect }) =>
    (!inside || within(b, inside.b)) &&
    b.x >= 0 && b.y >= 0 && b.x + b.w <= item.grid.w && b.y + b.h <= item.grid.h &&
    !segs.some((s) => (outside || s.id !== own) && s.segs.some((g) => segHitsBox(g, b))) &&
    !(avoidBodies && bodies.some((o) => (outside || o.id !== own) && o.id !== inside?.id && hit(b, o.b))) &&
    !taken.some((t) => hit(b, t));
  const within = (b: Rect, body: Rect) => b.x >= body.x && b.y >= body.y && b.x + b.w <= body.x + body.w && b.y + b.h <= body.y + body.h;
  const ringSearch = (x: number, y: number, label: string, px: number, own: string, outside = false, avoidBodies = outside, inside?: { id: string; b: Rect }): [number, number] | null => {
    const step = Math.max(0.3, (px * 0.6) / ky);
    for (let ring = 0; ring <= 7; ring++) {
      const tries = ring === 0 ? [[0, 0]] : Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * 2 * Math.PI) * ring * step, Math.sin((i / 12) * 2 * Math.PI) * ring * step]);
      for (const [dx, dy] of tries) if (free(boxAt(x + dx, y + dy, label, px), own, outside, avoidBodies, inside)) return [x + dx, y + dy];
    }
    return null;
  };
  const at = new Map<string, { x: number; y: number; size: number }>();
  const put = (id: string, x: number, y: number, label: string, px: number) => {
    // A label squeezed below a readable size is a fault the writer fixes (a bigger shape, a shorter label).
    if (px < SKETCH_MIN_TEXT - 0.5) recordLayoutDrop(`the label "${label.slice(0, 30)}" would be ${Math.round(px)} px, too small to read (make its shape bigger or the label shorter)`);
    at.set(id, { x, y, size: px });
    taken.push(boxAt(x, y, label, px));
  };
  const outsideLater: SketchShapeT[] = [];
  // 1. Inside its shape, when it fits.
  for (const sh of item.shapes) {
    if (!sh.label || sh.kind === "label" || sh.kind === "line" || sh.kind === "arrow") continue;
    const body = bodyOf(sh);
    if (!body) continue;
    const room = (sh.kind === "poly" ? 0.55 : 0.84) * body.w * kx;
    const fit = Math.min(labelSize, room / Math.max(0.5, writingWidth(sh.label, 1)));
    const tallEnough = body.h * ky >= fit * 1.25;
    if (fit >= 13 && tallEnough) {
      const cx = sh.kind === "poly" ? sh.points!.reduce((a, q) => a + q[0], 0) / sh.points!.length : body.x + body.w / 2;
      const cy = sh.kind === "poly" ? sh.points!.reduce((a, q) => a + q[1], 0) / sh.points!.length : body.y + body.h / 2;
      // Its centre may have another shape's line through it (an altitude, a smaller triangle's edge):
      // then the nearest clear spot still inside the shape, else outside it.
      const step = Math.max(0.2, (fit * 0.5) / ky);
      let spot: [number, number] | null = null;
      for (let ring = 0; ring <= 5 && !spot; ring++) {
        const tries = ring === 0 ? [[0, 0]] : Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * 2 * Math.PI) * ring * step, Math.sin((i / 12) * 2 * Math.PI) * ring * step]);
        for (const [dx, dy] of tries) {
          const b = boxAt(cx + dx, cy + dy, sh.label, fit);
          if (within(b, body) && free(b, sh.id)) { spot = [cx + dx, cy + dy]; break; }
        }
      }
      if (spot) put(sh.id, spot[0], spot[1], sh.label, fit);
      else outsideLater.push(sh);
    } else outsideLater.push(sh);
  }
  // 2. Beside its line.
  for (const sh of item.shapes) {
    if (!sh.label || (sh.kind !== "line" && sh.kind !== "arrow") || !sh.points || sh.points.length < 2) continue;
    let best = 0, bl = -1;
    for (let i = 0; i < sh.points.length - 1; i++) {
      const l = Math.hypot((sh.points[i + 1][0] - sh.points[i][0]) * kx, (sh.points[i + 1][1] - sh.points[i][1]) * ky);
      if (l > bl) { bl = l; best = i; }
    }
    const [a, b] = [sh.points[best], sh.points[best + 1]];
    let nx = -((b[1] - a[1]) * ky), ny = (b[0] - a[0]) * kx;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const off = labelSize * 0.95;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const sides: Array<[number, number]> = [[mx + (nx * off) / kx, my + (ny * off) / ky], [mx - (nx * off) / kx, my - (ny * off) / ky]];
    const spot = sides.find(([x, y]) => free(boxAt(x, y, sh.label!, labelSize), sh.id, false, true)) ?? ringSearch(sides[0][0], sides[0][1], sh.label, labelSize, sh.id, false, true);
    if (!spot) recordLayoutDrop(`the label "${sh.label}" has no clear room beside its line (the drawing is too crowded: space the shapes further apart)`);
    put(sh.id, (spot ?? sides[0])[0], (spot ?? sides[0])[1], sh.label, labelSize);
  }
  // 3. Too big for its shape: outside it.
  for (const sh of outsideLater) {
    const body = bodyOf(sh)!;
    const px = Math.max(13, Math.min(labelSize, 18));
    const half = boxAt(0, 0, sh.label!, px);
    const cx = body.x + body.w / 2, cy = body.y + body.h / 2, gap = 0.12;
    const sides: Array<[number, number]> = [
      [cx, body.y + body.h + gap - half.y],
      [cx, body.y - gap + half.y],
      [body.x + body.w + gap - half.x, cy],
      [body.x - gap + half.x, cy],
    ];
    const spot = sides.find(([x, y]) => free(boxAt(x, y, sh.label!, px), sh.id, true)) ?? ringSearch(sides[0][0], sides[0][1], sh.label!, px, sh.id, true);
    if (spot) put(sh.id, spot[0], spot[1], sh.label!, px);
    else {
      // Sent back to the writer (generate.ts "text-dropped"), so a cramped drawing is redrawn.
      recordLayoutDrop(`the label "${sh.label}" does not fit in its shape and has no clear room beside it (make the shape bigger, the label shorter, or space the shapes further apart)`);
      put(sh.id, cx, cy, sh.label!, 11);
    }
  }
  // 4. Free labels: where asked, or the nearest clear spot.
  for (const sh of item.shapes) {
    if (sh.kind !== "label" || !sh.label) continue;
    // The smallest box it was written inside, if any: it stays in there.
    const inside = bodies.filter((o) => sh.x! > o.b.x && sh.x! < o.b.x + o.b.w && sh.y! > o.b.y && sh.y! < o.b.y + o.b.h).sort((a, c) => a.b.w * a.b.h - c.b.w * c.b.h)[0];
    const spot = ringSearch(sh.x!, sh.y!, sh.label, labelSize, sh.id, false, true, inside);
    if (!spot) recordLayoutDrop(`the label "${sh.label}" has no clear room near where it was put (the drawing is too crowded there)`);
    put(sh.id, (spot ?? [sh.x!, sh.y!])[0], (spot ?? [sh.x!, sh.y!])[1], sh.label, labelSize);
  }
  return item.shapes.map((sh) => (at.has(sh.id) ? { ...sh, labelAt: at.get(sh.id) } : sh));
}

/* ── data structures ──────────────────────────────────────────────────────────────────────── */

/** A structure board: the structure across the stage, each step's note written under it. */
function layoutStructureStage(st: StructureStage, area: Rect, marks: Mark[], add: Add) {
  const captions = st.steps.filter((p) => p.note).map((p) => ({ s: p.s, text: p.note! }));
  // What the algorithm keeps beside the structure (BFS's queue, the visited set), drawn in pencil in a
  // column on the right as it changes (CS round, 2026-10-22: the queue was talked about, never drawn).
  const names = [...new Set(st.steps.flatMap((p) => (p.state ?? []).map((v) => v.name)))];
  if (names.length) {
    const longest = Math.max(1, ...st.steps.flatMap((p) => (p.state ?? []).map((v) => v.value.length)));
    const colW = Math.round(Math.min(area.w * 0.45, Math.max(240, longest * MONO * 17 + 140)));
    const rowsH = names.length * 46 + 40;
    const rect = { x: area.x + area.w - colW, y: area.y + Math.max(0, Math.round((area.h - rowsH) * 0.3)), w: colW, h: Math.min(area.h, rowsH) };
    const s0 = st.steps.find((p) => p.state)?.s ?? 0;
    marks.push({ type: "state", id: "state", rect, steps: st.steps.map((p) => ({ s: p.s, lines: [], ...(p.state ? { state: p.state } : {}) })), s: s0, pencil: true });
    add("state", rect, s0);
    layoutStructureMark(st.structure, st.steps, { ...area, w: area.w - colW - 22 }, marks, add, captions);
    return;
  }
  layoutStructureMark(st.structure, st.steps, area, marks, add, captions);
}

function layoutStructureMark(start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }>, area: Rect, marks: Mark[], add: Add, captions: Array<{ s: number; text: string }>) {
  // Frames up to the first operation that could not be done: the board is checked before it is kept
  // (lib/canvas/generate.ts), so this only guards a board that slipped through.
  const { frames } = runStructure(start, steps);
  const captionRoom = captions.length ? 44 : 0;
  // A two-coloured structure keeps a band at the top for its "Set A / Set B" legend (CanvasPanel).
  const legendRoom = steps.some((st) => st.ops?.some((o) => o.op === "group")) ? 28 : 0;
  const inner = { x: area.x, y: area.y + legendRoom, w: area.w, h: area.h - captionRoom - legendRoom };
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
    // Two arrows between the same two nodes, one each way, bow apart — on the same small bend they
    // were drawn over each other, labels and all ("accepts 2C" over "more reactions", Krebs 2026-10-18).
    const paired = arrows.some((other) => other !== arrow && other.from === arrow.to && other.to === arrow.from);
    // An arrow never runs through a card it does not join: it bows round it, or is left off when no
    // bow clears it ("Redox indicator → Test tube" was drawn straight through "Colour loss", 2026-10-18).
    const others = [...centres.entries()].filter(([id, n]) => id !== arrow.from && id !== arrow.to && n.box).map(([, n]) => n.box!);
    const crosses = (k: number) => {
      const c = { x: mx - (dy / d) * k, y: my + (dx / d) * k };
      for (let t = 0.12; t <= 0.88; t += 0.04) {
        const q = { x: (1 - t) * (1 - t) * p0.x + 2 * t * (1 - t) * c.x + t * t * p1.x, y: (1 - t) * (1 - t) * p0.y + 2 * t * (1 - t) * c.y + t * t * p1.y };
        if (others.some((r) => q.x > r.x + 4 && q.x < r.x + r.w - 4 && q.y > r.y + 4 && q.y < r.y + r.h - 4)) return true;
      }
      return false;
    };
    const base = paired ? 46 : bend(p0, p1);
    const k = [base, 55, -55].find((b) => !crosses(b));
    if (k === undefined) { recordLayoutDrop(`the arrow ${arrow.from} → ${arrow.to} had no path clear of the other cards`); return; }
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
      if (spot) { labelAt = spot; placedLabels.push(boxAt(spot)); } else { recordLayoutDrop(`the arrow label "${arrow.label}" had no free spot beside its arrow`); label = undefined; }
    } else if (arrow.label) recordLayoutDrop(`the arrow label "${arrow.label}" sits on an arrow too short to hold it`);
    marks.push({ type: "arrow", id: arrow.id, p0, c, p1, label, labelAt, s: arrow.s, flow: arrow.flow ?? false, rate: arrow.rate, color: arrow.color ?? PALETTE[(i + 2) % PALETTE.length] });
    add(arrow.id, union([{ x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(dx) || 8, h: Math.abs(dy) || 8 }, { x: labelAt.x - 40, y: labelAt.y - 16, w: 80, h: 22 }]), arrow.s);
  });
}

function layoutFlow(stage: FlowStage, box: Rect, marks: Mark[], add: Add) {
  const nodes = stage.nodes.slice(0, 7);
  for (const node of stage.nodes.slice(7)) recordLayoutDrop(`the step "${node.label}" is past the seven a flow holds`);
  const centres = new Map<string, { c: Pt; r: number; below?: number; box?: Rect }>();
  const nodeMarks: Mark[] = [];
  const place = (node: FlowStage["nodes"][number], i: number, cx: number, cy: number, r: number, maxLabelW?: number, maxH?: number) => {
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
      // Two or three steps fill the board: three small cards in a row left most of it empty (2026-10-18).
      const few = nodes.length <= 3;
      const w = Math.max(110, Math.min(few ? 270 : 220, room));
      const labelSize = Math.max(13, Math.min(few ? 21 : 18, Math.floor((w - 18) / Math.max(1, textWidth(node.label, 1)))));
      // In a column of cards each card fits its share of the column: cards drawn as tall as their
      // detail overlapped ("Testing" printed over "Antiretroviral drugs"; live test, 2026-10-17).
      // A title that wraps ("Enzyme-substrate / complex") takes room from the detail under it: counted,
      // the detail no longer spills out of the card's foot (2026-10-18).
      const title = fitText(node.label, w - 16, labelSize, 12);
      const titleExtra = (title.lines.length - 1) * title.size * 1.15;
      const detailRoom = (maxH === undefined ? 3 * 19 : maxH - 48) - titleExtra;
      const fit = original.sub && detailRoom >= 15 ? fitDetail(original.sub, w - 20, detailRoom) : undefined;
      if (original.sub && !fit) recordLayoutDrop(`"${original.sub}" under "${node.label}" had no room in its card`);
      const detail = fit?.lines;
      const h = Math.min(maxH ?? Infinity, Math.max(few ? 84 : 58, 40 + titleExtra + (detail?.length ?? 0) * (fit?.size ?? 15) * 1.27 + 8));
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
      // Each node gets the height it really takes — a pictured node is its circle AND the name (and
      // detail) printed under it; a card is its card. Spaced evenly by those heights, the "Heated air"
      // icon's name no longer prints over the "Thunder" card below it (lightning board, 2026-10-18).
      const pictured = (n: (typeof nodes)[number]) => Boolean(n.icon || n.becomes || n.glow);
      const tight = list.length >= 3 && span / list.length < 118;
      const heightOf = (n: (typeof nodes)[number]) => (pictured(n) ? 2 * r + (n.sub && !tight ? 48 : 28) : n.sub && !tight ? 96 : 66);
      const total = list.reduce((sum, n) => sum + heightOf(n), 0);
      const gap = Math.max(6, (span + 40 - total) / Math.max(1, list.length));
      let y = box.y + Math.max(0, (span + 40 - total - gap * list.length) / 2) + gap / 2;
      list.forEach((node) => {
        const h = heightOf(node);
        // A pictured node's centre is its circle's, above the name printed under it.
        const cy = pictured(node) ? y + r : y + h / 2;
        // A second line under each node only where the column has room for it; the label carries it otherwise.
        if (tight && node.sub && pictured(node)) recordLayoutDrop(`"${node.sub}" under "${node.label}" had no room in its column`);
        place(tight ? { ...node, sub: undefined } : node, nodes.indexOf(node), x, cy, r, undefined, Math.max(52, h - 4));
        y += h + gap;
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
      if (crowded && node.sub) recordLayoutDrop(`"${node.sub}" under "${node.label}" had no room with ${perRow} steps in a row`);
      // Room between cards for the arrow that joins them: a 14 px gap hid every arrow of a
      // meteoroid → meteor → meteorite chain (2026-10-18).
      place(crowded ? { ...node, sub: undefined } : node, i, cx, cy, rows === 1 ? 42 : 34, box.w / perRow - (stage.arrows.length ? 60 : 14));
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

/** How big a figure is drawn in `box`, its label margins taken off (the sizing half of layoutFigure). */
function figureFit(stage: FigureStage, box: Rect) {
  // A library diagram (lib/figures/library.ts) is a picture with exact anchors: the same label path
  // as a code-drawn figure, with the art drawn from its file instead of from shapes.
  const component = stage.asset || stage.drawing ? undefined : figureComponent(stage.component);
  if (!stage.asset && !stage.drawing && !component) return null;
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
  // In a narrow box (a figure beside its working) the labels wrap rather than take the drawing's room:
  // two 220 px margins left a function graph a speck under its own labels (live test, 2026-10-22).
  const cap = box.w < 600 ? Math.max(80, Math.round(box.w * 0.18)) : 220;
  const marginFor = (list: typeof shown) => (list.length ? Math.min(cap, Math.max(...list.map((p) => Math.min(textWidth(p.name, size), 190))) + 46) : 16);
  const left = component?.selfLabelled ? 16 : marginFor(leftSide), right = component?.selfLabelled ? 16 : marginFor(rightSide);
  const room = { w: box.w - left - right, h: box.h - 24 };
  const scale = Math.min(room.w / drawing.w, room.h / drawing.h);
  return { component, drawing, anchors, shown, size, left, right, room, scale };
}

function layoutFigure(stage: FigureStage, box: Rect, marks: Mark[], add: Add) {
  const fit = figureFit(stage, box);
  if (!fit) return;
  const { component, drawing, anchors, shown, size, left, room, scale } = fit;
  const rect = { x: box.x + left + (room.w - drawing.w * scale) / 2, y: box.y + 4 + (room.h - drawing.h * scale) / 2, w: drawing.w * scale, h: drawing.h * scale };
  const onBoard = (p: Pt): Pt => ({ x: rect.x + p.x * scale, y: rect.y + p.y * scale });
  // A figure whose shapes change with the narration (lib/figures/types.ts ShapeTiming) carries each
  // part's sentence; others carry nothing new.
  const timed = drawing.shapes.some((sh) => sh.show || sh.hide || sh.move);
  marks.push({ type: "figure", id: "figure", rect, scale, drawing, s: 0, ...(stage.asset ? { asset: stage.asset.id } : {}), ...(timed ? { timing: Object.fromEntries(stage.parts.map((p) => [p.id, p.s])) } : {}) });
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

  // Every label the board names is drawn (the validator allows 8): a student must see each part a
  // "label/identify" lesson asks for. Smaller type when more than three share the picture.
  const baseSize = stage.labels.length > 3 ? 15 : 18;
  const leaders: Array<[Pt, Pt]> = [];
  const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  };
  for (const id of stage.labels.slice(0, 8)) {
    const part = parts.find((p) => p.id === id);
    const at = part && points.get(part.id);
    if (!part || !at) continue;
    // A label with no free spot is tried smaller and further out before it is ever left off (it used
    // to be skipped silently), and a leader that would cross another is the last choice.
    let best: Rect | null = null;
    let size = baseSize;
    let bestScore = Infinity;
    for (const trySize of [baseSize, baseSize - 3]) {
      const bw = textWidth(part.name, trySize) + 26;
      const bh = trySize + 14;
      // Rings outward until a spot whose leader crosses no other is found; a crossing spot is kept
      // only as the last resort.
      for (let ring = 0; ring < 5 && bestScore >= 400; ring++) {
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
          const end = { x: cand.x + cand.w / 2, y: cand.y + cand.h / 2 };
          const crossing = leaders.some(([p, q]) => crosses(at, end, p, q));
          const score = dist + (outside ? 0 : 60) + (crossing ? 400 : 0) + (trySize < baseSize ? 30 : 0);
          if (score < bestScore) {
            bestScore = score;
            best = cand;
            size = trySize;
          }
        }
      }
      if (best && bestScore < 400) break;
    }
    const spot = best as Rect | null;
    if (!spot) {
      recordLayoutDrop(`the label "${part.name}" found no free spot on the picture`);
      continue;
    }
    leaders.push([at, { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 }]);
    placed.push(spot);
    marks.push({ type: "callout", id: `${part.id}-label`, partId: part.id, text: part.name, box: spot, anchor: at, s: part.s, size });
    add(`${part.id}-label`, spot, part.s);
  }
}

/* ── equation ─────────────────────────────────────────────────────────────────────────────── */

/**
 * A note's lines. A formula is never broken mid-expression ("SD = √[∑(x − mean)² ÷" over "n]"; maths
 * benchmark round 3): it is set a little smaller to fit one line, else broken at an "=" so each line
 * is whole; other notes wrap at words as before.
 */
export function noteLines(text: string, size: number, width: number): { lines: string[]; size: number } {
  const formula = /[=≈]/.test(text) && /[\d+\-−×÷/^²³√()∑]/.test(text);
  const plain = wrap(text, size, width, 2);
  if (!formula || plain.length === 1) return { lines: plain, size };
  for (const k of [0.9, 0.82]) {
    const small = Math.round(size * k);
    if (textWidth(text, small) <= width) return { lines: [text], size: small };
  }
  const at = [...text.matchAll(/\s[=≈]\s/g)].map((m) => m.index ?? -1).filter((i) => i > 0);
  for (const i of at.reverse()) {
    const head = text.slice(0, i).trim(), tail = text.slice(i).trim();
    for (const k of [1, 0.9, 0.82]) {
      const sz = Math.round(size * k);
      if (textWidth(head, sz) <= width && textWidth(tail, sz) <= width) return { lines: [head, tail], size: sz };
    }
  }
  return { lines: plain, size };
}

/**
 * A LaTeX term's width in em, estimated (KaTeX lays it out only in a browser, and layout is pure):
 * a fraction is as wide as its wider part, a power or index is small, a command is one symbol, and
 * the operators carry KaTeX's spacing. The renderer fits the real typesetting into this slot.
 */
export function texEm(s: string, script = false): number {
  // A matrix is as wide as its widest cell in each column, plus the brackets (maths benchmark round 2:
  // matrices measured as one long line of text overlapped the rows around them).
  const env = /\\begin\{([pbvBV]?matrix)\}([\s\S]*?)\\end\{\1\}/.exec(s);
  if (env) {
    const rows = env[2].split(/\\\\/).map((r) => r.split("&").map((c) => texEm(c.trim(), script)));
    const cols = Math.max(1, ...rows.map((r) => r.length));
    let mw = 0.9;
    for (let c = 0; c < cols; c++) mw += Math.max(0, ...rows.map((r) => r[c] ?? 0)) + 0.55;
    return mw + texEm(s.slice(0, env.index) + s.slice(env.index + env[0].length), script);
  }
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
      else if (name === "binom") w += Math.max(texEm(group(), true), texEm(group(), true)) * 0.72 + 0.9;
      else if (name === "sqrt") {
        if (s[i] === "[") i = s.indexOf("]", i) < 0 ? s.length : s.indexOf("]", i) + 1;
        w += texEm(group()) + 0.75;
      } else if (["text", "mathrm", "textbf", "mathbf", "operatorname", "textit"].includes(name)) w += textWidth(group(), 1) * 1.18;
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
      // KaTeX's italic maths letters are wider than the board font the estimate is made with: at 1.05
      // a row of terms overprinted ("B(n, p)Binomial"; diagram lab, 2026-10-17).
      w += textWidth(c, 1) * (/[A-Za-z]/.test(c) ? 1.25 : 1.1);
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
  // 48 terms: a worked calculation of four lines needs more than 16, and the rows shrink to fit
  // (a circuits board lost its "= 6 V" to the old limit of 16; 2026-10-18).
  // 96 terms: a derivation written one line per step runs to ten lines, over pages (below).
  const tokens = stage.tokens.slice(0, 96);
  if (stage.tokens.length > 96) recordLayoutDrop(`the equation has ${stage.tokens.length} terms; only 96 fit, so ${stage.tokens.slice(96).map((t) => t.text).join(" ")} was left off`);
  const steps = stage.steps.length ? stage.steps : [{ s: 0, order: tokens.map((t) => t.id) }];
  const hosted = new Map(tokens.filter((t) => t.on && tokens.some((h) => h.id === t.on && !h.on)).map((t) => [t.id, t.on as string]));
  const inRow = (id: string) => !hosted.has(id);
  // A sign on its own is typeset without the spacing it gets inside an expression: just its glyph.
  const em = new Map(tokens.map((t) => [t.id, t.tex ? (/^\s*(?:[=+<>−-]|\\times|\\cdot|\\to|\\rightarrow)\s*$/.test(t.tex) ? 0.8 : texEm(t.tex)) : textWidth(t.text, 1)]));
  const maxW = box.w - 40;
  const gapEm = 12 / 44;
  const rows = steps.map((step) => step.order.filter((id) => em.has(id) && inRow(id)));
  const rowEm = (row: string[]) => row.reduce((w, id) => w + em.get(id)!, 0) + gapEm * Math.max(0, row.length - 1);
  // ONE EQUATION PER LINE (QA batch 4, 2026-10-21: "x + y = 10, y = 10 and y = 2x + 1, x + 2x + 1 = 10"
  // on one line): where a step joins whole equations with ",", ";", "and", "so", "then", each equation
  // starts its own line — the comma stays at the end of a line, the joining word starts the next.
  const textOf = (id: string) => (tokens.find((t) => t.id === id)?.text ?? "").trim();
  const clauses = (row: string[]): string[][] => {
    const out: string[][] = [];
    let cur: string[] = [];
    row.forEach((id, i) => {
      const t = textOf(id);
      const restHasEq = row.slice(i + 1).some((r) => /^[=≈]$/.test(textOf(r)));
      const curHasEq = cur.some((c) => /^[=≈]$/.test(textOf(c)));
      // The comma that joined two equations is not written once each has its own line (a line ending
      // in "," read as unfinished; maths benchmark R5).
      if (/^[,;]$/.test(t) && curHasEq && restHasEq) { out.push(cur); cur = []; return; }
      if (/^(?:and|so|then|therefore|hence|giving|gives)$/i.test(t) && curHasEq && restHasEq) { out.push(cur); cur = [id]; return; }
      cur.push(id);
    });
    if (cur.length) out.push(cur);
    return out.filter((c) => c.length);
  };
  const widest = Math.max(1, ...rows.flatMap(clauses).map(rowEm));
  // One line as large as fits (down to 26); a step still too wide goes onto two lines, and the size
  // then fits the widest LINE (down to 18) — a long equation shrinks or wraps, never overflows.
  let size = Math.max(26, Math.min(46, Math.floor(maxW / widest)));
  const breakOf = (id: string): 0 | 1 | 2 => {
    const text = tokens.find((t) => t.id === id)?.text ?? "";
    return /^[=→⇌]$/.test(text) ? 2 : /^[+−-]$/.test(text) ? 1 : 0;
  };
  const wrapAt = (sz: number) => rows.map((row) => clauses(row).flatMap((c) => wrapRow(c, (id) => em.get(id)! * sz, breakOf, maxW, gapEm * sz)));
  let lined = wrapAt(size);
  const widestLine = Math.max(1, ...lined.flat().map(rowEm));
  if (widestLine * size > maxW) {
    size = Math.max(18, Math.floor(maxW / widestLine));
    lined = wrapAt(size);
  }
  const gap = gapEm * size;
  const small = Math.round(size * 0.5);
  const center = box.x + box.w / 2;
  const tall = tokens.some((t) => /\\[dt]?frac|\\sqrt|\\binom|matrix\}/.test(t.tex ?? ""));
  // A matrix row is two or three lines high: its rows need that much room (maths benchmark round 2).
  const matrixRows = Math.max(0, ...tokens.map((t) => (/matrix\}/.test(t.tex ?? "") ? (t.tex!.match(/\\\\/g)?.length ?? 0) + 1 : 0)));
  const tallK = matrixRows >= 2 ? 1.15 + 0.85 * matrixRows : tall ? 1.95 : 0;
  const lineGap = size * (tallK || 1.6);
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
    const rowSize = Math.max(16, Math.min(size, Math.floor((box.h - 20) / (rowsN * (tallK || 1.55)))));
    // A step that adds no new term (the same "−GM/r" again, for "Earth values") is not written out
    // again: the working showed one line three times (QA 2026-10-17). It highlights its terms instead.
    const seenIds = new Set<string>();
    const writes = steps.map((step) => { const own = step.order.filter(inRow); const adds = own.some((id) => !seenIds.has(id)); own.forEach((id) => seenIds.add(id)); return adds; });
    // A step that repeats the line before and adds to it ("log₂(32 ÷ 4) = … = 3", then the same line
    // ", log_b(M/N) = …") writes only what it adds: the line was written twice (maths benchmark V4).
    const added = rows.map((row, k) => {
      const prev = k > 0 ? rows[k - 1] : [];
      if (!prev.length || row.length <= prev.length || !prev.every((id, i) => row[i] === id)) return row;
      const rest = row.slice(prev.length);
      while (rest.length && /^[,;]$/.test(textOf(rest[0]))) rest.shift();
      return rest.length ? rest : row;
    });
    // THE BOARD IS WIPED WHEN FULL (owner, 2026-10-22: "clear that board to fit it in"). Every line of
    // a long derivation is written at a readable size: when the working no longer fits at PAGE_MIN,
    // it goes over pages — a page is wiped when the next one starts, like a teacher's board, and the
    // lines of one sentence always share a page. Shrinking everything onto one page wrote ten lines
    // of working at 16 px.
    // Beside a figure the column is half the board: a little smaller text keeps the working on one page.
    const PAGE_MIN = box.w < 600 ? 22 : 26;
    const linesAt = (sz: number) => added.map((row, k) => (writes[k] ? clauses(row).flatMap((c) => wrapRow(c, (id) => em.get(id)! * sz, breakOf, maxW, gapEm * sz)) : []));
    type Page = { steps: number[]; size: number };
    let pages: Page[];
    // One page whenever some readable size fits it: lines wrapped at the largest size counted too many
    // (a four-line calculation beside its triangle was paged and ended showing only "A = 27.0").
    const k1 = tallK || 1.55;
    const fitsAt = (sz: number) => linesAt(sz).reduce((n, l) => n + l.length, 0) * sz * k1 <= box.h - 20;
    let onePage = rowSize >= PAGE_MIN ? rowSize : 0;
    for (let sz = Math.min(size, 46); !onePage && sz >= PAGE_MIN; sz -= 2) if (fitsAt(sz)) onePage = sz;
    if (onePage || steps.length < 2) pages = [{ steps: steps.map((_, k) => k), size: onePage || rowSize }];
    else {
      // Pages at the smallest readable size hold the most lines: at 34 px a long line wrapped to fill a
      // page by itself, and a seven-line proof became six pages (live test, 2026-10-22).
      const pageSize = PAGE_MIN;
      const perPage = Math.max(1, Math.floor((box.h - 20) / (pageSize * (tallK || 1.55))));
      const at = linesAt(pageSize);
      pages = [];
      let cur: number[] = [];
      let used = 0;
      // Steps of one sentence go together: a page wiped on the sentence it is written is never seen.
      const blocks: number[][] = [];
      steps.forEach((st, k) => (k > 0 && steps[k - 1].s === st.s ? blocks[blocks.length - 1].push(k) : blocks.push([k])));
      for (const block of blocks) {
        const n = block.reduce((t, k) => t + at[k].length, 0);
        if (cur.length && used + n > perPage) { pages.push({ steps: cur, size: pageSize }); cur = []; used = 0; }
        cur.push(...block);
        used += n;
      }
      if (cur.length) pages.push({ steps: cur, size: pageSize });
      // A page with more lines than fit (one sentence's long working) shrinks to fit, never below 18.
      for (const page of pages) {
        const n = page.steps.reduce((t, k) => t + at[k].length, 0);
        if (n * pageSize * (tallK || 1.55) > box.h - 20) page.size = Math.max(18, Math.floor((box.h - 20) / (n * (tallK || 1.55))));
      }
    }
    pages.forEach((page, p) => {
      const pSize = page.size;
      const pGap = pSize * (tallK || 1.55);
      const pGapEm = gapEm * pSize;
      const lines = linesAt(pSize);
      const next = pages[p + 1];
      const until = next ? steps[next.steps[0]].s : undefined;
      const height = page.steps.reduce((n, k) => n + lines[k].length, 0) * pGap;
      let y = box.y + (pages.length > 1 ? pSize : Math.max(pSize, (box.h - height) / 2 + pSize));
      const sized = tokens.map((t, i) => ({ ...measured[i], w: (em.get(t.id) ?? 0) * (hosted.has(t.id) ? Math.round(pSize * 0.5) : pSize), size: hosted.has(t.id) ? Math.round(pSize * 0.5) : pSize }));
      for (const k of page.steps) {
        const step = steps[k];
        if (!writes[k]) continue;
        const place: Record<string, Pt> = {};
        for (const line of lines[k]) {
          const total = line.reduce((w, id) => w + sized.find((t) => t.id === id)!.w, 0) + pGapEm * Math.max(0, line.length - 1);
          let x = center - total / 2;
          for (const id of line) { place[id] = { x, y }; x += sized.find((m) => m.id === id)!.w + pGapEm; }
          y += pGap;
        }
        for (const id of step.order.filter((o) => hosted.has(o))) {
          const host = place[hosted.get(id)!];
          const t = sized.find((m) => m.id === id)!;
          if (host) place[id] = { x: host.x + sized.find((m) => m.id === hosted.get(id))!.w / 2 - t.w / 2, y: host.y - pSize * 1.05 };
        }
        const own = sized.filter((t) => place[t.id]);
        marks.push({ type: "equation", id: k ? `equation-${k + 1}` : "equation", tokens: own, steps: [{ s: step.s, place, highlight: [] }], size: pSize, captionY: box.y + box.h + 400, center, s: step.s, ...(until !== undefined && until > step.s ? { until } : {}) });
        for (const t of own) if (!(t.id in place) || k === steps.findIndex((st) => st.order.includes(t.id))) add(t.id, { x: place[t.id].x - 4, y: place[t.id].y - t.size, w: t.w + 8, h: t.size * 1.3 }, step.s);
      }
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
      // Centred on the base line however many lines the step has; the caption goes under the last
      // (a three-line step had its caption written over its third line; maths benchmark round 4).
      const y = baseY + (n - (lines.length - 1) / 2) * lineGap;
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
  const below = twoLines ? ((Math.max(1, ...lined.map((l) => l.length)) - 1) / 2) * lineGap : 0;
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
  const itemAnchors = new Map<string, { left: Pt; right: Pt; s: number; col: number }>();
  // Columns as tall as what they hold, centred: two items in full-height columns left half of each
  // empty (audit 2026-10-17). Few items are written a little larger; many are written smaller until
  // they all fit inside their column (items used to run past its bottom edge), never dropped below six.
  const shownItems = (side: CompareStage["left"]) => side.items.slice(0, 6);
  const most = Math.max(...sides.map(({ side }) => shownItems(side).length), 1);
  // An item card is colW − 28 wide and its words start 16 px in on each side (CanvasPanel "item"), so
  // they wrap to colW − 60: wrapping to colW − 40 ran lines into the card's right border (audit 2026-10-17).
  const itemTextW = colW - 60;
  const itemH = (text: string, size: number) => wrap(text, size, itemTextW, 2).length * size * 1.3 + 22;
  const heightAt = (size: number) => Math.max(...sides.map(({ side }) => shownItems(side).reduce((sum, item) => sum + itemH(item.text, size) + 12, 0)));
  let size = most <= 3 ? 21 : 19;
  while (size > 14 && 92 + heightAt(size) + 20 > box.h - 10) size--;
  const contentH = heightAt(size);
  const colH = Math.min(box.h - 10, Math.max(220, 92 + contentH + 20));
  const top = box.y + Math.max(0, (box.h - 10 - colH) / 2);
  for (const [col, { side, x, color }] of sides.entries()) {
    const rect = { x, y: top, w: colW, h: colH };
    const firstS = Math.min(...side.items.map((i) => i.s), 99);
    marks.push({ type: "column", id: side.id, rect, title: side.title, icon: side.icon, color, s: Number.isFinite(firstS) ? Math.max(0, firstS - 1) : 0 });
    add(side.id, rect, Math.max(0, firstS - 1));
    let y = top + 92;
    for (const item of shownItems(side)) {
      const lines = wrap(item.text, size, itemTextW, 2);
      const h = lines.length * size * 1.3 + 22;
      const r = { x: x + 14, y, w: colW - 28, h };
      marks.push({ type: "item", id: item.id, text: lines.join("\n"), rect: r, color, s: item.s, size });
      add(item.id, r, item.s);
      itemAnchors.set(item.id, { left: { x: r.x, y: r.y + h / 2 }, right: { x: r.x + r.w, y: r.y + h / 2 }, s: item.s, col });
      y += h + 12;
    }
  }
  // A link always runs across the gap between the columns, from the left item's right edge to the
  // right item's left edge, whichever way the writer listed it: a link written right-to-left started
  // at the far edge of the right column and was drawn through the words of both (audit 2026-10-17).
  // Links inside one column, and links that would cross one already drawn, are left out.
  const drawn: Array<{ y0: number; y1: number }> = [];
  for (const [i, link] of (stage.links ?? []).entries()) {
    const a = itemAnchors.get(link.from);
    const b = itemAnchors.get(link.to);
    if (!a || !b || a.col === b.col) continue;
    const [l, r] = a.col === 0 ? [a, b] : [b, a];
    if (drawn.some((d) => (d.y0 - l.right.y) * (d.y1 - r.left.y) < 0)) continue;
    drawn.push({ y0: l.right.y, y1: r.left.y });
    marks.push({ type: "link", id: `link-${i}`, p0: l.right, p1: r.left, s: Math.max(a.s, b.s) });
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
  const lead = (text: string) => (stage.scheme === "levels" ? `▸ ${text}` : `✓ ${text}  [1]`);
  const lostLead = (text: string) => `✗ Loses marks: ${text}`;
  const command = `Command word: ${stage.commandWord}`;
  // Sizes are tried whole (nothing recorded, nothing cut) until everything fits the stage; only text
  // that does not fit even at the smallest size is shortened — and then it is recorded WITHOUT the
  // tick, "[1]" or "Loses marks:" around it, so the shorten pass can find it in the board and rewrite
  // it (the decorated text matched nothing, so exam cuts were never rewritten; audit 2026-10-17).
  const fit = (size: number) => {
    const q = wrapWhole(stage.question, size + 1, box.w - 150);
    const qH = q.length * (size + 1) * 1.3 + 24;
    const cmd = wrapWhole(command, Math.min(16, size), box.w - 20);
    const cmdH = cmd.length * Math.min(16, size) * 1.3 + 6;
    const rows = points.map((p) => wrapWhole(lead(p.text), size, colW - 36));
    const rowH = rows.map((r) => r.length * size * 1.3 + 20);
    const colsH = two ? Math.max(rowH.slice(0, Math.ceil(points.length / 2)).reduce((a, b) => a + b + 10, 0), rowH.slice(Math.ceil(points.length / 2)).reduce((a, b) => a + b + 10, 0)) : rowH.reduce((a, b) => a + b + 10, 0);
    const lost = stage.lostMarks ? wrapWhole(lostLead(stage.lostMarks.text), size, box.w - 36) : [];
    const lostH = lost.length ? lost.length * size * 1.3 + 20 : 0;
    return { size, q, qH, cmd, cmdH, rows, rowH, lost, lostH, total: qH + 8 + cmdH + colsH + (lostH ? lostH + 12 : 0) };
  };
  let f = fit(21);
  for (const size of [20, 19, 18, 17, 16, 15, 14, 13]) if (f.total > box.h) f = fit(size);
  if (f.total > box.h) {
    // Still too tall at 13 px: the longest pieces are shortened to the lines their share of the stage
    // holds, each recorded as its own plain text.
    const cap = (text: string, decorated: (t: string) => string, lines: string[], maxLines: number, w: number) => {
      if (lines.length <= maxLines) return lines;
      const room = Math.max(12, lines.slice(0, maxLines).join(" ").length - (decorated("").length));
      recordFigureCut(text, `${maxLines} line(s) of the exam board`, room);
      return wrapWhole(decorated(trimToFit(text, room)), f.size, w).slice(0, maxLines);
    };
    f.q = cap(stage.question, (t) => t, f.q, 6, box.w - 150);
    f.qH = f.q.length * (f.size + 1) * 1.3 + 24;
    f.rows = f.rows.map((r, i) => cap(points[i].text, lead, r, 3, colW - 36));
    f.rowH = f.rows.map((r) => r.length * f.size * 1.3 + 20);
    if (stage.lostMarks) {
      f.lost = cap(stage.lostMarks.text, lostLead, f.lost, 3, box.w - 36);
      f.lostH = f.lost.length * f.size * 1.3 + 20;
    }
  }
  let y = box.y;
  // The question, with its marks at the right as the paper prints them.
  const qRect = { x: box.x, y, w: box.w, h: f.qH };
  marks.push({ type: "item", id: "exam-question", text: f.q.join("\n"), rect: qRect, color: "#1d4ed8", s: 0, size: f.size + 1 });
  add("exam-question", qRect, 0);
  const marksRect = { x: box.x + box.w - 120, y: y + 6, w: 110, h: 30 };
  marks.push({ type: "text", id: "exam-marks", text: `[${stage.marks} mark${stage.marks === 1 ? "" : "s"}]`, rect: marksRect, color: markInk, s: 0, size: 18 });
  add("exam-marks", marksRect, 0);
  y += f.qH + 8;
  // The command word and what it asks for, wrapped rather than run past the board's edge.
  const cmdSize = Math.min(16, f.size);
  const lineH = cmdSize * 1.3;
  f.cmd.forEach((line, i) => {
    const w = Math.min(box.w, textWidth(line, cmdSize) + 20);
    marks.push({ type: "text", id: i ? `command-word-${i + 1}` : "command-word", text: line, rect: { x: box.x, y: y + i * lineH, w, h: lineH + 2 }, color: markInk, s: 0, size: cmdSize });
  });
  add("command-word", { x: box.x, y, w: Math.min(box.w, Math.max(...f.cmd.map((l) => textWidth(l, cmdSize))) + 20), h: f.cmdH - 4 }, 0);
  y += f.cmdH;
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

/**
 * A scene of cards as a tidy diagram (owner, 2026-10-18: "chain or tidy grid"): cards joined in order
 * become a chain; one card most of the others connect to becomes the hub, the rest around it; anything
 * else a neat grid, with linked cards side by side so their arrows stay short. Laid out by the flow
 * layout, so every card in a row is the same size and nothing floats. Null for a scene that is not a
 * board of cards (pictures, text, more than seven items).
 */
export function tidyCards(stage: SceneStage): FlowStage | null {
  const items = stage.items;
  if (items.length < 2 || items.length > 7 || items.some((it) => it.kind === "text")) return null;
  if (items.filter((it) => it.kind === "box").length < Math.ceil(items.length / 2)) return null;
  const ids = new Set(items.map((it) => it.id));
  const arrows = stage.arrows.filter((a) => ids.has(a.from) && ids.has(a.to) && a.from !== a.to);
  const out = new Map<string, number>(), into = new Map<string, number>();
  for (const a of arrows) { out.set(a.from, (out.get(a.from) ?? 0) + 1); into.set(a.to, (into.get(a.to) ?? 0) + 1); }
  const degree = (id: string) => (out.get(id) ?? 0) + (into.get(id) ?? 0);
  const node = (it: SceneStage["items"][number], role?: FlowNode["role"]): FlowNode => ({
    id: it.id, label: it.label ?? "", ...(it.detail ? { sub: it.detail } : {}), ...(it.kind === "icon" && it.icon ? { icon: it.icon } : {}), ...(it.color ? { color: it.color } : {}), ...(role ? { role } : {}), s: it.s, ...(it.becomes ? { becomes: it.becomes } : {}),
  });
  // A chain first: the arrows run through every card but at most one, from a card nothing points to.
  const next = new Map(arrows.map((a) => [a.from, a.to]));
  const start = items.find((it) => out.has(it.id) && !into.has(it.id));
  const order: string[] = [];
  for (let at = start?.id; at && !order.includes(at); at = next.get(at)) order.push(at);
  const byId = new Map(items.map((it) => [it.id, it]));
  if (order.length >= Math.max(2, items.length - 1)) {
    for (const it of items) if (!order.includes(it.id)) order.push(it.id);
    return { kind: "flow", arrangement: "chain", nodes: order.map((id) => node(byId.get(id)!)), arrows };
  }
  // The hub: one card joined to three or more, with every other card (but at most one) joined to it
  // and at most three on each side of it.
  const hub = [...items].sort((a, b) => degree(b.id) - degree(a.id))[0];
  const joined = new Set(arrows.flatMap((a) => (a.from === hub.id ? [a.to] : a.to === hub.id ? [a.from] : [])));
  const outputs = new Set(arrows.filter((a) => a.from === hub.id).map((a) => a.to));
  if (joined.size >= 3 && joined.size >= items.length - 2 && outputs.size <= 3 && items.length - 1 - outputs.size <= 3) {
    return { kind: "flow", arrangement: "inputs-core-outputs", nodes: items.map((it) => node(it, it.id === hub.id ? "core" : outputs.has(it.id) ? "output" : "input")), arrows };
  }
  return null;
}

/**
 * Any other board of cards on an even grid: equal cells, two columns for up to four cards, three for
 * more, rows spread down the board, cards that an arrow joins placed next to each other. Pictures,
 * text and big diagrams keep the writer's own cells.
 */
export function tidyGrid(stage: SceneStage): SceneStage {
  const items = stage.items;
  // Up to six: two rows of tall cards keep every card's detail whole. Seven or more on a 4-row grid cut
  // details to one word ("More", "Above" — photoelectric evidence board, 2026-10-18); they keep the
  // writer's own cells.
  if (items.length < 2 || items.length > 6 || items.some((it) => it.kind === "text") || items.filter((it) => it.kind === "box").length < items.length - 2) return stage;
  // Linked cards first, in arrow order, so each arrow joins neighbours.
  const order: typeof items = [];
  for (const a of stage.arrows) for (const id of [a.from, a.to]) { const it = items.find((x) => x.id === id); if (it && !order.includes(it)) order.push(it); }
  for (const it of items) if (!order.includes(it)) order.push(it);
  const cols = order.length <= 4 ? 2 : 3;
  const rows = Math.ceil(order.length / cols);
  // Columns of two cells each (A, C, E) or a 2-wide pair centred (B, D); rows spread over the four.
  const colCells = cols === 2 ? ["B", "D"] : ["A", "C", "E"];
  const rowCells = rows === 1 ? [2] : [1, 3];
  // Snake order (the second row runs right to left), so cards next in the arrows' order stay neighbours.
  return { ...stage, items: order.map((it, i) => { const row = Math.floor(i / cols); const col = row % 2 ? cols - 1 - (i % cols) : i % cols; return { ...it, cell: `${colCells[col]}${rowCells[row]}`, span: rows === 1 ? "2x1" : "2x2" }; }) };
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
  // A BOARD OF CARDS IS LAID OUT TIDILY, not where the writer dropped each one: floating cards, cards
  // touching and a seven-card collage with two arrows (enzyme and photoelectric boards, 2026-10-18).
  const tidy = tidyCards(stage);
  if (tidy) {
    layoutFlow(tidy, box, marks, add);
    return;
  }
  const gridded = tidyGrid(stage);
  // A tidied grid leaves a gutter round every card: room for the arrows between neighbours, which
  // were dropped when the cards touched.
  const gutter = gridded !== stage ? { x: 20, y: 10 } : { x: 0, y: 0 };
  stage = gridded;
  const centres = new Map<string, { c: Pt; r: number; below?: number }>();
  const itemMarks: Mark[] = [];
  // NO TWO ITEMS SHARE A CELL. The writer gave a 2x2 "Villus" card over the cell of "Central lacteal",
  // and the two cards printed over each other (diagram lab, 2026-10-17). A card that would cover an
  // earlier one moves to the nearest free place of its size, then shrinks to one cell if it must.
  const taken = new Set<string>();
  const cellsOf = (col: number, row: number, w: number, h: number) => { const out: string[] = []; for (let c = col; c < col + w; c++) for (let r = row; r < row + h; r++) out.push(`${c},${r}`); return out; };
  const placed = stage.items.slice(0, 12).map((item) => {
    const m = /^([A-F])([1-4])$/i.exec(item.cell.trim());
    const col = m ? m[1].toUpperCase().charCodeAt(0) - 65 : 0, row = m ? Number(m[2]) - 1 : 0;
    const sp = /^([1-6])x([1-4])$/.exec(item.span ?? "") ?? ["", "1", "1"];
    const tries: Array<[number, number, number, number]> = [];
    for (const [w, h] of [[Number(sp[1]), Number(sp[2])], [Math.min(2, Number(sp[1])), 1], [1, 1]] as Array<[number, number]>) {
      const order: Array<[number, number]> = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) order.push([c, r]);
      order.sort((a, b) => Math.hypot(a[0] - col, a[1] - row) - Math.hypot(b[0] - col, b[1] - row));
      for (const [c, r] of order) if (c + w <= 6 && r + h <= 4) tries.push([c, r, w, h]);
    }
    const spot = tries.find(([c, r, w, h]) => cellsOf(c, r, w, h).every((k) => !taken.has(k))) ?? [col, row, Number(sp[1]), Number(sp[2])];
    for (const k of cellsOf(...spot)) taken.add(k);
    return { ...item, cell: `${String.fromCharCode(65 + spot[0])}${spot[1] + 1}`, span: `${spot[2]}x${spot[3]}` };
  });
  placed.forEach((item, i) => {
    const cell = sceneCell(item.cell, item.span, box);
    const rect = { x: cell.x + gutter.x, y: cell.y + gutter.y, w: cell.w - 2 * gutter.x, h: cell.h - 2 * gutter.y };
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
      // A title that wraps ("Supply / voltage" in a narrow cell) takes room from the detail below it:
      // counted, the detail no longer spills out of the card onto the next one (2026-10-18).
      const title = item.label ? fitText(item.label, rect.w - 16, 18, 13) : null; // as the card draws it (CanvasPanel)
      const titleExtra = title ? (title.lines.length - 1) * title.size * 1.15 : 0;
      const fit = !item.icon && item.detail ? fitDetail(item.detail, rect.w - 24, rect.h - 60 - titleExtra) : undefined;
      const detail = fit?.lines;
      // A card is as tall as what it says, centred in its cells: a two-row box holding one line left
      // most of itself empty (audit 2026-10-17). Icon boxes keep their room for the icon.
      const needed = item.icon ? rect.h : Math.max(64, 46 + titleExtra + (detail?.length ?? 0) * (fit?.size ?? 15) * 1.27 + 14);
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
