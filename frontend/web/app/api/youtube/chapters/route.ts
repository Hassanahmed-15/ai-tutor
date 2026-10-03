import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import OpenAI from "openai";
import { createCostMeter } from "@/lib/costMeter";
import { isModernModel } from "@/lib/modelPricing";
import { CHAPTERS_SYSTEM_PROMPT, chaptersUserMessage, fallbackChapters, parseChapters, sanitizeSegments } from "@/lib/youtube/videoNotes";
import { MAX_VIDEO_SEC } from "@/lib/youtube/videoSource";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The video's transcript, divided into the topics it teaches (lib/youtube/videoNotes.ts).
 *
 * This call only has to find boundaries, so it is the one place the whole transcript goes to a
 * model at once. A transcript it cannot divide still becomes a lecture: equal six-minute chapters.
 */
const MODEL = process.env.OPENAI_VIDEO_NOTES_MODEL ?? "gpt-4o";

export async function POST(req: Request) {
  // Reading a video is metered; like building the lecture itself, it needs a signed-in student.
  if (!(await currentUser())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const videoTitle = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const durationSec = Math.min(MAX_VIDEO_SEC, Math.max(1, Math.floor(Number(body.durationSec) || 0)));
  // Three hours at one segment per twenty seconds is 540; the limit is a bound, not a budget.
  const segments = sanitizeSegments(body.segments, 2_000);
  if (segments.length === 0) return NextResponse.json({ error: "The video has no speech to build a lecture from." }, { status: 422 });

  const meter = createCostMeter();
  const client = meter.wrap(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        ...(isModernModel(MODEL) ? { max_completion_tokens: 4_000 } : { max_tokens: 4_000, temperature: 0.2 }),
        messages: [
          { role: "system", content: CHAPTERS_SYSTEM_PROMPT },
          { role: "user", content: chaptersUserMessage(videoTitle, segments) },
        ],
      });
      const parsed = parseChapters(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), durationSec);
      return NextResponse.json({ title: parsed.title || videoTitle, chapters: parsed.chapters, costUsd: meter.totalUsd });
    } catch (error) {
      console.warn(`[youtube] chapters attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  return NextResponse.json({ title: videoTitle, chapters: fallbackChapters(durationSec), costUsd: meter.totalUsd, fallback: true });
}
