import "server-only";

import { GoogleGenAI } from "@google/genai";
import { costFor } from "../modelPricing";
import { readVideoCache, writeVideoCache } from "./videoCache";
import { parseTimestamp } from "./videoUrl";
import type { VideoOnScreen, VideoSegment, VideoWindow } from "./videoSource";

/**
 * Reading a YouTube video: Gemini is handed the link and fetches the video itself.
 *
 * WHY NOT THE CAPTIONS. YouTube's caption endpoints now want a per-video proof-of-origin token and
 * refuse cloud provider addresses outright, so a caption scraper works on a laptop and fails in the
 * deployed app. Here Google fetches the video, so where this server runs does not matter. It also
 * reads the FRAMES: what a lecture puts on a slide or a whiteboard and never says aloud is exactly
 * what a caption track cannot contain.
 *
 * WHY IN CLIPS. All measured with scripts/probe-youtube-gemini.mjs (2026-10-03, gemini-3.8-flash):
 *   - video costs about 91 input tokens per second, so ten minutes is ~55,000 tokens and an hour
 *     is ~330,000 — more than a free-tier key may send in one minute, and more than a transcription
 *     stays faithful over. A ten-minute clip is neither.
 *   - `countTokens` on the whole video is free, takes under two seconds, and returns 100 tokens per
 *     second of video (four videos of known length, within 3%). That is how the length is known
 *     without downloading anything or calling another API.
 *   - a clip that starts past the end of the video is answered with a bare HTTP 500, which is why
 *     the length is measured first rather than discovered by reading until something breaks.
 *   - "model is experiencing high demand" (503) is common. It usually passes on a retry, but not
 *     always: a 40-minute video failed outright after nine attempts over three minutes while
 *     gemini-3.5-flash-lite answered the same clip first time. So a clip the main model is too busy
 *     to read is read by a second model rather than failing the whole video.
 */

const MODEL = process.env.GEMINI_VIDEO_MODEL ?? "gemini-3.8-flash";
/** Reads a clip when MODEL is too busy to. Set to the same value as MODEL to turn the fallback off. */
const FALLBACK_MODEL = process.env.GEMINI_VIDEO_FALLBACK_MODEL ?? "gemini-3.5-flash-lite";
/** What `countTokens` charges a second of video. Measured; see the header. */
const COUNT_TOKENS_PER_SEC = 100;
/** Bump when WINDOW_PROMPT changes what a clip is read as, so old readings are not served. */
const READ_VERSION = "r1";
const RETRY_WAITS_MS = [6_000, 15_000];
/** A segment longer than this is one a model did not break up as asked; see spreadLongSegments. */
const LONG_SEGMENT_WORDS = 110;

const WINDOW_PROMPT = `You are reading one clip of a lecture video for a student who will not watch it.
Return JSON only, in this shape:
{"segments":[{"t":"M:SS","text":"..."}],"onScreen":[{"t":"M:SS","kind":"slide|equation|diagram|code|text","content":"..."}]}
"segments" is everything spoken OR SUNG — narration, dialogue, lyrics — transcribed faithfully and completely in order, in the language it is spoken in (romanised if it is not in Latin script), one entry per 20-40 seconds. Do not summarise, do not skip, do not translate, and do not correct what was said.
"onScreen" is everything shown that the speech does not say in full: slide text, equations (as LaTeX), code, and a precise description of each diagram (what is drawn, its labelled parts, how they connect). Leave out logos, the speaker's appearance and decoration.
Every "t" is the time measured from the start of the WHOLE video, not of this clip.
Only if the clip has no voice at all and shows nothing, return {"segments":[],"onScreen":[]}.`;

export type VideoReadCost = { costUsd: number; promptTokens: number; outputTokens: number };
export type VideoWindowRead = VideoWindow & VideoReadCost & { cached: boolean; model: string };

/** A failure worth showing the student as it is, with the HTTP status the route should answer with. */
export class VideoReadError extends Error {
  constructor(message: string, readonly status: number, readonly retryable = false) {
    super(message);
  }
}

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new VideoReadError("GEMINI_API_KEY is not set. Add it to frontend/web/.env.local to read YouTube videos.", 503);
  return new GoogleGenAI({ apiKey });
}

const messageOf = (error: unknown): string => String((error as { message?: unknown } | null)?.message ?? error);
const isBusy = (error: unknown): boolean => /"code":\s*(429|503)|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(messageOf(error));

