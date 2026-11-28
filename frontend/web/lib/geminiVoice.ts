import "server-only";
import { ALWAYS_EXCITED, deliveryFor, DELIVERY_VERSION, type Delivery } from "@/lib/voiceDelivery";
import { chosenVoiceId, chosenVoiceKey } from "@/lib/voices";
import { teacherOf } from "@/lib/teachers";

/**
 * ARIA'S OWN VOICE: a cloned voice on Gemini 3.8 Flash TTS (owner, 2026-11-12: "just the voice and the
 * personality", boards unchanged). Off unless NARRATION_VOICE=gemini and the paid key and the voice id are
 * set; then every narration clip comes from here instead of OpenAI (lib/narrationAudio.ts).
 *
 * What was measured in persona-lab/ (2026-11-12):
 *   - Her personality is in the acting (lib/voiceDelivery.ts): a couple of style words and a pause, never
 *     a persona description, which made the clone drift (voice match 7 → 4/10). The words stay luna's.
 *   - About 6 s to make a 7 s line; $9 per 1M audio tokens at 25 tokens a second ≈ $0.014 a minute
 *     (rises to $18 per 1M on 2027-01-01). Input text $0.50 per 1M.
 *   - Raw 24 kHz 16-bit PCM is asked for and encoded to MP3 here, so a clip is stored, served and
 *     trimmed exactly like an OpenAI one.
 */
export const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? "gemini-3.8-flash-tts";
const USD_PER_AUDIO_TOKEN = Number(process.env.GEMINI_TTS_USD_PER_AUDIO_TOKEN ?? 9e-6);
const USD_PER_TEXT_TOKEN = 0.5e-6;
const SAMPLE_RATE = 24_000;
const CALL_TIMEOUT_MS = 30_000;

/**
 * The delivery for the chosen teacher (lib/teachers.ts). Aria keeps the one "always excited" delivery (acted5,
 * owner 2026-11-27); Zara and Kai say every line in their own way instead ("cheerful", "calm and firm"), keeping
 * the stress on a board's key term.
 */
export function teacherStyle(style: string | undefined, key = chosenVoiceKey()): string | undefined {
  const own = teacherOf(key).delivery;
  if (!own) return style;
  if (!style) return own;
  return style.includes(ALWAYS_EXCITED) ? style.replace(ALWAYS_EXCITED, own) : style;
}

export function geminiVoiceOn(): boolean {
  return process.env.NARRATION_VOICE === "gemini" && Boolean(process.env.GEMINI_TTS_API_KEY) && Boolean(process.env.GEMINI_TTS_VOICE);
}

/** The voice of this request or task (lib/voices.ts): Aria's unless the student chose another. */
export function geminiVoiceId(): string {
  return chosenVoiceId();
}

/** The voice part of a stored clip's path: the voice and the acting rules it was made under. */
export function geminiVoiceTag(): string {
  return `${geminiVoiceId()}-${DELIVERY_VERSION}`;
}

/**
 * THE PLANNING CHAT IN THE CLONED VOICE (owner, 2026-11-27: "planning phase should also contain cloned voice").
 * No Gemini Live model takes a cloned voice (every one closes with "Replicated voice is not supported for this
 * model", probed on this account 2026-11-27), so Live still listens and thinks, and each sentence of its
 * transcript is spoken here instead (lib/useGeminiLiveTutor.ts `clonedVoice`). On whenever the voice id and a
 * key are set; PLANNING_VOICE=live turns it off.
 */
export function planningCloneOn(): boolean {
  return process.env.PLANNING_VOICE !== "live" && Boolean(geminiVoiceId()) && Boolean(process.env.GEMINI_TTS_API_KEY ?? process.env.GEMINI_API_KEY);
}

/**
 * One sentence in the cloned voice, STREAMED: raw 24 kHz 16-bit mono PCM, yielded as it arrives (always an even
 * number of bytes, so no sample is split). The first audio comes ≈2.3 s after the call for a 7 s line, against
 * ≈4.7 s for the whole clip (measured 2026-11-27). Returns what it cost once the stream is done.
 */
