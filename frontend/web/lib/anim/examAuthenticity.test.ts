import test from "node:test";
import assert from "node:assert/strict";
import { commandWordsOf, examAuthenticityIssues, examReadinessScore } from "../curriculum/examAuthenticity";
import { evaluateBenchRelease } from "../bench/release";
import { BENCH_CRITERIA, type BenchScores } from "../bench/criteria";
import type { CanvasPlanBeat } from "../canvas/types";

const beat = (title: string, script: string): CanvasPlanBeat => ({
  id: "b1", title, script, stage: "figure", brief: title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false,
});

test("Phase 4 reads command words from official outcomes, not from a downloaded mark scheme", () => {
  assert.deepEqual(commandWordsOf(["Describe the structure of a leaf.", "Calculate the area of a sector."]), ["describe", "calculate"]);
  const weak = examAuthenticityIssues(["Explain osmosis."], [beat("Water", "Water moves from dilute to concentrated.")]);
  assert.ok(weak.some((i) => /explain/i.test(i)));
  const strong = [beat("Osmosis", "Water moves from dilute to concentrated. Predict: which way? From dilute to concentrated. Now explain osmosis in a new example.")];
  assert.equal(examAuthenticityIssues(["Explain osmosis."], strong).length, 0);
  assert.equal(examReadinessScore(["Explain osmosis."], strong), 10);
});

test("Phase 8/9 release holds until held-out 10 also clear the 9/10 bar", () => {
  const scores = Object.fromEntries(BENCH_CRITERIA.map((k) => [k, 9])) as BenchScores;
  const lesson = (id: string, title: string): Parameters<typeof evaluateBenchRelease>[0][number] => ({
    id, title, subject: "biology", mean: 9.5, min: 8, usd: 0.03, scores,
  });
  const tuning = Array.from({ length: 30 }, (_, i) => lesson(`t${i}`, `Tune ${i}`));
  const held = Array.from({ length: 10 }, (_, i) => lesson(`h${i}`, `Hold ${i}`));
  const pass = evaluateBenchRelease(tuning, held);
  assert.equal(pass.passed, true);
  assert.equal(pass.rollout.mode, "hold", "USA / typed-only coverage is not a general rollout");
  const fail = evaluateBenchRelease(tuning, held.map((l, i) => (i === 0 ? { ...l, min: 6, mean: 8.5 } : l)));
  assert.equal(fail.passed, false);
  assert.ok(fail.combined.lessonsBelowBar.length);
});
