/**
 * A BOARD FOR A QUESTION, MADE LIKE THE LECTURE'S OWN (owner, 2026-11-11: "the slide drawn by Aria upon
 * asking a question should have the same quality as the original boards").
 *
 * The voice tutor's show_board used to go to the old free-form sketch pipeline (/api/explain), so a slide
 * asked for mid-lecture looked far worse than the canvas boards around it. Here the question is planned as
 * ONE canvas board (lib/canvas/prompts.ts CANVAS_PLAN_PROMPT, which already says a question one board can
 * answer is one board) and written by writeCanvasBoard — the same board types, code-placed layout,
 * reviews and CS checks — in its fast mode (the owner's choice): one review, no polish rewrites, and no
 * headless look, so it arrives in about a minute while Aria answers in words.
 */
import { createOpenAI } from "../openaiClient";
import { findLibraryFigure } from "../figures/library";
import type { Beat } from "../lessonContent";
import { jsonCall, PLAN_MODEL } from "./generate";
import { mathsPicturesOn } from "./mathsPicture";
import { validatePlan } from "./plan";
import { writeCanvasBoard } from "./progressive";
import { CANVAS_PLAN_PROMPT } from "./prompts";
import type { SubjectDomain } from "./subjectDomain";
import { classifySubjectDomain } from "./subjectDomainClassifier";
import { applyLessonVisualPolicy } from "./visualPolicy";

export type QuestionBoardInput = {
  userId: string;
  /** The lecture's session, when the player knows it (its beat keys). Pictures are filed under it. */
  sessionId?: string;
  /** The lecture's topic. */
  topic: string;
  question: string;
  lessonContext?: string;
  /** What is on the board the student is looking at. */
  beatContext?: string;
  /** What the last board drawn for a question explained. */
  previousBoard?: string;
  /** Already known (the lecture's subject); asked of the classifier otherwise. */
  subjectDomain?: SubjectDomain;
};

/** The planner's request for one board that answers the question inside the lesson. */
export function questionPlanRequest(input: QuestionBoardInput): string {
  return [
    `Topic: ${input.question}`,
    `This is ONE board, drawn during a lecture on "${input.topic}" because the student asked: "${input.question}".`,
    "Plan exactly ONE board that answers this question completely: no opening map, no recap, no refresher, no check board. Use the lesson's own terms and its running example.",
    input.lessonContext ? `What the lecture covers:\n${input.lessonContext.slice(0, 3500)}` : "",
    input.beatContext ? `The board on screen when they asked:\n${input.beatContext.slice(0, 1500)}` : "",
    input.previousBoard ? `The last board drawn for a question explained: "${input.previousBoard.slice(0, 800)}" — do not repeat it.` : "",
  ].filter(Boolean).join("\n\n");
}

/** The lecture-quality board, or null when it could not be made (the caller keeps its old path). */
export async function writeQuestionBoard(input: QuestionBoardInput): Promise<{ script: string; draw: NonNullable<Beat["draw"]>; costUsd: number; log: string[] } | null> {
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let costUsd = 0;
  const subject = input.subjectDomain
    ? { domain: input.subjectDomain, costUsd: 0 }
    : await classifySubjectDomain(`${input.topic} — ${input.question}`).catch(() => ({ domain: undefined as SubjectDomain | undefined, costUsd: 0 }));
  costUsd += subject.costUsd;
  const planned = await jsonCall(openai, PLAN_MODEL, CANVAS_PLAN_PROMPT, questionPlanRequest(input), 6000);
  costUsd += planned.costUsd;
  const plan = validatePlan(planned.json);
  const chosen = plan?.beats.find((b) => !b.overview && !b.refresher && b.stage !== "exam") ?? plan?.beats[0];
  if (!chosen) return null;
  const beat = { ...chosen, id: `q${Date.now().toString(36)}`, overview: false, refresher: undefined };
  const policy = applyLessonVisualPolicy([beat], { mode: "prompt", findAsset: findLibraryFigure, topic: input.topic, domain: subject.domain, mathsPictures: mathsPicturesOn() });
  const written = await writeCanvasBoard({
    userId: input.userId,
    sessionId: input.sessionId ?? `question-${Date.now().toString(36)}`,
    topic: input.topic,
    plan: policy.beats,
    index: 0,
    earlier: [],
    notes: [],
    typedPrompt: true,
    subjectDomain: subject.domain,
    hurry: () => true,
    opening: true,
    skipLook: true,
  });
  costUsd += written.costUsd;
  // The plain backup board is no better than the old path: the caller draws it the old way instead.
  if (written.fallback || !written.beat.draw) return null;
  return { script: written.beat.script, draw: written.beat.draw, costUsd, log: written.log };
}