export async function* streamGeminiVoicePcm(text: string, signal?: AbortSignal, delivery: Delivery = deliveryFor(text)): AsyncGenerator<Uint8Array, number> {
  const item: Record<string, unknown> = { type: "text", text: delivery.input };
  // A plain sentence is said in the chosen teacher's way (lib/teachers.ts); questions and warnings keep their own.
  const style = teacherStyle(delivery.style);
  if (style) item.annotations = [{ type: "speech_metadata", style }];
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse", {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_TTS_API_KEY ?? process.env.GEMINI_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      stream: true,
      input: [{ type: "user_input", content: [item] }],
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: SAMPLE_RATE },
      generation_config: { speech_config: [{ voice: geminiVoiceId() }] },
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) : AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`gemini voice ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let carry: Uint8Array | null = null;
  let seconds = 0;
  let usage: { total_input_tokens?: number; total_output_tokens?: number } | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const events = pending.split("\n\n");
    pending = events.pop() ?? "";
    for (const event of events) {
      const line = event.split("\n").find((l) => l.startsWith("data: "));
      if (!line || line === "data: [DONE]") continue;
      let json: { delta?: { type?: string; data?: string }; interaction?: { usage?: typeof usage } };
      try {
        json = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (json.interaction?.usage) usage = json.interaction.usage;
      if (json.delta?.type !== "audio" || !json.delta.data) continue;
      let bytes: Uint8Array = Buffer.from(json.delta.data, "base64");
      if (carry) {
        const joined = new Uint8Array(carry.length + bytes.length);
        joined.set(carry);
        joined.set(bytes, carry.length);
        bytes = joined;
        carry = null;
      }
      if (bytes.length % 2) {
        carry = bytes.slice(-1);
        bytes = bytes.slice(0, -1);
      }
      if (!bytes.length) continue;
      seconds += bytes.length / 2 / SAMPLE_RATE;
      yield bytes;
    }
  }
  return (usage?.total_output_tokens ?? seconds * 25) * USD_PER_AUDIO_TOKEN + (usage?.total_input_tokens ?? 0) * USD_PER_TEXT_TOKEN;
}

/** The audio somewhere in an Interactions answer (its shape has moved between API versions). */
function audioOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.data === "string" && record.data.length > 200) return record.data;
  for (const child of Object.values(record)) {
    const found = Array.isArray(child) ? child.map(audioOf).find(Boolean) ?? null : audioOf(child);
    if (found) return found;
  }
  return null;
}

/** 16-bit little-endian mono PCM → MP3 (64 kbps). */
// Loaded as the package's ES module build: its CommonJS build (what a plain require gets) exports nothing.
type Encoder = { encodeBuffer(samples: Int16Array): Int8Array | Uint8Array; flush(): Int8Array | Uint8Array };
type EncoderClass = new (channels: number, rate: number, kbps: number) => Encoder;
let encoderClass: Promise<EncoderClass> | null = null;
function loadEncoder(): Promise<EncoderClass> {
  encoderClass ??= import("@breezystack/lamejs").then((m) => ((m as { Mp3Encoder?: EncoderClass }).Mp3Encoder ?? (m as { default?: { Mp3Encoder?: EncoderClass } }).default?.Mp3Encoder) as EncoderClass);
  return encoderClass;
}

export async function pcmToMp3(pcm: Buffer, sampleRate = SAMPLE_RATE): Promise<Buffer> {
  const Mp3Encoder = await loadEncoder();
  const samples = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length - (pcm.length % 2))));
  const encoder = new Mp3Encoder(1, sampleRate, 64);
  const chunks: Buffer[] = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const out = encoder.encodeBuffer(samples.subarray(i, i + 1152));
    if (out.length) chunks.push(Buffer.from(out));
  }
  const end = encoder.flush();
  if (end.length) chunks.push(Buffer.from(end));
  return Buffer.concat(chunks);
}

/** One sentence in the cloned voice, acted as Aria (lib/voiceDelivery.ts), as MP3, with what it cost. Two tries, each bounded. */
export async function synthesizeGeminiVoice(text: string, delivery: Delivery = deliveryFor(text)): Promise<{ audio: Buffer; costUsd: number }> {
  const item: Record<string, unknown> = { type: "text", text: delivery.input };
  // A plain sentence is said in the chosen teacher's way (lib/teachers.ts); questions and warnings keep their own.
  const style = teacherStyle(delivery.style);
  if (style) item.annotations = [{ type: "speech_metadata", style }];
  let lastError: Error = new Error("no attempt");
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timed out")), CALL_TIMEOUT_MS);
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "x-goog-api-key": process.env.GEMINI_TTS_API_KEY ?? "", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: GEMINI_TTS_MODEL,
          input: [{ type: "user_input", content: [item] }],
          response_format: { type: "audio", mime_type: "audio/l16", sample_rate: SAMPLE_RATE },
          generation_config: { speech_config: [{ voice: geminiVoiceId() }] },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`gemini voice ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
      const json = (await res.json()) as { usage?: { total_input_tokens?: number; total_output_tokens?: number } };
      const data = audioOf(json);
      if (!data) throw new Error("gemini voice answered without audio");
      const pcm = Buffer.from(data, "base64");
      const costUsd = (json.usage?.total_output_tokens ?? (pcm.length / 2 / SAMPLE_RATE) * 25) * USD_PER_AUDIO_TOKEN + (json.usage?.total_input_tokens ?? 0) * USD_PER_TEXT_TOKEN;
      return { audio: await pcmToMp3(pcm), costUsd };
    } catch (error) {
      lastError = error as Error;
      console.warn(`[tts] gemini voice call ${attempt} failed: ${lastError.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

