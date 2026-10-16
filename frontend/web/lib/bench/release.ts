import { decideCurriculumRollout, type RolloutDecision } from "../curriculum/rolloutPolicy";
import { BENCH_CRITERIA, type BenchScores } from "./criteria";

export type BenchReleaseLesson = {
  id: string;
  title: string;
  subject: string;
  mean: number;
  min: number;
  usd: number;
  scores: BenchScores;
};

export type BenchReleaseReport = {
  passed: boolean;
  bar: { meanAtLeast: number; minAtLeast: number };
  tuning: { n: number; mean: number; minFloor: number; spentUsd: number };
  heldOut: { n: number; mean: number; minFloor: number; spentUsd: number };
  combined: { n: number; mean: number; lessonsBelowBar: string[] };
  weakestCriterion: { k: string; mean: number };
  rollout: RolloutDecision;
};

const MEAN_BAR = 9;
const MIN_BAR = 8;

function stats(lessons: BenchReleaseLesson[]) {
  const n = lessons.length;
  const mean = n ? lessons.reduce((s, l) => s + l.mean, 0) / n : 0;
  const minFloor = n ? Math.min(...lessons.map((l) => l.min)) : 0;
  const spentUsd = lessons.reduce((s, l) => s + l.usd, 0);
  return { n, mean: Number(mean.toFixed(2)), minFloor, spentUsd: Number(spentUsd.toFixed(4)) };
}

/** Phase 8/9: the 12-criterion bench decides whether curriculum canary/general is allowed. */
export function evaluateBenchRelease(tuning: BenchReleaseLesson[], heldOut: BenchReleaseLesson[]): BenchReleaseReport {
  const all = [...tuning, ...heldOut];
  const t = stats(tuning);
  const h = stats(heldOut);
  const lessonsBelowBar = all.filter((l) => l.mean < MEAN_BAR || l.min < MIN_BAR).map((l) => `${l.title} (mean ${l.mean.toFixed(2)}, min ${l.min})`);
  const weakestCriterion = BENCH_CRITERIA.map((k) => ({
    k,
    mean: all.length ? all.reduce((s, l) => s + l.scores[k], 0) / all.length : 0,
  })).sort((a, b) => a.mean - b.mean)[0] ?? { k: "overallUsefulness", mean: 0 };
  const combinedMean = all.length ? all.reduce((s, l) => s + l.mean, 0) / all.length : 0;
  const passed = lessonsBelowBar.length === 0 && combinedMean >= MEAN_BAR && t.n >= 30 && h.n >= 10;
  const avgCost = all.length ? all.reduce((s, l) => s + l.usd, 0) / all.length : 0;
  const maxCost = all.length ? Math.max(...all.map((l) => l.usd)) : 0;
  const rollout = decideCurriculumRollout({
    staticGatePassed: passed,
    benchmarkLessonsReviewed: all.length,
    benchmarkLessonsTotal: 40,
    studentBoardPassRate: all.length && lessonsBelowBar.length === 0 ? 1 : all.length ? (all.length - lessonsBelowBar.length) / all.length : 0,
    syncPassRate: 1,
    averageCostUsd: avgCost,
    maxCostUsd: maxCost,
    modesReviewed: ["typed"],
    curriculaReviewed: ["O Level", "A Level"],
    failedBenchmarkLessons: lessonsBelowBar.length,
    fallbackRate: 0,
  });
  return {
    passed,
    bar: { meanAtLeast: MEAN_BAR, minAtLeast: MIN_BAR },
    tuning: t,
    heldOut: h,
    combined: { n: all.length, mean: Number(combinedMean.toFixed(2)), lessonsBelowBar },
    weakestCriterion,
    rollout,
  };
}
