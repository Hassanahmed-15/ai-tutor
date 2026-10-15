import type { CurriculumLessonRequest } from "./lessonSpec";
import type { CurriculumTree } from "./types";

export type GoldBenchmarkTrack = "O Level" | "A Level" | "USA";
export type GoldBenchmarkMode = "typed" | "reference" | "strict";

export type GoldBenchmarkDefinition = {
  id: string;
  track: GoldBenchmarkTrack;
  courseId: string;
  subject: string;
  lessonPattern: RegExp;
  levelPattern?: RegExp;
};

export type GoldBenchmarkEvidence = {
  pages: number[];
  sourceKeys: string[];
  sourceChars: number;
  outcomeCount: number;
  officialCodes: string[];
};

export type ResolvedGoldBenchmark = GoldBenchmarkDefinition & {
  request: CurriculumLessonRequest;
  unitTitle: string;
  topicTitle: string;
  lessonTitle: string;
  outcomeTexts: string[];
  evidence: GoldBenchmarkEvidence;
};

export type BenchmarkRun = {
  run: 1 | 2 | 3;
  mode: GoldBenchmarkMode;
  status: "not-run" | "passed" | "failed";
  generatedAt: string | null;
  lessonId: string;
  boardCount: number | null;
  scores: Partial<Record<"authenticity" | "coverage" | "depth" | "accuracy" | "visual" | "sync" | "understanding" | "interaction" | "assessment" | "readiness", number>>;
  issues: string[];
};

/** The first Phase 1 gold set: five real lessons per curriculum track. */
export const GOLD_BENCHMARKS: readonly GoldBenchmarkDefinition[] = [
  { id: "olevel-biology-cells", track: "O Level", courseId: "cie-olevel-biology-5090-2026-2028", subject: "Biology", lessonPattern: /cell|plant|microscope/i },
  { id: "olevel-chemistry-atomic-structure", track: "O Level", courseId: "cie-olevel-chemistry-5070-2026-2028", subject: "Chemistry", lessonPattern: /atomic|atom|periodic/i },
  { id: "olevel-physics-measurement", track: "O Level", courseId: "cie-olevel-physics-5054-2026-2028", subject: "Physics", lessonPattern: /motion|force|measure|length|volume|time/i },
  { id: "olevel-mathematics-equations", track: "O Level", courseId: "cie-olevel-mathematics-d-4024-2025-2027", subject: "Mathematics", lessonPattern: /quadratic|equation|algebra|factor/i },
  { id: "olevel-computer-binary", track: "O Level", courseId: "cie-olevel-computer-science-2210-2026-2028", subject: "Computer Science", lessonPattern: /algorithm|binary|data|number system/i },

  { id: "alevel-biology-microscope", track: "A Level", courseId: "cie-alevel-biology-9700-2025-2027", subject: "Biology", lessonPattern: /cell|microscope/i, levelPattern: /^AS$/i },
  { id: "alevel-chemistry-atom", track: "A Level", courseId: "cie-alevel-chemistry-9701-2025-2027", subject: "Chemistry", lessonPattern: /atom|particle|bond/i, levelPattern: /^AS$/i },
  { id: "alevel-physics-motion", track: "A Level", courseId: "cie-alevel-physics-9702-2025-2027", subject: "Physics", lessonPattern: /motion|kinematic|force/i, levelPattern: /^AS$/i },
  { id: "alevel-mathematics-quadratics", track: "A Level", courseId: "cie-alevel-mathematics-9709-2026-2027", subject: "Mathematics", lessonPattern: /quadratic|differentiat|function/i, levelPattern: /^AS$/i },
  { id: "alevel-computer-data", track: "A Level", courseId: "cie-alevel-computer-science-9618-2026", subject: "Computer Science", lessonPattern: /algorithm|data|representation/i, levelPattern: /^AS$/i },

  { id: "usa-ap-biology-cells", track: "USA", courseId: "us-ap-biology", subject: "Biology", lessonPattern: /cell|gene|evolution|energy/i },
  { id: "usa-ap-chemistry-equilibrium", track: "USA", courseId: "us-ap-chemistry", subject: "Chemistry", lessonPattern: /equilibrium|atom|bond|reaction/i },
  { id: "usa-ap-physics-motion", track: "USA", courseId: "us-ap-physics-1", subject: "Physics", lessonPattern: /motion|force|kinematic|represent/i },
  { id: "usa-ap-computer-programs", track: "USA", courseId: "us-ap-computer-science-a", subject: "Computer Science", lessonPattern: /algorithm|program|data|method|class/i },
  { id: "usa-ap-statistics-study", track: "USA", courseId: "us-ap-statistics", subject: "Statistics", lessonPattern: /data|statistic|probability|sample|study/i },
];

