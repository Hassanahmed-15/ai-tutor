import {
  buildLessonInputFromVideo,
  windowsBetween,
  type VideoBuildResult,
  type VideoChapter,
  type VideoChapterNotes,
  type VideoWindow,
} from "./videoSource";
import { formatTimestamp } from "./videoUrl";

/**
 * A YouTube link, turned into a lesson source — driven from the browser, one short request at a time.
 *
 * WHY THE BROWSER DRIVES IT. Reading an hour of video is six clips and a dozen model calls. As one
 * request that is minutes long, past the 240 seconds a Container Apps ingress allows and with
 * nothing to show while it runs. As a sequence — open the video, read each clip, find the chapters,
 * take notes on each — every request is short, a busy model is retried one clip at a time instead
 * of restarting the video, and the student sees how far the reading has got.
 *
 * NOTHING IS SKIPPED QUIETLY. A clip or a chapter that cannot be read fails the whole ingest with
 * its reason. A lecture missing ten minutes of its video with no sign of it is the one outcome this
 * feature exists to prevent.
 */

export type VideoIngestProgress = {
  stage: "opening" | "reading" | "chapters" | "notes";
  /** What to show the student, e.g. "Watching the video: 20:00 of 58:12". */
  label: string;
  /** 0..1 across the whole ingest. */
  fraction: number;
};

export type VideoIngestResult = VideoBuildResult & {
  videoId: string;
  url: string;
  durationSec: number;
  costUsd: number;
  /** How many clips were served from the cache — a fully cached video costs nothing to read. */
  cachedWindows: number;
};

type IngestOptions = { onProgress?: (progress: VideoIngestProgress) => void; signal?: AbortSignal };

/** A busy reader usually frees up within a minute or two; the page waits that long before giving up. */
const RETRY_WAITS_MS = [8_000, 20_000, 40_000, 60_000];
const NOTES_CONCURRENCY = 4;

async function post<T>(path: string, body: unknown, signal?: AbortSignal, onWaiting?: (waiting: boolean) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) {
      if (attempt > 0) onWaiting?.(false);
      return data as T;
    }
    const retryable = data.retryable === true || response.status === 503 || response.status === 504;
    if (!retryable || attempt >= RETRY_WAITS_MS.length) {
      throw new Error(typeof data.error === "string" ? data.error : `The video could not be read (${response.status}).`);
    }
    onWaiting?.(true);
    await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[attempt]));
  }
}

/** `limit` at a time, results in input order; the first failure stops the rest from starting. */
async function mapPool<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await run(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export async function ingestYouTubeVideo(url: string, options: IngestOptions = {}): Promise<VideoIngestResult> {
  const { onProgress, signal } = options;
  let costUsd = 0;
  const spent = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) costUsd += value;
  };

  onProgress?.({ stage: "opening", label: "Opening the video", fraction: 0.02 });
  const info = await post<{
    videoId: string;
    url: string;
    title: string;
    durationSec: number;
    windows: Array<{ startSec: number; endSec: number }>;
    readConcurrency: number;
  }>("/api/youtube/info", { url }, signal);

  // Reading is most of the wait, so it gets most of the bar: 5% to 70%.
  let read = 0;
  let cachedWindows = 0;
  // A wait is said, not hidden: a bar that stops moving with no reason reads as a broken page.
  let waiting = 0;
  const readSoFar = () => Math.min(info.durationSec, read * (info.windows[0]?.endSec ?? 0));
  const reading = (seconds: number) => onProgress?.({
    stage: "reading",
    label: waiting > 0
      ? `Watching the video: ${formatTimestamp(seconds)} of ${formatTimestamp(info.durationSec)} (the reader is busy, retrying)`
      : `Watching the video: ${formatTimestamp(seconds)} of ${formatTimestamp(info.durationSec)}`,
    fraction: 0.05 + 0.65 * (info.windows.length ? read / info.windows.length : 1),
  });
  reading(0);
  const windows = await mapPool(info.windows, info.readConcurrency, async (clip) => {
    const data = await post<{ window: VideoWindow; cached: boolean; costUsd: number }>(
      "/api/youtube/window",
      { url: info.url, startSec: clip.startSec, endSec: clip.endSec, durationSec: info.durationSec },
      signal,
      (isWaiting) => {
        waiting += isWaiting ? 1 : -1;
        reading(readSoFar());
      },
    );
    spent(data.costUsd);
    if (data.cached) cachedWindows++;
    read++;
    reading(readSoFar());
    return data.window;
  });

  const segments = windows.flatMap((window) => window.segments).sort((a, b) => a.startSec - b.startSec);
  /*
   * A video with no voice can still teach: slides with music under them, a silent whiteboard. Only a
   * video with nothing heard AND nothing shown is refused. Without speech, what was shown stands in
   * for it when the topics are found.
   */
  const shown = windows.flatMap((window) => window.onScreen).sort((a, b) => a.startSec - b.startSec);
  if (segments.length === 0 && shown.length === 0) throw new Error("Nothing could be heard or read in that video, so there is nothing to build a lesson from.");
  const topicSource = segments.length > 0 ? segments : shown.map((item) => ({ startSec: item.startSec, text: item.content }));

  onProgress?.({ stage: "chapters", label: "Finding the topics it covers", fraction: 0.72 });
  const outline = await post<{ title: string; chapters: VideoChapter[]; costUsd: number }>(
    "/api/youtube/chapters",
    { title: info.title, durationSec: info.durationSec, segments: topicSource },
    signal,
  );
  spent(outline.costUsd);
  const title = outline.title || info.title || "YouTube video";

  let noted = 0;
  const noting = () => onProgress?.({
    stage: "notes",
    label: `Taking notes: ${noted} of ${outline.chapters.length} topics`,
    fraction: 0.75 + 0.23 * (outline.chapters.length ? noted / outline.chapters.length : 1),
  });
  noting();
  const chapters = await mapPool(outline.chapters, NOTES_CONCURRENCY, async (chapter) => {
    const data = await post<{ notes: VideoChapterNotes; costUsd: number }>(
      "/api/youtube/notes",
      { videoTitle: title, chapter, ...windowsBetween(windows, chapter.startSec, chapter.endSec) },
      signal,
    );
    spent(data.costUsd);
    noted++;
    noting();
    return data.notes;
  });

  const built = buildLessonInputFromVideo({ videoId: info.videoId, url: info.url, title, durationSec: info.durationSec, chapters, windows });
  if (built.beatCount === 0) {
    throw new Error("Aria watched the whole video but found nothing in it to teach. It may be music or entertainment rather than a lecture or tutorial; this feature summarises lectures, talks and explainers.");
  }
  return { ...built, videoId: info.videoId, url: info.url, durationSec: info.durationSec, costUsd, cachedWindows };
}
