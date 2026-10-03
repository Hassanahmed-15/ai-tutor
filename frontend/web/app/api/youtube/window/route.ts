import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { VideoReadError, mayStartPastEnd, readVideoWindow } from "@/lib/youtube/geminiVideo";
import { MAX_VIDEO_SEC, VIDEO_WINDOW_SEC } from "@/lib/youtube/videoSource";
import { parseYouTubeUrl } from "@/lib/youtube/videoUrl";

export const runtime = "nodejs";
export const maxDuration = 300;

/** One clip of the video, read as speech and on-screen notes (lib/youtube/geminiVideo.ts). */
export async function POST(req: Request) {
  // Reading a video is metered; like building the lecture itself, it needs a signed-in student.
  if (!(await currentUser())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const link = parseYouTubeUrl(typeof body.url === "string" ? body.url : "");
  if (!link) return NextResponse.json({ error: "That is not a YouTube video link." }, { status: 400 });
  const startSec = Math.floor(Number(body.startSec));
  const endSec = Math.floor(Number(body.endSec));
  const durationSec = Math.floor(Number(body.durationSec));
  if (!(startSec >= 0) || !(endSec > startSec) || endSec - startSec > VIDEO_WINDOW_SEC || endSec > MAX_VIDEO_SEC) {
    return NextResponse.json({ error: "Invalid clip." }, { status: 400 });
  }
  try {
    const pastEndOk = durationSec > 0 && mayStartPastEnd(startSec, durationSec);
    const { cached, costUsd, model, promptTokens, outputTokens, ...window } = await readVideoWindow(link.videoId, link.url, startSec, endSec, pastEndOk);
    return NextResponse.json({ window, cached, costUsd, model, promptTokens, outputTokens });
  } catch (error) {
    if (error instanceof VideoReadError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the video.", retryable: true }, { status: 502 });
  }
}
