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

/**
 * THE CARD'S CHECKS, ANSWERED (professor's review, 2026-10-20: "question correct ans — what happens?").
 * The question card grades its checks on Submit and said nothing about them: a student who answered
 * "A queue" correctly heard only "would you like to change the plan?". This is what Aria is told to
 * say before the plan: praise for what was right, and for each wrong answer the right one, kindly.
 * Empty when no check was answered (all "Not sure", or none asked).
 */
export function cardChecksVoiceLine(
  parts: Array<{ id: string; check: { question: string; options: string[]; answer: number } | null }>,
  outcomes: Record<string, "right" | "wrong" | "unsure">,
  answers: Record<string, string>,
): string {
  const right = parts.filter((p) => p.check && outcomes[p.id] === "right");
  const wrong = parts.filter((p) => p.check && outcomes[p.id] === "wrong");
  if (!right.length && !wrong.length) return "";
  const said = [`The student just answered ${right.length + wrong.length === 1 ? "a quick check" : "some quick checks"}.`];
  if (right.length) said.push(`Right: ${right.map((p) => `"${p.check!.question}"`).join("; ")}. Tell them warmly, in a few words, that ${right.length === 1 ? "it is" : "these are"} right (for example "That's right, well done!"), with no explanation.`);
  if (wrong.length) said.push(`Not right: ${wrong.map((p) => `"${p.check!.question}" they chose "${answers[p.id] ?? ""}", but the answer is "${p.check!.options[p.check!.answer]}"`).join("; ")}. In ONE kind sentence each, say what the right answer is and why, simply. Do not lecture.`);
  return said.join(" ");
}
