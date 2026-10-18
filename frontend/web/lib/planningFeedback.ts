import type { LearnerProfile } from "./learnerProfile";

/**
 * RIGHT OR WRONG, SAID BACK, WHEN THE STUDENT ANSWERS A PLANNING QUESTION (owner, 2026-10-18:
 * "congratulate the user for a right option, and for a wrong one tell them what was wrong, then
 * move on"). The server grades every answer to a knowledge question (lib/diagnosticPrompt.ts
 * gradedAnswer) and records it in the profile's diagnostics; this picks out the grade of the answer
 * just given and turns it into what Aria says and what the screen shows.
 *
 * A preference ("Intermediate, I know the basics"), a description of their own level, "Not sure" or
 * a skip is never judged: it gets a plain acknowledgement, as before.
 */
export type AnswerVerdict = { verdict: "correct" | "partial" | "incorrect" | "misconception"; misconception?: string };

/** The grade of `answer`, from the diagnostics the server added since `before`. Null when it is not a judgeable answer. */
export function verdictOfAnswer(before: LearnerProfile | null, after: LearnerProfile | null, answer: string): AnswerVerdict | null {
  if (!after || /^\s*not sure\s*$/i.test(answer)) return null;
  const fresh = after.diagnostics.slice(before?.diagnostics.length ?? 0);
  const result = [...fresh].reverse().find((d) => d.answer.trim() === answer.trim()) ?? fresh[fresh.length - 1];
  if (!result || result.selfReport || result.verdict === "skipped") return null;
  return { verdict: result.verdict, ...(result.misconception ? { misconception: result.misconception } : {}) };
}

/** What Aria is told to say about the answer, before she asks anything else. */
export function verdictVoiceLine(verdict: AnswerVerdict | null): string {
  if (!verdict) return "Acknowledge it in ONE short, natural sentence (do not grade it or teach).";
  if (verdict.verdict === "correct") return `Their answer is right: tell them so warmly in a few words (for example "That's right — well done!"), with no explanation.`;
  const belief = verdict.misconception ? ` They seem to think: "${verdict.misconception}".` : "";
  return `Their answer is not right.${belief} In ONE kind sentence, tell them what was wrong with it and what is actually true. Do not lecture.`;
}

/** The line shown under the next question. */
export function verdictNote(verdict: AnswerVerdict | null): string {
  if (!verdict) return "";
  return verdict.verdict === "correct" ? "That's right — well done!" : verdict.verdict === "partial" ? "Nearly — Aria explains what was missing." : "Not quite — Aria explains why.";
}
