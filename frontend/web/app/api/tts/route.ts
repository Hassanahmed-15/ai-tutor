import { NextResponse } from "next/server";
import { recordNarrationSpend, storeNarration, storedNarration, synthesizeNarration, TTS_MODEL, TTS_VOICE, type Synthesis } from "@/lib/narrationAudio";
import { narrationInput } from "@/lib/narrationText";
import { createTtsQueue } from "@/lib/ttsQueue";
import { ttsOutageLeftMs } from "@/lib/ttsOutage";

/**
 * Teacher-voice text-to-speech: one sentence of Aria's narration as audio/mpeg. Server-side only: the
 * API key never reaches the browser.
 *
 * WHERE A CLIP COMES FROM, fastest first (owner, 2026-11-07: "I want no delay"):
 *   1. this server's memory (a sentence just played);
 *   2. STORED — made ahead by the worker when the board was written, or made live once before, on any
 *      server (lib/narrationAudio.ts). Tens of milliseconds, nothing spent;
 *   3. made now by OpenAI, shared with any other request for the same sentence, the sentence the
 *      student is about to hear first — then stored, so it is never made again.
 *
 * Honesty: making a clip costs a small amount per call and needs OPENAI_API_KEY in
 * frontend/web/.env.local. Without a key (and no stored clip) it returns 503.
 */
const MAX_CACHE_ENTRIES = Math.max(0, Math.min(200, Number(process.env.TTS_CACHE_ENTRIES ?? 80)));
const ttsCache = new Map<string, Buffer>();

const audioResponse = (buffer: Buffer, source: "hit" | "stored" | "shared" | "miss", costUsd: number | null) =>
  new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
      "X-TTS-Cache": source,
      // A clip from memory or storage, or one that joined a synthesis already under way, spent nothing itself.
      ...(source !== "miss" ? { "X-Cost-Usd": "0" } : costUsd !== null ? { "X-Cost-Usd": costUsd.toFixed(8) } : {}),
    },
  });

function remember(key: string, buffer: Buffer) {
  if (MAX_CACHE_ENTRIES <= 0) return;
  if (ttsCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = ttsCache.keys().next().value;
    if (oldestKey) ttsCache.delete(oldestKey);
  }
  ttsCache.set(key, buffer);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const input = typeof body.text === "string" ? narrationInput(body.text) : "";
  if (!input) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  // THE TEST PAGE'S SIMULATED OUTAGE (app/tts-lab, dev only): the voice fails as a broken one would.
  if (ttsOutageLeftMs() > 0) return NextResponse.json({ error: "simulated voice outage" }, { status: 503 });
  const cacheKey = `${TTS_MODEL}:${TTS_VOICE}:${input}`;
  // THE TEST PAGE'S LIVE MEASURE (app/tts-lab, dev only): made now, bypassing memory and storage, kept nowhere.
  if (process.env.NODE_ENV !== "production" && req.headers.get("x-tts-fresh") === "1" && process.env.OPENAI_API_KEY) {
    const made = await synthesizeNarration(input).catch((error: Error) => error);
    if (made instanceof Error) return NextResponse.json({ error: made.message }, { status: 502 });
    await recordNarrationSpend(made);
    return audioResponse(made.buffer, "miss", made.costUsd);
  }
  const cached = MAX_CACHE_ENTRIES > 0 ? ttsCache.get(cacheKey) : undefined;
  if (cached) return audioResponse(Buffer.from(cached), "hit", 0);

  // Made ahead (or once before, anywhere): served from storage, no call made.
  const stored = await storedNarration(input);
  if (stored) {
    remember(cacheKey, stored);
    return audioResponse(stored, "stored", 0);
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not set — add it to frontend/web/.env.local to enable the teacher voice." },
      { status: 503 }
    );
  }

  try {
    /*
     * ONE PAID SYNTHESIS PER SENTENCE. The player gives up on a slow clip after 10 s and retries,
     * and the prefetcher asks for the same sentences ahead of time; each of those used to start its
     * own paid call. Measured 2026-10-13: under a burst, one sentence could be bought up to six
     * times. Now every request for a sentence already being made waits for that one.
     */
    // A warm-up for later (lib/useNarrationPrefetch.ts) waits behind the sentence a student is about to hear.
    const warm = req.headers.get("x-tts-priority") === "warm";
    let entry = inflight.get(cacheKey);
    const shared = Boolean(entry);
    if (!entry) {
      const priority = { warm };
      const promise = withTtsSlot(() => synthesizeNarration(input), priority).finally(() => inflight.delete(cacheKey));
      entry = { promise, priority };
      inflight.set(cacheKey, entry);
    } else if (!warm && entry.priority.warm) {
      // The student has reached a sentence still queued as a warm-up: it is needed NOW.
      entry.priority.warm = false;
      wakeWaiters();
    }
    const made = await entry.promise;
    if (!shared) {
      await recordNarrationSpend(made);
      remember(cacheKey, made.buffer);
      // Kept for every server and every later play; not awaited by the student.
      void storeNarration(input, made.buffer);
    }
    return audioResponse(made.buffer, shared ? "shared" : "miss", made.costUsd);
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

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
