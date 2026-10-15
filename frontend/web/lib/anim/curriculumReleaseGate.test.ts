import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCurriculumReleaseGate } from "../curriculum/releaseGate";
import type { ResolvedGoldBenchmark } from "../curriculum/goldBenchmarks";

const lesson = (track: "O Level" | "A Level" | "USA", id: string): ResolvedGoldBenchmark => ({
  id, track, courseId: id, subject: "Science", lessonPattern: /x/, request: { courseId: id, version: "v", grade: "x", unitId: "u", topicId: "t", lessonId: "l" },
  unitTitle: "Unit", topicTitle: "Topic", lessonTitle: "Lesson", outcomeTexts: ["Explain"],
  evidence: { pages: [1], sourceKeys: ["x"], sourceChars: 100, outcomeCount: 1, officialCodes: ["1"] },
});

test("Phase 6 release gate is balanced and cost-safe before paid generation", () => {
  const lessons = (["O Level", "A Level", "USA"] as const).flatMap((track) => Array.from({ length: 5 }, (_, i) => lesson(track, `${track}-${i}`)));
  const sync = lessons.map((l) => ({ id: l.id, track: l.track, passed: true }));
  const gate = evaluateCurriculumReleaseGate(lessons, sync, 0);
  assert.equal(gate.checks.every((check) => check.name !== "gold benchmark balance" || check.passed), true);
  assert.equal(gate.passed, false, "unrun lessons cannot be reported as release-ready");
  assert.ok(gate.warnings.some((warning) => /not a substitute/i.test(warning)));
});

test("Phase 6 blocks missing evidence or a failed sync fixture", () => {
  const lessons = (["O Level", "A Level", "USA"] as const).flatMap((track) => Array.from({ length: 5 }, (_, i) => lesson(track, `${track}-${i}`)));
  lessons[0] = { ...lessons[0], evidence: { ...lessons[0].evidence, sourceChars: 0 } };
  const sync = lessons.map((l, i) => ({ id: l.id, track: l.track, passed: i !== 1 }));
  const gate = evaluateCurriculumReleaseGate(lessons, sync, 15);
  assert.equal(gate.passed, false);
  assert.equal(gate.blockers.length, 2);
  assert.match(gate.blockers.join(" "), /evidence|sync/i);
});

test("Phase 6 uses reviewed quality, mode coverage, fallbacks and cost rather than run counts", () => {
  const lessons = (["O Level", "A Level", "USA"] as const).flatMap((track) => Array.from({ length: 5 }, (_, i) => lesson(track, `${track}-${i}`)));
  const sync = lessons.map((l) => ({ id: l.id, track: l.track, passed: true }));
  const modes = ["typed", "reference", "strict"] as const;
  const reviews = lessons.map((l, i) => ({
    lessonId: l.id, track: l.track, mode: modes[i % modes.length], passed: true,
    studentBoardPassRate: 1, syncPassRate: 1, costUsd: 0.08, boardCount: 5, fallbackBoards: 0,
  }));
  assert.equal(evaluateCurriculumReleaseGate(lessons, sync, 15, reviews).passed, true);
  const bad = reviews.map((review, i) => i === 0 ? { ...review, studentBoardPassRate: 0.8, costUsd: 0.6, fallbackBoards: 3 } : review);
  const gate = evaluateCurriculumReleaseGate(lessons, sync, 15, bad);
  assert.equal(gate.passed, false);
  assert.match(gate.blockers.join(" "), /100%|fallback|cost/i);
});
