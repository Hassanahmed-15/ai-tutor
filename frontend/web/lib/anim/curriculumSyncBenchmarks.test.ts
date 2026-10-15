import test from "node:test";
import assert from "node:assert/strict";

import {
  benchmarksForTrack,
  CURRICULUM_SYNC_BENCHMARKS,
  evaluateCurriculumSyncBenchmark,
} from "../board/curriculumSyncBenchmarks";
import { evaluateSyncGate } from "../board/sentenceSync";

test("the curriculum sync benchmark has five lectures for each track", () => {
  assert.equal(CURRICULUM_SYNC_BENCHMARKS.length, 15);
  for (const track of ["O Level", "A Level", "USA"] as const) {
    const benchmarks = benchmarksForTrack(track);
    assert.equal(benchmarks.length, 5, `${track} must have five benchmark lectures`);
    assert.equal(new Set(benchmarks.map((benchmark) => benchmark.id)).size, 5);
    for (const benchmark of benchmarks) {
      assert.equal(benchmark.script.length, 5, `${benchmark.id} should exercise five narration sentences`);
      assert.equal(benchmark.ops.length, 5, `${benchmark.id} should exercise five visual events`);
    }
  }
});

test("all 15 curriculum benchmark lectures pass the strict sync gate", () => {
  for (const benchmark of CURRICULUM_SYNC_BENCHMARKS) {
    const result = evaluateCurriculumSyncBenchmark(benchmark);
    assert.equal(result.passed, true, `${benchmark.id}: ${result.issues.join("; ")}`);
    assert.equal(result.legacy, false, benchmark.id);
    assert.equal(result.coverage, 1, benchmark.id);
    assert.equal(result.boundRatio, 1, benchmark.id);
  }
});

test("the strict sync gate rejects an unbound new board", () => {
  const result = evaluateSyncGate([{ at: 0.2 }, { at: 0.7 }], 5, { requireSentenceBinding: true });
  assert.equal(result.passed, false);
  assert.equal(result.legacy, true);
  assert.match(result.issues.join(" "), /atSentence|visuals cover/i);
});

test("the migration gate reports legacy boards without rejecting playback by default", () => {
  const result = evaluateSyncGate([{ at: 0.2 }, { at: 0.7 }], 2);
  assert.equal(result.passed, true);
  assert.equal(result.legacy, true);
  assert.deepEqual(result.issues, []);
});

