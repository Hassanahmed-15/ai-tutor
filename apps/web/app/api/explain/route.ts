import { NextResponse } from "next/server";
import OpenAI from "openai";
import { EXPLAIN_SYSTEM_PROMPT } from "@/lib/drawPrompt";
import { sanitizeExplanation } from "@/lib/drawSanitize";
import { fillImageOps } from "@/lib/imageGen";

/**
 * The side-chat "explain this further" endpoint. Returns one spoken explanation plus a fresh
 * marker-drawn DrawScript board answering the question. Follow-up questions prefer a
 * blackboard diagram; if a legacy/model response still includes an image op, it is filled.
 *
 * Honesty: costs a gpt-4o call + optionally a low-quality image call only if an image op
 * survives sanitization.
 * Needs OPENAI_API_KEY in apps/web/.env.local.
 */
const MODEL = process.env.OPENAI_EXPLAIN_MODEL ?? "gpt-4o";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const beatContext = typeof body.beatContext === "string" ? body.beatContext.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userMsg =
    `The lecture topic is "${topic || "this subject"}". ` +
    (beatContext ? `The student is on this part: "${beatContext}". ` : "") +
    `They asked: "${question}". Explain it and draw a fresh board.`;

  let lastError = "Couldn't generate an explanation.";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      const result = sanitizeExplanation(JSON.parse(raw), { question });

      // Fill any "image" op placeholder with a real generated contextual image.
      // sanitizeExplanation returns { script, draw? } — wrap draw in a synthetic beat for fillImageOps.
      if (result.draw) {
        const syntheticBeat = { title: topic || question, script: result.script, draw: result.draw };
        await fillImageOps(client, [syntheticBeat as Parameters<typeof fillImageOps>[1][number]]);
        result.draw = syntheticBeat.draw;
      }

      return NextResponse.json(result);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Explanation failed";
    }
  }
  return NextResponse.json({ error: lastError }, { status: 502 });
}