/**
 * The key's allowance for a model is used up — not a busy moment that passes. Measured 2026-10-03:
 * a free-tier key gets 20 gemini-3.8-flash requests a DAY ("Quota exceeded for metric:
 * generate_content_free_tier_requests, limit: 20"), and each ten-minute clip is one request. It
 * arrives as the same 429 as a rate limit, so it was waited on and retried for nothing.
 */
const isQuotaSpent = (error: unknown): boolean => /quota|free_tier_requests|per ?day/i.test(messageOf(error));
/** Until when the main model's allowance is known to be spent, so later clips go straight to the fallback. */
let mainModelSpentUntil = 0;

async function withRetry<T>(call: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!isBusy(error) || isQuotaSpent(error) || attempt >= RETRY_WAITS_MS.length) throw error;
      console.log(`[youtube] ${label} busy (attempt ${attempt + 1}), waiting ${RETRY_WAITS_MS[attempt] / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[attempt]));
    }
  }
}

/** A model error, said the way the student needs to hear it. */
function readError(error: unknown, what: string): VideoReadError {
  if (error instanceof VideoReadError) return error;
  const message = messageOf(error);
  if (isBusy(error)) return new VideoReadError("The video reader is busy right now. Try again in a minute.", 503, true);
  if (/"code":\s*(400|403|404)|PERMISSION_DENIED|INVALID_ARGUMENT|NOT_FOUND/.test(message)) {
    return new VideoReadError("That video could not be opened. It has to be a public YouTube video (not private, unlisted or age-restricted).", 422);
  }
  return new VideoReadError(`Could not ${what}: ${message.replace(/\s+/g, " ").slice(0, 200)}`, 502, true);
}

const videoPart = (url: string, startSec?: number, endSec?: number) => ({
  fileData: { fileUri: url, mimeType: "video/*" },
  ...(startSec === undefined || endSec === undefined ? {} : { videoMetadata: { startOffset: `${startSec}s`, endOffset: `${endSec}s` } }),
});

/** The video's length in seconds, from a free token count. */
export async function videoDurationSec(url: string): Promise<number> {
  try {
    const counted = await withRetry(
      () => client().models.countTokens({ model: MODEL, contents: [{ role: "user", parts: [videoPart(url)] }] }),
      "duration",
    );
    const seconds = Math.round((counted.totalTokens ?? 0) / COUNT_TOKENS_PER_SEC);
    if (seconds <= 0) throw new VideoReadError("That video could not be opened. It has to be a public YouTube video.", 422);
    return seconds;
  } catch (error) {
    throw readError(error, "open the video");
  }
}

/**
 * Timestamps as seconds from the start of the whole video.
 *
 * The prompt asks for whole-video times, and a model sometimes counts from the start of the clip
 * instead. A clip that does not start at zero and whose every time fits inside the clip's own
 * length was counted from the clip, and is shifted.
 */
function absoluteTimes<T extends { startSec: number }>(items: T[], startSec: number, endSec: number): T[] {
  if (items.length === 0) return items;
  const times = items.map((item) => item.startSec);
  const relative = startSec > 0 && Math.max(...times) <= endSec - startSec + 5 && Math.min(...times) < startSec;
  return items
    .map((item) => ({ ...item, startSec: Math.min(endSec, Math.max(startSec, relative ? item.startSec + startSec : item.startSec)) }))
    .sort((a, b) => a.startSec - b.startSec);
}

/**
 * A long run of speech under one timestamp, given back the times it was spoken at.
 *
 * The prompt asks for an entry every 20-40 seconds, and a smaller model sometimes returns two
 * minutes — or a whole clip — as one. The words are all there, but every one of them is stamped
 * with the moment the run began, and time is what decides which chapter a sentence belongs to: a
 * ten-minute clip in one segment would put all ten minutes into the first chapter it touches. So a
 * long segment is cut at sentence ends into pieces of about 70 words, and each piece is placed
 * between this segment's start and the next one's in proportion to how far through the words it is.
 */
function spreadLongSegments(segments: VideoSegment[], endSec: number): VideoSegment[] {
  const out: VideoSegment[] = [];
  segments.forEach((segment, index) => {
    const words = segment.text.split(/\s+/).filter(Boolean);
    if (words.length <= LONG_SEGMENT_WORDS) {
      out.push(segment);
      return;
    }
    const until = Math.max(segment.startSec + 1, segments[index + 1]?.startSec ?? endSec);
    const sentences = segment.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    let piece: string[] = [];
    let pieceWords = 0;
    let spoken = 0;
    let pieceStart = 0;
    const flush = () => {
      if (piece.length === 0) return;
      out.push({ startSec: Math.round(segment.startSec + ((until - segment.startSec) * pieceStart) / words.length), text: piece.join(" ") });
      piece = [];
      pieceWords = 0;
    };
    for (const sentence of sentences) {
      const count = sentence.split(/\s+/).filter(Boolean).length;
      if (pieceWords > 0 && pieceWords + count > 70) flush();
      if (pieceWords === 0) pieceStart = spoken;
      piece.push(sentence);
      pieceWords += count;
      spoken += count;
    }
    flush();
  });
  return out;
}

function parseWindow(text: string, startSec: number, endSec: number): Pick<VideoWindow, "segments" | "onScreen"> | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const entries = (value: unknown) => (Array.isArray(value) ? value : []).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  const segments: VideoSegment[] = entries(parsed.segments)
    .map((item) => ({ startSec: parseTimestamp(item.t) ?? startSec, text: clean(item.text) }))
    .filter((segment) => segment.text);
  const onScreen: VideoOnScreen[] = entries(parsed.onScreen)
    .map((item) => ({ startSec: parseTimestamp(item.t) ?? startSec, kind: clean(item.kind) || "text", content: clean(item.content) }))
    .filter((shown) => shown.content);
  return { segments: spreadLongSegments(absoluteTimes(segments, startSec, endSec), endSec), onScreen: absoluteTimes(onScreen, startSec, endSec) };
}

/** The clip, from the main model or, when that is too busy to answer, from the fallback. */
async function generateClip(url: string, startSec: number, endSec: number) {
  const generate = (model: string) => withRetry(
    () => client().models.generateContent({
      model,
      contents: [{ role: "user", parts: [videoPart(url, startSec, endSec), { text: WINDOW_PROMPT }] }],
      config: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 24_000 },
    }),
    `clip ${startSec}-${endSec}s on ${model}`,
  );
  if (FALLBACK_MODEL !== MODEL && Date.now() < mainModelSpentUntil) {
    return { response: await generate(FALLBACK_MODEL), model: FALLBACK_MODEL };
  }
  try {
    return { response: await generate(MODEL), model: MODEL };
  } catch (error) {
    if (!isBusy(error) || FALLBACK_MODEL === MODEL) throw error;
    if (isQuotaSpent(error)) {
      // Spent for the day: an hour's rest before the main model is tried again.
      mainModelSpentUntil = Date.now() + 60 * 60 * 1000;
      console.log(`[youtube] ${MODEL}'s allowance on this key is used up; reading with ${FALLBACK_MODEL} for the next hour`);
    } else {
      console.log(`[youtube] ${MODEL} is too busy for clip ${startSec}-${endSec}s; reading it with ${FALLBACK_MODEL}`);
    }
    return { response: await generate(FALLBACK_MODEL), model: FALLBACK_MODEL };
  }
}

