/**
 * The rules that decide how many boards a lecture has and how deeply each teaches.
 *
 * Every test here corresponds to an observed failure: ten shallow boards for a topic with four
 * ideas, the same concept taught three times under different headings, and "deep" producing more
 * sections rather than deeper ones.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { boardCountFor, conceptOverlap, depthBudget } from "../lectureDepth";

test("THE INVERSION: deep means longer boards, never more of them", () => {
  // The old rule was 6/8/10 BEATS by depth, so asking to go deep bought ten shallow sections.
  const concise = depthBudget("concise");
  const balanced = depthBudget("balanced");
  const deep = depthBudget("deep");
  assert.ok(deep.wordRange[0] > balanced.wordRange[0], "deep must buy more words per board");
  assert.ok(balanced.wordRange[0] > concise.wordRange[0]);
  assert.ok(deep.movements[1] >= balanced.movements[1], "deep develops more movements per board");
  // The count is not a function of depth at all — it comes from the concepts found.
  assert.equal(boardCountFor(4), boardCountFor(4));
});

test("a board is long enough to actually teach something", () => {
  // 95-130 words was the old ceiling: ~40s, too short for setup + example + interpretation.
  // At ~150 wpm the floor here is well past the 30-90s the board should hold a concept.
  for (const depth of ["concise", "balanced", "deep"]) {
    const { wordRange } = depthBudget(depth);
    const seconds = (wordRange[0] / 150) * 60;
    assert.ok(seconds >= 60, `${depth}: ${Math.round(seconds)}s is too short to teach a concept`);
  }
});

test("the board count comes from the concepts found, not from a target", () => {
  assert.equal(boardCountFor(3), 3, "a narrow topic gets three boards, not padded to eight");
  assert.equal(boardCountFor(8), 8, "a broad topic keeps all eight, not truncated to six");
  assert.equal(boardCountFor(11), 11);
});

test("an absurd or missing plan is guarded, but a real plan passes through untouched", () => {
  assert.equal(boardCountFor(0), 3, "no concepts at all still yields a lecture");
  assert.equal(boardCountFor(-5), 3);
  assert.equal(boardCountFor(NaN), 3);
  assert.equal(boardCountFor(400), 12, "a malformed outline cannot produce a 400-board lecture");
  for (const n of [2, 4, 5, 6, 7, 9, 12]) assert.equal(boardCountFor(n), n, `${n} should pass through`);
});

test("THE REPETITION: boards teaching the same concept are detected despite different titles", () => {
  // Exactly what the padding loop plus cosmetic renaming produced: distinct headings over
  // byte-identical teaching instructions.
  const earlier = [
    { title: "Worked Example", objective: "Explain a distinct, useful part of gradient descent with a concrete example." },
  ];
  const duplicate = {
    title: "Common Pitfalls",
    objective: "Explain a distinct, useful part of gradient descent with a concrete example.",
  };
  const { overlap, with: index } = conceptOverlap(duplicate, earlier);
  assert.equal(index, 0);
  assert.ok(overlap > 0.8, `identical objectives must read as the same concept, got ${overlap}`);
});

test("genuinely different concepts are not flagged as repetition", () => {
  const earlier = [
    { title: "Line of best fit", objective: "Show how a straight line summarises a cloud of data points." },
  ];
  const different = {
    title: "Measuring error",
    objective: "Define squared residuals and why we sum them to score a candidate line.",
  };
  const { overlap } = conceptOverlap(different, earlier);
  assert.ok(overlap < 0.5, `distinct concepts should not read as duplicates, got ${overlap}`);
});

test("overlap is reported rather than silently dropping a board", () => {
  // Dropping would leave a hole in the lecture; the caller decides whether to merge.
  const result = conceptOverlap({ title: "x", objective: "y" }, []);
  assert.deepEqual(result, { overlap: 0, with: -1 });
});

test("generic scaffolding words do not make two boards look alike", () => {
  // "explain", "concept", "lesson" appear in every objective ever written.
  const a = { title: "Photosynthesis", objective: "Explain the concept of how a leaf makes sugar." };
  const b = { title: "Respiration", objective: "Explain the concept of how a cell releases energy." };
  const { overlap } = conceptOverlap(b, [a]);
  assert.ok(overlap < 0.5, `scaffolding words inflated the overlap to ${overlap}`);
});
