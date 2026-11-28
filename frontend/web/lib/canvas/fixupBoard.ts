/**
 * A FIX-UP BOARD AFTER A WRONG ANSWER (owner, 2026-11-26: "if a user gives a wrong answer to a question, make a
 * separate board for this"). The lecture's plan used to be fixed: a wrong answer to a board's "Check it" card got
 * one spoken line and the lesson carried on as planned.
 *
 * Now the board that asked is followed by ONE extra board that: names the tempting wrong idea behind the wrong
 * options and why it does not hold (refutation: specific feedback beats "the answer is B" — Shute 2008); teaches
 * the idea again from a DIFFERENT angle, a new example or analogy, never the board's own words again; and ends with
 * a new "Check it" question on the same idea. Written like the lecture's own boards (writeCanvasBoard), in its fast
 * mode, like a requested slide (lib/canvas/questionBoard.ts).
 *
 * It is started when the board with the question begins (the player's speculative request), so it is usually
 * ready by the time the student has answered; when the answer is right it is simply not shown.
 */
import { createOpenAI } from "../openaiClient";
import { findLibraryFigure } from "../figures/library";
import type { Beat } from "../lessonContent";
import { bounded, jsonCall, PLAN_MODEL } from "./generate";
import { checkExplanations } from "./explanationCheck";
import { mathsPicturesOn } from "./mathsPicture";
import { canvasSentences, validatePlan } from "./plan";
import { pitchScripts, writeCanvasBoard } from "./progressive";
import { CANVAS_PLAN_PROMPT } from "./prompts";
import type { SubjectDomain } from "./subjectDomain";
import { applyLessonVisualPolicy } from "./visualPolicy";

export type FixupInput = {
  userId: string;
  sessionId: string;
  topic: string;
  /** The board that asked: its title and what Aria said on it. */
  board: { title: string; script: string };
  question: string;
  options: Array<{ text: string; correct: boolean; feedback?: string }>;
  /** The lecture's boards, for its running example and terms. */
  lessonContext?: string;
  subjectDomain?: SubjectDomain;
  /** The lecture's own reading grade (its boards' narration, measured): the fix-up board is worded no harder. */
  readingGrade?: number;
};

/** The planner's request for the one fix-up board. Pure (tested). */
export function fixupPlanRequest(input: FixupInput): string {
  const right = input.options.find((o) => o.correct)?.text ?? "";
  // An order question's wrong option is only "another order": it names no idea to refute (QA, 2026-11-26: the
  // board said "It is easy to think another order works").
  const wrong = input.options.filter((o) => !o.correct && !/^\s*(?:another|a different|any other) order\s*$/i.test(o.text));
  const mistake = wrong.length
    ? `The wrong options, each a tempting idea that does not hold:\n${wrong.map((o) => `- "${o.text}"${o.feedback ? ` — ${o.feedback}` : ""}`).join("\n")}`
    : "The student put the steps in the wrong order: say why each step must come where it does (what it needs from the step before it), and never call the mistake \"another order\".";
  return [
    `Topic: ${input.board.title}`,
    `This is ONE board, added during a lecture on "${input.topic}" because the student answered this check question WRONG: "${input.question}"`,
    `The right answer: "${right}". ${mistake}`,
    "Plan exactly ONE board that fixes this: no opening map, no recap, no refresher.",
    "Its narration: first name the tempting wrong idea plainly (\"It is easy to think … — but …\") and why it does not hold; then teach the idea again from a DIFFERENT angle — a new example or analogy, NOT the earlier board's example or words; end on the idea said simply. Warm and encouraging, never \"you were wrong\".",
    `The board the student had just seen (do not repeat its example or wording):\nTitle: ${input.board.title}\n${input.board.script.slice(0, 1500)}`,
    input.lessonContext ? `What the lecture covers:\n${input.lessonContext.slice(0, 2500)}` : "",
  ].filter(Boolean).join("\n\n");
}

