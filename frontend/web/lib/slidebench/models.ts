/**
 * THE CONTESTANT REGISTRY for the slide-generation bench.
 *
 * Separate from `lib/animationModels.ts` on purpose. That list is the PRODUCTION rotation — three
 * OpenAI models that real lectures are actually drawn with, and adding an untested contestant to it
 * would put that contestant in front of students. This list is the bench: anything may be entered
 * here, including models that turn out to be bad, because nothing here ships to a lecture.
 *
 * ADDING A MODEL is one entry. The provider field decides which client runs it; everything
 * downstream (pricing, the runner, the report) reads from this registry rather than hardcoding
 * names, which is the mistake `scripts/compare-animation-models.mjs:26` made when it duplicated the
 * rotation as a string array and then drifted from it.
 */

/** Which SDK/endpoint talks to this model. */
export type SlideBenchProvider = "openai" | "gemini";

export interface SlideBenchModel {
  /** The id sent to the provider, verbatim. */
  id: string;
  /** For the UI and the report. */
  label: string;
  provider: SlideBenchProvider;
  /**
   * WHICH KEY RAN IT. Not the key — the name of the env var holding it.
   *
   * The report has to say which credential produced a number (two keys on different tiers hit
   * different rate limits and can produce different latencies for the same model), and it must do
   * that without ever putting a secret in a document that gets shared. The var NAME plus a short
   * fingerprint of the key's value is enough to tell two keys apart and useless to an attacker.
   */
  apiKeyEnv: string;
  /** USD per 1M tokens. Gemini text prices live here because lib/modelPricing.ts only knows Live. */
  price: { input: number; output: number };
  /** Shown in the report so a reader knows why a model was included. */
  note: string;
}

/**
 * Six contestants: three production OpenAI models, one cheap OpenAI baseline, and two Gemini Flash
 * models including the 3.8 that prompted this bench. Verified present on this account's keys —
 * `gemini-3.8-flash` answers generateContent and reports usage including thoughtsTokenCount.
 *
 * Prices are USD per 1M tokens. The OpenAI ones mirror lib/modelPricing.ts so the two cannot
 * disagree about the same model; the Gemini ones are published list prices for text generation.
 */
export const SLIDE_BENCH_MODELS: SlideBenchModel[] = [
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    provider: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    price: { input: 0.2, output: 1.2 },
    note: "Production default for animation generation (OPENAI_ANIMATION_MODEL).",
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    provider: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    price: { input: 2, output: 12 },
    note: "Mid tier of the production rotation.",
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    provider: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    price: { input: 4, output: 20 },
    note: "Top tier of the production rotation — the quality ceiling to beat.",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    price: { input: 0.15, output: 0.6 },
    note: "Cheap baseline. Included to show what the money buys, not to win.",
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    price: { input: 0.3, output: 2.5 },
    note: "The model this bench was built to evaluate.",
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    provider: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    price: { input: 0.3, output: 2.5 },
    note: "Previous Flash generation, so 3.8's gain over its own line is visible.",
  },
];

export function slideBenchModel(id: string): SlideBenchModel | null {
  return SLIDE_BENCH_MODELS.find((model) => model.id === id) ?? null;
}

/**
 * A short, non-reversible fingerprint of the key that ran a request.
 *
 * Enough to prove two runs used the same credential, or to tell two keys on different tiers apart
 * in the report. Never the key itself: this string ends up in a DOCX that gets emailed around.
 */
export function apiKeyFingerprint(rawKey: string | undefined): string {
  if (!rawKey) return "absent";
  let hash = 0;
  for (let i = 0; i < rawKey.length; i++) {
    hash = (hash * 31 + rawKey.charCodeAt(i)) | 0;
  }
  return `k-${(hash >>> 0).toString(36).slice(0, 6)}`;
}

/** USD for one call, from this registry's prices rather than the OpenAI-only pricing table. */
export function slideBenchCost(model: SlideBenchModel, promptTokens: number, outputTokens: number): number {
  return (promptTokens * model.price.input + outputTokens * model.price.output) / 1_000_000;
}
