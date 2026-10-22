import type OpenAI from "openai";
import { costFor } from "../modelPricing";
import { boardFacts } from "./boardReview";
import { canvasSentences } from "./plan";
import { isMathsTopic } from "./predictCard";
import { isCsTopic } from "./subjectLook";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * THE MATHS EXAMINER. A strong model reads every board of a maths lecture the way a maths teacher marks
 * it: every number recomputed, every line of working checked, every answer Aria says looked for on the
 * board, every definition checked for the condition it needs. The benchmark of 2026-10-21 (70 lectures,
 * read by professor reviewers) found that the code checks catch wrong arithmetic but not a false
 * theorem condition ("same chord or arc"), a wrong term ("distance" for a signed deviation), a figure
 * that contradicts the example, or an answer said and never written — and the owner chose this check
 * on gpt-5.6-sol at about $0.25 a lecture.
 *
 * It fails open: a check that errors or runs out of time never holds a board back.
 */

export const MATHS_CHECK_MODEL = process.env.CANVAS_MATHS_CHECK_MODEL ?? "gpt-5.6-sol";

/** On for maths lectures unless CANVAS_MATHS_CHECK=off. */
export function mathsCheckOn(topic: string, plan: Pick<CanvasPlanBeat, "title" | "brief">[]): boolean {
  if (process.env.CANVAS_MATHS_CHECK === "off") return false;
  return isMathsTopic([topic, ...plan.map((b) => `${b.title} ${b.brief ?? ""}`)].join(" "));
}

export type ExaminerSubject = "maths" | "cs";

/** Which examiner reads this lecture's boards: maths, computer science (CANVAS_CS_CHECK=off turns it off), or none. */
export function examinerFor(topic: string, plan: Pick<CanvasPlanBeat, "title" | "brief">[]): ExaminerSubject | null {
  if (isCsTopic(topic) && process.env.CANVAS_CS_CHECK !== "off") return "cs";
  return mathsCheckOn(topic, plan) ? "maths" : null;
}

export const MATHS_CHECK_PROMPT = `You are a strict maths examiner checking ONE board of a school maths lesson (O Level / A Level) before a student sees it. You get what the teacher (Aria) SAYS, sentence by sentence, and what the board SHOWS: its equation rows, its notes, its figure and the words and numbers drawn in the figure.

Report only faults a maths examiner would mark as WRONG or that would MISLEAD a student:
- "false-maths": any false statement, wrong number, wrong algebra, false identity, wrong solution set or inequality direction, wrong matrix, probability that does not add up — on the board OR in what Aria says. Recompute every calculation yourself.
- "figure-contradicts": a figure value, label or plotted set that disagrees with the narration or the board's own working.
- "answer-not-written": a result or final answer Aria states that appears nowhere on the board (rows, notes or figure).
- "skipped-step": two consecutive lines of working (on the board or in what Aria says) where a school student cannot see how the second follows from the first — an expansion, cancelling or rearrangement done in one jump. Give the missing line in "line" and, in "sentence", the sentence it belongs to.
- "working-not-written": a step of working Aria SAYS that the board does not SHOW — a substitution, an expansion, a cancelling, a simplification, a calculation, a limit, a derivative or integral, a rule applied to an example. The student must SEE every line of working as she says it. Report EACH missing step as its own problem, in the order she says them, even when the final answer is written.
- "garbled": a line of maths that reads wrongly — cut off ("y = m"), starting or ending on an operator, an unclosed bracket, words glued into maths, a division whose scope is wrong (1 ÷ ad − bc), a "=" between unequal things.
- "missing-condition": a definition, theorem or method stated without a condition it needs (y = mx + c "for a non-vertical line"; the finite binomial expansion "for a positive integer n"; dividing an inequality by a negative reverses it).
- "wrong-term": a mathematical word used wrongly ("distance" for a signed deviation, "reflex" for a minor angle, "secant" for a straight line).
- "out-of-order": the finished answer written above the working that produces it, or a conclusion above its premise (the board is read top to bottom as Aria speaks).

Never report style, colour, layout taste, a step a teacher might also skip, or anything you are not sure is wrong. A board with no such fault ships.

Return JSON only: {"ship": boolean, "problems": [{"kind": one of the kinds above, "where": "board" or "narration", "sentence": the sentence number (for "narration", and for "answer-not-written" / "working-not-written" / "skipped-step": the sentence that says it), "detail": "what is wrong, quoting the exact text", "fix": "for the board: the exact correct text or value; for the narration: the WHOLE corrected sentence, one sentence, same meaning otherwise", "line": "for answer-not-written, working-not-written and skipped-step only: the exact line to write on the board, in maths symbols not words (÷ × − √ ² ≤ → ∫ lim), at most 48 characters, '=' only between equal things, e.g. \"[(2 + h)² − 2²] ÷ h = (4h + h²) ÷ h = 4 + h\""}]}. "ship" is true only when "problems" is empty. A missing line is written into the board by code from "line", so make it exactly right.`;

