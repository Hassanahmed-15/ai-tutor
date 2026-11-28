import { readingGrade } from "./studentCard";

/**
 * THE TEST READS NO HARDER THAN THE LESSON (owner QA brief, 2026-11-28, item 4j: the written test used formal
 * phrasing the lesson never did). The lesson's own narration sets the level — measured, so it follows whatever
 * the student was taught at, a beginner's grade-6 lesson or a university one — and every question is checked
 * against it after it is written. Pure (lib/anim/wordingChecks.test.ts).
 */

export type TestWordingTarget = { grade: number; sentenceWords: number };

const sentencesOf = (t: string) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const wordsIn = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** The lesson's reading grade and a sentence length a little above its usual one. */
export function testWordingTarget(scripts: string[]): TestWordingTarget {
  const all = scripts.filter(Boolean).join(" ");
  const lengths = sentencesOf(all).map(wordsIn).sort((a, b) => a - b);
  const typical = lengths.length ? lengths[Math.floor(lengths.length * 0.75)] : 16;
  return { grade: Math.max(3, Math.round(readingGrade(all) || 8)), sentenceWords: Math.max(12, Math.min(25, typical + 3)) };
}

/** The rule the test writer is given. */
export function testWordingRule(t: TestWordingTarget): string {
  return `WORDING: the lesson was taught at reading grade ${t.grade}. Word every question, its oral phrasing and the model answer no harder: sentences of at most ${t.sentenceWords} words, the everyday words the lesson used, each term only as the lesson used it. A hard question is hard because of the thinking it asks for, never because of its words — no formal or textbook phrasing where plain words say the same. Spell every word correctly.`;
}

/** Questions worded harder than the lesson: their reading grade well above it, or a sentence far too long. */
export function testWordingIssues(questions: Array<{ id: string; prompt: string }>, t: TestWordingTarget): Array<{ id: string; why: string }> {
  const out: Array<{ id: string; why: string }> = [];
  for (const q of questions) {
    const g = readingGrade(q.prompt);
    const longest = Math.max(0, ...sentencesOf(q.prompt).map(wordsIn));
    // A single question is a short text, so its grade is noisy: two grades over the lesson before it counts.
    if (g > t.grade + 2) out.push({ id: q.id, why: `reads at grade ${g}, the lesson at ${t.grade}` });
    else if (longest > t.sentenceWords + 6) out.push({ id: q.id, why: `a sentence of ${longest} words` });
  }
  return out;
}
