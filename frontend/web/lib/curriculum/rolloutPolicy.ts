export type RolloutMetrics = {
  staticGatePassed: boolean;
  benchmarkLessonsReviewed: number;
  benchmarkLessonsTotal: number;
  studentBoardPassRate: number;
  syncPassRate: number;
  averageCostUsd: number;
  maxCostUsd: number;
  modesReviewed?: Array<"typed" | "reference" | "strict">;
  curriculaReviewed?: Array<"O Level" | "A Level" | "USA">;
  failedBenchmarkLessons?: number;
  fallbackRate?: number;
};

export type RolloutDecision = {
  allowed: boolean;
  mode: "hold" | "canary" | "general";
  reasons: string[];
  nextStep: string;
};

/** Phase 9 rollout policy. Thresholds are explicit so quality cannot be traded for a quiet deploy. */
export function decideCurriculumRollout(metrics: RolloutMetrics): RolloutDecision {
  const reasons: string[] = [];
  if (!metrics.staticGatePassed) reasons.push("static curriculum gate has not passed");
  if (metrics.syncPassRate < 1) reasons.push("not every board is sentence-synchronised");
  if (metrics.averageCostUsd > 0.15 || metrics.maxCostUsd > 0.5) reasons.push("generation cost exceeds the curriculum budget");
  if (metrics.failedBenchmarkLessons !== undefined && metrics.failedBenchmarkLessons > 0) reasons.push(`${metrics.failedBenchmarkLessons} reviewed benchmark lesson(s) failed`);
  if (metrics.fallbackRate !== undefined && metrics.fallbackRate > 0.1) reasons.push("more than 10% of reviewed boards used degraded fallbacks");
  if (metrics.modesReviewed && !["typed", "reference", "strict"].every((mode) => metrics.modesReviewed!.includes(mode as "typed" | "reference" | "strict"))) reasons.push("typed, reference and strict modes have not all been reviewed");
  if (metrics.curriculaReviewed && !["O Level", "A Level", "USA"].every((track) => metrics.curriculaReviewed!.includes(track as "O Level" | "A Level" | "USA"))) reasons.push("O Level, A Level and USA curricula have not all been reviewed");
  if (metrics.benchmarkLessonsReviewed === 0) return { allowed: false, mode: "hold", reasons: [...reasons, "no benchmark lesson has been reviewed"], nextStep: "Review one lesson from each track before enabling a canary." };
  // Averages must never hide a known-bad student board. A canary may be small, but every board in
  // the reviewed release set must pass its hard student-view and semantic gates.
  if (metrics.studentBoardPassRate < 1) reasons.push("student-view board pass rate is below 100%");
  if (metrics.benchmarkLessonsReviewed < metrics.benchmarkLessonsTotal || reasons.length) {
    return { allowed: reasons.length === 0, mode: reasons.length === 0 ? "canary" : "hold", reasons, nextStep: reasons.length ? "Fix the listed quality or cost failures, then rerun the audit." : "Review the remaining benchmark lessons before general rollout." };
  }
  return { allowed: true, mode: "general", reasons: [], nextStep: "Keep monitoring cost and board pass rate after rollout." };
}
