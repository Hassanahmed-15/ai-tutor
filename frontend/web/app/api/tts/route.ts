import { NextResponse } from "next/server";
import OpenAI from "openai";
import { costFor } from "@/lib/modelPricing";

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
        // Served from memory: no call was made, so nothing was spent.
        "X-Cost-Usd": "0",
      },
    });
  }

  try {
    // Measured first; the plain SDK call remains as the fallback so narration never depends on it.
    const measured = await synthesizeWithUsage(input).catch(() => null);
    let buffer: Buffer;
    let costUsd: number | null = null;
    if (measured) {
      buffer = measured.audio;
      costUsd = costFor(TTS_MODEL, { prompt_tokens: measured.inputTokens, completion_tokens: measured.outputTokens });
    } else {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const speech = await client.audio.speech.create({
        model: TTS_MODEL,
        voice: VOICE,
        input, // API hard limit is 4096 chars
        instructions: TEACHER_TONE,
        response_format: "mp3",
      });
      buffer = Buffer.from(await speech.arrayBuffer());
    }
    if (MAX_CACHE_ENTRIES > 0) {
      if (ttsCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = ttsCache.keys().next().value;
        if (oldestKey) ttsCache.delete(oldestKey);
      }
      ttsCache.set(cacheKey, buffer);
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
        "X-TTS-Cache": "miss",
        // Absent when usage could not be read: the client then shows narration as unpriced rather
        // than inventing a figure.
        ...(costUsd !== null ? { "X-Cost-Usd": costUsd.toFixed(8) } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Synthesise and read back what the call actually used.
 *
 * WHY. The plain speech endpoint returns only audio, so narration was the one stream whose cost could
 * only be guessed — and the usual guess (~$0.015 per minute) is wrong for this app. Narration is
 * synthesised one sentence at a time, and short clips cost more per minute: a measured 3-second
 * sentence used 108 audio tokens, about $0.026 per minute. With `stream_format: "sse"` the final
 * event carries real token usage, so the figure is measured rather than assumed.
 *
 * Raw fetch, because the installed SDK (openai 4.104) predates `stream_format`. Returns null on
 * anything unexpected and the caller falls back to the ordinary call.
 */
async function synthesizeWithUsage(
  input: string,
): Promise<{ audio: Buffer; inputTokens: number; outputTokens: number } | null> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: VOICE,
      input,
      instructions: TEACHER_TONE,
      response_format: "mp3",
      stream_format: "sse",
    }),
  });
  if (!res.ok) return null;
  const chunks: Buffer[] = [];
  type SpeechUsage = { input_tokens?: number; output_tokens?: number };
  let usage: SpeechUsage | null = null;
  for (const line of (await res.text()).split(/\r?\n/)) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const event = JSON.parse(line.slice(6)) as { type?: string; audio?: string; usage?: SpeechUsage };
    if (event.type === "speech.audio.delta" && typeof event.audio === "string") chunks.push(Buffer.from(event.audio, "base64"));
    else if (event.type === "speech.audio.done") usage = event.usage ?? null;
  }
  if (!chunks.length || !usage) return null;
  return { audio: Buffer.concat(chunks), inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 };
}