/** The clip read by the fallback model, for a second opinion on an empty answer. */
async function generateClipWith(model: string, url: string, startSec: number, endSec: number) {
  return withRetry(
    () => client().models.generateContent({
      model,
      contents: [{ role: "user", parts: [videoPart(url, startSec, endSec), { text: WINDOW_PROMPT }] }],
      config: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 24_000 },
    }),
    `clip ${startSec}-${endSec}s on ${model} (second look)`,
  );
}

async function readClip(url: string, startSec: number, endSec: number): Promise<VideoWindow & VideoReadCost> {
  let { response, model } = await generateClip(url, startSec, endSec);
  /*
   * AN EMPTY CLIP GETS A SECOND OPINION. A five-minute song came back as nothing at all — the model
   * took singing for "no speech" — and the whole video was then refused as having no speech
   * (2026-10-03). Silence is rare in a video anyone asks to be taught from, so a clip that read as
   * empty is read once more by the other model before the emptiness is believed.
   */
  const empty = (text: string | undefined) => {
    const read = parseWindow(text ?? "", startSec, endSec);
    return Boolean(read && read.segments.length === 0 && read.onScreen.length === 0);
  };
  if (empty(response.text)) {
    const other = model === MODEL ? FALLBACK_MODEL : MODEL;
    if (other !== model && !(other === MODEL && Date.now() < mainModelSpentUntil)) {
      console.log(`[youtube] clip ${startSec}-${endSec}s read as empty by ${model}; asking ${other}`);
      const second = await generateClipWith(other, url, startSec, endSec).catch(() => null);
      if (second && !empty(second.text)) {
        response = second;
        model = other;
      }
    }
  }
  const usage = response.usageMetadata ?? {};
  const promptTokens = usage.promptTokenCount ?? 0;
  const outputTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  const cost: VideoReadCost = {
    costUsd: costFor(model, { prompt_tokens: promptTokens, completion_tokens: outputTokens }),
    promptTokens,
    outputTokens,
  };
  const parsed = parseWindow(response.text ?? "", startSec, endSec);
  const cutShort = response.candidates?.[0]?.finishReason === "MAX_TOKENS";
  /*
   * A clip whose answer ran out of room (a fast talker over dense slides) is read again as two
   * halves rather than kept with its ending missing: the lecture is built on this being complete.
   */
  if ((cutShort || !parsed) && endSec - startSec > 120) {
    const middle = Math.round((startSec + endSec) / 2);
    const [first, second] = [await readClip(url, startSec, middle), await readClip(url, middle, endSec)];
    return {
      startSec,
      endSec,
      segments: [...first.segments, ...second.segments],
      onScreen: [...first.onScreen, ...second.onScreen],
      costUsd: cost.costUsd + first.costUsd + second.costUsd,
      promptTokens: cost.promptTokens + first.promptTokens + second.promptTokens,
      outputTokens: cost.outputTokens + first.outputTokens + second.outputTokens,
    };
  }
  if (!parsed) throw new VideoReadError("The video reader returned something unreadable for part of the video. Try again.", 502, true);
  return { startSec, endSec, ...parsed, ...cost };
}

