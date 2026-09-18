/**
 * Measures how far the board's sentence cue drifts from what the teacher is actually saying.
 *
 *   node scripts/measure-sentence-sync.mjs [beatCount=12]
 *
 * WHAT IS BEING MEASURED. The cloud voice plays each beat as ONE audio clip, and `lib/voice.ts` works
 * out which sentence is playing by mapping `audio.currentTime / duration` onto a layout that assumes
 * speech advances in proportion to character count. The board draws whatever belongs to that
 * sentence. When the assumption is wrong, the board shows sentence N while the teacher is on N+1.
 *
 * HOW, WITHOUT A DECODER. OpenAI TTS can return raw `pcm` — 24 kHz, 16-bit, mono — so a clip's
 * duration is exactly `bytes / 48000` seconds. Each sentence is synthesised on its own to learn how
 * long it really takes, and the whole beat is synthesised as the app does to learn the length of the
 * clip the student hears.
 *
 * GROUND TRUTH. Where sentence i truly begins inside the single clip is estimated by distributing the
 * clip's length across sentences in proportion to their MEASURED durations. That is not perfect — it
 * spreads inter-sentence pauses evenly — but it captures what character counting cannot: numbers,
 * symbols and technical terms, which are spoken far longer than they are written. It is the best
 * reference available without forced alignment, and it errs toward UNDER-stating the drift.
 *
 * Costs TTS only: roughly two minutes of synthesised audio per beat.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `.pathname`: the pathname keeps "%20" for spaces, which this repo's own folder
// name ("Vs Code Folders") contains, and every file lookup then fails.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".lecture-cache");
const BEAT_COUNT = Number(process.argv[2] ?? 12);

// Mirror app/api/tts/route.ts exactly — a different voice or model would change the durations.
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.trim().replace(/^["']|["']$/g, "")]),
);
const KEY = env.OPENAI_API_KEY;
const MODEL = env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const VOICE = env.OPENAI_TTS_VOICE ?? "nova";
const TEACHER_TONE =
  "You are Aria, a kind classroom teacher helping one curious student. Speak with a clear, " +
  "friendly teacher style: patient, reassuring, lightly upbeat, and never theatrical. Use gentle " +
  "enthusiasm, natural pauses, and a small smile in the voice. Do not sound stern, sarcastic, " +
  "ominous, intimidating, seductive, mocking, sadistic, or like a dramatic narrator. If the text " +
  "contains a surprising idea, present it with wonder, not menace. Keep the volume and projection " +
  "confident and easy to hear without rushing.";
if (!KEY) throw new Error("OPENAI_API_KEY missing from .env.local");

/** The app's splitter and weights, copied from lib/voice.ts so this measures what ships. */
const split = (text) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const weight = (sentence) => Math.max(1.35, sentence.length / 13);

async function seconds(input) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input, instructions: TEACHER_TONE, response_format: "pcm" }),
    });
    if (res.ok) return (await res.arrayBuffer()).byteLength / 48000;
    if (attempt === 2) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return 0;
}

/** Deterministic spread across the corpus, weighted toward long beats where drift accumulates. */
function sampleBeats() {
  const beats = [];
  for (const file of fs.readdirSync(CACHE).filter((f) => f.endsWith(".json"))) {
    const lecture = JSON.parse(fs.readFileSync(path.join(CACHE, file), "utf8"));
    for (const beat of lecture.beats ?? []) {
      const script = typeof beat?.script === "string" ? beat.script.trim() : "";
      if (split(script).length >= 4 && script.length < 4000) beats.push({ topic: lecture.topic, title: beat.title, script });
    }
  }
  beats.sort((a, b) => split(b.script).length - split(a.script).length || a.script.localeCompare(b.script));
  const step = Math.max(1, Math.floor(beats.length / BEAT_COUNT));
  return beats.filter((_, i) => i % step === 0).slice(0, BEAT_COUNT);
}

const results = [];
for (const beat of sampleBeats()) {
  const sentences = split(beat.script);
  const [whole, ...parts] = await Promise.all([seconds(beat.script), ...sentences.map(seconds)]);
  const measuredTotal = parts.reduce((a, b) => a + b, 0);
  const weights = sentences.map(weight);
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  let cumWeight = 0;
  let cumSeconds = 0;
  const errors = sentences.map((sentence, i) => {
    const estimated = (whole * cumWeight) / weightTotal;
    const truth = (whole * cumSeconds) / measuredTotal;
    cumWeight += weights[i];
    cumSeconds += parts[i];
    // Positive: the board changes AFTER the teacher has already begun this sentence (it lags).
    return { i, lagSeconds: estimated - truth, sentence: sentence.slice(0, 70) };
  });

  const worst = errors.reduce((a, b) => (Math.abs(b.lagSeconds) > Math.abs(a.lagSeconds) ? b : a));
  results.push({ topic: beat.topic, title: beat.title, sentences: sentences.length, clipSeconds: whole, worst, errors });
  console.log(
    `${String(sentences.length).padStart(2)} sentences  ${whole.toFixed(1).padStart(5)}s clip  ` +
      `worst ${worst.lagSeconds >= 0 ? "+" : ""}${worst.lagSeconds.toFixed(2)}s at sentence ${worst.i}  — ${(beat.title ?? "").slice(0, 44)}`,
  );
}

const all = results.flatMap((r) => r.errors.map((e) => Math.abs(e.lagSeconds)));
all.sort((a, b) => a - b);
const pct = (p) => all[Math.min(all.length - 1, Math.floor(p * all.length))];
const overOne = all.filter((v) => v >= 1).length;
const summary = {
  beats: results.length,
  sentenceBoundaries: all.length,
  medianSeconds: pct(0.5),
  p90Seconds: pct(0.9),
  maxSeconds: all[all.length - 1],
  boundariesOffByOneSecondOrMore: overOne,
};
console.log("\nSUMMARY", JSON.stringify(summary));
const out = process.env.SYNC_OUT;
if (out) fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
