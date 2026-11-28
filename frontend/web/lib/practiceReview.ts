import type { PracticeReview } from "./pendingBrief";

/**
 * "EXPLAIN MY MISTAKES" after a practice test (docs/practice-exam.md): the mistakes become a lecture outline with
 * ONE part per mistake, built straight away with no planning questions. Each part is marked "shaky", so the board
 * builds on what the student got partly right; its caption carries the exact error, and its reason the right method.
 * Limits follow app/api/progressive-lectures/route.ts (title 100, caption 240, reason 240, focus 1000 characters).
 */
export type ReviewOutline = {
  topic: string;
  scope: "lesson";
  subtopics: { title: string; caption: string; reason: string; status: "shaky" }[];
};

const clip = (s: string, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

export function reviewOutline(topic: string, review: PracticeReview): ReviewOutline {
  const mistakes = review.mistakes.slice(0, 10);
  return {
    topic: clip(review.title || `My mistakes: ${topic}`, 200),
    scope: "lesson",
    subtopics: mistakes.map((m) => {
      const what = m.firstError ? `${m.firstError.step ? `At "${m.firstError.step}": ` : ""}${m.firstError.what}` : m.feedback;
      const right = m.correctWorking.length ? `Right method: ${m.correctWorking.join(" → ")}` : m.feedback;
      return {
        title: clip(`Question ${m.n}: ${m.stem}`, 100),
        caption: clip(`My answer: ${m.studentAnswer || "(none)"}. ${what}`, 240),
        reason: clip(`${m.firstError?.why ? `${m.firstError.why} ` : ""}${right}`, 240),
        status: "shaky" as const,
      };
    }),
  };
}

/** What the lecture writer is told the student wants: one board per mistake, about THEIR error. */
export function reviewFocus(review: PracticeReview): string {
  const lines = review.mistakes.slice(0, 10).map((m) => `Q${m.n}: ${m.firstError?.what ?? m.feedback}`);
  return clip(`Explain each of my practice test mistakes on its own board, one board per mistake: show exactly where my working went wrong, why, and the correct method step by step, then one quick check. ${lines.join(" ")}`, 1000);
}
