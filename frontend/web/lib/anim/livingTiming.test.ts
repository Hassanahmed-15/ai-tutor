import { test } from "node:test";
import assert from "node:assert/strict";
import { retimeLivingSteps, stateTimes } from "../canvas/livingTiming";
import type { EquationStage } from "../canvas/types";

const stage = (steps: Array<{ s: number; order: string[] }>): EquationStage => ({
  kind: "equation",
  tokens: [{ id: "y", text: "y" }, { id: "eq", text: "=" }, { id: "f", text: "64/10" }, { id: "eq2", text: "=" }, { id: "r", text: "6.4" }, { id: "sum", text: "36 + 64 = 100" }],
  steps,
} as unknown as EquationStage);

const sentences = [
  "Now we find the other part of the hypotenuse.",
  "The similar triangles give y times 10 equals 64.",
  "So y is 64 over 10, which is 6.4.",
  "Adding the squares, 36 plus 64 makes 100.",
];

test("a step moves to the sentence that says its numbers, at the point they are said", () => {
  const out = retimeLivingSteps(stage([{ s: 3, order: ["y", "eq", "f"] }, { s: 3, order: ["y", "eq", "f", "eq2", "r"] }, { s: 3, order: ["sum"] }]), sentences);
  assert.deepEqual(out.steps.map((st) => st.s), [1, 2, 3]);
  assert.ok(out.steps.every((st) => st.at !== undefined && st.at > 0 && st.at < 1));
});

test("a step never comes later than the writer put it, nor before the step before it", () => {
  const out = retimeLivingSteps(stage([{ s: 0, order: ["y", "eq", "f"] }, { s: 1, order: ["sum"] }]), sentences);
  assert.deepEqual(out.steps.map((st) => st.s), [0, 1]);
});

test("states with no place given share their sentence evenly", () => {
  const t = stateTimes([{ s: 2 }, { s: 2 }, { s: 2 }, { s: 4, at: 0.5 }]);
  assert.deepEqual(t.map((x) => Math.round(x * 100) / 100), [2, 2.3, 2.6, 4.5]);
});