/**
 * The measured length can run up to 3% long, so the last sliver of the last clip may lie wholly
 * past the real end of the video — where the API answers with an error, not an empty clip.
 */
export function mayStartPastEnd(startSec: number, durationSec: number): boolean {
  return startSec > 0 && durationSec - startSec <= durationSec * 0.03 + 2;
}

/**
 * One clip of the video as speech and on-screen notes. Served from the cache when it has been read
 * before. `pastEndOk` is for a clip that may start after the video has ended (mayStartPastEnd): a
 * failure there is an empty clip. Anywhere else a failure is a failure — a clip that silently came
 * back empty would be ten minutes of the video missing from the lecture.
 */
export async function readVideoWindow(videoId: string, url: string, startSec: number, endSec: number, pastEndOk = false): Promise<VideoWindowRead> {
  const cacheName = `window-${startSec}-${endSec}-${MODEL.replace(/[^A-Za-z0-9_-]/g, "-")}-${READ_VERSION}`;
  const cached = await readVideoCache<VideoWindow>(videoId, cacheName);
  // An empty reading is never served from the cache: it is exactly the answer worth asking again.
  if (cached && Array.isArray(cached.segments) && Array.isArray(cached.onScreen) && (cached.segments.length > 0 || cached.onScreen.length > 0)) {
    return { ...cached, costUsd: 0, promptTokens: 0, outputTokens: 0, cached: true, model: MODEL };
  }
  try {
    const startedAt = Date.now();
    const read = await readClip(url, startSec, endSec);
    console.log(`[youtube] read ${videoId} ${startSec}-${endSec}s in ${Math.round((Date.now() - startedAt) / 1000)}s: ${read.segments.length} segments, ${read.onScreen.length} on screen, ${read.promptTokens} tokens in`);
    const window: VideoWindow = { startSec, endSec, segments: read.segments, onScreen: read.onScreen };
    if (window.segments.length > 0 || window.onScreen.length > 0) await writeVideoCache(videoId, cacheName, window);
    return { ...read, cached: false, model: MODEL };
  } catch (error) {
    if (pastEndOk && !isBusy(error)) {
      console.log(`[youtube] ${videoId} ${startSec}-${endSec}s is past the end of the video; treated as empty`);
      return { startSec, endSec, segments: [], onScreen: [], costUsd: 0, promptTokens: 0, outputTokens: 0, cached: false, model: MODEL };
    }
    throw readError(error, "read the video");
  }
}
