import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { VideoReadError, videoDurationSec } from "@/lib/youtube/geminiVideo";
import { MAX_VIDEO_SEC, planVideoWindows } from "@/lib/youtube/videoSource";
import { formatTimestamp, parseYouTubeUrl } from "@/lib/youtube/videoUrl";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The first step of a video lecture: is this a video we can read, how long is it, and in which
 * clips will it be read (lib/youtube/geminiVideo.ts).
 *
 * The browser drives the steps that follow — one request per clip, then chapters, then one per
 * chapter's notes — so no single request runs anywhere near the 240 seconds a Container Apps
 * ingress allows, and the student sees the video being read rather than a spinner.
 */

/** How many clips the browser reads at once. One on a free-tier key, which is limited per minute. */
function readConcurrency(): number {
  const value = Number(process.env.YOUTUBE_READ_CONCURRENCY ?? 2);
  return Number.isFinite(value) ? Math.max(1, Math.min(6, Math.round(value))) : 2;
}

/** The video's own title. YouTube's oEmbed needs no key; a miss just leaves the naming to the chapter call. */
async function videoTitle(url: string): Promise<string> {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return "";
    const data = (await response.json()) as { title?: unknown };
    return typeof data.title === "string" ? data.title.trim().slice(0, 200) : "";
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  // Reading a video is metered; like building the lecture itself, it needs a signed-in student.
  if (!(await currentUser())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const link = parseYouTubeUrl(typeof body.url === "string" ? body.url : "");
  if (!link) return NextResponse.json({ error: "That is not a YouTube video link." }, { status: 400 });
  try {
    const [durationSec, title] = await Promise.all([videoDurationSec(link.url), videoTitle(link.url)]);
    if (durationSec > MAX_VIDEO_SEC) {
      return NextResponse.json(
        { error: `That video is ${formatTimestamp(durationSec)} long. Videos up to ${formatTimestamp(MAX_VIDEO_SEC)} are supported for now.` },
        { status: 413 },
      );
    }
    return NextResponse.json({
      videoId: link.videoId,
      url: link.url,
      title,
      durationSec,
      windows: planVideoWindows(durationSec),
      readConcurrency: readConcurrency(),
    });
  } catch (error) {
    if (error instanceof VideoReadError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not open the video." }, { status: 502 });
  }
}
