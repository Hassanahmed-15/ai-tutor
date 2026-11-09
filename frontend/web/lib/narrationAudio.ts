import "server-only";
import { createHash } from "node:crypto";
import { costFor } from "@/lib/modelPricing";
import { createOpenAI, spendScopeNow } from "@/lib/openaiClient";
import { recordSpend } from "@/lib/spend/record";
import { blobExists, blobStorageConfigured, downloadRawBlob, uploadRawBlob } from "@/lib/blobStorage";
import { narrationInput } from "@/lib/narrationText";
import { trimNarrationTail } from "@/lib/narrationTail";

/**
 * ARIA'S NARRATION, MADE AHEAD AND KEPT (owner, 2026-11-07: "I want no delay … sometimes it does not
 * respond, due to which the browser fallback voice is used — I don't want this").
 *
 * Narration used to be made only when the student reached a sentence: a healthy call answered in
 * 1.4–1.7 s, some never answered, and the only copy was an 80-sentence cache in one server's memory.
 * Now each clip is made once and stored in blob storage under its exact text, the model and the voice:
 * the worker makes a board's clips before the board is ready (prepareNarration), /api/tts serves the
 * stored clip, and a clip made live is stored too — so no sentence is paid for or waited on twice,
 * across servers and restarts. A change of voice or model is a new path, never an old clip.
 */
export const TTS_VOICE = process.env.OPENAI_TTS_VOICE ?? "shimmer";
// The dated model and Shimmer, picked by the owner from samples (2026-11-09: "change the voice to a human").
export const TTS_MODEL = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts-2025-12-15";

const TEACHER_TONE =
  "You are a warm, friendly teacher talking to one student. Sound like a real person in a relaxed conversation: " +
  "natural rhythm at an easy, steady pace, gentle rises when you ask something. Keep moving: no long pauses. Never sound like an announcer or a narrator.";

/** Where a clip is stored: its model, voice and the hash of its exact text. */
export function narrationBlobName(text: string): string {
  const hash = createHash("sha256").update(`${TTS_MODEL}:${TTS_VOICE}:${narrationInput(text)}`).digest("hex");
  const segment = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `narration/${segment(TTS_MODEL)}/${segment(TTS_VOICE)}/${hash}.mp3`;
}

/** A stored clip, or null when there is none (or storage is not configured or not reachable). */
export async function storedNarration(text: string): Promise<Buffer | null> {
  if (!blobStorageConfigured()) return null;
  const audio = await downloadRawBlob(narrationBlobName(text)).catch(() => null);
  // Clips stored before this check are mended as they are read (about 4 ms).
  return audio ? trimNarrationTail(audio, narrationInput(text)) : null;
}

/** Keeps a clip. Never throws: a clip that could not be stored is only made again later. */
export async function storeNarration(text: string, audio: Buffer): Promise<boolean> {
  if (!blobStorageConfigured() || !audio.length) return false;
  return uploadRawBlob(narrationBlobName(text), audio, "audio/mpeg").then(() => true, (error) => {
    console.warn(`[tts] could not store a clip: ${(error as Error).message}`);
    return false;
  });
}

export type Synthesis = { buffer: Buffer; costUsd: number | null; estimated: boolean };

/*
 * Dollars per character of narration, learned from this process's measured sentences (a running
 * average), for the rare call that reports no usage. Seeded from measured sentences (2026-10-13:
 * ~$0.0015–0.0022 for 45–70 characters).
 */
let usdPerChar = 0.000028;

/*
 * EVERY CALL IS BOUNDED. The fallback used to be the SDK's default — a 10-minute timeout and two
 * retries — so one slow upstream held a slot for minutes (176 s measured). Both calls now give up in
 * well under a minute, and the caller then asks again.
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
/**
 * THE LAST GUARANTEE: a synthesis that is still not done after this gives up whatever it is stuck on,
 * so one hung upstream call can never stall everything behind it.
 */
const SYNTHESIS_DEADLINE_MS = 45_000;

/** One clip, made by OpenAI, with what it cost. Bounded by SYNTHESIS_DEADLINE_MS. */
export function synthesizeNarration(text: string): Promise<Synthesis> {
  const input = narrationInput(text);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("synthesis deadline")), SYNTHESIS_DEADLINE_MS); });
  const made = synthesize(input).then(async (clip) => ({ ...clip, buffer: await trimNarrationTail(clip.buffer, input) }));
  return Promise.race([made, deadline]).finally(() => clearTimeout(timer));
}

