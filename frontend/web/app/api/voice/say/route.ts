import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { GEMINI_TTS_MODEL, planningCloneOn, streamGeminiVoicePcm } from "@/lib/geminiVoice";
import { withVoice } from "@/lib/voices";
import { spendScopeNow } from "@/lib/openaiClient";
import { recordSpend } from "@/lib/spend/record";

/**
 * ONE SENTENCE OF THE PLANNING CHAT, IN ARIA'S CLONED VOICE (lib/geminiVoice.ts planningCloneOn). Gemini Live
 * listens and thinks; the browser sends each sentence of its transcript here and plays what comes back
 * (lib/useGeminiLiveTutor.ts `clonedVoice`).
 *
 *   GET  → { on }: whether the clone is set up on this server (the hook plays Live's own voice when it is not).
 *   POST { text } → raw 24 kHz 16-bit mono PCM, streamed as it is made. Signed in only; the key stays here.
 */
export const dynamic = "force-dynamic";

const MAX_CHARS = 600;

export async function GET() {
  return NextResponse.json({ on: planningCloneOn() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!planningCloneOn()) return NextResponse.json({ error: "the cloned voice is not set up" }, { status: 503 });
  if (!(await currentUser())) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS) : "";
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const scope = await spendScopeNow();
  const audio = streamGeminiVoicePcm(text, req.signal);
  // The first chunk is awaited here, so a failed call answers with an error status the hook can fall back on,
  // rather than a 200 with an empty body.
  let first: IteratorResult<Uint8Array, number>;
  try {
    // The generator makes its request on the first chunk: that chunk runs in the student's chosen voice (lib/voices.ts).
    first = await withVoice(typeof body.voice === "string" ? body.voice : req.headers.get("x-aria-voice"), () => audio.next());
  } catch (error) {
    console.warn(`[voice/say] ${(error as Error).message}`);
    return NextResponse.json({ error: "the cloned voice did not answer" }, { status: 502 });
  }
  const record = (usd: number | null) =>
    recordSpend({ tag: scope.tag, userId: scope.userId, kind: scope.kind === "other" ? "planning" : scope.kind, model: GEMINI_TTS_MODEL, endpoint: "speech-stream", usd });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (first.done) {
          record(first.value);
          controller.close();
          return;
        }
        controller.enqueue(first.value);
        for (;;) {
          const next = await audio.next();
          if (next.done) {
            record(next.value);
            break;
          }
          controller.enqueue(next.value);
        }
        controller.close();
      } catch (error) {
        // Cut short (the student spoke over her, or the call failed mid-way): what was made is still billed.
        record(null);
        try {
          controller.error(error);
        } catch {
          // Already closed by the reader going away.
        }
      }
    },
    cancel() {
      void audio.return?.(0);
    },
  });
  return new NextResponse(stream, {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Audio-Format": "pcm-s16le-24000-mono" },
  });
}
