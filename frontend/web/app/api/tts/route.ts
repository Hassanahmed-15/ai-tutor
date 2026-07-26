import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * Teacher-voice text-to-speech. Streams warm, natural narration from OpenAI TTS so the
 * tutor sounds like a real teacher explaining — not a flat robotic reader. Server-side
 * only: the API key never reaches the browser. Returns audio/mpeg bytes the client plays.
 *
 * Honesty: this costs a small amount per call and needs OPENAI_API_KEY in frontend/web/.env.local.
 * Without a key it returns 503 and the client falls back to silent captions.
 */
const VOICE = process.env.OPENAI_TTS_VOICE ?? "nova"; // brighter and more classroom-friendly than the old darker narrator voice
const TTS_MODEL = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const MAX_CACHE_ENTRIES = Math.max(0, Math.min(200, Number(process.env.TTS_CACHE_ENTRIES ?? 80)));
const ttsCache = new Map<string, Buffer>();

const TEACHER_TONE =
  "You are Aria, a kind classroom teacher helping one curious student. Speak with a clear, " +
  "friendly teacher style: patient, reassuring, lightly upbeat, and never theatrical. Use gentle " +
  "enthusiasm, natural pauses, and a small smile in the voice. Do not sound stern, sarcastic, " +
  "ominous, intimidating, seductive, mocking, sadistic, or like a dramatic narrator. If the text " +
  "contains a surprising idea, present it with wonder, not menace. Keep the volume and projection " +
  "confident and easy to hear without rushing.";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not set — add it to frontend/web/.env.local to enable the teacher voice." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const input = text.slice(0, 4000);
  const cacheKey = `${TTS_MODEL}:${VOICE}:${input}`;
  const cached = MAX_CACHE_ENTRIES > 0 ? ttsCache.get(cacheKey) : undefined;
  if (cached) {
    return new NextResponse(Buffer.from(cached), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
        "X-TTS-Cache": "hit",
      },
    });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const speech = await client.audio.speech.create({
      model: TTS_MODEL,
      voice: VOICE,
      input, // API hard limit is 4096 chars
      instructions: TEACHER_TONE,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await speech.arrayBuffer());
    if (MAX_CACHE_ENTRIES > 0) {
      if (ttsCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = ttsCache.keys().next().value;
        if (oldestKey) ttsCache.delete(oldestKey);
      }
      ttsCache.set(cacheKey, buffer);
    }
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
        "X-TTS-Cache": "miss",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
