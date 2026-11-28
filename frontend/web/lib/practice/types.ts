/**
 * PRACTICE EXAM TYPES (docs/practice-exam.md is the contract; the client in components/practice/* reads the same
 * shapes). Pure: no server code here, so the browser and the tests can import it.
 */
export type Difficulty = "easy" | "medium" | "hard";
/** worked = a long numerical or structured question, answered on paper. */
export type Style = "mcq" | "short" | "worked";
export type OptionKey = "A" | "B" | "C" | "D";

export type ExamPlan = {
  topic: string;
  level: string;
  /** e.g. "IGCSE", "Cambridge 0620". */
  board?: string;
  /** [] = everything in the topic. */
  subtopics: string[];
  /** 3–15, default 8. */
  count: number;
  /** Counts that sum to `count`. */
  mix: { easy: number; medium: number; hard: number };
  /** Allowed styles. */
  styles: Style[];
  /** null = untimed. */
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


/** What the browser sees: NO answers or schemes. */
export type StudentQuestion = {
  id: string;
  n: number;
  difficulty: Difficulty;
  style: Style;
  marks: number;
  subtopic: string;
  /** May use $…$ LaTeX for maths. */
  stem: string;
  /** mcq only. */
  options?: Record<OptionKey, string>;
  /** short/worked; [] for mcq. */
  parts: { label: string; marks: number; text: string }[];
  /** worked → paper. */
  answerOn: "screen" | "paper";
};

export type Scheme = {
  id: string;
  /** mcq: the key letter. */
  answer?: string;
  points: { label: string; text: string; marks: number }[];
  working: string[];
  commonErrors: string[];
};

export type QuestionResult = {
  id: string;
  awarded: number;
  max: number;
  correct: boolean;
  /** What Aria read (typed, or transcribed from the photo). */
  studentAnswer: string;
  /** One or two plain sentences. */
  feedback: string;
  /** Where the working first went wrong. */
  firstError?: { step: string; what: string; why: string };
  /** The right steps. */
  correctWorking: string[];
  /** Photo answers: how sure the reading is. */
  readConfidence?: "high" | "low";
};

export type ExamResult = {
  examId: string;
  total: number;
  max: number;
  percent: number;
  grade: string;
  results: QuestionResult[];
  mistakes: QuestionResult[];
  costUsd: number;
};

/** One question as kept on the server: the student's view plus its checked mark scheme. */
export type StoredQuestion = StudentQuestion & { scheme: Scheme };

/** The exam as kept in storage (practice/exam/<examId>.json). Only `userId` may grade it. */
export type StoredExam = {
  id: string;
  userId: string;
  plan: ExamPlan;
  questions: StoredQuestion[];
  minutes: number | null;
  createdAt: string;
  costUsd: number;
};

export type PlanOptions = {
  subtopics: string[];
  levels: string[];
  suggestion: { count: number; mix: ExamPlan["mix"]; styles: Style[]; minutes: number | null };
};

/** The grade route's body. */
export type Answers = Record<string, { choice?: string; text?: string }>;
