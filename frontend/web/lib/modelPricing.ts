/**
 * One price table, keyed by the model actually called.
 *
 * WHY THIS EXISTS. Every call site used to carry its own `INPUT_PRICE`/`OUTPUT_PRICE` pair, and the
 * animation pipeline drifted: `OPENAI_ANIMATION_MODEL` was pointed at gpt-5.5 while its constants
 * still read gpt-4o's $2.50/$10.00. gpt-5.5 is $5.00/$30.00, so every reported `costUsd` understated
 * the largest call in the pipeline by 2x on input and 3x on output — and nothing failed, because a
 * wrong price is not a wrong answer. Prices that live next to the call site are prices nobody
 * updates when the model moves.
 *
 * The rule that follows: a caller passes the model id it just used. It cannot pass a price, so it
 * cannot pass a stale one.
 *
 * Prices are USD per 1M tokens, from OpenAI's published pricing, checked 2026-08-24. When a model
 * is missing we deliberately fall back to the most expensive entry rather than to zero — a cost
 * report that silently reads $0.00 for an unrecognised model is how this bug happened in the first
 * place, and over-reporting is the safe direction to be wrong in.
 */

export type TokenUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined | null;

type Price = { input: number; output: number };

/** USD per 1M tokens. */
const PRICES: Record<string, Price> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.6-terra": { input: 2.0, output: 12.0 },
  "gpt-5.6-sol": { input: 4.0, output: 20.0 },
  "gpt-5.5": { input: 5.0, output: 30.0 },
  "gpt-5.5-pro": { input: 5.0, output: 30.0 },
  "gpt-5.4": { input: 5.0, output: 30.0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5": { input: 5.0, output: 30.0 },
  "gpt-5-mini": { input: 0.75, output: 4.5 },
  "gpt-5-nano": { input: 0.2, output: 1.25 },
  // Image tokens, not per-image. gpt-image-1 also bills $5.00/1M for text input.
  "gpt-image-1": { input: 10.0, output: 40.0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  // Narration. Text input and AUDIO output tokens, from the speech endpoint's SSE usage event.
  // Checked 2026-09-18 on developers.openai.com/api/docs/pricing.
  "gpt-4o-mini-tts": { input: 0.6, output: 12.0 },
};

/** The most expensive entry, used when a model id is unrecognised. See the header note. */
const FALLBACK: Price = { input: 10.0, output: 40.0 };

/**
 * Resolve a price, tolerating dated snapshots like `gpt-5.5-2026-04-23`.
 *
 * Longest prefix wins, so `gpt-5.4-mini-2026-03-17` matches `gpt-5.4-mini` and not `gpt-5.4` — the
 * shorter match would price a mini model at ten times its rate.
 */
export function priceFor(model: string): Price {
  const exact = PRICES[model];
  if (exact) return exact;
  let best: { key: string; price: Price } | null = null;
  for (const [key, price] of Object.entries(PRICES)) {
    if (!model.startsWith(key)) continue;
    if (!best || key.length > best.key.length) best = { key, price };
  }
  return best?.price ?? FALLBACK;
}

/** Cost in USD of one chat completion, from the model id and the usage block it returned. */
export function costFor(model: string, usage: TokenUsage): number {
  if (!usage) return 0;
  const { input, output } = priceFor(model);
  const prompt = usage.prompt_tokens ?? 0;
  /*
   * Output is billed on everything generated, thinking included. OpenAI folds reasoning into
   * `completion_tokens`, so total = prompt + completion and this changes nothing for it. A provider
   * that reports thinking only inside `total_tokens` would otherwise have its thinking priced at $0,
   * so the larger of the two readings is used.
   */
  const generated = Math.max(usage.completion_tokens ?? 0, (usage.total_tokens ?? 0) - prompt);
  return (prompt * input + generated * output) / 1_000_000;
}

/** True when a model needs `max_completion_tokens` and refuses a non-default `temperature`. */
export function isModernModel(model: string): boolean {
  return /^(gpt-5|o[0-9])/.test(model);
}

/* ── Gemini Live ─────────────────────────────────────────────────────────── */

type ModalityCount = { modality?: string; tokenCount?: number };
export type GeminiLiveUsage = {
  promptTokenCount?: number;
  responseTokenCount?: number;
  promptTokensDetails?: ModalityCount[];
  responseTokensDetails?: ModalityCount[];
} | null | undefined;

/**
 * USD per 1M tokens for gemini-3.1-flash-live-preview, paid tier, by modality.
 * From ai.google.dev/gemini-api/docs/pricing, checked 2026-09-18.
 */
const GEMINI_LIVE_PRICES = {
  input: { TEXT: 0.75, AUDIO: 3.0, IMAGE: 1.0, VIDEO: 1.0 } as Record<string, number>,
  output: { TEXT: 4.5, AUDIO: 12.0 } as Record<string, number>,
};

/**
 * Cost of ONE Live `usageMetadata` message.
 *
 * Measured on the real API (2026-09-18): usage arrives once per turn and is NOT cumulative — a
 * second turn reported 57 response tokens, not 109 — so callers must SUM these. Each turn's prompt
 * re-counts the whole conversation so far, including the tutor's earlier audio, which is why a long
 * Live session gets steadily more expensive per turn.
 *
 * Tokens the modality breakdown does not account for (the totals can exceed the details) are priced
 * as text — the cheapest reading — and never dropped.
 */
export function geminiLiveCostFor(usage: GeminiLiveUsage): number {
  if (!usage) return 0;
  const side = (total: number | undefined, details: ModalityCount[] | undefined, prices: Record<string, number>) => {
    let usd = 0;
    let counted = 0;
    for (const d of details ?? []) {
      const n = Math.max(0, d.tokenCount ?? 0);
      counted += n;
      usd += n * (prices[String(d.modality ?? "TEXT").toUpperCase()] ?? prices.TEXT);
    }
    usd += Math.max(0, (total ?? 0) - counted) * prices.TEXT;
    return usd;
  };
  return (
    side(usage.promptTokenCount, usage.promptTokensDetails, GEMINI_LIVE_PRICES.input) +
    side(usage.responseTokenCount, usage.responseTokensDetails, GEMINI_LIVE_PRICES.output)
  ) / 1_000_000;
}

/* ── OpenAI Realtime ─────────────────────────────────────────────────────── */

export type RealtimeUsage = {
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
} | null | undefined;

/** USD per 1M tokens for gpt-realtime. From developers.openai.com/api/docs/pricing, checked 2026-09-18. */
const REALTIME_PRICES = { textIn: 4.0, audioIn: 32.0, cachedIn: 0.4, textOut: 16.0, audioOut: 64.0 };

/**
 * Cost of one Realtime `response.done`, from its `response.usage`. Each response reports its own
 * usage, so callers SUM these. Cached input is billed at the cached rate and removed from the
 * uncached counts it is included in.
 */
export function realtimeCostFor(usage: RealtimeUsage): number {
  if (!usage) return 0;
  const inp = usage.input_token_details ?? {};
  const out = usage.output_token_details ?? {};
  const cachedText = inp.cached_tokens_details?.text_tokens ?? 0;
  const cachedAudio = inp.cached_tokens_details?.audio_tokens ?? 0;
  const cached = inp.cached_tokens_details ? cachedText + cachedAudio : inp.cached_tokens ?? 0;
  const text = Math.max(0, (inp.text_tokens ?? 0) - cachedText);
  const audio = Math.max(0, (inp.audio_tokens ?? 0) - cachedAudio);
  return (
    text * REALTIME_PRICES.textIn +
    audio * REALTIME_PRICES.audioIn +
    cached * REALTIME_PRICES.cachedIn +
    (out.text_tokens ?? 0) * REALTIME_PRICES.textOut +
    (out.audio_tokens ?? 0) * REALTIME_PRICES.audioOut
  ) / 1_000_000;
}
