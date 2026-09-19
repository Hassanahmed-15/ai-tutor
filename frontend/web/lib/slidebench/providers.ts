import "server-only";

import OpenAI from "openai";

import { apiKeyFingerprint, slideBenchCost, type SlideBenchModel } from "./models";
import { stripCodeFences } from "./scoring";

/**
 * ONE SHAPE FOR EVERY PROVIDER.
 *
 * OpenAI reports `{prompt_tokens, completion_tokens}`; Gemini reports
 * `{promptTokenCount, candidatesTokenCount, thoughtsTokenCount}` and bills thinking tokens as
 * output. `lib/modelPricing.ts` only understands the OpenAI shape, so a Gemini id passed to
 * `costFor` silently lands on the $10/$40 fallback and the whole cost comparison becomes fiction.
 * Normalising here — at the one place that knows which provider answered — is what makes the
 * dollar column mean the same thing in every row.
 */
export interface SlideGenerationResult {
  code: string;
  promptTokens: number;
  /** Includes reasoning/thinking tokens, which are billed as output by both providers. */
  outputTokens: number;
  /** Reported separately so the report can show WHY a "cheap" reasoning model was not cheap. */
  thinkingTokens: number;
  costUsd: number;
  latencyMs: number;
  /** Which credential ran it — the env var name plus a fingerprint, never the key. */
  apiKeyId: string;
  /** Set when the provider itself failed. A provider failure is not a bad slide. */
  providerError: string | null;
}

async function generateWithOpenAI(
  model: SlideBenchModel,
  prompt: string,
  maxTokens: number,
): Promise<SlideGenerationResult> {
  const key = process.env[model.apiKeyEnv];
  const apiKeyId = `${model.apiKeyEnv}:${apiKeyFingerprint(key)}`;
  const startedAt = Date.now();
  if (!key) {
    return emptyResult(apiKeyId, Date.now() - startedAt, `${model.apiKeyEnv} is not set.`);
  }
  try {
    const client = new OpenAI({ apiKey: key });
    const response = await client.chat.completions.create({
      model: model.id,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: maxTokens,
    });
    const usage = response.usage;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const total = usage?.total_tokens ?? 0;
    /*
     * Same guard as lib/modelPricing.ts:78 — take whichever is larger, so a model that hides
     * reasoning tokens inside total_tokens is not priced at zero for the part that cost the most.
     */
    const outputTokens = Math.max(usage?.completion_tokens ?? 0, total - promptTokens);
    const thinkingTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    return {
      code: stripCodeFences(response.choices[0]?.message?.content ?? "").code,
      promptTokens,
      outputTokens,
      thinkingTokens,
      costUsd: slideBenchCost(model, promptTokens, outputTokens),
      latencyMs: Date.now() - startedAt,
      apiKeyId,
      providerError: null,
    };
  } catch (cause) {
    return emptyResult(apiKeyId, Date.now() - startedAt, messageFor(cause));
  }
}

async function generateWithGemini(
  model: SlideBenchModel,
  prompt: string,
  maxTokens: number,
): Promise<SlideGenerationResult> {
  const key = process.env[model.apiKeyEnv];
  const apiKeyId = `${model.apiKeyEnv}:${apiKeyFingerprint(key)}`;
  const startedAt = Date.now();
  if (!key) {
    return emptyResult(apiKeyId, Date.now() - startedAt, `${model.apiKeyEnv} is not set.`);
  }
  try {
    /*
     * The REST endpoint rather than @google/genai. The SDK in this repo is wired for Live sessions
     * (ephemeral tokens, websockets, v1alpha); generateContent over plain HTTP has no such setup,
     * returns usageMetadata verbatim, and keeps this file's only dependency the fetch that Node
     * already has.
     */
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return emptyResult(apiKeyId, Date.now() - startedAt, data?.error?.message ?? `HTTP ${response.status}`);
    }
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((part: { text?: string }) => part.text ?? "").join("");
    const usage = data?.usageMetadata ?? {};
    const promptTokens = usage.promptTokenCount ?? 0;
    const thinkingTokens = usage.thoughtsTokenCount ?? 0;
    /*
     * Gemini reports thinking separately from candidates and bills BOTH as output. Adding them is
     * the difference between an honest cost and one that flatters a reasoning model — on the smoke
     * test for this bench, a 1-token answer carried 60 thinking tokens.
     */
    const outputTokens = (usage.candidatesTokenCount ?? 0) + thinkingTokens;
    return {
      code: stripCodeFences(text).code,
      promptTokens,
      outputTokens,
      thinkingTokens,
      costUsd: slideBenchCost(model, promptTokens, outputTokens),
      latencyMs: Date.now() - startedAt,
      apiKeyId,
      providerError: null,
    };
  } catch (cause) {
    return emptyResult(apiKeyId, Date.now() - startedAt, messageFor(cause));
  }
}

/**
 * Worth retrying: the provider is busy right now and may not be in a few seconds.
 *
 * Note what is NOT here: a quota/billing exhaustion. See QUOTA below.
 */
const TRANSIENT = /high demand|overloaded|unavailable|timeout|temporarily|503/i;

/**
 * NEVER RETRY A QUOTA ERROR — retrying it is what causes it.
 *
 * Measured the hard way on this account: gemini-3.8-flash is on a free tier capped at 20 requests
 * per day per model. Nine bench attempts, each retried three times, burned roughly 27 requests and
 * exhausted the whole day's allowance — so the retry logic intended to protect a model from a
 * transient blip is exactly what locked it out. A daily cap does not clear in two seconds, and
 * every extra call spends a budget the user cannot get back until tomorrow.
 */
const QUOTA = /exceeded your current quota|RESOURCE_EXHAUSTED|billing|quota/i;

/**
 * RETRY THE PROVIDER, NOT THE MODEL.
 *
 * Observed while building this: Gemini answered a smoke test fine, then returned "this model is
 * currently experiencing high demand" twice in a row minutes later. Recording that as a score of
 * zero would be the single most misleading thing this bench could do — it would publish "Gemini 3.8
 * Flash cannot draw a slide" when what happened is that Google was busy.
 *
 * So a transient failure is retried with backoff, and a failure that survives the retries is
 * recorded as a PROVIDER error, which every downstream consumer keeps separate from a bad drawing.
 * The same distinction `scripts/compare-animation-models.mjs` draws for the same reason.
 */
export async function generateSlide(
  model: SlideBenchModel,
  prompt: string,
  maxTokens = 8_000,
  attempts = 3,
): Promise<SlideGenerationResult> {
  let last: SlideGenerationResult | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = model.provider === "gemini"
      ? await generateWithGemini(model, prompt, maxTokens)
      : await generateWithOpenAI(model, prompt, maxTokens);
    if (!last.providerError) return last;
    // A quota is a budget, not a blip. Retrying spends more of the thing that just ran out.
    if (QUOTA.test(last.providerError)) return last;
    if (!TRANSIENT.test(last.providerError)) return last; // a real error: a bad key, an unknown model
    if (attempt < attempts - 1) {
      // 2s, 6s. Long enough for a demand spike to pass, short enough to keep a sweep interactive.
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt * 2 + 1)));
    }
  }
  return last as SlideGenerationResult;
}

function emptyResult(apiKeyId: string, latencyMs: number, providerError: string): SlideGenerationResult {
  return {
    code: "",
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    costUsd: 0,
    latencyMs,
    apiKeyId,
    providerError,
  };
}

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
