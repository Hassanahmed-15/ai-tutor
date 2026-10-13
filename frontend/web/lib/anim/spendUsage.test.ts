import test from "node:test";
import assert from "node:assert/strict";
import { adaptChatBody, endpointOf, isReasoningModel, spendKindForPath, usageFromEventStream, usdForUsage } from "../spend/usage";
import { summarize } from "../spend/record";

test("a gpt-4o style request is rewritten for luna; gpt-4o and gpt-4o-mini are left alone", () => {
  const old = { model: "gpt-5.6-luna", temperature: 0.7, top_p: 0.9, max_tokens: 900, messages: [] };
  const out = adaptChatBody(old);
  assert.equal(out.temperature, undefined);
  assert.equal(out.top_p, undefined);
  assert.equal(out.max_tokens, undefined);
  assert.equal(out.max_completion_tokens, 2400, "headroom for reasoning tokens");
  assert.equal(out.reasoning_effort, "low");
  assert.deepEqual(old.temperature, 0.7, "the caller's object is not mutated");
  const four = { model: "gpt-4o", temperature: 0.2, max_tokens: 500 };
  assert.equal(adaptChatBody(four), four);
  assert.equal(adaptChatBody({ model: "gpt-4o-mini", temperature: 0 }).temperature, 0);
  // An explicit effort and completion cap are kept.
  const kept = adaptChatBody({ model: "gpt-5.6-terra", reasoning_effort: "medium", max_completion_tokens: 9000 });
  assert.equal(kept.reasoning_effort, "medium");
  assert.equal(kept.max_completion_tokens, 9000);
  assert.ok(isReasoningModel("gpt-5.6-luna") && !isReasoningModel("gpt-4o"));
});

test("usage is priced in every shape the API returns", () => {
  const chat = usdForUsage("gpt-5.6-luna", { prompt_tokens: 1_000_000, completion_tokens: 0 });
  assert.ok(Math.abs((chat ?? 0) - 0.2) < 1e-9);
  const image = usdForUsage("gpt-image-1-mini", { input_tokens: 0, output_tokens: 1_000_000 });
  assert.ok(Math.abs((image ?? 0) - 8) < 1e-9, "mini is not priced as gpt-image-1");
  assert.equal(usdForUsage("gpt-4o", null), null);
  const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"model":"gpt-4o-mini","usage":{"prompt_tokens":10,"completion_tokens":5}}\n\ndata: [DONE]\n';
  const found = usageFromEventStream(sse);
  assert.equal(found?.model, "gpt-4o-mini");
  assert.equal(found?.usage?.completion_tokens, 5);
  assert.equal(usageFromEventStream("data: {\"x\":1}\n"), null);
});

test("each API route is filed under the part of the app it serves", () => {
  assert.equal(spendKindForPath("/api/plan-lesson"), "planning");
  assert.equal(spendKindForPath("/api/progressive-lectures"), "generation");
  assert.equal(spendKindForPath("/api/tts"), "narration");
  assert.equal(spendKindForPath("/api/explain"), "questions");
  assert.equal(spendKindForPath("/api/canvas-lecture/check-drawing"), "questions");
  assert.equal(spendKindForPath("/api/parse-pdf"), "document");
  assert.equal(spendKindForPath("/api/youtube/notes"), "video");
  assert.equal(spendKindForPath("/api/voice-transcribe"), "voice");
  assert.equal(spendKindForPath("http://localhost:3000/api/learner-profile/tiles"), "personal");
  assert.equal(endpointOf("https://api.openai.com/v1/images/generations"), "image");
  assert.equal(endpointOf("https://api.openai.com/v1/chat/completions"), "chat");
});

test("totals add priced calls by part and by model, and count unpriced ones separately", () => {
  const s = summarize([
    { kind: "narration", model: "gpt-4o-mini-tts", usd: 0.01 },
    { kind: "narration", model: "gpt-4o-mini-tts", usd: 0.02 },
    { kind: "questions", model: "gpt-5.6-luna", usd: 0.001 },
    { kind: "questions", model: "gpt-5.6-luna", usd: null },
  ]);
  assert.ok(Math.abs(s.totalUsd - 0.031) < 1e-9);
  assert.ok(Math.abs((s.byKind.narration ?? 0) - 0.03) < 1e-9);
  assert.equal(s.unpriced, 1);
  assert.equal(s.calls, 4);
});
