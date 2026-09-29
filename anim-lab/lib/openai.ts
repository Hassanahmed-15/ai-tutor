import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

/** Same model the production sandbox draws with (OPENAI_ANIMATION_MODEL in frontend/web/.env.local). */
export const LAB_MODEL = process.env.ANIM_LAB_MODEL ?? "gpt-5.6-luna";
/** lib/modelPricing.ts in the main app: USD per 1M tokens. */
const PRICE = { input: 0.2, output: 1.2 };

/** Reads the key from the main app's .env.local instead of duplicating the secret into the lab. */
function apiKey(): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const env = fs.readFileSync(path.resolve(process.cwd(), "../frontend/web/.env.local"), "utf8");
    const match = env.match(/^OPENAI_API_KEY=(.*)$/m);
    return match?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

let client: OpenAI | null = null;
export function openai(): OpenAI {
  if (!client) {
    const key = apiKey();
    if (!key) throw new Error("OPENAI_API_KEY not found (env or ../frontend/web/.env.local)");
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

export type Completion = { text: string; costUsd: number; ms: number; finish: string | null };

export async function complete(system: string, user: string, opts: { json?: boolean; maxTokens?: number } = {}): Promise<Completion> {
  const started = Date.now();
  const res = await openai().chat.completions.create({
    model: LAB_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // gpt-5.x: reasoning draws from the same budget as the reply; "low" is what production uses.
    max_completion_tokens: opts.maxTokens ?? 16_000,
    reasoning_effort: "low",
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const usage = res.usage;
  const costUsd = usage ? (usage.prompt_tokens * PRICE.input + usage.completion_tokens * PRICE.output) / 1_000_000 : 0;
  return {
    text: res.choices[0]?.message?.content ?? "",
    costUsd,
    ms: Date.now() - started,
    finish: res.choices[0]?.finish_reason ?? null,
  };
}

export function stripFences(text: string): string {
  return text.trim().replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
}
