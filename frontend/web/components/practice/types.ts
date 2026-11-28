/**
 * The practice exam's shapes as the browser sees them (docs/practice-exam.md). Kept here, not imported from
 * lib/practice/types.ts, so the client never pulls a server module in; the two must stay in step with the doc.
 */
export type Difficulty = "easy" | "medium" | "hard";
export type Style = "mcq" | "short" | "worked";

export type ExamPlan = {
  topic: string;
  level: string;
  board?: string;
  subtopics: string[];
  count: number;
  mix: { easy: number; medium: number; hard: number };
  styles: Style[];
  minutes: number | null;
  /** A practice sheet's lecture or course lesson; absent for a typed topic. */
  source?: PracticeSource;
};
/**
 * WHAT A PRACTICE SHEET IS WRITTEN FROM (2026-11-27): a lecture the student watched or a course lesson. `text` is what
 * was taught (board titles, claims, points, a little of the script; a course adds its outcomes), and every question
 * must stay inside it. `exam` names a course's exam ("Cambridge IGCSE Mathematics 0580 · Core"); `examples` are that
 * course's own exam-style questions, for the style. Data from the browser: the server caps it and never obeys it.
 */
export type PracticeSource = {
  kind: "lecture" | "course";
  title: string;
  text: string;
  exam?: string;
  examples?: string[];
};


export type PlanOptions = {
  subtopics: string[];
  levels: string[];
  suggestion: { count: number; mix: { easy: number; medium: number; hard: number }; styles: Style[]; minutes: number | null };
};

export type StudentQuestion = {
  id: string;
  n: number;
  difficulty: Difficulty;
  style: Style;
  marks: number;
  subtopic: string;
  stem: string;
  options?: Record<"A" | "B" | "C" | "D", string>;
  parts: { label: string; marks: number; text: string }[];
  answerOn: "screen" | "paper";
};

export type QuestionResult = {
  id: string;
  awarded: number;
  max: number;
  correct: boolean;
  studentAnswer: string;
  feedback: string;
  firstError?: { step: string; what: string; why: string };
  correctWorking: string[];
  readConfidence?: "high" | "low";
};

export type ExamResult = { examId: string; total: number; max: number; percent: number; grade: string; results: QuestionResult[]; mistakes: QuestionResult[]; costUsd: number };

export type Answers = Record<string, { choice?: string; text?: string }>;
