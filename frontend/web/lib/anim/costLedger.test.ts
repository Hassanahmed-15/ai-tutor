/**
 * The per-lecture cost ledger. The property that matters: spend that could not be measured is
 * counted as unpriced and shown, never folded into the total as $0.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  addCost,
  addUnpriced,
  getCostLedger,
  recordJsonCost,
  recordTtsResponse,
  resetCostLedger,
  setCost,
} from "../costLedger";

test("streams add up to the total", () => {
  resetCostLedger();
  addCost("document", 0.08);
  addCost("narration", "0.0016");
  addCost("narration", 0.0012);
  setCost("generation", 0.31);
  setCost("generation", 0.35); // generation reports a running total, which replaces
  const ledger = getCostLedger();
  assert.ok(Math.abs(ledger.totalUsd - (0.08 + 0.0028 + 0.35)) < 1e-12);
  assert.ok(Math.abs(ledger.lines.narration.usd - 0.0028) < 1e-12);
  assert.equal(ledger.unpriced, 0);
});

test("unmeasurable spend is unpriced, never free", () => {
  resetCostLedger();
  addCost("questions", undefined);
  addCost("questions", "not a number");
  addCost("questions", -1);
  addUnpriced("liveTutor", 2);
  const ledger = getCostLedger();
  assert.equal(ledger.totalUsd, 0);
  assert.equal(ledger.lines.questions.unpriced, 3);
  assert.equal(ledger.unpriced, 5);
});

test("a TTS cache hit is free, a miss is priced, a missing header is unpriced", () => {
  resetCostLedger();
  recordTtsResponse(new Response("", { headers: { "X-Cost-Usd": "0" } }));
  recordTtsResponse(new Response("", { headers: { "X-Cost-Usd": "0.00159360" } }));
  recordTtsResponse(new Response(""));
  recordTtsResponse(new Response("", { status: 502 })); // failed: nothing to play, nothing billed
  const ledger = getCostLedger();
  assert.ok(Math.abs(ledger.lines.narration.usd - 0.0015936) < 1e-12);
  assert.equal(ledger.lines.narration.unpriced, 1);
});

test("JSON bodies report their cost and their unpriced calls", () => {
  resetCostLedger();
  recordJsonCost("document", { costUsd: 0.12, unpricedCalls: 1 });
  recordJsonCost("document", { error: "no cost field" });
  recordJsonCost("document", null);
  const ledger = getCostLedger();
  assert.ok(Math.abs(ledger.lines.document.usd - 0.12) < 1e-12);
  assert.equal(ledger.lines.document.unpriced, 1);
});

test("reset starts a clean lecture", () => {
  addCost("planning", 1);
  resetCostLedger();
  assert.equal(getCostLedger().totalUsd, 0);
});

test("the ledger module never imports React, because server code reaches it", async () => {
  // lib/voice.ts records narration cost here and is imported by lib/blackboardGen.ts, which the
  // lecture-start route loads. A React hook in this module made every new lecture fail with a 500.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const source = readFileSync(join(process.cwd(), "lib", "costLedger.ts"), "utf8");
  assert.doesNotMatch(source, /from\s+["']react["']/);
});
