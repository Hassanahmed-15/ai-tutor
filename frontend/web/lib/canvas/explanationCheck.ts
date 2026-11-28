/**
 * WHAT ARIA SAYS AFTER A WRONG ANSWER IS CHECKED BEFORE SHE SAYS IT (owner QA brief, 2026-11-28, item 4f). A
 * remediation said a model "represents the unknown quantity" when it shows that two sides are equal, and that an
 * idea means "more than one value works" when it means every value works. Those lines are written fast, to answer
 * a student who is already confused, and nothing read them before they were spoken.
 *
 * One small call reads each line against what the lesson taught (its board, the question and the right answer)
 * and standard knowledge at the level, and also catches a misspelt or wrong word. A flagged line is replaced by the
 * checker's correction when that correction is usable; a flagged line with no usable correction is reported as
 * failed, and the caller falls back (no fix-up board, another card). Pure except `checkExplanations`, which takes
 * the model call as an argument. General: no topic, word or example is named.
 */

export type ExplainItem = { key: string; text: string; /** Shown to the checker beside the line, never rewritten ("feedback for the wrong option 'x'"). */ context?: string };

export const EXPLANATION_CHECK_PROMPT = `You check what a tutor is about to SAY to a student who just answered a question wrongly, before it is spoken. You get what the lesson taught (its board, the question and the right answer) and numbered lines. For each line decide: is it true, and does it agree with what the lesson taught? Flag a line that:
- states a fact, definition or rule wrongly;
- says a model, picture, symbol or step represents or shows something it does not;
- gets a quantity word wrong ("some" where the idea is "every", "more than one" where it is "all", "none" where it is "few");
- calls a right idea wrong or a wrong idea right, or contradicts the right answer;
- has a misspelt word or a wrong word (a real word that is not the one meant).
Never flag style, simplification or missing detail. For each flagged line give the corrected line — as plain, about as long, making the same teaching point, the same number of sentences. Return JSON only: {"fixes": {"<key>": "<corrected line>"}, "why": {"<key>": "<what was wrong, in a few words>"}} — two empty objects when every line is right.`;

export function explanationRequest(reference: string, items: ExplainItem[]): string {
  return `WHAT THE LESSON TAUGHT:\n${reference.slice(0, 4000)}\n\nLINES TO CHECK:\n${items.map((i) => `${i.key}${i.context ? ` (${i.context})` : ""}: ${i.text}`).join("\n")}`;
}

const sentenceCount = (t: string) => t.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;
const numbersOf = (t: string) => (t.match(/-?\d+(?:\.\d+)?/g) ?? []).sort().join(",");

/**
 * The checker's answer applied: a flagged line takes its correction when it keeps the line's sentence count and
 * length range; a flagged line with no usable correction is `failed`. A correction that changes the numbers is
 * taken only when the checker said why (a wrong number is a reason).
 */
export function applyExplanationFixes(items: ExplainItem[], answer: unknown): { items: ExplainItem[]; fixed: Array<{ key: string; from: string; to: string; why: string }>; failed: Array<{ key: string; why: string }> } {
  const a = (answer && typeof answer === "object" ? answer : {}) as { fixes?: Record<string, unknown>; why?: Record<string, unknown> };
  const fixes = a.fixes && typeof a.fixes === "object" ? a.fixes : {};
  const why = a.why && typeof a.why === "object" ? a.why : {};
  const fixed: Array<{ key: string; from: string; to: string; why: string }> = [];
  const failed: Array<{ key: string; why: string }> = [];
  const out = items.map((item) => {
    const flagged = item.key in fixes || item.key in why;
    if (!flagged) return item;
    const reason = typeof why[item.key] === "string" ? (why[item.key] as string).trim() : "";
    const next = typeof fixes[item.key] === "string" ? (fixes[item.key] as string).replace(/\s+/g, " ").trim() : "";
    const usable = next && next !== item.text && /[.!?]$/.test(next) && sentenceCount(next) === sentenceCount(item.text) && next.length <= item.text.length * 2 + 40 && (numbersOf(next) === numbersOf(item.text) || reason);
    if (!usable) {
      // "Flagged" with the same text back, or no reason and no fix, is the checker agreeing: not a failure.
      if (next === item.text || (!next && !reason)) return item;
      failed.push({ key: item.key, why: reason || "the line is wrong and no usable correction came back" });
      return item;
    }
    fixed.push({ key: item.key, from: item.text, to: next, why: reason });
    return { ...item, text: next };
  });
  return { items: out, fixed, failed };
}

/** Ask once, apply. `checked` is false when the call itself failed: the caller decides what an unchecked line may do. */
export async function checkExplanations(
  call: (system: string, user: string, maxTokens: number) => Promise<{ json: unknown; costUsd: number }>,
  reference: string,
  items: ExplainItem[],
): Promise<ReturnType<typeof applyExplanationFixes> & { costUsd: number; checked: boolean }> {
  const lines = items.filter((i) => i.text.trim());
  if (!lines.length) return { items, fixed: [], failed: [], costUsd: 0, checked: true };
  try {
    const answer = await call(EXPLANATION_CHECK_PROMPT, explanationRequest(reference, lines), 1500);
    const applied = applyExplanationFixes(items, answer.json);
    return { ...applied, costUsd: answer.costUsd, checked: true };
  } catch (error) {
    return { items, fixed: [], failed: [], costUsd: (error as { costUsd?: number }).costUsd ?? 0, checked: false };
  }
}
