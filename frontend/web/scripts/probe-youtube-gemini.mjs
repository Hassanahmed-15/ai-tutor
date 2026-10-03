/**
 * Can this key read a YouTube video through the Gemini API, and what does a 10-minute window cost?
 *
 *   node scripts/probe-youtube-gemini.mjs [url] [model ...]
 *
 * Exists because the YouTube URL input is a preview feature whose request shape, limits and
 * behaviour past the end of a video are not something to assume. Everything lib/youtube builds on
 * is measured here first:
 *
 *   1. countTokens over the WHOLE video — free, no generation. Does it work, and does the audio
 *      token count give the video's duration (32 tokens per second of audio)?
 *   2. One 10-minute window, clipped with videoMetadata offsets: latency, tokens by modality, and
 *      whether the transcript and the on-screen notes come back as asked.
 *   3. A window that starts past the end of the video: error, or an empty answer?
 *
 * COST: step 1 is free. Step 2 is one request of roughly 80k input tokens; step 3 is one small
 * request. Free of charge on a free-tier key.
 */
import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^(GEMINI_API_KEY|GEMINI_VIDEO_MODEL)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set in .env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a)) ?? "https://www.youtube.com/watch?v=aircAruvnKk";
// --window=SECONDS: the clip length for step 2 (default 600), to tell a size limit from a busy model.
const windowSec = Number(args.find((a) => a.startsWith("--window="))?.split("=")[1] ?? 600);
const named = args.filter((a) => !/^https?:\/\//.test(a) && !a.startsWith("--"));
const models = named.length ? named : [process.env.GEMINI_VIDEO_MODEL ?? "gemini-3.8-flash"];
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const WINDOW_PROMPT = `You are reading one clip of a lecture video for a student who will not watch it.
Return JSON only, in this shape:
{"segments":[{"t":"MM:SS","text":"..."}],"onScreen":[{"t":"MM:SS","kind":"slide|equation|diagram|code|text","content":"..."}]}
"segments" is the speech, transcribed faithfully and completely in order, one entry per 20-40 seconds, with timestamps measured from the start of the WHOLE video. Do not summarise and do not skip.
"onScreen" is everything shown that the speech does not say in full: slide text, equations (as LaTeX), code, and a precise description of each diagram (what is drawn, its labelled parts, how they connect).
If the clip contains no video at all, return {"segments":[],"onScreen":[]}.`;

const videoPart = (startSec, endSec) => ({
  fileData: { fileUri: url, mimeType: "video/*" },
  ...(startSec === undefined ? {} : { videoMetadata: { startOffset: `${startSec}s`, endOffset: `${endSec}s` } }),
});

const brief = (error) => String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 400);
const byModality = (details) => Object.fromEntries((details ?? []).map((d) => [d.modality, d.tokenCount]));

async function countWhole(model) {
  const startedAt = Date.now();
  try {
    const res = await client.models.countTokens({ model, contents: [{ role: "user", parts: [videoPart()] }] });
    const modalities = byModality(res.promptTokensDetails);
    return {
      step: "count-whole",
      model,
      ms: Date.now() - startedAt,
      totalTokens: res.totalTokens,
      modalities,
      // 32 tokens per second of audio, per the video-understanding docs.
      durationFromAudioSec: modalities.AUDIO ? Math.round(modalities.AUDIO / 32) : null,
    };
  } catch (error) {
    return { step: "count-whole", model, ms: Date.now() - startedAt, error: brief(error) };
  }
}

/** 429 (rate limit) and 503 (busy model) are worth waiting out; anything else is an answer. */
const RETRY_WAITS_MS = [10_000, 25_000, 50_000];
async function withRetry(call, note) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const retryable = /"code":\s*(429|503)|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(String(error?.message ?? error));
      if (!retryable || attempt >= RETRY_WAITS_MS.length) throw error;
      note(attempt + 1, brief(error));
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[attempt]));
    }
  }
}

async function readWindow(model, startSec, endSec, step) {
  const startedAt = Date.now();
  const retries = [];
  try {
    const res = await withRetry(
      () => client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [videoPart(startSec, endSec), { text: WINDOW_PROMPT }] }],
        config: { responseMimeType: "application/json", temperature: 0 },
      }),
      (attempt, why) => retries.push(`${attempt}: ${why.slice(0, 90)}`),
    );
    const usage = res.usageMetadata ?? {};
    let parsed = null;
    try {
      parsed = JSON.parse(res.text ?? "");
    } catch {
      /* reported below as unparsed */
    }
    const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
    const onScreen = Array.isArray(parsed?.onScreen) ? parsed.onScreen : [];
    return {
      step,
      model,
      window: `${startSec}-${endSec}s`,
      ms: Date.now() - startedAt,
      retries,
      promptTokens: usage.promptTokenCount,
      outputTokens: usage.candidatesTokenCount,
      thoughtTokens: usage.thoughtsTokenCount,
      modalities: byModality(usage.promptTokensDetails),
      finishReason: res.candidates?.[0]?.finishReason,
      parsed: Boolean(parsed),
      segments: segments.length,
      onScreen: onScreen.length,
      words: segments.reduce((n, s) => n + String(s?.text ?? "").split(/\s+/).filter(Boolean).length, 0),
      firstT: segments[0]?.t,
      lastT: segments[segments.length - 1]?.t,
      sampleSpeech: segments.slice(0, 2).map((s) => `${s.t} ${String(s.text).slice(0, 160)}`),
      sampleOnScreen: onScreen.slice(0, 3).map((s) => `${s.t} [${s.kind}] ${String(s.content).slice(0, 160)}`),
      ...(parsed ? {} : { raw: String(res.text ?? "").slice(0, 300) }),
    };
  } catch (error) {
    return { step, model, window: `${startSec}-${endSec}s`, ms: Date.now() - startedAt, retries, error: brief(error) };
  }
}

console.log(JSON.stringify({ url, models }));
for (const model of models) {
  const counted = await countWhole(model);
  console.log(JSON.stringify(counted));
  const first = await readWindow(model, 0, windowSec, "window-first");
  console.log(JSON.stringify(first, null, 1));
  if (first.error) continue;
  // Well past the end of any video this probe is pointed at by default (the default is ~19 minutes).
  const past = await readWindow(model, 6 * 3600, 6 * 3600 + 600, "window-past-end");
  console.log(JSON.stringify(past));
}
process.exit(0);
