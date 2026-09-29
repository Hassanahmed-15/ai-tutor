import test from "node:test";
import assert from "node:assert/strict";
import type { Beat } from "../lessonContent";
import { modelCostBreakdown } from "./modelCosts";

const board = (model: string, costUsd: number, picture = false): Beat => ({
  id: `${model}-${costUsd}`, title: "t", script: "s.",
  draw: { ops: [{ kind: "reactAnimation", model, trial: { costUsd }, code: picture ? 'const ILLUSTRATION_ID = "0123456789abcdef0123456789abcdef";' : "export default function Animation({ sentence }) {}" }] },
} as unknown as Beat);
const lines = (generation: number, narration = 0) => ({
  document: { usd: 0 }, planning: { usd: 0.004 }, generation: { usd: generation }, narration: { usd: narration }, questions: { usd: 0 }, liveTutor: { usd: 0 },
});

test("generation is split into boards by model plus the rest; the parts sum to the ledger's total", () => {
  const beats = [board("gpt-5.6-terra", 0.2), board("gpt-5.6-terra", 0.014), board("gpt-image-1", 0.146, true), board("gpt-5.6-luna", 0.031)];
  const { totalUsd, parts } = modelCostBreakdown(beats, lines(0.4, 0.021));
  const by = Object.fromEntries(parts.map((p) => [p.label, Number(p.usd.toFixed(4))]));
  assert.deepEqual(by, { "GPT-5.6 Terra": 0.214, Pictures: 0.146, "GPT-5.6 Luna": 0.031, narration: 0.021, "lecture writing": 0.009, planning: 0.004 });
  assert.equal(Number(totalUsd.toFixed(4)), Number((0.4 + 0.021 + 0.004).toFixed(4)), "no double counting");
  assert.equal(parts[0].label, "GPT-5.6 Terra", "largest first");
});

test("a cached lecture (no generation spend this session) does not show its boards' old costs", () => {
  const { totalUsd, parts } = modelCostBreakdown([board("gpt-5.6-terra", 0.2)], lines(0, 0.01));
  assert.deepEqual(parts.map((p) => p.label), ["narration", "planning"]);
  assert.equal(Number(totalUsd.toFixed(3)), 0.014);
});
