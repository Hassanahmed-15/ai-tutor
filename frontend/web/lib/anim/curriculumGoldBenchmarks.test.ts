import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  benchmarkRunPlan,
  GOLD_BENCHMARKS,
  resolveGoldBenchmark,
} from "../curriculum/goldBenchmarks";
import type { CurriculumTree } from "../curriculum/types";

const root = path.join(process.cwd(), "data", "curricula");

function loadTree(courseId: string): CurriculumTree {
  return JSON.parse(readFileSync(path.join(root, "trees", `${courseId}.json`), "utf8")) as CurriculumTree;
}

function loadSources(courseId: string): Record<string, Array<{ page?: number; code?: string | null; text?: string }>> {
  const parsed = JSON.parse(readFileSync(path.join(root, "sources", `${courseId}.json`), "utf8")) as { lessons: Record<string, Array<{ page?: number; code?: string | null; text?: string }>> };
  return parsed.lessons;
}

test("the Phase 1 gold set resolves to real syllabus lessons and evidence", () => {
  assert.equal(GOLD_BENCHMARKS.length, 15);
  assert.equal(new Set(GOLD_BENCHMARKS.map((benchmark) => benchmark.id)).size, 15);
  for (const track of ["O Level", "A Level", "USA"] as const) {
    assert.equal(GOLD_BENCHMARKS.filter((benchmark) => benchmark.track === track).length, 5);
  }

  for (const definition of GOLD_BENCHMARKS) {
    const resolved = resolveGoldBenchmark(loadTree(definition.courseId), loadSources(definition.courseId), definition);
    assert.equal(resolved.request.courseId, definition.courseId);
    assert.ok(resolved.request.version, `${definition.id}: missing source build version`);
    assert.ok(resolved.lessonTitle.length > 2, `${definition.id}: unusable lesson title`);
    assert.ok(resolved.outcomeTexts.length > 0, `${definition.id}: no outcomes`);
    assert.ok(resolved.evidence.pages.length > 0, `${definition.id}: no source page evidence`);
    assert.ok(resolved.evidence.sourceChars > 50, `${definition.id}: source evidence is too small`);
  }
});

test("each gold lesson has one generation slot for every teaching mode", () => {
  const lessons = GOLD_BENCHMARKS.map((definition) => resolveGoldBenchmark(loadTree(definition.courseId), loadSources(definition.courseId), definition));
  const plan = benchmarkRunPlan(lessons);
  assert.equal(plan.length, 15);
  assert.equal(plan.reduce((count, item) => count + item.runs.length, 0), 45);
  for (const item of plan) {
    assert.deepEqual(item.runs.map((run) => run.run), [1, 2, 3]);
    assert.deepEqual(item.runs.map((run) => run.mode), ["typed", "reference", "strict"]);
    assert.ok(item.runs.every((run) => run.status === "not-run"));
  }
});
