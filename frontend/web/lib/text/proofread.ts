/**
 * SPELLING AND WRONG WORDS IN WHAT A STUDENT READS (owner QA brief, 2026-11-28: test feedback said a verb that sounds
 * like the right one but means something else). A spell checker cannot catch a real word used wrongly, so one small
 * call proofreads the texts; code then takes a correction only when it is a proofreading change — a few words, the
 * same numbers, nearly the same length — never a rewrite of what the grader meant. Pure except `proofread`, which
 * takes the model call as an argument. General: no word is named.
 */

export const PROOFREAD_PROMPT = `You proofread short texts a tutor wrote to a student. Fix ONLY misspelt words and wrong words — a real word that is not the one meant (one that sounds or looks like the right word), or the wrong form of a word. Change nothing else: not the meaning, the numbers, the facts, the punctuation style or the wording. Return JSON only: {"fixed": {"<id>": "<the whole corrected text>"}} — only the texts you changed; an empty object when all are right.`;

const tokens = (t: string) => t.split(/\s+/).filter(Boolean);
const numbersOf = (t: string) => (t.match(/-?\d+(?:\.\d+)?/g) ?? []).join(",");

/** A correction is a proofreading change: at most three words changed, none added or dropped beyond one, the numbers kept. */
export function acceptProofread(original: string, fixed: unknown): boolean {
  if (typeof fixed !== "string") return false;
  const next = fixed.replace(/\s+/g, " ").trim();
  const before = original.replace(/\s+/g, " ").trim();
  if (!next || next === before || numbersOf(next) !== numbersOf(before)) return false;
  const a = tokens(before);
  const b = tokens(next);
  if (Math.abs(a.length - b.length) > 1 || Math.abs(next.length - before.length) > 24) return false;
  // Words changed, matched from both ends (a word added or dropped shifts only the middle).
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return Math.max(a.length, b.length) - head - tail <= 3;
}

/** The texts with every accepted correction; on any failure they are returned as they were. */
export async function proofread(
  call: (system: string, user: string) => Promise<unknown>,
  texts: Record<string, string>,
): Promise<{ texts: Record<string, string>; changed: Array<{ id: string; from: string; to: string }> }> {
  const entries = Object.entries(texts).filter(([, t]) => typeof t === "string" && /[a-z]{3,}/i.test(t));
  if (!entries.length) return { texts, changed: [] };
  try {
    const json = await call(PROOFREAD_PROMPT, JSON.stringify(Object.fromEntries(entries)));
    const fixed = (json && typeof json === "object" ? (json as { fixed?: Record<string, unknown> }).fixed : null) ?? {};
    const out = { ...texts };
    const changed: Array<{ id: string; from: string; to: string }> = [];
    for (const [id, text] of entries) {
      if (!acceptProofread(text, fixed[id])) continue;
      out[id] = (fixed[id] as string).replace(/\s+/g, " ").trim();
      changed.push({ id, from: text, to: out[id] });
    }
    return { texts: out, changed };
  } catch {
    return { texts, changed: [] };
  }
}
