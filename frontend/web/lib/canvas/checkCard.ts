import "server-only";

import type OpenAI from "openai";
import { bounded, jsonCall, shortenToFit } from "./generate";
import { canvasSentences } from "./plan";
import { checkCardIssues, OPTION_MAX } from "./quizLint";
import type { CanvasBoardSpec, CanvasPlanBeat, QuizInteraction } from "./types";
import { validateInteraction } from "./validate";
import { boardElements, codeBoardText, lineReferenceIssues, orderCard, tapParts } from "./cardKinds";

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

const WRITE_PROMPT = `You write ONE multiple-choice check question for the end of one board of a school lesson. Return JSON only: {"question": string, "options": [{"text": string, "correct": boolean, "feedback": string}], "evidence": [sentence numbers], "hint": {"text": string, "target": string}}.
- The question tests whether the student UNDERSTOOD this board: apply its idea to a NEW case — different numbers, a different example or situation from the ones the narration already worked — or ask why or how; never ask them to recall a phrase word for word. It must be answerable from the narration alone, at the lesson's level. It names what it is about (it is read on its own) and does not list its options inside it.
- Exactly 4 options (3 only when there are exactly three sensible answers), exactly ONE correct. Each option a bare answer in one short clause, at most ${OPTION_MAX} characters, parallel in grammar and similar in length, the same units. No "all/none of the above", "both", "neither", no option that is also true, no joke or absurd option.
- Every wrong option is a specific misconception real students hold about this idea (use the listed common mistakes when they fit; for a calculation, the number a real slip produces).
- "feedback": 1–2 sentences Aria says when that option is chosen. For a WRONG option: why that choice is wrong — the mistake in it — and what is actually true, without naming the right option's letter (the right option is highlighted on its own). For the correct option: one short sentence of why it is right. Every number you write is computed exactly.
- "evidence": the numbers of the narration sentences that prove the correct answer.
- "hint": a nudge Aria says if the student asks — what to look at or think about, NEVER the answer or a word that gives it away; "target": the id of the board element the pen points at while she says it (from the list of board elements), or "" for none.`;

const TAP_PROMPT = `You write ONE "tap the board" check question for the end of one board of a school lesson: the student answers by tapping ONE part of the board's diagram. Return JSON only: {"question": string, "options": [{"target": string, "correct": boolean, "feedback": string}], "evidence": [sentence numbers], "hint": {"text": string, "target": string}}.
- The question asks for a part by what it DOES or where something HAPPENS, as taught in the narration ("Tap where the substrate binds", "Tap the part that carries blood away from the heart") — never by its name, and never with a word of its name in it.
- "options": 3 or 4 of the listed parts (ids exactly as given), exactly ONE correct; the others are parts a confused student would really tap.
- "feedback": 1–2 sentences Aria says when that part is tapped. For a wrong part: what that part actually is or does, and what to look for instead (without naming the right one). For the right part: one short sentence of why.
- "evidence": the numbers of the narration sentences that teach the answer.
- "hint": a nudge (what to think about), never the answer; "target": "" or a board element id that does not give the answer away.`;

const VERIFY_PROMPT = `You are checking a multiple-choice question for a school lesson before a student sees it. You are given the lesson narration and the question with lettered options. Using ONLY the narration and standard knowledge at this level, answer it yourself. Return JSON only: {"answer": "A" | "B" | "C" | "D", "otherDefensible": [letters of any other option a careful student could defend as correct], "ambiguous": boolean, "answerable": boolean (the narration teaches what is needed), "problem": string (empty when the question is sound)}.`;

export type CheckCardResult = { card: QuizInteraction | null; costUsd: number; log: string };

/** The lesson's common mistakes, when the course plan lists them ("Watch for: …"). */
function mistakesOf(hints: string[] = []): string {
  return hints.find((h) => /^Watch for:/i.test(h))?.replace(/^Watch for:\s*/i, "") ?? "";
}

/** The sentence that taught the answer, and the element shown on it — for "Show me again". */
function replayFor(spec: CanvasBoardSpec, sentences: string[], evidence: unknown): QuizInteraction["replay"] {
  const nums = (Array.isArray(evidence) ? evidence : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < sentences.length);
  const s = nums.length ? Math.min(...nums) : -1;
  if (s < 0) return undefined;
  const el = boardElements(spec).find((e) => e.s === s);
  return { text: sentences[s], ...(el ? { target: el.id } : {}) };
}

