import { priceFor } from "../modelPricing";

/**
 * SPEND, AS PURE FUNCTIONS: how a request is adapted for the model it targets, and what a response
 * cost. Used by lib/openaiClient.ts on every OpenAI call; tested in lib/anim/spendUsage.test.ts.
 */

/**
 * The GPT-5.x family (luna, terra, sol, nano…) are reasoning models. They reject a non-default
 * `temperature`, `top_p` and the penalties, and they want `max_completion_tokens` instead of
 * `max_tokens` (measured 2026-10-13: both return HTTP 400). Older call sites were written for
 * gpt-4o; this lets any of them move to a cheaper GPT-5.x model without touching each one.
 */
export function isReasoningModel(model: unknown): boolean {
  return typeof model === "string" && /^(gpt-5|o\d)/.test(model);
}

const DROP_FOR_REASONING = ["temperature", "top_p", "presence_penalty", "frequency_penalty", "logprobs", "top_logprobs", "logit_bias"] as const;

/** Rewrite a chat-completions body so a reasoning model accepts it. Returns the same object when nothing changes. */
export function adaptChatBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isReasoningModel(body.model)) return body;
  const out: Record<string, unknown> = { ...body };
  let changed = false;
  for (const key of DROP_FOR_REASONING) {
    if (key in out && !(key === "temperature" && out.temperature === 1)) {
      delete out[key];
      changed = true;
    }
  }
  if (typeof out.max_tokens === "number") {
    // Reasoning tokens are billed inside the completion budget, so the old cap gets headroom or a
    // short answer could be cut off mid-sentence.
    const old = out.max_tokens;
    delete out.max_tokens;
    if (typeof out.max_completion_tokens !== "number") out.max_completion_tokens = Math.min(32_000, Math.max(old + 1_500, old * 2));
    changed = true;
  }
  if (!("reasoning_effort" in out)) {
    // Low effort: measured as fast as gpt-4o on the app's own prompts (≈2 s), at a fraction of the cost.
    out.reasoning_effort = "low";
    changed = true;
  }
  return changed ? out : body;
}

type AnyUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
} | null | undefined;

/** USD for one response's usage block, whichever shape it uses (chat, images, audio). Null if there is none. */
export function usdForUsage(model: string, usage: AnyUsage): number | null {
  if (!usage) return null;
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  if (typeof input !== "number" && typeof output !== "number") return null;
  const price = priceFor(model);
  return ((input ?? 0) * price.input + (output ?? 0) * price.output) / 1_000_000;
}

/** The usage block of a server-sent-event stream (chat with include_usage, speech in SSE format), if any. */
export function usageFromEventStream(text: string): { model?: string; usage: AnyUsage } | null {
  let found: { model?: string; usage: AnyUsage } | null = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as { model?: string; usage?: AnyUsage };
      if (json.usage) found = { model: json.model, usage: json.usage };
    } catch {
      // A partial line: skip it.
    }
  }
  return found;
}

/** What a request was for, from its path: chat, image, speech, transcription, other. */
export function endpointOf(url: string): "chat" | "image" | "speech" | "transcription" | "embedding" | "other" {
  if (url.includes("/chat/completions")) return "chat";
  if (url.includes("/images/")) return "image";
  if (url.includes("/audio/speech")) return "speech";
  if (url.includes("/audio/transcriptions")) return "transcription";
  if (url.includes("/embeddings")) return "embedding";
  return "other";
}

/** The spend kinds the badge shows, and which API route each one comes from. */
export type SpendKind = "planning" | "generation" | "pictures" | "narration" | "questions" | "document" | "video" | "voice" | "personal" | "other";

export function spendKindForPath(path: string): SpendKind {
  const p = path.replace(/^https?:\/\/[^/]+/, "");
  if (/^\/api\/plan-lesson/.test(p)) return "planning";
  if (/^\/api\/(progressive-lectures|canvas-lecture\/?$|canvas-lecture\?|generate-lecture|sandbox-board)/.test(p)) return "generation";
  if (/^\/api\/tts/.test(p)) return "narration";
  if (/^\/api\/(explain|revisit|viewer-ask|ask-drawing|canvas-lecture\/check-drawing|summarize-lecture|mind-map|generate-test|grade-|teach-back|fork-concept|generate-remediation|word-help|restructure|dyslexia)/.test(p)) return "questions";
  if (/^\/api\/(parse-pdf|parse-pptx|document)/.test(p)) return "document";
  if (/^\/api\/youtube/.test(p)) return "video";
  if (/^\/api\/(voice-|gemini-live|realtime)/.test(p)) return "voice";
  if (/^\/api\/(learner-|education|knowledge|onboarding)/.test(p)) return "personal";
  return "other";
}
