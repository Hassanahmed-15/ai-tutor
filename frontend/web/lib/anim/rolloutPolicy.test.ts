import test from "node:test";
import assert from "node:assert/strict";
import { decideCurriculumRollout } from "../curriculum/rolloutPolicy";

const base = { staticGatePassed: true, benchmarkLessonsReviewed: 15, benchmarkLessonsTotal: 15, studentBoardPassRate: 1, syncPassRate: 1, averageCostUsd: 0.05, maxCostUsd: 0.2 };

test("Phase 9 holds rollout when quality or cost is unsafe", () => {
  const decision = decideCurriculumRollout({ ...base, benchmarkLessonsReviewed: 1, studentBoardPassRate: 0.7, averageCostUsd: 0.3 });
  assert.equal(decision.allowed, false);
  assert.equal(decision.mode, "hold");
  assert.ok(decision.reasons.some((reason) => /cost|pass rate/i.test(reason)));
});

test("Phase 9 permits canary only after at least one reviewed benchmark", () => {
  const decision = decideCurriculumRollout({ ...base, benchmarkLessonsReviewed: 3, benchmarkLessonsTotal: 15 });
  assert.equal(decision.allowed, true);
  assert.equal(decision.mode, "canary");
});

test("Phase 9 permits general rollout only after the full matrix passes", () => {
  const decision = decideCurriculumRollout(base);
  assert.deepEqual(decision, { allowed: true, mode: "general", reasons: [], nextStep: "Keep monitoring cost and board pass rate after rollout." });
});

test("rollout holds when a mode, curriculum or reviewed lesson is missing", () => {
  const decision = decideCurriculumRollout({
    ...base,
    modesReviewed: ["typed", "reference"],
    curriculaReviewed: ["O Level", "A Level"],
    failedBenchmarkLessons: 1,
    fallbackRate: 0.2,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reasons.join(" "), /strict|USA|failed|fallback/i);
});
