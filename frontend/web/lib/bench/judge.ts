import { BENCH_CRITERIA, clampScore, type BenchScores } from "./criteria";
import { rubricLines } from "./rubric";

/** Lesson writer family is OpenAI gpt-5.6-luna. The judge must be a different family. */
export const BENCH_JUDGE_FAMILY = "google";
export const BENCH_JUDGE_MODEL = process.env.BENCH_JUDGE_MODEL ?? "gemini-2.5-flash";

export type BoardJudgeInput = {
  lessonTitle: string;
  syllabus: string;
  outcomes: string[];
  boardTitle: string;
  script: string;
  quiz?: { question: string; options: string[]; correct?: string };
};

export type LessonJudgeVerdict = {
  scores: BenchScores;
  notes: Partial<Record<keyof BenchScores, string>>;
  diagramsAndLabelsEvidence: string;
};

export function judgeSystemPrompt(): string {
  return `You are a strict Cambridge O/A Level examiner scoring ONE lesson from PNG boards plus the spoken scripts and quiz cards.
Score each criterion 1–10 integers, as a fair teacher would: 9–10 is a lesson a student learns well from, and small imperfections do not pull a criterion below 8. Do not give 9 or 10 for diagrams when a diagram label points at the wrong part or overlaps another.
The writer model is a different family from you; do not assume its diagrams are correct — inspect the PNG.
Criteria:\n${rubricLines()}
Return JSON only: {"scores": {${BENCH_CRITERIA.map((c) => `"${c}": n`).join(", ")}}, "notes": {}, "diagramsAndLabelsEvidence": "..."}.`;
}

export function parseJudgeJson(raw: string): LessonJudgeVerdict {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("judge returned no JSON object");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { scores?: Record<string, number>; notes?: Record<string, string>; diagramsAndLabelsEvidence?: string };
  const scores = {} as BenchScores;
  for (const key of BENCH_CRITERIA) scores[key] = clampScore(Number(parsed.scores?.[key] ?? 1));
  return {
    scores,
    notes: parsed.notes ?? {},
    diagramsAndLabelsEvidence: String(parsed.diagramsAndLabelsEvidence ?? ""),
  };
}

export function judgeUserPayload(input: BoardJudgeInput[], lessonTitle: string): string {
  return JSON.stringify({
    lessonTitle,
    boards: input.map((b) => ({
      title: b.boardTitle,
      script: b.script,
      syllabus: b.syllabus,
      outcomes: b.outcomes,
      quiz: b.quiz ?? null,
    })),
  });
}
