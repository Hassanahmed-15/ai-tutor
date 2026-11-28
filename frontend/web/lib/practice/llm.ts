import "server-only";
import type OpenAI from "openai";
import { bounded, client } from "@/lib/canvas/generate";
import { costFor } from "@/lib/modelPricing";
import { parseMathsJson } from "./jsonRepair";

/**
 * ONE JSON CALL for the practice exam: lib/canvas/generate.ts `jsonCall`, with the reasoning effort chosen per
 * call (the second examiner solves at medium) and image parts allowed (the photo marker). Goes through
 * createOpenAI, which logs the call in the spend log by itself: never record it again here.
 */
export const PRACTICE_MODEL = process.env.PRACTICE_EXAM_MODEL ?? "gpt-5.6-luna";

export type Effort = "low" | "medium" | "high";

export async function practiceJson<T>(system: string, content: string | OpenAI.Chat.ChatCompletionContentPart[], opts: { what: string; maxTokens: number; ms: number; effort?: Effort; model?: string }): Promise<{ json: T; costUsd: number }> {
  const model = opts.model ?? PRACTICE_MODEL;
  const res = await bounded(
    client().chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: opts.maxTokens,
      reasoning_effort: opts.effort ?? "low",
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming),
    opts.ms,
    opts.what,
  );
  const costUsd = costFor(model, res.usage);
  const text = res.choices[0]?.message?.content ?? "";
  try {
    return { json: parseMathsJson<T>(text), costUsd };
  } catch {
    throw Object.assign(new Error(`${opts.what}: the model returned invalid JSON (${text.length} chars, finish=${res.choices[0]?.finish_reason})`), { costUsd });
  }
}
