import { currentUser } from "@/lib/auth";
import { downloadBlobRange, storedBlobProperties } from "@/lib/blobStorage";
import { lectureForUser } from "@/lib/lectureArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return "invalid";
  }
  return { start, end };
}

/** Streams a saved Manim asset only when it belongs to one of the learner's lectures. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; videoId: string }> },
) {
  const session = await currentUser();
  if (!session) return new Response("Authentication required", { status: 401 });

  const { id, videoId } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{32}$/.test(videoId)) {
    return new Response("Invalid asset id", { status: 400 });
  }

  try {
    const lecture = await lectureForUser(session.userId, id);
    const video = lecture?.manimVideos.find((item) => item.id === videoId);
    if (!lecture || !video) return new Response("Not found", { status: 404 });

    const properties = await storedBlobProperties(video.blobName);
    const range = parseRange(request.headers.get("range"), properties.totalBytes);
    const baseHeaders: Record<string, string> = {
      "Content-Type": properties.contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    };

    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${properties.totalBytes}` },
      });
    }

    const download = await downloadBlobRange(video.blobName, range ?? undefined);
    if (range) {
      return new Response(new Uint8Array(download.body), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${range.start}-${range.end}/${download.totalBytes}`,
          "Content-Length": String(download.body.length),
        },
      });
    }
    return new Response(new Uint8Array(download.body), {
      headers: { ...baseHeaders, "Content-Length": String(download.body.length) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stored video could not be loaded.";
    console.error(`[lectures] video ${id}/${videoId} failed: ${message}`);
    return new Response("Stored video could not be loaded", { status: 502 });
  }
}
