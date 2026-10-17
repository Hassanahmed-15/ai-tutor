import { keyPointTaught } from "./courseCoverage";
import { trimToFit } from "../text/fit";
import { canvasSentences } from "./plan";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * THE EXAM-PRACTICE BOARD, built by code from the lesson's mark scheme (lib/curriculum/lessonSpec.ts
 * examPractice) and what Aria says over it. No model writes it, so the question, its marks and the
 * marking points are exactly the spec's: each point is ticked on the sentence that says it.
 */

/** What each command word asks of a candidate, as Cambridge International defines them. */
export const COMMAND_WORD_MEANING: Record<string, string> = {
  state: "give a short answer — no explanation needed",
  define: "give the precise meaning",
  identify: "name or point out the thing asked for",
  label: "name the parts on the diagram",
  describe: "say what it is like or what happens, step by step",
  outline: "give the main points briefly",
  explain: "give reasons — say why or how, with linked steps",
  suggest: "apply what you know to a new situation",
  calculate: "work out a number — show the working and the unit",
  determine: "work out the answer from the data given",
  "show that": "prove the given result — every step of working",
  compare: "give similarities and differences of both",
  discuss: "give arguments on both sides",
  assess: "weigh up how important or successful it is",
  evaluate: "judge strengths and weaknesses and reach a conclusion",
  analyse: "break it down and show how the parts are linked",
  justify: "support a decision or conclusion with evidence",
  prepare: "set out the statement in its proper format",
  recommend: "advise on a course of action, with reasons",
};

export function commandMeaning(word: string): string | undefined {
  const w = word.trim().toLowerCase();
  return COMMAND_WORD_MEANING[w] ?? Object.entries(COMMAND_WORD_MEANING).find(([k]) => w.startsWith(k))?.[1];
}

export type ExamBlock = { commandWord: string; question: string; marks: number; markPoints: string[]; lostMarks: string; levels?: Array<{ level: string; marks: string; descriptor: string }> };

export function examBoardSpec(beat: Pick<CanvasPlanBeat, "title" | "script">, exam: ExamBlock): CanvasBoardSpec {
  const sentences = canvasSentences(beat.script);
  const last = Math.max(0, sentences.length - 1);
  // Each marking point appears on the first sentence that says it (after the question is read);
  // a point Aria never says outright is spread across the answer in order, never all at once.
  let floor = Math.min(1, last);
  // An essay marked by levels shows its bands, top first; a points question its marking points.
  const rows = exam.levels?.length ? exam.levels.map((l) => trimToFit(`${l.level} (${l.marks}): ${l.descriptor}`, 120)) : exam.markPoints;
  const points = rows.map((text, i) => {
    // Marking points are said in order: each is looked for after the previous one first.
    const after = sentences.findIndex((s, k) => k >= floor && keyPointTaught(text, s));
    const said = after >= 0 ? after : sentences.findIndex((s, k) => k >= Math.max(1, floor - 1) && keyPointTaught(text, s));
    const s = said >= 0 ? said : Math.min(last, floor);
    floor = Math.min(last, s + 1);
    return { id: `mark-${i + 1}`, text, s };
  });
  const lostAt = exam.lostMarks ? sentences.findIndex((s) => /\b(lose|lost|losing|marks?|examiners?|mistake|common error|careful)\b/i.test(s) && keyPointTaught(exam.lostMarks, s)) : -1;
  const meaning = commandMeaning(exam.commandWord);
  return {
    v: 1,
    heading: beat.title.slice(0, 40) || "Exam practice",
    notes: [],
    stage: {
      kind: "exam",
      commandWord: meaning ? `${exam.commandWord} = ${meaning}` : exam.commandWord,
      question: exam.question,
      marks: exam.levels?.length ? exam.marks : exam.markPoints.length,
      ...(exam.levels?.length ? { scheme: "levels" as const } : {}),
      points,
      ...(exam.lostMarks ? { lostMarks: { id: "lost-marks", text: exam.lostMarks, s: lostAt >= 0 ? lostAt : last } } : {}),
    },
    cues: points.map((p) => ({ s: p.s, at: 0.2, action: "point" as const, target: p.id })),
  };
}
