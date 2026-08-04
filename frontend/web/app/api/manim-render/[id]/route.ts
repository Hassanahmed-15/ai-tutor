import { readCachedRender, readCachedVideo } from "@/lib/manimRender";

/**
 * Serves a rendered beat video out of the render cache.
 *
 * Not `public/`: these are generated at runtime, and Next only serves `public/` as it existed
 * at build time. Streaming them through a route also keeps the id validated in one place —
 * `readCachedVideo` rejects anything that is not a plain 32-char hex id before it touches the
 * filesystem.
 *
 * RANGE SUPPORT IS NOT OPTIONAL HERE. ManimBoard never calls play() — it holds the video
 * paused and sets `currentTime` from narration progress. A <video> will only honour that if
 * the resource is seekable, and it decides that from `Accept-Ranges` / a `206` response.
 * Without this the element silently discards every seek and sits on frame 0, which for a beat
 * whose first op lands at `at ≈ 0.04` is an empty board. That was exactly the "Manim renders
 * blank" bug: the files were correct all along and the seek was being dropped.
 */

/** Parses a single-range `bytes=start-end` header. Multi-range is not worth supporting here. */
function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "invalid";

  let start: number;
  let end: number;
  if (rawStart === "") {
    // `bytes=-500` means the LAST 500 bytes, not the first 500.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
    end = Math.min(end, size - 1);
  }

  if (start > end || start >= size) return "invalid";
  return { start, end };
}

export async function GET(req: Request, ctx: RouteContext<"/api/manim-render/[id]">) {
  const { id } = await ctx.params;

  const meta = await readCachedRender(id);
  const video = meta ? await readCachedVideo(id) : null;
  if (!meta || !video) {
    return new Response("Not found", { status: 404 });
  }

  const size = video.length;
  const baseHeaders: Record<string, string> = {
    "Content-Type": "video/mp4",
    // The header that tells the element it may seek at all.
    "Accept-Ranges": "bytes",
    // Content-addressed by hash, so a given id's bytes can never change.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Manim-Duration-Ms": String(meta.durationMs),
  };

  const range = parseRange(req.headers.get("range"), size);

  if (range === "invalid") {
    return new Response(null, {
      status: 416, // Range Not Satisfiable
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    });
  }

  if (range) {
    const body = video.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(body), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(body.length),
      },
    });
  }

  return new Response(new Uint8Array(video), {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