type SourceLesson = { page?: number; code?: string | null; text?: string };
type SourceMap = Record<string, SourceLesson[]>;

export function resolveGoldBenchmark(tree: CurriculumTree, sourceLessons: SourceMap, definition: GoldBenchmarkDefinition): ResolvedGoldBenchmark {
  if (tree.id !== definition.courseId) throw new Error(`${definition.id}: expected ${definition.courseId}, received ${tree.id}`);
  const candidates: Array<{ grade: string; unit: { id: string; title: string }; topic: { id: string; title: string }; lesson: { id: string; title: string; outcomes: Array<{ text: string; code: string | null }> } }> = [];
  for (const grade of tree.grades) {
    if (definition.levelPattern && !definition.levelPattern.test(grade.grade)) continue;
    for (const unit of grade.units) for (const topic of unit.topics) for (const lesson of topic.subtopics) {
      const haystack = `${unit.title} ${topic.title} ${lesson.title}`;
      if (definition.lessonPattern.test(haystack)) candidates.push({ grade: grade.grade, unit, topic, lesson });
    }
  }
  const evidenceFor = (candidate: (typeof candidates)[number]): SourceLesson[] => {
    const exactSuffix = `/${candidate.topic.id}/${candidate.lesson.id}`;
    const exact = Object.entries(sourceLessons).find(([key]) => key.endsWith(exactSuffix));
    if (exact) return exact[1];
    // Some official documents split one tree subtopic into several source-sized lessons. Keep the
    // tree address used by the course API, but aggregate that topic's evidence for the benchmark.
    const topicEntries = Object.entries(sourceLessons).filter(([key]) => key.split("/").includes(candidate.topic.id));
    return topicEntries.flatMap(([, value]) => value);
  };
  const chosen = candidates.find((candidate) => evidenceFor(candidate).some((item) => (item.text?.length ?? 0) > 50)) ?? candidates[0];
  if (!chosen) throw new Error(`${definition.id}: no lesson matched ${definition.lessonPattern}`);
  const lessonKey = `${chosen.grade}/${chosen.unit.id}/${chosen.topic.id}/${chosen.lesson.id}`;
  const evidence = evidenceFor(chosen);
  if (!evidence.length) throw new Error(`${definition.id}: no source evidence for ${lessonKey}`);
  return {
    ...definition,
    request: { courseId: tree.id, version: tree.build.builtAt, grade: chosen.grade, unitId: chosen.unit.id, topicId: chosen.topic.id, lessonId: chosen.lesson.id },
    unitTitle: chosen.unit.title,
    topicTitle: chosen.topic.title,
    lessonTitle: chosen.lesson.title,
    outcomeTexts: chosen.lesson.outcomes.map((outcome) => outcome.text),
    evidence: {
      pages: [...new Set(evidence.map((item) => item.page).filter((page): page is number => typeof page === "number"))],
      sourceKeys: [lessonKey],
      sourceChars: evidence.reduce((total, item) => total + (item.text?.length ?? 0), 0),
      outcomeCount: chosen.lesson.outcomes.length,
      officialCodes: [...new Set(evidence.map((item) => item.code).filter((code): code is string => typeof code === "string" && code.length > 0))],
    },
  };
}

export function benchmarkRunPlan(lessons: ResolvedGoldBenchmark[]): Array<{ lesson: ResolvedGoldBenchmark; runs: BenchmarkRun[] }> {
  const modes: Record<BenchmarkRun["run"], GoldBenchmarkMode> = { 1: "typed", 2: "reference", 3: "strict" };
  return lessons.map((lesson) => ({
    lesson,
    runs: ([1, 2, 3] as const).map((run) => ({ run, mode: modes[run], status: "not-run", generatedAt: null, lessonId: lesson.id, boardCount: null, scores: {}, issues: [] })),
  }));
}
