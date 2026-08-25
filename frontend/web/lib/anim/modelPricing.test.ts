import test from "node:test";
import assert from "node:assert/strict";

import { priceFor, costFor, isModernModel } from "../modelPricing";

test("a model is priced as itself, not as whatever the call site last hardcoded", () => {
  // The bug this file exists to prevent: reactAnimationGen ran gpt-5.5 while its own constants read
  // gpt-4o's rates, so the most expensive call in the app under-reported by 3x on output and
  // nothing failed. A wrong price is not a wrong answer, so only a test catches it.
  assert.equal(priceFor("gpt-5.5").output, 30.0);
  assert.equal(priceFor("gpt-4o").output, 10.0);
  assert.notEqual(priceFor("gpt-5.5").output, priceFor("gpt-4o").output);
});

test("dated model snapshots price as their base model", () => {
  // The API returns ids like gpt-5.5-2026-04-23; pricing them at the fallback rate would silently
  // inflate every report the day OpenAI pins a snapshot.
  assert.deepEqual(priceFor("gpt-5.5-2026-04-23"), priceFor("gpt-5.5"));
  assert.deepEqual(priceFor("gpt-4o-mini-2024-07-18"), priceFor("gpt-4o-mini"));
});

test("LONGEST prefix wins, so a mini model is never billed as its full-size sibling", () => {
  // "gpt-5.4-mini-2026-03-17" starts with BOTH "gpt-5.4" and "gpt-5.4-mini". Shortest-match would
  // price a $0.75 model at $5.00 — a 6x over-report that looks like a cost regression.
  assert.deepEqual(priceFor("gpt-5.4-mini-2026-03-17"), priceFor("gpt-5.4-mini"));
  assert.ok(priceFor("gpt-5.4-mini").input < priceFor("gpt-5.4").input);
});

test("an unknown model over-reports rather than reading zero", () => {
  // Failing to the most expensive entry is deliberate. A cost report that silently shows $0.00 for
  // an unrecognised model is exactly how the original drift went unnoticed for so long.
  const unknown = priceFor("gpt-9-imaginary");
  assert.ok(unknown.input > 0 && unknown.output > 0, "never free");
  assert.ok(unknown.output >= priceFor("gpt-5.5").output, "and never cheaper than the priciest known");
});

test("costFor converts usage into dollars, and no usage costs nothing", () => {
  const cost = costFor("gpt-4o", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
  assert.ok(Math.abs(cost - 12.5) < 1e-9, "$2.50 in + $10.00 out");
  assert.equal(costFor("gpt-4o", undefined), 0);
  assert.equal(costFor("gpt-4o", { prompt_tokens: 0, completion_tokens: 0 }), 0);
});

test("the modern-model flag matches the call sites that must not send max_tokens", () => {
  // gpt-5.x and o-series reject `max_tokens` and a non-default `temperature`. Pointing an env var
  // at one without honouring this 400s every call and drops every beat to a fallback board, which
  // reads as a total quality collapse rather than a config error.
  assert.ok(isModernModel("gpt-5.5"));
  assert.ok(isModernModel("gpt-5.4-mini"));
  assert.ok(isModernModel("o3"));
  assert.equal(isModernModel("gpt-4o"), false);
  assert.equal(isModernModel("gpt-4o-mini"), false);
});
