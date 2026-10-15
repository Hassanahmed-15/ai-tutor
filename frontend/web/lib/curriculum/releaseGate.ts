import type { ResolvedGoldBenchmark } from "./goldBenchmarks";
import type { GoldBenchmarkMode } from "./goldBenchmarks";
import type { CurriculumTrack } from "../board/curriculumSyncBenchmarks";

export type ReleaseGateCheck = { name: string; passed: boolean; detail: string };
export type CurriculumReleaseGate = {
  passed: boolean;
  checks: ReleaseGateCheck[];
  blockers: string[];
  warnings: string[];
};

export type CurriculumReleaseReview = {
  lessonId: string;
  track: CurriculumTrack;
  mode: GoldBenchmarkMode;
  passed: boolean;
  studentBoardPassRate: number;
  syncPassRate: number;
  costUsd: number;
  boardCount: number;
  fallbackBoards: number;
};

/**
 * Phase 6's cheap release gate. It validates the benchmark matrix and sync fixtures without
 * generating a lecture or calling a model. A real run is still required before claiming quality.
 */
export function evaluateCurriculumReleaseGate(
  lessons: ResolvedGoldBenchmark[],
  sync: Array<{ id: string; track: CurriculumTrack; passed: boolean }>,
  executedRuns = 0,
  reviews: CurriculumReleaseReview[] = [],
): CurriculumReleaseGate {
  const checks: ReleaseGateCheck[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const tracks: CurriculumTrack[] = ["O Level", "A Level", "USA"];
  const counts = Object.fromEntries(tracks.map((track) => [track, lessons.filter((l) => l.track === track).length])) as Record<CurriculumTrack, number>;
  const balanced = tracks.every((track) => counts[track] === 5);
  checks.push({ name: "gold benchmark balance", passed: balanced, detail: tracks.map((track) => `${track}: ${counts[track]}`).join(", ") });
  if (!balanced) blockers.push("Gold benchmark set must contain exactly five lessons per track.");

  const evidence = lessons.filter((lesson) => lesson.evidence.pages.length > 0 && lesson.evidence.sourceChars > 50 && lesson.evidence.outcomeCount > 0);
  checks.push({ name: "official evidence", passed: evidence.length === lessons.length, detail: `${evidence.length}/${lessons.length} lessons have pages, source text and outcomes` });
  if (evidence.length !== lessons.length) blockers.push("Every gold lesson needs official source evidence and at least one outcome.");

  const syncPassed = sync.filter((result) => result.passed).length;
  checks.push({ name: "sentence-to-board sync", passed: sync.length > 0 && syncPassed === sync.length, detail: `${syncPassed}/${sync.length} sync fixtures pass` });
  if (!sync.length || syncPassed !== sync.length) blockers.push("Every curriculum sync fixture must pass before release.");

  const reviewedLessons = reviews.length ? new Set(reviews.map((review) => review.lessonId)).size : executedRuns;
  if (reviewedLessons < lessons.length) warnings.push(`Only ${reviewedLessons}/${lessons.length} gold lessons have been generated and reviewed; static checks are not a substitute for student-facing review.`);
  const paidReviewPassed = reviewedLessons >= lessons.length;
  checks.push({ name: "paid generation review", passed: paidReviewPassed, detail: `${reviewedLessons}/${lessons.length} benchmark lessons reviewed` });

  if (reviews.length) {
    const modes: GoldBenchmarkMode[] = ["typed", "reference", "strict"];
    const reviewedModes = modes.filter((mode) => reviews.some((review) => review.mode === mode));
    const reviewedTracks = tracks.filter((track) => reviews.some((review) => review.track === track));
    const coveragePassed = reviewedModes.length === modes.length && reviewedTracks.length === tracks.length;
    checks.push({ name: "mode and curriculum coverage", passed: coveragePassed, detail: `modes: ${reviewedModes.join(", ") || "none"}; tracks: ${reviewedTracks.join(", ") || "none"}` });
    if (!coveragePassed) blockers.push("Reviewed runs must include typed, reference and strict modes across O Level, A Level and USA curricula.");

    const qualityPassed = reviews.every((review) => review.passed && review.studentBoardPassRate === 1 && review.syncPassRate === 1);
    checks.push({ name: "reviewed lesson quality", passed: qualityPassed, detail: `${reviews.filter((review) => review.passed && review.studentBoardPassRate === 1 && review.syncPassRate === 1).length}/${reviews.length} runs passed every board and sync gate` });
    if (!qualityPassed) blockers.push("Every reviewed run must pass with 100% student-board and sentence-sync rates.");

    const totalBoards = reviews.reduce((sum, review) => sum + Math.max(0, review.boardCount), 0);
    const fallbackBoards = reviews.reduce((sum, review) => sum + Math.max(0, review.fallbackBoards), 0);
    const fallbackRate = totalBoards ? fallbackBoards / totalBoards : 1;
    const fallbackPassed = totalBoards > 0 && fallbackRate <= 0.1;
    checks.push({ name: "fallback board rate", passed: fallbackPassed, detail: `${fallbackBoards}/${totalBoards} boards (${Math.round(fallbackRate * 100)}%)` });
    if (!fallbackPassed) blockers.push("More than 10% of reviewed boards used degraded fallbacks.");

    const averageCost = reviews.reduce((sum, review) => sum + review.costUsd, 0) / reviews.length;
    const maxCost = Math.max(...reviews.map((review) => review.costUsd));
    const costPassed = averageCost <= 0.15 && maxCost <= 0.5;
    checks.push({ name: "generation cost", passed: costPassed, detail: `average $${averageCost.toFixed(3)}, maximum $${maxCost.toFixed(3)}` });
    if (!costPassed) blockers.push("Reviewed generation cost exceeds the $0.15 average or $0.50 single-lesson limit.");
  }
  return { passed: blockers.length === 0 && paidReviewPassed, checks, blockers, warnings };
}
