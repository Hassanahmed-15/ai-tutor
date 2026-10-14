import { NextResponse } from "next/server";
import { costFor } from "@/lib/modelPricing";
import { createOpenAI, spendScopeNow } from "@/lib/openaiClient";
import { recordSpend } from "@/lib/spend/record";
import { createTtsQueue } from "@/lib/ttsQueue";

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
    /*
     * ONE PAID SYNTHESIS PER SENTENCE. The player gives up on a slow clip after 10 s and retries
     * (three times), and the prefetcher asks for the same sentences ahead of time; each of those used
     * to start its own paid call. Measured 2026-10-13: under a burst, one sentence could be bought up
     * to six times. Now every request for a sentence already being made waits for that one.
     */
    // A warm-up for later (lib/useNarrationPrefetch.ts) waits behind the sentence a student is about to hear.
    const warm = req.headers.get("x-tts-priority") === "warm";
    let entry = inflight.get(cacheKey);
    const shared = Boolean(entry);
    if (!entry) {
      const priority = { warm };
      const promise = withTtsSlot(() => withDeadline(synthesize(input)), priority).finally(() => inflight.delete(cacheKey));
      entry = { promise, priority };
      inflight.set(cacheKey, entry);
    } else if (!warm && entry.priority.warm) {
      // The student has reached a sentence still queued as a warm-up: it is needed NOW.
      entry.priority.warm = false;
      wakeWaiters();
    }
    const { buffer, costUsd, estimated } = await entry.promise;
    if (!shared) {
      // Narration is billed per sentence; the spend log needs every one (the badge, today's total).
      const scope = await spendScopeNow();
      recordSpend({ tag: scope.tag, userId: scope.userId, kind: "narration", model: TTS_MODEL, endpoint: estimated ? "speech-estimated" : "speech", usd: costUsd });
      if (MAX_CACHE_ENTRIES > 0) {
        if (ttsCache.size >= MAX_CACHE_ENTRIES) {
          const oldestKey = ttsCache.keys().next().value;
          if (oldestKey) ttsCache.delete(oldestKey);
        }
        ttsCache.set(cacheKey, buffer);
      }
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
        "X-TTS-Cache": shared ? "shared" : "miss",
        // A request that joined a synthesis already under way spent nothing itself.
        ...(shared ? { "X-Cost-Usd": "0" } : costUsd !== null ? { "X-Cost-Usd": costUsd.toFixed(8) } : {}),
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
 * Raw fetch, because the installed SDK (openai 4.104) predates `stream_format`. Throws on anything
 * unexpected; `synthesize` then falls back to the ordinary call, except after a timeout.
 */
type Synthesis = { buffer: Buffer; costUsd: number | null; estimated: boolean };
const inflight = new Map<string, { promise: Promise<Synthesis>; priority: { warm: boolean } }>();

/*
 * AT MOST A FEW SENTENCES AT ONCE. A burst of a dozen parallel requests made OpenAI queue them: the
 * measured calls hit their timeout, each then fell back to a SECOND paid call, and one clip took five
 * minutes (2026-10-13). A small queue keeps every call quick, so none is paid for twice.
 *
 * AND THE SENTENCE BEING HEARD GOES FIRST (2026-10-14). The queue was first come, first served, and
 * one student's lecture alone asks for 4 clips of the sentence in hand plus 2 warm-ups of later parts —
 * so the next sentence waited behind warm-ups for minutes ahead, the player gave up on it at 10 s, and
 * the lecture went quiet mid-part (measured on the live site: a 16.8 s silence, warm-ups of 126 s and
 * 176 s). Now a warm-up (header `x-tts-priority: warm`) never starts while a heard sentence waits, and
 * warm-ups never hold all the slots; a warm-up the player then asks for is promoted (lib/ttsQueue.ts).
 */
const TTS_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.TTS_CONCURRENCY ?? 4)));
const ttsQueue = createTtsQueue(TTS_CONCURRENCY);
const withTtsSlot = ttsQueue.run;
const wakeWaiters = ttsQueue.wake;

/*
 * Dollars per character of narration, learned from this server's measured sentences (a running
 * average), for the rare call that reports no usage. Seeded from measured sentences (2026-10-13:
 * ~$0.0015–0.0022 for 45–70 characters).
 */
let usdPerChar = 0.000028;

