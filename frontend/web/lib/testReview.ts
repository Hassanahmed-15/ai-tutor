/**
 * "REVIEW SLIDE N" FROM THE TEST RESULTS (QA brief, 2026-11-28: it opened the board blank and paused).
 * The board now opens fully drawn and Aria says a short re-explanation aimed at what went wrong in the
 * answer — built here from the grader's own words and the question's model answer, with no model call.
 * Pure; unit-tested in lib/anim/testReview.test.ts.
 */
import type { TestGradeResult, TestQuestion } from "./testPrompt";

export type SlideReview = {
  /** The board (0-based) to open. */
  index: number;
  /** What Aria says over the finished board. */
  say: string;
  /** The one line shown on the board: what to fix. */
  note: string;
};

const sentence = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim().replace(/[.;:,]+$/, "");
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : "";
};
const clip = (s: string, words: number) => {
  const all = s.split(/\s+/).filter(Boolean);
  return all.length <= words ? s : `${all.slice(0, words).join(" ")}…`;
};

/** The review of one wrongly answered question, on the board that taught it. */
export function slideReview(index: number, question: TestQuestion, result: TestGradeResult): SlideReview {
  const fix = result.misconception?.trim() || (result.missingKeyPoints.length ? `Your answer left out: ${result.missingKeyPoints.slice(0, 2).join("; ")}` : result.feedback.trim());
  const right = question.rubric.modelAnswer.trim() || question.rubric.keyPoints.slice(0, 2).join(". ");
  const parts = [
    `Let's look at this board again, for the question "${clip(question.prompt.replace(/[?.!\s]+$/, ""), 18)}".`,
    result.misconception ? sentence(`The slip in your answer: ${result.misconception}`) : result.missingKeyPoints.length ? sentence(`What your answer missed: ${result.missingKeyPoints.slice(0, 2).join(", and ")}`) : "",
    right ? sentence(`Here is the idea to hold on to: ${clip(right, 45)}`) : "",
    "Look at the board as you think it through, then press Play to hear this board again, or Next to move on.",
  ].filter(Boolean);
  return { index, say: parts.join(" "), note: clip(fix, 24) };
}
