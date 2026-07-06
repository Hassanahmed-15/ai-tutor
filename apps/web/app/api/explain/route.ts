import { NextResponse } from "next/server";
import OpenAI from "openai";
import { EXPLAIN_SYSTEM_PROMPT } from "@/lib/drawPrompt";
import { sanitizeExplanation } from "@/lib/drawSanitize";
import { fillImageOps } from "@/lib/imageGen";
import { findWebImageForQuestion } from "@/lib/imageSearch";

/**
 * The side-chat "explain this further" endpoint. Returns one spoken explanation plus a fresh
 * marker-drawn DrawScript board answering the question. The board's image is a real photo
 * looked up via an unofficial DuckDuckGo image-search scrape (lib/imageSearch.ts, no API key
 * needed) — a spontaneous follow-up question is better served by a real picture of the actual
 * thing than a generic AI illustration. Falls back to AI image generation exactly as before
 * whenever the scrape breaks/changes or doesn't return a usable result.
 *
 * Honesty: costs a gpt-4o call, a small gpt-4o-mini keyword call, and either one free (but
 * unofficial/best-effort) DuckDuckGo lookup or, on fallback, one or more low-quality AI image
 * calls per question. Needs OPENAI_API_KEY in apps/web/.env.local.
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

      // Prefer a real photo for the question's image op: try the DuckDuckGo scrape first, and
      // only fall back to AI image generation if it breaks/isn't configured or comes up empty.
      // `imageSource` is reported to the client so the UI can show which pipeline produced it.
      let imageSource: "web" | "ai" | "none" = "none";
      if (result.draw) {
        const webImageUrl = await findWebImageForQuestion(client, question, beatContext);
        if (webImageUrl) {
          result.draw = {
            ...result.draw,
            ops: result.draw.ops.map((op) => (op.kind === "image" ? { ...op, src: webImageUrl } : op)),
          };
          imageSource = "web";
        } else {
          // sanitizeExplanation returns { script, draw? } — wrap draw in a synthetic beat for fillImageOps.
          const syntheticBeat = { title: topic || question, script: result.script, draw: result.draw };
          await fillImageOps(client, [syntheticBeat as Parameters<typeof fillImageOps>[1][number]]);
          result.draw = syntheticBeat.draw;
          imageSource = result.draw.ops.some((op) => op.kind === "image") ? "ai" : "none";
        }
      }

      return NextResponse.json({ ...result, imageSource });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Explanation failed";
    }
  }
  return NextResponse.json({ error: lastError }, { status: 502 });
}