/**
 * THE CS EXAMINER (owner's manager, a CS teacher, 2026-10-22: the code and visuals were nice but it
 * "never really teaches" and "doesn't explain the visuals"). The same strong model reads each board of
 * a computer-science lecture as a CS teacher marks it: runs the code in its head, checks every traced
 * value, and finds anything on the board Aria never explains.
 */
export const CS_CHECK_PROMPT = `You are a strict computer-science teacher checking ONE board of a school or university CS lesson before a student sees it. You get what the teacher (Aria) SAYS, sentence by sentence, and what the board SHOWS: the code with line numbers and, for each sentence, the lines lit, the variables, the call stack, the data-structure changes and the output; or the board's drawing, notes and labels.

Report only faults a CS teacher would mark as WRONG or that would leave a student CONFUSED:
- "wrong-code": code that would not run, would not do what Aria says, or is prose dressed as code ("push(stack, item): add item to top").
- "wrong-trace": a value, call, return, output or structure change (said OR shown) that this code would not produce. Run the code yourself on the input given.
- "unexplained": a line of code, box, arrow, pointer, value, label or note ON THE BOARD that Aria never explains — say which, and in "sentence" the sentence that should explain it.
- "out-of-sync": a sentence that lights or draws something other than what it talks about, or several lines at once while explaining one.
- "squeezed-trace": ONE sentence that covers what needs several — it runs several loop passes, calls or steps at once ("the loop compares 9, then 2 and 7, and returns 9"; "the queue evolves as A, then B,C, then C,D"), or it presents several lines of code without explaining each ("Here is the complete Python implementation", "the loop removes the front vertex, processes it, and enqueues each neighbour"). The board lights one line per sentence, so the student cannot follow. Its "where" is "narration"; its "fix" is the REPLACEMENT: several sentences — one per pass, call or step (saying the line that runs and what changes, with the same values), or one per line of code (saying what it does and why).
- "concept-gap": a term used before it is defined (stack frame, pointer, index, base case), or a step whose reason is never given.
- "wrong-term": a CS word used wrongly ("array" for a linked list, "pointer" for a value, "recursion" for a loop).

Never report style, colour, layout taste or anything you are not sure is wrong. A board with no such fault ships.

Return JSON only: {"ship": boolean, "problems": [{"kind": one of the kinds above, "where": "board" or "narration", "sentence": the sentence number it concerns, "detail": "what is wrong, quoting the exact text", "fix": "for the board: the exact correct text, value or code line; for the narration: the WHOLE corrected sentence, one sentence, same meaning otherwise"}]}. "ship" is true only when "problems" is empty.`;

export type MathsProblem = { kind: string; detail: string; fix: string; where: "board" | "narration"; sentence?: number; line?: string };
export type MathsVerdict = { ship: boolean; problems: MathsProblem[]; costUsd: number; ms: number; checked: boolean };

export function mathsCheckRequest(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "title" | "script">, topic: string): string {
  const said = canvasSentences(beat.script).map((s, i) => `${i}. ${s}`).join("\n");
  return `Lesson: ${topic}\nBoard: ${beat.title}\n\nWHAT ARIA SAYS:\n${said}\n\nWHAT THE BOARD SHOWS:\n${boardFacts(spec)}`;
}