/** The fix-up board as a lecture Beat (id "cv-<session>-fx…"), or null when it could not be made. */
export async function writeFixupBoard(input: FixupInput): Promise<{ beat: Beat; costUsd: number; log: string[] } | null> {
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const right = input.options.find((o) => o.correct)?.text ?? "";
  let costUsd = 0;
  const planned = await jsonCall(openai, PLAN_MODEL, CANVAS_PLAN_PROMPT, fixupPlanRequest(input), 6000);
  costUsd += planned.costUsd;
  const plan = validatePlan(planned.json);
  const chosen = plan?.beats.find((b) => !b.overview && !b.refresher && b.stage !== "exam") ?? plan?.beats[0];
  if (!chosen) return null;
  const beat = { ...chosen, id: `fx${Date.now().toString(36)}`, overview: false, refresher: undefined, inside: null, carry: [] };
  // No harder to read than the lecture it fixes (owner QA brief, 2026-11-28).
  if (input.readingGrade) costUsd += (await pitchScripts(openai, [beat], Math.max(4, Math.round(input.readingGrade)), "", { lesson: [beat], topic: input.topic }).catch(() => ({ costUsd: 0 }))).costUsd;
  // CHECKED BEFORE IT IS SPOKEN (lib/canvas/explanationCheck.ts, item 4f): every sentence against the board the
  // student saw, the question and the right answer. A wrong sentence is corrected; one that cannot be corrected,
  // or a check that could not run, means no fix-up board — the card's own (checked) feedback stands instead.
  const sentences = canvasSentences(beat.script);
  const reference = [`The check question: "${input.question}"`, `The right answer: "${right}"`, `The board the student saw — ${input.board.title}:\n${input.board.script.slice(0, 2500)}`, input.lessonContext ? `The lecture's boards:\n${input.lessonContext.slice(0, 1200)}` : ""].filter(Boolean).join("\n\n");
  const checked = await bounded(checkExplanations((system, user, max) => jsonCall(openai, PLAN_MODEL, system, user, max), reference, sentences.map((text, i) => ({ key: `s${i + 1}`, text }))), 25_000, "fix-up check").catch(() => null);
  costUsd += checked?.costUsd ?? 0;
  if (!checked?.checked || checked.failed.length) {
    console.warn(`[fixup] ${input.sessionId.slice(0, 8)}: fix-up board not used — ${checked ? (checked.failed.map((f) => `${f.key}: ${f.why}`).join("; ") || "the check could not run") : "the check timed out"}`);
    return null;
  }
  if (checked.fixed.length) {
    for (const f of checked.fixed) console.log(`[fixup] ${input.sessionId.slice(0, 8)} corrected ${f.key}: "${f.from}" -> "${f.to}"${f.why ? ` (${f.why})` : ""}`);
    beat.script = checked.items.map((i) => i.text).join(" ");
  }
  const policy = applyLessonVisualPolicy([beat], { mode: "prompt", findAsset: findLibraryFigure, topic: input.topic, domain: input.subjectDomain, mathsPictures: mathsPicturesOn(), aiPictures: false });
  const written = await writeCanvasBoard({
    userId: input.userId,
    sessionId: input.sessionId,
    topic: input.topic,
    plan: policy.beats,
    index: 0,
    earlier: [],
    notes: ["The student just answered a check question wrongly: this board fixes that misconception."],
    typedPrompt: true,
    subjectDomain: input.subjectDomain,
    hurry: () => true,
    opening: true,
    skipLook: true,
    // A new question on the same idea, so the fix is checked.
    checkCard: true,
  });
  costUsd += written.costUsd;
  if (written.fallback || !written.beat.draw) return null;
  // Shown in the player's part list as an extra board, not a numbered part of the plan.
  const fixed: Beat = { ...written.beat, stepLabel: `Fix-up · ${written.beat.title ?? chosen.title}` };
  return { beat: fixed, costUsd, log: written.log };
}