/** The card for a board: put its steps in order, tap its diagram, or choose an answer. */
export async function writeCheckCard(openai: OpenAI, beat: Pick<CanvasPlanBeat, "title" | "script">, spec: CanvasBoardSpec, context: { level?: string; teachingHints?: string[]; typed?: boolean } = {}): Promise<CheckCardResult> {
  const ordered = orderCard(spec, beat.script);
  if (ordered) return { card: ordered, costUsd: 0, log: "order card built from the board's steps" };
  if (tapParts(spec).length >= 3) {
    const tap = await writeTapCard(openai, beat, spec, context).catch(() => null);
    if (tap?.card) return tap;
    const choice = await writeChoiceCard(openai, beat, spec, context);
    return { ...choice, costUsd: choice.costUsd + (tap?.costUsd ?? 0) };
  }
  return writeChoiceCard(openai, beat, spec, context);
}

/** A "tap the board" card: the part's name hidden, asked by what it does, verified like any card. */
async function writeTapCard(openai: OpenAI, beat: Pick<CanvasPlanBeat, "title" | "script">, spec: CanvasBoardSpec, context: { level?: string }): Promise<CheckCardResult> {
  const sentences = canvasSentences(beat.script);
  const narration = sentences.map((s, i) => `[${i}] ${s}`).join("\n");
  const parts = tapParts(spec);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const elements = boardElements(spec);
  let costUsd = 0;
  let issues: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = [`Board: ${beat.title}`, context.level ? `Level: ${context.level}` : "", `Parts of the diagram (id: name): ${parts.map((p) => `${p.id}: ${p.name}`).join("; ")}`, `Board elements for the hint: ${elements.map((e) => `${e.id} ("${e.name}")`).join(", ")}`, `Narration:\n${narration}`, issues.length ? `Your previous card was rejected: ${issues.join("; ")}.` : ""].filter(Boolean).join("\n\n");
    const written = await bounded(jsonCall(openai, CARD_MODEL, TAP_PROMPT, user, 1200), 25_000, `tap card ${beat.title}`);
    costUsd += written.costUsd;
    const raw = written.json as { question?: unknown; options?: Array<{ target?: unknown; correct?: unknown; feedback?: unknown }>; evidence?: unknown; hint?: { text?: unknown; target?: unknown } };
    const options = (raw.options ?? []).filter((o) => typeof o.target === "string" && byId.has(o.target)).map((o) => ({ text: byId.get(o.target as string)!.name, target: o.target as string, correct: o.correct === true, feedback: typeof o.feedback === "string" ? o.feedback.replace(/^\s*(aria|feedback)\s*:\s*/i, "") : "" }));
    const card = validateInteraction({ kind: "quiz", mode: "tap", question: raw.question, options, hint: raw.hint }) as QuizInteraction | undefined;
    if (!card || card.kind !== "quiz" || card.mode !== "tap") { issues = ["give 3 or 4 options, each a listed part id, exactly one correct, each with feedback"]; continue; }
    const right = card.options.find((o) => o.correct)!;
    // The question may not name the part it asks for.
    const nameWords = right.text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    if (nameWords.some((w) => card.question.toLowerCase().includes(w))) { issues = [`the question names the answer ("${right.text}"): ask by what it does`]; continue; }
    // The same independent check as every card: the verifier must pick the same part.
    const letters = "ABCD";
    const asked = `Narration:\n${narration}\n\nQuestion: ${card.question}\n${card.options.map((o, k) => `${letters[k]}. ${o.text}`).join("\n")}`;
    const verified = await bounded(jsonCall(openai, CARD_MODEL, VERIFY_PROMPT, asked, 800), 20_000, `verify tap ${beat.title}`);
    costUsd += verified.costUsd;
    const v = verified.json as { answer?: string; otherDefensible?: unknown[]; ambiguous?: boolean };
    const chosen = letters.indexOf(String(v.answer ?? "").trim().toUpperCase().charAt(0));
    if (card.options[chosen] !== right || (Array.isArray(v.otherDefensible) && v.otherDefensible.length) || v.ambiguous) { issues = ["an independent check did not pick the same single part — make the question point to exactly one part"]; continue; }
    const hint = card.hint && card.hint.target === right.target ? { text: card.hint.text } : card.hint;
    return { card: { ...card, ...(hint ? { hint } : {}), replay: replayFor(spec, sentences, raw.evidence), check: true }, costUsd, log: `tap card verified (attempt ${attempt})` };
  }
  return { card: null, costUsd, log: `no tap card — ${issues.join("; ").slice(0, 200)}` };
}