/** Narration is billed per sentence; the spend log needs every one (the badge, today's total). */
export async function recordNarrationSpend(made: Synthesis): Promise<void> {
  const scope = await spendScopeNow();
  recordSpend({ tag: scope.tag, userId: scope.userId, kind: "narration", model: TTS_MODEL, endpoint: made.estimated ? "speech-estimated" : "speech", usd: made.costUsd });
}

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
      { model: TTS_MODEL, voice: TTS_VOICE, input, instructions: TEACHER_TONE, response_format: "mp3" },
      { timeout: FALLBACK_TIMEOUT_MS, maxRetries: 0, signal: controller.signal },
    );
    // This call reported no usage, but it was billed: estimated at the measured rate, never left out.
    return { buffer: Buffer.from(await speech.arrayBuffer()), costUsd: input.length * usdPerChar, estimated: true };
  } finally {
    clearTimeout(timer);
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
 * Raw fetch, because the installed SDK (openai 4.104) predates `stream_format`.
 */
async function synthesizeWithUsage(input: string): Promise<{ audio: Buffer; inputTokens: number; outputTokens: number }> {
  // A hung upstream request held one sentence's clip, and with it the whole narration: no answer in
  // FIRST_BYTE_TIMEOUT_MS, or no finished clip in MEASURED_TIMEOUT_MS, and the call is dropped.
  const controller = new AbortController();
  const overall = setTimeout(() => controller.abort(new Error("timed out")), MEASURED_TIMEOUT_MS);
  const firstByte = setTimeout(() => controller.abort(new Error(`no answer in ${FIRST_BYTE_TIMEOUT_MS / 1000} s`)), FIRST_BYTE_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input, instructions: TEACHER_TONE, response_format: "mp3", stream_format: "sse" }),
      signal: controller.signal,
    });
    clearTimeout(firstByte);
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
  } finally {
    clearTimeout(overall);
    clearTimeout(firstByte);
  }
}

/** "later": still being made when the deadline came; it is stored when done, usually before it is reached. */
export type PreparedClip = { text: string; source: "stored" | "made" | "later" | "failed"; ms: number; costUsd: number };

/**
 * MAKE THESE SENTENCES AHEAD: each one already stored is left alone; the rest are made `concurrency` at
 * a time and stored. Answers by `deadlineMs` at the latest, so a board is never held up — but the work
 * goes on past it (2026-11-07: an opening board's 20 s ran out with 2 of 6 sentences unmade and they
 * were simply dropped): those are "later", stored while the earlier boards play. Never throws.
 */
export async function prepareNarration(sentences: string[], opts: { concurrency?: number; deadlineMs?: number } = {}): Promise<PreparedClip[]> {
  const unique = [...new Set(sentences.map(narrationInput).filter(Boolean))];
  const results = new Map<string, PreparedClip>();
  if (!process.env.OPENAI_API_KEY || !blobStorageConfigured()) {
    return unique.map((text) => ({ text, source: "failed" as const, ms: 0, costUsd: 0 }));
  }
  let next = 0;
  const work = async () => {
    while (next < unique.length) {
      const text = unique[next++];
      const t0 = Date.now();
      if (await narrationExists(text)) { results.set(text, { text, source: "stored", ms: Date.now() - t0, costUsd: 0 }); continue; }
      try {
        const made = await synthesizeNarration(text);
        await recordNarrationSpend(made);
        const kept = await storeNarration(text, made.buffer);
        results.set(text, { text, source: kept ? "made" : "failed", ms: Date.now() - t0, costUsd: made.costUsd ?? 0 });
      } catch (error) {
        console.warn(`[tts] could not make a clip ahead: ${(error as Error).message}`);
        results.set(text, { text, source: "failed", ms: Date.now() - t0, costUsd: 0 });
      }
    }
  };
  const all = Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, unique.length)) }, work));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, opts.deadlineMs ?? 60_000); });
  await Promise.race([all, deadline]).finally(() => clearTimeout(timer));
  // A clip not answered yet keeps being made in the background (`all` is still running); it is reported as "later".
  void all.catch(() => undefined);
  return unique.map((text) => results.get(text) ?? { text, source: "later" as const, ms: 0, costUsd: 0 });
}

/** Whether a clip is stored — a properties read, no download. */
function narrationExists(text: string): Promise<boolean> {
  return blobExists(narrationBlobName(text)).catch(() => false);
}
