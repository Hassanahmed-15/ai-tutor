/**
 * The animation model comparison: which model draws which board, what the chip says, and that the
 * record of who drew a board (and what it cost) survives re-sanitising.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ANIMATION_ROTATION, animationChipDetail, animationModelForBeat, animationModelLabel } from "../animationModels";
import { sanitizeDraw, sanitizeTrial } from "../drawSanitize";
import { priceFor } from "../modelPricing";

test("with the switch on, consecutive beats go to different models, in order, and wrap", () => {
  const ids = [0, 1, 2, 3, 4, 5].map((i) => animationModelForBeat(i, true)?.id);
  assert.deepEqual(ids, [
    "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol",
    "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol",
  ]);
  for (let i = 0; i < 20; i += 1) {
    assert.notEqual(animationModelForBeat(i, true)?.id, animationModelForBeat(i + 1, true)?.id);
  }
});

test("with the switch off, nothing changes: the configured model is used", () => {
  for (const i of [0, 1, 2, 7]) assert.equal(animationModelForBeat(i, false), null);
});

test("odd indices never throw or pick outside the rotation", () => {
  assert.equal(animationModelForBeat(-1, true)?.id, ANIMATION_ROTATION[2].id);
  assert.equal(animationModelForBeat(4.7, true)?.id, ANIMATION_ROTATION[1].id);
  assert.equal(animationModelForBeat(Number.NaN, true), null);
});

test("every model in the rotation has a real price, not the unknown-model fallback", () => {
  const fallback = priceFor("definitely-not-a-model");
  for (const model of ANIMATION_ROTATION) assert.notDeepEqual(priceFor(model.id), fallback, model.id);
});

test("the chip names the model and what its board cost", () => {
  assert.equal(animationModelLabel("gpt-5.6-sol-2026-08-01"), "GPT-5.6 Sol");
  assert.equal(animationModelLabel("gpt-5.5"), "gpt-5.5");
  assert.equal(animationChipDetail("gpt-5.6-terra", 0.14237), "GPT-5.6 Terra · $0.142");
  // A board with no recorded cost still names its model; one with no model shows the chip as before.
  assert.equal(animationChipDetail("gpt-5.6-luna", undefined), "GPT-5.6 Luna");
  assert.equal(animationChipDetail(undefined, 0.1), null);
});

test("who drew a board survives re-sanitising the lecture", () => {
  // The sanitiser rebuilds the op field by field; a field it does not name is silently dropped.
  const trial = { score: 4, attempts: 2, refineTrail: "r0=3 -> r1=4", costUsd: 0.0123, ms: 41000 };
  const draw = sanitizeDraw(
    {
      durationMs: 40000,
      ops: [{ kind: "reactAnimation", teachingPoint: "How a leaf feeds", model: "gpt-5.6-luna", trial }],
    },
    { index: 1, title: "Leaf" } as never,
  );
  const op = draw?.ops.find((o) => o.kind === "reactAnimation") as { model?: string; trial?: unknown } | undefined;
  assert.equal(op?.model, "gpt-5.6-luna");
  assert.deepEqual(op?.trial, trial);
});

test("a malformed trial record is dropped, never half-kept", () => {
  assert.equal(sanitizeTrial({ score: 4, attempts: -1, costUsd: 0, ms: 1 }), undefined);
  assert.equal(sanitizeTrial({ score: "high", attempts: 1, costUsd: 0, ms: 1 }), undefined);
  assert.equal(sanitizeTrial(null), undefined);
  // An unscored board (abstract diagrams skip the judge) keeps score null, never 0.
  assert.equal(sanitizeTrial({ score: null, attempts: 1, costUsd: 0.01, ms: 5 })?.score, null);
});