/*
 * EVERY CALL IS BOUNDED. The fallback used to be the SDK's default — a 10-minute timeout and two
 * retries — so one slow upstream held a slot for minutes (176 s measured). Both calls now give up in
 * well under a minute, and the player's own retry then asks again.
 */
const MEASURED_TIMEOUT_MS = 20_000;
const FALLBACK_TIMEOUT_MS = 12_000;
/*
 * A sentence normally starts arriving in 1-2 s. A call with no answer at all after 6 s has hung
 * upstream (measured 2026-10-14: hung calls never answered, healthy ones answered in 1.4-1.7 s), so
 * it is dropped and asked again at once instead of holding a slot for the full 20 s. A call that never
 * connected is not billed.
 */
const FIRST_BYTE_TIMEOUT_MS = 6_000;

async function synthesize(input: string): Promise<Synthesis> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const measured = await synthesizeWithUsage(input);
      const costUsd = costFor(TTS_MODEL, { prompt_tokens: measured.inputTokens, completion_tokens: measured.outputTokens });
      if (input.length > 10) usdPerChar = usdPerChar * 0.9 + (costUsd / input.length) * 0.1;
      return { buffer: measured.audio, costUsd, estimated: false };
    } catch (error) {
      // A stall (usually before connecting, so unbilled) or an error: asked again, then once plainly.
      console.warn(`[tts] measured call ${attempt} failed:`, error instanceof Error ? error.message : error);
    }
  }
  const client = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // The SDK's `timeout` stops at the response headers; reading the audio is bounded by this signal
  // (a body that stalled mid-stream held a slot for 304 s, measured 2026-10-14).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("fallback timed out")), FALLBACK_TIMEOUT_MS);
  try {
    const speech = await client.audio.speech.create(
      { model: TTS_MODEL, voice: VOICE, input, instructions: TEACHER_TONE, response_format: "mp3" },
      { timeout: FALLBACK_TIMEOUT_MS, maxRetries: 0, signal: controller.signal },
    );
    // This call reported no usage, but it was billed: estimated at the measured rate, never left out.
    return { buffer: Buffer.from(await speech.arrayBuffer()), costUsd: input.length * usdPerChar, estimated: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * THE LAST GUARANTEE: a synthesis that is still not done after SYNTHESIS_DEADLINE_MS gives up its slot
 * whatever it is stuck on, so one hung upstream call can never stall every lecture behind it.
 */
const SYNTHESIS_DEADLINE_MS = 45_000;
function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("synthesis deadline")), SYNTHESIS_DEADLINE_MS); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

async function synthesizeWithUsage(
  input: string,
): Promise<{ audio: Buffer; inputTokens: number; outputTokens: number }> {
  // A hung upstream request held one sentence's clip, and with it the whole narration: no answer in
  // FIRST_BYTE_TIMEOUT_MS, or no finished clip in MEASURED_TIMEOUT_MS, and the call is dropped.
  const controller = new AbortController();
  const overall = setTimeout(() => controller.abort(new Error("timed out")), MEASURED_TIMEOUT_MS);
  const firstByte = setTimeout(() => controller.abort(new Error(`no answer in ${FIRST_BYTE_TIMEOUT_MS / 1000} s`)), FIRST_BYTE_TIMEOUT_MS);
  try {
    return await readMeasuredSpeech(input, controller.signal, () => clearTimeout(firstByte));
  } finally {
    clearTimeout(overall);
    clearTimeout(firstByte);
  }
}

async function readMeasuredSpeech(input: string, signal: AbortSignal, answered: () => void): Promise<{ audio: Buffer; inputTokens: number; outputTokens: number }> {
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
    signal,
  });
  answered();
  if (!res.ok) throw new Error(`speech ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
  const chunks: Buffer[] = [];
  type SpeechUsage = { input_tokens?: number; output_tokens?: number };
  let usage: SpeechUsage | null = null;
  for (const line of (await res.text()).split(/\r?\n/)) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const event = JSON.parse(line.slice(6)) as { type?: string; audio?: string; usage?: SpeechUsage };
    if (event.type === "speech.audio.delta" && typeof event.audio === "string") chunks.push(Buffer.from(event.audio, "base64"));
    else if (event.type === "speech.audio.done") usage = event.usage ?? null;
  }
  if (!chunks.length || !usage) throw new Error(`speech stream ended without ${chunks.length ? "usage" : "audio"}`);
  return { audio: Buffer.concat(chunks), inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 };
}
