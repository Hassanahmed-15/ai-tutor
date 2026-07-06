import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * Dysgraphia "AI scribe": takes a messy, rambling spoken explanation (transcribed by the
 * browser's speech recognition) and restructures it into a clean, organized written
 * paragraph — fixing ordering, removing filler ("um", "like", "so basically"), and grouping
 * related ideas. This is explicitly NOT transcription cleanup; the model is asked to
 * reorganize the thought, not just punctuate it. Server-side only: the API key never
 * reaches the browser.
 *
 * Honesty: this costs a small amount per call and needs OPENAI_API_KEY in frontend/web/.env.local.
 * Without a key it returns 503 and the client shows a clear "scribe unavailable" notice.
 */
const MODEL = process.env.OPENAI_RESTRUCTURE_MODEL ?? "gpt-4o-mini";

const SCRIBE_PROMPT =
  "You are a writing assistant for a student with dysgraphia — they know the answer but " +
  "struggle to get it written down in an organized way. You will receive a messy, rambling, " +
  "spoken explanation (filler words, false starts, out-of-order ideas). Rewrite it as a clean, " +
  "well-organized written paragraph in the student's own voice and intent: fix the ordering, " +
  "remove filler words, group related ideas together, and use proper spacing and punctuation. " +
  "Do not add facts the student did not say. Do not add commentary, headers, or quotation " +
  "marks. Return ONLY the rewritten paragraph, nothing else.";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not set — add it to frontend/web/.env.local to enable the AI scribe." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: SCRIBE_PROMPT },
        { role: "user", content: text.slice(0, 6000) },
      ],
    });

    const restructured = completion.choices[0]?.message?.content?.trim();
    if (!restructured) throw new Error("empty response");

    return NextResponse.json({ restructured });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restructure failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
