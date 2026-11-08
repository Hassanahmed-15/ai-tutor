import { NextResponse } from "next/server";
import { simulateTtsOutage, ttsOutageLeftMs } from "@/lib/ttsOutage";

/**
 * `/api/tts/outage` — the TTS test page's "simulate an outage" (app/tts-lab). Dev only: for the next `ms`
 * every /api/tts request fails as a broken voice would, so the lecture's last fallback can be watched —
 * it pauses on the sentence and goes on, in Aria's voice, once the voice is back.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { ms?: unknown };
  const ms = Math.max(0, Math.min(120_000, Number(body.ms) || 0));
  simulateTtsOutage(ms);
  return NextResponse.json({ leftMs: ttsOutageLeftMs() });
}

export async function GET() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ leftMs: ttsOutageLeftMs() });
}