async function writeChoiceCard(openai: OpenAI, beat: Pick<CanvasPlanBeat, "title" | "script">, spec: CanvasBoardSpec, context: { level?: string; teachingHints?: string[]; typed?: boolean } = {}): Promise<CheckCardResult> {
  const sentences = canvasSentences(beat.script);
  const narration = sentences.map((s, i) => `[${i}] ${s}`).join("\n");
  const mistakes = mistakesOf(context.teachingHints);
  let costUsd = 0;
  let issues: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const user = [
        `Board: ${beat.title}`,
        context.level ? `Level: ${context.level}` : "",
        `On the board: ${spec.heading}; ${spec.notes.map((n) => n.text).join("; ")}`,
        `Board elements for the hint (id: name): ${boardElements(spec).map((e) => `${e.id}: ${e.name}`).join("; ")}`,
        // A typed lesson's code board: the card sees the code as the student does, with its numbers.
        context.typed ? codeBoardText(spec) : "",
        mistakes ? `Common mistakes at this level: ${mistakes}` : "",
        `Narration:\n${narration}`,
        issues.length ? `Your previous card was rejected: ${issues.join("; ")}. Write a new card that fixes exactly that.` : "",
      ].filter(Boolean).join("\n\n");
      const written = await bounded(jsonCall(openai, CARD_MODEL, WRITE_PROMPT, user, 1500), 25_000, `check card ${beat.title}`);
      costUsd += written.costUsd;
      const raw = written.json as Record<string, unknown>;
      // Tidy what is fixable by code before judging the card: the board title the model prefixes to the
      // stem ("Mucociliary protection: If cilia…"), a speaker tag in the feedback ("Aria: …"), options
      // longer than the card holds — rewritten to fit, never a reason to drop the card (audit 2026-10-17).
      const options = (Array.isArray(raw.options) ? raw.options : []).map((o) => (o && typeof o === "object" ? { ...(o as Record<string, unknown>) } : {})) as Array<Record<string, unknown>>;
      for (const o of options) if (typeof o.feedback === "string") o.feedback = o.feedback.replace(/^\s*(aria|teacher|feedback)\s*:\s*/i, "");
      const long = options.filter((o) => typeof o.text === "string" && o.text.length > OPTION_MAX).map((o) => ({ text: String(o.text).replace(/\s+/g, " ").trim(), max: OPTION_MAX }));
      if (long.length) {
        const fitted = await shortenToFit(openai, long).catch(() => null);
        if (fitted) { costUsd += fitted.costUsd; for (const o of options) { const t = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim() : ""; if (fitted.replacements.has(t)) o.text = fitted.replacements.get(t); } }
      }
      const stem = typeof raw.question === "string" ? raw.question.replace(new RegExp(`^\\s*${beat.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:—–-]\\s*`, "i"), "") : raw.question;
      const card = validateInteraction({ kind: "quiz", question: stem, options }) as QuizInteraction | undefined;
      if (!card || card.kind !== "quiz") { issues = [`the card must have a "question" string and 3 or 4 "options", each {"text", "correct", "feedback"}, with exactly ONE "correct": true`]; continue; }
      issues = [...checkCardIssues(card, beat.script), ...(context.typed ? lineReferenceIssues(card, spec) : [])];
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
      else {
        // The hint may point the pen only at something on this board, and never give the answer away.
        const hintRaw = (raw.hint && typeof raw.hint === "object" ? raw.hint : {}) as { text?: unknown; target?: unknown };
        const rightText = card.options[right].text.toLowerCase();
        const hintText = typeof hintRaw.text === "string" && hintRaw.text.trim() && !hintRaw.text.toLowerCase().includes(rightText) ? hintRaw.text.trim().slice(0, 200) : "";
        const hintTarget = typeof hintRaw.target === "string" && boardElements(spec).some((e) => e.id === hintRaw.target) ? hintRaw.target : undefined;
        const replay = replayFor(spec, sentences, raw.evidence);
        return { card: { ...card, ...(hintText ? { hint: { text: hintText, ...(hintTarget ? { target: hintTarget } : {}) } } : {}), ...(replay ? { replay } : {}), check: true }, costUsd, log: `check card verified (attempt ${attempt})` };
      }
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
      issues = [(error as Error).message];
    }
  }
  return { card: null, costUsd, log: `no check card — ${issues.join("; ").slice(0, 200)}` };
}
