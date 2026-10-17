import "server-only";

import type OpenAI from "openai";
import { bounded, jsonCall } from "./generate";
import { canvasSentences } from "./plan";
import { checkCardIssues, OPTION_MAX } from "./quizLint";
import type { CanvasBoardSpec, CanvasPlanBeat, QuizInteraction } from "./types";
import { validateInteraction } from "./validate";

/**
 * THE "CHECK IT" CARD — written after its board, verified independently, never able to fail a board.
 *
 * The old "Predict it" card was written inside each board and tied to a question in the middle of the
 * narration; its faults (two identical options, working inside an option, a stem that named the
 * answer) failed whole boards and sent them to the backup, and it was removed (2026-10-16). The owner
 * wants it back, reliable (2026-10-17). So the card is now its own pipeline:
 *
 *   1. written from the finished board's narration: ONE question applying the board's idea to a new
 *      case, four short options — one right, three real misconceptions — each with Aria's feedback;
 *   2. checked by code: exactly one right option, no give-away patterns (lib/canvas/quizLint.ts), no
 *      option over 60 characters, every number in the right option and the feedback recomputed;
 *   3. verified by a second, independent call that sees only the narration and the shuffled options —
 *      never which is marked right — and must choose the same answer, find no other defensible option
 *      and judge the question unambiguous and answerable from the lesson;
 *   4. one rewrite with what failed; a card that still fails is simply not shown.
 *
 * It appears when Aria finishes the board (the player already holds there for a board's task), so it
 * never interrupts a sentence and cannot give away an answer mid-board.
 */

const CARD_MODEL = process.env.CANVAS_SPEC_MODEL ?? "gpt-5.6-luna";

const WRITE_PROMPT = `You write ONE multiple-choice check question for the end of one board of a school lesson. Return JSON only: {"question": string, "options": [{"text": string, "correct": boolean, "feedback": string}], "evidence": [sentence numbers]}.
- The question tests whether the student UNDERSTOOD this board: apply its idea to a new case, or ask why or how — never ask them to recall a phrase word for word. It must be answerable from the narration alone, at the lesson's level. It names what it is about (it is read on its own) and does not list its options inside it.
- Exactly 4 options (3 only when there are exactly three sensible answers), exactly ONE correct. Each option a bare answer in one short clause, at most ${OPTION_MAX} characters, parallel in grammar and similar in length, the same units. No "all/none of the above", "both", "neither", no option that is also true, no joke or absurd option.
- Every wrong option is a specific misconception real students hold about this idea (use the listed common mistakes when they fit; for a calculation, the number a real slip produces).
- "feedback": 1–2 sentences Aria says when that option is chosen. For a WRONG option: why that choice is wrong — the mistake in it — and what is actually true, without naming the right option's letter (the right option is highlighted on its own). For the correct option: one short sentence of why it is right. Every number you write is computed exactly.
- "evidence": the numbers of the narration sentences that prove the correct answer.`;

const VERIFY_PROMPT = `You are checking a multiple-choice question for a school lesson before a student sees it. You are given the lesson narration and the question with lettered options. Using ONLY the narration and standard knowledge at this level, answer it yourself. Return JSON only: {"answer": "A" | "B" | "C" | "D", "otherDefensible": [letters of any other option a careful student could defend as correct], "ambiguous": boolean, "answerable": boolean (the narration teaches what is needed), "problem": string (empty when the question is sound)}.`;

export type CheckCardResult = { card: QuizInteraction | null; costUsd: number; log: string };

/** The lesson's common mistakes, when the course plan lists them ("Watch for: …"). */
function mistakesOf(hints: string[] = []): string {
  return hints.find((h) => /^Watch for:/i.test(h))?.replace(/^Watch for:\s*/i, "") ?? "";
}

export async function writeCheckCard(openai: OpenAI, beat: Pick<CanvasPlanBeat, "title" | "script">, spec: CanvasBoardSpec, context: { level?: string; teachingHints?: string[] } = {}): Promise<CheckCardResult> {
  const sentences = canvasSentences(beat.script);
  const narration = sentences.map((s, i) => `[${i}] ${s}`).join("\n");
  const mistakes = mistakesOf(context.teachingHints);
  let costUsd = 0;
  let issues: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const user = [
        `Board: ${beat.title}`,
        context.level ? `Level: ${context.level}` : "",
        `On the board: ${spec.heading}; ${spec.notes.map((n) => n.text).join("; ")}`,
        mistakes ? `Common mistakes at this level: ${mistakes}` : "",
        `Narration:\n${narration}`,
        issues.length ? `Your previous card was rejected: ${issues.join("; ")}. Write a new card that fixes exactly that.` : "",
      ].filter(Boolean).join("\n\n");
      const written = await bounded(jsonCall(openai, CARD_MODEL, WRITE_PROMPT, user, 1500), 25_000, `check card ${beat.title}`);
      costUsd += written.costUsd;
      const raw = written.json as Record<string, unknown>;
      const card = validateInteraction({ kind: "quiz", question: raw.question, options: raw.options }) as QuizInteraction | undefined;
      if (!card || card.kind !== "quiz") { issues = ["the card needs a question and 3–4 options with exactly one correct"]; continue; }
      issues = checkCardIssues(card, beat.script);
      if (issues.length) continue;
      // The independent check: shuffled, lettered, without the right answer marked.
      const order = card.options.map((_, i) => i).sort((a, b) => ((a * 7 + 3) % card.options.length) - ((b * 7 + 3) % card.options.length));
      const letters = "ABCD";
      const asked = `Narration:\n${narration}\n\nQuestion: ${card.question}\n${order.map((i, k) => `${letters[k]}. ${card.options[i].text}`).join("\n")}`;
      const verified = await bounded(jsonCall(openai, CARD_MODEL, VERIFY_PROMPT, asked, 800), 20_000, `verify card ${beat.title}`);
      costUsd += verified.costUsd;
      const v = verified.json as { answer?: string; otherDefensible?: unknown[]; ambiguous?: boolean; answerable?: boolean; problem?: string };
      const chosen = order[letters.indexOf(String(v.answer ?? "").trim().toUpperCase().charAt(0))];
      const others = Array.isArray(v.otherDefensible) ? v.otherDefensible.filter((x) => typeof x === "string" && x.trim()) : [];
      const right = card.options.findIndex((o) => o.correct);
      if (chosen !== right) issues = [`an independent check chose "${chosen !== undefined ? card.options[chosen]?.text : "none"}" — the right answer must follow clearly from the narration${v.problem ? ` (${v.problem})` : ""}`];
      else if (others.length) issues = [`another option can also be defended as correct (${others.join(", ")}) — make every wrong option clearly wrong${v.problem ? `: ${v.problem}` : ""}`];
      else if (v.ambiguous || v.answerable === false) issues = [`the question is ${v.ambiguous ? "ambiguous" : "not answerable from the narration"}${v.problem ? `: ${v.problem}` : ""}`];
      else return { card: { ...card, check: true }, costUsd, log: `check card verified (attempt ${attempt})` };
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
      issues = [(error as Error).message];
    }
  }
  return { card: null, costUsd, log: `no check card — ${issues.join("; ").slice(0, 200)}` };
}
