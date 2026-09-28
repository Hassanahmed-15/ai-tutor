import test from "node:test";
import assert from "node:assert/strict";
import { hasCompleteSourcePlan, pdfTeachingState } from "../pdfTeachingState";
import { buildProgressivePlan } from "../progressivePlan";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";

const source = {
  contentBlocks: [
    { id: "p1-a", pageNumber: 1, sourceOrder: 0, heading: "Definition", text: "Alpha", bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 } },
    { id: "p1-b", pageNumber: 1, sourceOrder: 1, heading: "Mechanism", text: "Beta", bbox: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 } },
    { id: "p3-a", pageNumber: 3, sourceOrder: 2, heading: "Example", text: "Gamma", bbox: { x: 0.2, y: 0.3, width: 0.7, height: 0.2 } },
  ],
};

test("PDF focus follows the current beat and coverage follows completed beats", () => {
  const beats = [
    { sourceBlockIds: ["p1-a"] },
    { sourceBlockIds: ["p1-b"] },
    { sourceBlockIds: ["p3-a"] },
  ];
  const state = pdfTeachingState(beats, 1, source);
  assert.equal(state.activePage, 1);
  assert.deepEqual(state.activeBlockIds, ["p1-b"]);
  assert.deepEqual(state.completedBlockIds, ["p1-a"]);
  assert.deepEqual(state.remainingBlockIds, ["p3-a"]);
  assert.deepEqual(state.highlights[0].rect, { x: 0.1, y: 0.4, width: 0.8, height: 0.2 });
});

test("coverage detects a silently skipped source block", () => {
  assert.equal(hasCompleteSourcePlan([{ sourceBlockIds: ["p1-a", "p1-b"] }], source), false);
  assert.equal(hasCompleteSourcePlan([{ sourceBlockIds: ["p1-a", "p1-b", "p3-a"] }], source), true);
});

test("strict whole-source planning keeps more than twelve source sections", () => {
  const blocks = Array.from({ length: 15 }, (_, index) => ({
    id: `b${index}`,
    pageNumber: index + 1,
    sourceOrder: index,
    heading: `Section ${index + 1}`,
    text: `Source material ${index + 1}`,
  }));
  const input: ProgressiveLectureInput = {
    topic: "Long source",
    mood: "",
    sourceType: "pdf",
    mode: "standard",
    suprnotes: {
      contentBlocks: blocks,
      lessonPlan: { beats: blocks.map((block) => ({ title: block.heading, objective: block.text, sourceBlockIds: [block.id] })) },
    },
    learnerProfile: { expertise: "intermediate", depth: "concise", goal: "school", codeExamples: false, preferredExamples: "mixed", rationale: "test", confirmedAt: "now" },
    sourceScope: { fidelity: "strict", breadth: { kind: "whole" }, documentLabels: [] },
  };
  const plan = buildProgressivePlan(input);
  assert.equal(plan.length, 15);
  assert.deepEqual(plan.flatMap((beat) => beat.sourceBlockIds ?? []), blocks.map((block) => block.id));
});
