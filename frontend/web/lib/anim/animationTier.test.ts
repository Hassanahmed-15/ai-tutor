/**
 * How heavy an animation is decides which model draws it: a recap slide must not buy the most
 * expensive model, and a traced algorithm must not be left to the cheapest.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ANIMATION_TIERS, animationTierRoutingEnabled, modelForTier, validateAnimationTier } from "../animationTier";
import { priceFor } from "../modelPricing";

test("a malformed judgement is moderate — never the most expensive, never the cheapest", () => {
  for (const raw of [null, undefined, "heavy", {}, { tier: "enormous" }, { tier: 7 }, { reason: "no tier" }]) {
    const decision = validateAnimationTier(raw);
    assert.equal(decision.tier, "moderate", `${JSON.stringify(raw)} should fall back to moderate`);
    assert.ok(decision.reason.length > 0);
  }
});

test("a judgement the model actually made is kept, however it is cased", () => {
  assert.deepEqual(validateAnimationTier({ tier: "heavy", reason: "many parts move in sequence" }), {
    tier: "heavy",
    reason: "many parts move in sequence",
  });
  assert.equal(validateAnimationTier({ tier: " Light " }).tier, "light");
  // A rambling reason is kept, but not at any length.
  assert.equal(validateAnimationTier({ tier: "light", reason: "x".repeat(400) }).reason.length, 140);
});

test("each tier buys a real model, and a dearer one as the work gets harder", () => {
  const models = ANIMATION_TIERS.map((tier) => modelForTier(tier, {}));
  assert.deepEqual(models.map((m) => m.id), ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
  // Every one is a model this codebase knows the price of: an unknown id silently prices at the
  // most expensive fallback, which would make a "light" beat the dearest in the lecture.
  const fallback = priceFor("definitely-not-a-model");
  for (const model of models) {
    const price = priceFor(model.id);
    assert.notDeepEqual(price, fallback, `${model.id} has no real price`);
    assert.ok(model.label && model.label !== model.id, `${model.id} should have a display name`);
  }
  const outputs = models.map((m) => priceFor(m.id).output);
  assert.deepEqual([...outputs].sort((a, b) => a - b), outputs, "tiers should not get cheaper as they get heavier");
});

test("each tier's model can be overridden, and routing switched off", () => {
  assert.equal(modelForTier("heavy", { ANIMATION_MODEL_HEAVY: "gpt-5.6-terra" }).id, "gpt-5.6-terra");
  assert.equal(modelForTier("heavy", { ANIMATION_MODEL_HEAVY: "  " }).id, "gpt-5.6-sol", "blank override is ignored");
  assert.equal(animationTierRoutingEnabled({}), true, "on unless switched off");
  assert.equal(animationTierRoutingEnabled({ ANIMATION_TIER_ROUTING: "0" }), false);
});
