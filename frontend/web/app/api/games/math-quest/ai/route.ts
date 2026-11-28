import { NextResponse } from "next/server";
import type OpenAI from "openai";
import { lessonCaller } from "@/lib/auth";
import { bounded, client } from "@/lib/canvas/generate";
import { extractJSON, limited, mockReply } from "@/lib/games/mathQuest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * MATH QUEST'S AI ROUTE (the game's `aiEndpoint`, contract in docs/math-quest/README.original.md):
 * POST {prompt, mode: "text"|"json", tier: "quick"|"default"} → {text} or {json}; busy → 429 {error:"rate_limited"}.
 * With ANTHROPIC_API_KEY set it calls Claude exactly as the game's own server does; without one it uses Aria's
 * OpenAI model (createOpenAI logs the spend by itself). MQ_MOCK_AI=1 gives the original free fake replies.
 */
const CLAUDE_DEFAULT = process.env.MQ_MODEL ?? "claude-sonnet-5-5";
const CLAUDE_QUICK = process.env.MQ_MODEL_QUICK ?? "claude-haiku-5-5";
const OPENAI_MODEL = process.env.MQ_OPENAI_MODEL ?? "gpt-5.6-luna";

class Busy extends Error {}

async function claude(prompt: string, tier: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: tier === "quick" ? CLAUDE_QUICK : CLAUDE_DEFAULT, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
  });
  if (r.status === 429 || r.status === 529) throw new Busy("rate_limited");
  if (!r.ok) throw new Error(`Claude API error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
  return (d.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

async function openai(prompt: string, tier: string, mode: string): Promise<string> {
  try {
    const res = await bounded(
      client().chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        // A level written by the Learning Portal is one long JSON reply; Euclid's answers are short.
        max_completion_tokens: mode === "json" ? 16000 : 2000,
        reasoning_effort: "low",
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming),
      tier === "quick" ? 30_000 : 110_000,
      "Math Quest AI",
    );
    return res.choices[0]?.message?.content ?? "";
  } catch (error) {
    if ((error as { status?: number }).status === 429) throw new Busy("rate_limited");
    throw error;
  }
}

export async function POST(req: Request) {
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to play." }, { status: 401 });
  if (limited(caller.userId)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as { prompt?: unknown; mode?: unknown; tier?: unknown };
  const prompt = b.prompt, mode = b.mode === "json" ? "json" : "text", tier = b.tier === "quick" ? "quick" : "default";
  if (typeof prompt !== "string" || prompt.length > 20000) return NextResponse.json({ error: "bad prompt" }, { status: 400 });
  if (process.env.MQ_MOCK_AI === "1") return NextResponse.json(mockReply(prompt, mode));
  try {
    const text = process.env.ANTHROPIC_API_KEY ? await claude(prompt, tier) : await openai(prompt, tier, mode);
    return NextResponse.json(mode === "json" ? { json: extractJSON(text) } : { text });
  } catch (error) {
    if (error instanceof Busy) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    console.warn("[math-quest] AI call failed:", (error as Error).message);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