export function parseMathsVerdict(json: unknown): { ship: boolean; problems: MathsProblem[] } {
  const r = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const problems = (Array.isArray(r.problems) ? r.problems : [])
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
    .map((p): MathsProblem => ({
      kind: String(p.kind ?? "false-maths").slice(0, 40),
      detail: String(p.detail ?? "").slice(0, 400),
      fix: String(p.fix ?? "").slice(0, 400),
      where: p.where === "narration" ? "narration" : "board",
      ...(typeof p.sentence === "number" && Number.isInteger(p.sentence) ? { sentence: p.sentence } : {}),
      ...(typeof p.line === "string" && p.line.trim() ? { line: p.line.replace(/\s+/g, " ").trim().slice(0, 80) } : {}),
    }))
    .filter((p) => p.detail);
  return { ship: problems.length === 0, problems };
}

/** One examiner's read of one board. Never throws; a failure ships the board (checked: false). */
export async function mathsCheck(openai: OpenAI, topic: string, spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "title" | "script">, timeoutMs = 60_000, subject: ExaminerSubject = "maths"): Promise<MathsVerdict> {
  const started = Date.now();
  let costUsd = 0;
  try {
    const call = openai.chat.completions.create({
      model: MATHS_CHECK_MODEL,
      messages: [
        { role: "system", content: subject === "cs" ? CS_CHECK_PROMPT : MATHS_CHECK_PROMPT },
        { role: "user", content: mathsCheckRequest(spec, beat, topic) },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 8000,
      reasoning_effort: "medium",
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    const res = await Promise.race([call, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`maths check timed out after ${timeoutMs / 1000}s`)), timeoutMs))]);
    costUsd = costFor(MATHS_CHECK_MODEL, res.usage);
    const verdict = parseMathsVerdict(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
    return { ...verdict, costUsd, ms: Date.now() - started, checked: true };
  } catch (error) {
    console.warn(`[canvas] maths check skipped: ${(error as Error).message}`);
    return { ship: true, problems: [], costUsd, ms: Date.now() - started, checked: false };
  }
}

/** The examiner's faults as the board writer's instruction for its next attempt. */
export function mathsFixes(problems: MathsProblem[]): string {
  return `an examiner found: ${problems.map((p) => `${p.kind}: ${p.detail}${p.fix ? ` → ${p.fix}` : ""}`).join("; ")}. Correct exactly these, keep everything else`;
}

/**
 * A narration fault is fixed in the script itself: the examiner's corrected sentence takes the place of
 * the wrong one — one sentence for one, so every sentence keeps its number (the board and the voice stay
 * in step). Returns the script and how many sentences it changed.
 */
export function patchNarration(script: string, problems: MathsProblem[], opts: { grow?: boolean } = {}): { script: string; changed: number; grew: boolean } {
  const sentences = canvasSentences(script);
  let changed = 0;
  let grew = false;
  for (const p of problems) {
    if (p.where !== "narration" || p.sentence === undefined || !sentences[p.sentence]) continue;
    const fix = p.fix.replace(/\s+/g, " ").trim();
    // A squeezed trace becomes one sentence per pass (CS round, 2026-10-22) — only when the board is
    // written again for it, or its lines would light on the wrong sentences.
    if (p.kind === "squeezed-trace") {
      const n = canvasSentences(fix).length;
      if (!opts.grow || n < 2 || n > 8 || !/[.!?]$/.test(fix) || fix.length > sentences[p.sentence].length * 6 + 240) continue;
      sentences[p.sentence] = fix;
      changed++;
      grew = true;
      continue;
    }
    // One whole sentence that ends like one, and not wildly longer than the one it replaces.
    if (canvasSentences(fix).length !== 1 || !/[.!?]$/.test(fix) || fix.length > sentences[p.sentence].length * 2 + 40) continue;
    sentences[p.sentence] = fix;
    changed++;
  }
  return { script: changed ? sentences.join(" ") : script, changed, grew };
}
