import { lessonCaller } from "@/lib/auth";
import { downloadBlobRange, parseByteRange, storedBlobProperties } from "@/lib/blobStorage";
import { mediaBlobName, validRun } from "@/lib/screen/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = /^(slide-[1-3]\.mp4|video\.mp4|video\.vtt)$/;

/** A slide or full video made for one of the signed-in student's own marks, with byte ranges so it can be scrubbed. */
export async function GET(request: Request, { params }: { params: Promise<{ run: string; file: string }> }) {
  const session = await lessonCaller();
  if (!session) return new Response("Authentication required", { status: 401 });
  const { run, file } = await params;
  if (!validRun(run) || !FILE.test(file)) return new Response("Not found", { status: 404 });
  const blobName = mediaBlobName(session.userId, run, file);
  try {
    const properties = await storedBlobProperties(blobName);
    const range = parseByteRange(request.headers.get("range"), properties.totalBytes);
    const baseHeaders: Record<string, string> = { "Content-Type": properties.contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
    if (range === "invalid") return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${properties.totalBytes}` } });
    const download = await downloadBlobRange(blobName, range ?? undefined);
    if (range) {
      return new Response(new Uint8Array(download.body), {
        status: 206,
        headers: { ...baseHeaders, "Content-Range": `bytes ${range.start}-${range.end}/${download.totalBytes}`, "Content-Length": String(download.body.length) },
      });
    }
    return new Response(new Uint8Array(download.body), { headers: { ...baseHeaders, "Content-Length": String(download.body.length) } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
