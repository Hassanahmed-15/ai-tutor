import { normalizeMath, orderNotesAsSaid, spokenIsWritten, tidyNotes } from "./equationCheck";
import { equationTerms, plainTex } from "./equationRepair";
import type { MathsProblem } from "./mathsCheck";
import { checkNumbers } from "./numberCheck";
import type { CanvasBoardSpec, EquationStage } from "./types";

/**
 * WHAT ARIA SAYS IS WRITTEN. The owner watched a derivatives lecture in which Aria worked
 * "[(2 + h)² − 2²] divided by h … then 4 + h after cancelling" while the board showed only
 * "f(x) = x²" and the result (2026-10-22: "a lot of working which Aria speaks and never writes").
 * The writer drops working it said, and the code only finds spoken maths that has an "=".
 *
 * The maths examiner (lib/canvas/mathsCheck.ts) reads every sentence against the board and lists
 * each missing step as the exact line to write. Code writes it at the sentence that says it — a row
 * of an equation board, else a note — so it appears as she says it. No rewrite, no extra model call.
 * A line that is not sound maths (an open bracket, a line ending on a sign, false arithmetic, too
 * long for the board) is not written; it stays a problem for the writer.
 */

const MISSING = /not-written|skipped-step/;

/** A fault the board fixes by writing a line in: a step said but not shown, or a jump in the working. */
export function isMissingLine(kind: string): boolean {
  return MISSING.test(kind);
}
const NOTE_MAX = 48;
const NOTES_CAP = 12;

/** Is this a line the board can show as it stands? */
export function soundLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  if (!/[\d=<>≤≥≈→∫√²³^+×÷−-]/.test(t)) return false;
  if (/^[+×÷=*/·≈<>≤≥]/.test(t) || /[+×÷=*/·−≈<>≤≥-]$/.test(t)) return false;
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
    let depth = 0;
    for (const ch of t) {
      if (ch === open) depth++;
      else if (ch === close && --depth < 0) return false;
    }
    if (depth !== 0) return false;
  }
  return checkNumbers(t).length === 0;
}

/** Writes one line into an equation stage at its sentence: joined to that sentence's row, else a new row. */
function writeRow(stage: EquationStage, sentence: number, line: string, k: number): boolean {
  const ids = equationTerms(line).map((term, j) => {
    const id = `said-line-${sentence}-${k}-${j}`;
    const tex = plainTex(term);
    stage.tokens.push(tex ? { id, text: term, tex } : { id, text: term });
    return id;
  });
  if (!ids.length) return false;
  const step = stage.steps.find((st) => st.s === sentence);
  if (step) {
    const sep = `said-line-${sentence}-${k}-sep`;
    stage.tokens.push({ id: sep, text: ",", tex: ",\\quad" });
    step.order = [...step.order, sep, ...ids];
  } else {
    stage.steps.push({ s: sentence, order: ids, highlight: [] });
    stage.steps.sort((a, b) => a.s - b.s);
  }
  return true;
}

/**
 * Writes the examiner's missing lines into `spec` (in place). Returns how many it wrote and the
 * missing-line problems it could not write (they go back to the writer like any other fault).
 */
export function writeMissingLines(spec: CanvasBoardSpec, problems: MathsProblem[], script: string, sentenceCount: number): { written: number; left: MathsProblem[] } {
  const left: MathsProblem[] = [];
  let written = 0;
  const shownNow = () => {
    const out = spec.notes.map((n) => normalizeMath(n.text));
    if (spec.stage.kind === "equation") {
      const stage = spec.stage;
      const text = new Map(stage.tokens.map((t) => [t.id, t.text]));
      out.push(...stage.steps.map((st) => normalizeMath(st.order.map((id) => text.get(id) ?? "").join(""))));
    }
    return out;
  };
  for (const p of problems) {
    if (!MISSING.test(p.kind)) continue;
    const line = (p.line ?? "").replace(/\s+/g, " ").trim();
    const sentence = Math.max(0, Math.min(sentenceCount - 1, p.sentence ?? sentenceCount - 1));
    if (!soundLine(line)) { left.push(p); continue; }
    if (spokenIsWritten(line, shownNow())) continue;
    if (spec.stage.kind === "equation") {
      if (writeRow(spec.stage, sentence, line, written)) written++;
      else left.push(p);
    } else if (line.length <= NOTE_MAX && spec.notes.length < NOTES_CAP) {
      spec.notes.push({ id: `said-line-${written + 1}`, text: line, s: sentence });
      written++;
    } else left.push(p);
  }
  if (written) spec.notes = orderNotesAsSaid(tidyNotes(spec.notes), script);
  return { written, left };
}
