import { graphIssues } from "./graphCheck";
import { layoutPanel } from "./layout";
import { layoutIssues } from "./layoutQa";
import { checkNumbers, numberIssuesText } from "./numberCheck";
import { predictionRevealIssues, quizMatchesPrediction } from "./predict";
import { quizIssues } from "./quizLint";
import { semanticBoardIssues } from "./semanticGate";
import { critiqueStudentBoard, labelTexts } from "./studentCritic";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";
import { vseprIssues } from "./vsepr";

export type BoardReleaseFinding = { gate: "semantic" | "student-view" | "numbers" | "molecule" | "prediction" | "graph" | "quiz" | "layout"; message: string };

/** One authoritative release audit, used for generated boards and deterministic fallbacks alike. */
export function auditBoardForRelease(spec: CanvasBoardSpec, beat: CanvasPlanBeat): BoardReleaseFinding[] {
  const findings: BoardReleaseFinding[] = [];
  const add = (gate: BoardReleaseFinding["gate"], messages: string[]) => messages.forEach((message) => findings.push({ gate, message }));
  add("semantic", semanticBoardIssues(spec, beat));
  add("student-view", critiqueStudentBoard(spec, beat).issues);
  const interactionText: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") interactionText.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(spec.interaction);
  const arithmetic = [...labelTexts(spec), ...interactionText].flatMap((text) => checkNumbers(text));
  if (arithmetic.length) add("numbers", [`wrong numbers on the board: ${numberIssuesText(arithmetic)}`]);
  if (spec.stage.kind === "molecule") add("molecule", vseprIssues(spec.stage));
  add("prediction", predictionRevealIssues(spec, beat));
  if (beat.teachingCycle && spec.interaction?.kind === "quiz") {
    const sentences = beat.script.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    const match = quizMatchesPrediction(spec.interaction.question, sentences[beat.teachingCycle.predict] ?? "");
    if (!match.ok) add("prediction", [match.why ?? "the quiz asks a different question from the spoken prediction"]);
  }
  if (spec.stage.kind === "graph") add("graph", graphIssues(spec.stage, spec.interaction?.kind === "try" ? Object.fromEntries(spec.interaction.controls.map((control) => [control.var, control.value])) : {}));
  add("quiz", quizIssues(spec.interaction, `${beat.title} ${beat.brief} ${beat.script}`));
  if (spec.stage.kind === "scene" || spec.stage.kind === "flow") add("layout", layoutIssues(layoutPanel(spec), spec));
  return findings;
}
