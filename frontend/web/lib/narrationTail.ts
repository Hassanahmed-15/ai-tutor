/**
 * WHEN THE VOICE MODEL KEEPS GOING AFTER THE SENTENCE. gpt-4o-mini-tts now and then ends a clip with a second of
 * silence and then a sound that is not speech: a low hum fading out, or a burst far louder than her voice (owner,
 * 2026-11-09: "very random moan voices"; 3 of 70 clips of one lecture, 2–3 s each). Word timings confirmed the
 * sentence was over before it started. A clip is cut where the words end, without re-encoding it, and only when two
 * things agree: enough time has passed for the whole sentence, and what follows the pause does not sound like her.
 */
const WINDOW_S = 0.025;
const SILENT = 0.006;
const MIN_GAP_S = 0.3;
const KEEP_AFTER_S = 0.3;
const LONG_SILENCE_S = 0.9;

/** About how long the sentence takes to say: letters at her pace, and the numbers and signs she says out in full. */
export function expectedSpeechSecs(text: string): number {
  const digits = (text.match(/\d/g) ?? []).length;
  const signs = (text.match(/[×÷=+−→≈<>^]/g) ?? []).length;
  const units = (text.match(/(?:^|\s)[A-Za-z](?=[\s.,;]|$)/g) ?? []).length;
  const letters = text.replace(/[\d×÷=+−→≈<>^]/g, "").length;
  return letters / 13.5 + digits * 0.24 + signs * 0.45 + units * 0.32;
}

type Win = { rms: number; hz: number };

function windowsOf(samples: Float32Array, rate: number): Win[] {
  const n = Math.max(1, Math.round(WINDOW_S * rate));
  const out: Win[] = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let sum = 0, crossings = 0;
    for (let k = i; k < i + n; k++) {
      sum += samples[k] * samples[k];
      if (k > i && samples[k] < 0 !== samples[k - 1] < 0) crossings++;
    }
    out.push({ rms: Math.sqrt(sum / n), hz: crossings / 2 / WINDOW_S });
  }
  return out;
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

/** Where to end the clip, in seconds, or null to leave it whole. */
export function speechEndSecs(samples: Float32Array, rate: number, text: string): number | null {
  return speechEnd(samples, rate, text)?.secs ?? null;
}

export function speechEnd(samples: Float32Array, rate: number, text: string): { secs: number; why: "sound" | "silence" } | null {
  const wins = windowsOf(samples, rate);
  const lastSound = wins.reduce((at, w, i) => (w.rms >= SILENT ? i : at), -1);
  if (lastSound < 0) return null;
  const expected = expectedSpeechSecs(text);
  const secs = (i: number) => i * WINDOW_S;
  // Her level, from the part of the clip where she is certainly speaking.
  const voice = median(wins.slice(0, Math.max(4, Math.round((expected * 0.7) / WINDOW_S))).filter((w) => w.rms >= SILENT).map((w) => w.rms));
  const gaps: Array<{ from: number; to: number }> = [];
  for (let i = 0; i <= lastSound; ) {
    if (wins[i].rms >= SILENT) { i++; continue; }
    let j = i;
    while (j <= lastSound && wins[j].rms < SILENT) j++;
    if (secs(j - i) >= MIN_GAP_S && i > 0) gaps.push({ from: i, to: j });
    i = j;
  }
  for (const gap of gaps) {
    if (secs(gap.from) < expected * 0.72) continue;
    const tail = wins.slice(gap.to, lastSound + 1).filter((w) => w.rms >= SILENT);
    if (!tail.length) continue;
    const level = median(tail.map((w) => w.rms)), pitch = median(tail.map((w) => w.hz));
    if (level < voice * 0.5 || level > voice * 2.2 || pitch < 230) return { secs: secs(gap.from) + KEEP_AFTER_S, why: "sound" };
  }
  // Nothing odd, but a long silence at the end is still a gap in her voice. A short one is the pause between sentences.
  const end = secs(lastSound + 1);
  return secs(wins.length) - end > LONG_SILENCE_S ? { secs: end + KEEP_AFTER_S, why: "silence" } : null;
}

const BITRATE_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATE_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The first `secs` of an MP3, cut on a frame boundary. Whole frames are kept, so nothing is re-encoded. */
export function cutMp3(mp3: Uint8Array, secs: number): Uint8Array {
  let at = 0;
  if (mp3[0] === 0x49 && mp3[1] === 0x44 && mp3[2] === 0x33) at = 10 + ((mp3[6] & 127) << 21 | (mp3[7] & 127) << 14 | (mp3[8] & 127) << 7 | (mp3[9] & 127));
  let played = 0;
  while (at + 4 <= mp3.length) {
    if (mp3[at] !== 0xff || (mp3[at + 1] & 0xe0) !== 0xe0) { at++; continue; }
    const version = (mp3[at + 1] >> 3) & 3, layer = (mp3[at + 1] >> 1) & 3;
    const bitIndex = mp3[at + 2] >> 4, rateIndex = (mp3[at + 2] >> 2) & 3, padding = (mp3[at + 2] >> 1) & 1;
    if (version === 1 || layer !== 1 || bitIndex === 0 || bitIndex === 15 || rateIndex === 3) { at++; continue; }
    const v1 = version === 3;
    const rate = RATES[version][rateIndex];
    const size = Math.floor(((v1 ? 144 : 72) * (v1 ? BITRATE_V1 : BITRATE_V2)[bitIndex] * 1000) / rate) + padding;
    if (played >= secs) return mp3.subarray(0, at);
    played += (v1 ? 1152 : 576) / rate;
    at += size;
  }
  return mp3;
}

/** The clip without anything after her words. On any failure, the clip as it was. */
export async function trimNarrationTail(mp3: Buffer, text: string): Promise<Buffer> {
  try {
    const { MPEGDecoder } = await import("mpg123-decoder");
    const decoder = new MPEGDecoder();
    await decoder.ready;
    try {
      const { channelData, sampleRate } = decoder.decode(new Uint8Array(mp3));
      const end = channelData[0]?.length ? speechEndSecs(channelData[0], sampleRate, text) : null;
      return end === null ? mp3 : Buffer.from(cutMp3(new Uint8Array(mp3), end));
    } finally {
      decoder.free();
    }
  } catch (error) {
    console.warn(`[tts] could not check a clip's ending: ${(error as Error).message}`);
    return mp3;
  }
}
