import { NextResponse } from "next/server";
import { renderPdfWithPython } from "@/lib/pdfPythonPipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024;
/**
 * Thumbnails are rendered directly at this DPI rather than rendered large and downscaled.
 * 40 DPI puts a Letter page at roughly 340x440 — recognisable at preview size, a few KB on the
 * wire, and about a tenth the work of the 400 DPI the lesson pipeline uses.
 */
const THUMB_DPI = 40;

/**
 * Render every page of an uploaded document to a small thumbnail.
 *
 * SEPARATE FROM /api/parse-pdf ON PURPOSE. Parsing does the expensive work — figure cropping, OCR,
 * vision calls — and returns a structured lesson source. This route answers a different and much
 * cheaper question: "what do these pages look like, so the student can point at the ones they
 * care about?" Keeping them apart means picking pages never waits on the full parse, and the parse
 * route's contract is unchanged for every existing caller.
 *
 * Thumbnails are returned as data URIs rather than files. A rendered page at preview size is a few
 * kilobytes; writing them to disk would mean a storage location, a cleanup policy, and a URL
 * scheme, all of which are real work for something that lives for one screen. The container
 * filesystem is also ephemeral, so files written here would not survive a restart anyway.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a PDF or PowerPoint file." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1_048_576).toFixed(1)} MB; the limit is 20 MB.` },
      { status: 413 },
    );
  }

  const name = file.name.toLowerCase();
  const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
  if (!isPdf) {
    // PowerPoint has no page raster to render without a converter (LibreOffice or similar), which
    // is not in the image. Rather than fake it, say so — the caller falls back to listing slides
    // by title, which is still selectable, just not visual.
    return NextResponse.json(
      { kind: "no-thumbnails", reason: "Slide previews are unavailable for PowerPoint files." },
      { status: 200 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = await renderPdfWithPython(bytes, THUMB_DPI);
  if (!pages) {
    // renderPdfWithPython returns null when the Python pipeline is disabled or unavailable. That
    // is a degradation, not an error: the caller can still select pages by number.
    return NextResponse.json(
      { kind: "no-thumbnails", reason: "Page previews are unavailable on this server." },
      { status: 200 },
    );
  }

  const thumbnails = pages.map((page) => ({
    pageNumber: page.pageNumber,
    thumbnail: `data:image/png;base64,${Buffer.from(page.png).toString("base64")}`,
    // A short excerpt gives the student something to read when a thumbnail is ambiguous, and
    // labels the page for the model when only a subset is sent on.
    excerpt: page.text.replace(/\s+/g, " ").trim().slice(0, 140),
  }));

  return NextResponse.json({ kind: "pages", pageCount: thumbnails.length, pages: thumbnails });
}
