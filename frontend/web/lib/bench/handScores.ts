import { BENCH_CRITERIA, pearson, type BenchCriterion, type BenchScores } from "./criteria";
import type { LessonJudgeVerdict } from "./judge";

export type HandScoredLecture = {
  id: string;
  title: string;
  scores: BenchScores;
};

export type CalibrationReport = {
  n: number;
  overallR: number;
  perCriterion: Record<BenchCriterion, number>;
  targetR: number;
  passed: boolean;
};

export function calibrateJudge(hand: HandScoredLecture[], judged: Array<{ id: string; verdict: LessonJudgeVerdict }>): CalibrationReport {
  const byId = new Map(judged.map((j) => [j.id, j.verdict.scores]));
  const paired = hand.filter((h) => byId.has(h.id));
  const overallHand = paired.map((h) => mean12(h.scores));
  const overallJudge = paired.map((h) => mean12(byId.get(h.id)!));
  const perCriterion = {} as Record<BenchCriterion, number>;
  for (const key of BENCH_CRITERIA) {
    perCriterion[key] = pearson(paired.map((h) => h.scores[key]), paired.map((h) => byId.get(h.id)![key]));
  }
  const overallR = pearson(overallHand, overallJudge);
  const diagramsR = perCriterion.diagramsAndLabels;
  return {
    n: paired.length,
    overallR,
    perCriterion,
    targetR: 0.7,
    passed: paired.length >= 9 && overallR >= 0.7 && diagramsR >= 0.7,
  };
}

function mean12(s: BenchScores): number {
  return BENCH_CRITERIA.reduce((n, k) => n + s[k], 0) / BENCH_CRITERIA.length;
}
