/**
 * The per-request cost meter: every completion made through a wrapped client is priced from the
 * usage it returned, and a call that returned no usage is counted as unpriced — never as free.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createCostMeter } from "../costMeter";
import { costFor, geminiLiveCostFor, realtimeCostFor } from "../modelPricing";

function fakeClient(responses: Array<{ model?: string; usage?: { prompt_tokens: number; completion_tokens: number } }>) {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async (params: { model?: string }) => ({ ...responses[i++], echoed: params.model }),
      },
    },
  };
}

test("every call through the wrapped client is priced from its own usage", async () => {
  const meter = createCostMeter();
  const client = meter.wrap(fakeClient([
    { model: "gpt-4o", usage: { prompt_tokens: 1000, completion_tokens: 200 } },
    { model: "gpt-4o-mini", usage: { prompt_tokens: 5000, completion_tokens: 100 } },
  ]));
  await client.chat.completions.create({ model: "gpt-4o" });
  await client.chat.completions.create({ model: "gpt-4o-mini" });
  const expected =
    costFor("gpt-4o", { prompt_tokens: 1000, completion_tokens: 200 }) +
    costFor("gpt-4o-mini", { prompt_tokens: 5000, completion_tokens: 100 });
  assert.ok(Math.abs(meter.totalUsd - expected) < 1e-12);
  assert.equal(meter.calls, 2);
  assert.equal(meter.unpricedCalls, 0);
});

test("a call with no usage is unpriced, not free", async () => {
  const meter = createCostMeter();
  const client = meter.wrap(fakeClient([{ model: "gpt-4o" }]));
  await client.chat.completions.create({ model: "gpt-4o" });
  assert.equal(meter.totalUsd, 0);
  assert.equal(meter.unpricedCalls, 1);
});

test("the result the caller receives is untouched", async () => {
  const meter = createCostMeter();
  const client = meter.wrap(fakeClient([{ model: "gpt-4o", usage: { prompt_tokens: 1, completion_tokens: 1 } }]));
  const result = await client.chat.completions.create({ model: "gpt-4o" });
  assert.equal((result as { echoed?: string }).echoed, "gpt-4o");
});

test("wrapping nothing is harmless", () => {
  const meter = createCostMeter();
  assert.equal(meter.wrap(null), null);
  assert.equal(meter.totalUsd, 0);
});

test("TTS is priced from the published audio rates", () => {
  // 15 text tokens in, 108 audio tokens out: a real 3-second sentence, measured 2026-09-18.
  const usd = costFor("gpt-4o-mini-tts", { prompt_tokens: 15, completion_tokens: 108 });
  assert.ok(Math.abs(usd - (15 * 0.6 + 108 * 12) / 1_000_000) < 1e-12);
});


test("Gemini Live usage is priced per modality, from two real turns", () => {
  // Captured from gemini-3.1-flash-live-preview on 2026-09-18.
  const turn1 = {
    promptTokenCount: 146, responseTokenCount: 52,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: 128 }],
    responseTokensDetails: [{ modality: "AUDIO", tokenCount: 52 }],
  };
  const turn2 = {
    promptTokenCount: 224, responseTokenCount: 57,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: 142 }, { modality: "AUDIO", tokenCount: 52 }],
    responseTokensDetails: [{ modality: "AUDIO", tokenCount: 57 }],
  };
  // Turn 1: 128 text + 18 unbroken-down (as text) in, 52 audio out.
  assert.ok(Math.abs(geminiLiveCostFor(turn1) - ((146 * 0.75) + 52 * 12) / 1e6) < 1e-12);
  // Turn 2: 142 text + 52 audio + 30 unbroken-down in, 57 audio out.
  assert.ok(Math.abs(geminiLiveCostFor(turn2) - ((172 * 0.75) + 52 * 3 + 57 * 12) / 1e6) < 1e-12);
  assert.equal(geminiLiveCostFor(null), 0);
});

test("Realtime usage bills cached input at the cached rate, not twice", () => {
  const usd = realtimeCostFor({
    input_token_details: { text_tokens: 1000, audio_tokens: 500, cached_tokens: 800, cached_tokens_details: { text_tokens: 800, audio_tokens: 0 } },
    output_token_details: { text_tokens: 40, audio_tokens: 300 },
  });
  assert.ok(Math.abs(usd - (200 * 4 + 500 * 32 + 800 * 0.4 + 40 * 16 + 300 * 64) / 1e6) < 1e-12);
  assert.equal(realtimeCostFor(undefined), 0);
});
