import "server-only";
import { deliveryFor, DELIVERY_VERSION, type Delivery } from "@/lib/voiceDelivery";

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

export function geminiVoiceOn(): boolean {
  return process.env.NARRATION_VOICE === "gemini" && Boolean(process.env.GEMINI_TTS_API_KEY) && Boolean(process.env.GEMINI_TTS_VOICE);
}

export function geminiVoiceId(): string {
  return process.env.GEMINI_TTS_VOICE ?? "";
}

/** The voice part of a stored clip's path: the voice and the acting rules it was made under. */
export function geminiVoiceTag(): string {
  return `${geminiVoiceId()}-${DELIVERY_VERSION}`;
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
  if (delivery.style) item.annotations = [{ type: "speech_metadata", style: delivery.style }];
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

