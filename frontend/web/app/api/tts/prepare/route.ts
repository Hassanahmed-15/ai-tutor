import { NextResponse } from "next/server";
import { prepareNarration } from "@/lib/narrationAudio";
import { splitNarrationSentences } from "@/lib/narrationText";

/**
 * `/api/tts/prepare` — the TTS test page's "make ahead" (app/tts-lab). Dev only: it runs exactly what
 * the worker runs before a board is ready (lib/narrationAudio.ts prepareNarration) on text the page
 * sends, and says, sentence by sentence, whether the clip was already stored, made now, or failed.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; sentences?: unknown };
  const sentences = Array.isArray(body.sentences)
    ? body.sentences.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : typeof body.text === "string" ? splitNarrationSentences(body.text) : [];
  if (!sentences.length) return NextResponse.json({ error: "text or sentences is required" }, { status: 400 });
  const started = Date.now();
  const clips = await prepareNarration(sentences.slice(0, 200), { concurrency: 3, deadlineMs: 120_000 });
  return NextResponse.json({ clips, ms: Date.now() - started, costUsd: clips.reduce((sum, clip) => sum + clip.costUsd, 0) });
}
