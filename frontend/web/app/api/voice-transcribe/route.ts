import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

export const runtime = "nodejs";

/**
 * A SECOND OPINION ON A FEW SECONDS OF SPEECH.
 *
 * The voice gate waits for words before it lets a voice interrupt the lecture, and those words come
 * from the browser's speech recogniser — which captures through its own audio path and can hear
 * nothing at all while the gate hears the student clearly (measured: "no-speech" to every phrase).
 * When that happens the gate sends the utterance here, and only then: one short clip, after a voice
 * was detected and the local recogniser stayed silent. The text decides whether "Aria" was called.
 *
 * Body: a 16 kHz mono WAV (<= ~8 s). Returns { text }. Any failure returns { text: "" } — the gate
 * then treats the utterance as not addressed, which is what it did before this existed.
 */
const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";
const MAX_BYTES = 400_000;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ text: "" }, { status: 503 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length < 1_000 || bytes.length > MAX_BYTES) return NextResponse.json({ text: "" }, { status: 400 });
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 8_000, maxRetries: 0 });
  try {
    const result = await client.audio.transcriptions.create({
      file: await toFile(bytes, "utterance.wav", { type: "audio/wav" }),
      model: MODEL,
      // The tutor's name is the word that matters most and the one a recogniser knows least.
      prompt: "A student talking to their tutor, Aria. They may say \"Aria\" or \"hey Aria\".",
      response_format: "json",
    });
    return NextResponse.json({ text: (result.text ?? "").trim() });
  } catch (error) {
    console.error(`[voice-transcribe] ${error instanceof Error ? error.message : "failed"}`);
    return NextResponse.json({ text: "" }, { status: 502 });
  }
}
