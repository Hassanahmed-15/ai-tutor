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

export type TokenUsage = { prompt_tokens?: number; completion_tokens?: number } | undefined | null;

type Price = { input: number; output: number };

/** USD per 1M tokens. */
const PRICES: Record<string, Price> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
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
  return ((usage.prompt_tokens ?? 0) * input + (usage.completion_tokens ?? 0) * output) / 1_000_000;
}

/** True when a model needs `max_completion_tokens` and refuses a non-default `temperature`. */
export function isModernModel(model: string): boolean {
  return /^(gpt-5|o[0-9])/.test(model);
}
