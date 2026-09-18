import { NextResponse } from "next/server";
import { renderPdfWithPython, streamPdfThumbnails } from "@/lib/pdfPythonPipeline";
import { renderPptxSlides } from "@/lib/pptxRender";
import { convertPptxToPdf } from "@/lib/pptxToPdf";
import { DOCUMENT_LIMITS, exceedsPageLimit, tooManyPagesMessage } from "@/lib/documentLimits";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = DOCUMENT_LIMITS.MAX_BYTES;
/**
 * Thumbnails are rendered directly at this DPI rather than rendered large and downscaled.
 * 150 DPI puts a Letter page at roughly 1275x1650 — sharp when the page picker displays it at up
 * to 672 CSS px wide (including on a retina 2x display), while staying well under the 400 DPI the
 * lesson pipeline uses for the model call this screen is not making. Was 40 DPI (≈340x440) when
 * the picker showed a small single-page preview beside a thumbnail grid; once the preview became
 * the primary, larger reading surface, that resolution upscaled visibly blurry.
 */
const THUMB_DPI = 150;

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
/**
 * Same reasoning as parse-pdf's wrapper: an uncaught throw here became a bare 500 that the page
 * picker reported as an unreadable file. `arrayBuffer()` on a 20 MB upload and the LibreOffice
 * conversion are both capable of it.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const response = await documentPagesRequest(request);
    console.log(`[document-pages] completed in ${Date.now() - startedAt}ms status=${response.status}`);
    return response;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[document-pages] failed after ${Date.now() - startedAt}ms:`, error);
    if (/timed? ?out|ETIMEDOUT|SIGTERM|SIGKILL/i.test(detail)) {
      return NextResponse.json({
        error: "Rendering these pages took too long. Try a shorter document.",
        detail,
      }, { status: 504 });
    }
    if (/heap out of memory|ENOMEM|Array buffer allocation failed/i.test(detail)) {
      return NextResponse.json({
        error: "This document was too large to preview. Try a smaller file.",
        detail,
      }, { status: 507 });
    }
    return NextResponse.json({ error: `Could not render these pages: ${detail}`, detail }, { status: 500 });
  }
}

async function documentPagesRequest(request: Request) {
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
  const isPptx = name.endsWith(".pptx") || file.type.includes("presentationml");

  if (isPptx) {
    /*
     * A DECK GETS PREVIEWS TOO.
     *
     * This used to answer "Slide previews are unavailable for PowerPoint files", so a deck could
     * only be picked from a list of titles while a PDF got a page grid and a drag-a-region
     * selector. That was never a decision — PowerPoint has no page raster, and rendering one
     * properly means LibreOffice, which is not in this image.
     *
     * `renderPptxSlides` composes each slide from its text and its real embedded pictures instead.
     * It is a map of the slide, not a facsimile — but the pictures in it ARE the file's own
     * bitmaps, so pointing at a chart crops the actual chart, which is what the preview is for.
     */
    const deckBytes = new Uint8Array(await file.arrayBuffer());

    /*
     * THE REAL SLIDES FIRST.
     *
     * LibreOffice converts the deck to PDF and the SAME rasteriser a paper uses renders the pages —
     * one code path, so a deck is genuinely treated like a PDF rather than sent down something that
     * resembles it. Composing slides from their XML (below) can never reproduce themes, masters,
     * SmartArt or native charts, because PowerPoint draws those itself.
     */
    try {
      const asPdf = await convertPptxToPdf(deckBytes);
      if (asPdf) {
        const pages = await renderPdfWithPython(asPdf, THUMB_DPI);
        // A deck is held to the same length as a paper, and finds out at the same point in the flow.
        if (pages && exceedsPageLimit(pages.length)) {
          return NextResponse.json({ error: tooManyPagesMessage(pages.length, "slide") }, { status: 413 });
        }
        if (pages && pages.length > 0) {
          return NextResponse.json({
            kind: "pages",
            fidelity: "rendered",
            pageCount: pages.length,
            pages: pages.map((page) => ({
              pageNumber: page.pageNumber,
              thumbnail: `data:image/png;base64,${Buffer.from(page.png).toString("base64")}`,
              excerpt: page.text.replace(/\s+/g, " ").trim().slice(0, 140),
            })),
          });
        }
      }
    } catch {
      // Conversion is best-effort; the composed preview below still works.
    }

    /*
     * Fall back to composing the slides.
     *
     * `fidelity: "approximate"` is reported so the UI can SAY so. A student who cannot tell a real
     * slide from a redrawing of one cannot tell why the region they cropped looks unfamiliar.
     */
    try {
      const slides = await renderPptxSlides(deckBytes);
      if (exceedsPageLimit(slides.length)) {
        return NextResponse.json({ error: tooManyPagesMessage(slides.length, "slide") }, { status: 413 });
      }
      if (slides.length > 0) {
        return NextResponse.json({
          kind: "pages",
          fidelity: "approximate",
          pageCount: slides.length,
          pages: slides.map((slide) => ({
            pageNumber: slide.slideNumber,
            thumbnail: `data:image/png;base64,${slide.png.toString("base64")}`,
            excerpt: slide.text.slice(0, 140),
          })),
        });
      }
    } catch {
      // Fall through to the no-thumbnails answer below rather than failing the upload.
    }
    return NextResponse.json(
      { kind: "no-thumbnails", reason: "Slide previews could not be built for this deck." },
      { status: 200 },
    );
  }

  if (!isPdf) {
    return NextResponse.json(
      { kind: "no-thumbnails", reason: "Previews are only available for PDFs and PowerPoint decks." },
      { status: 200 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  /*
   * STREAM THE PAGES, one NDJSON line each, as they are rendered.
   *
   * The whole-array path below waits for every page to rasterise, base64s the lot into one JSON
   * body, and only then sends it — so nothing appeared on screen until the last page of the last
   * file was done. Rendering was never the bottleneck (0.79s for twenty pages at 150 DPI); the
   * 7.0 MB single response was. Streaming changes when the first page arrives, not how much total
   * work happens: measured, page one lands at ~140 ms instead of ~790 ms plus transfer.
   *
   * Opt-in via `?stream=1` so every existing caller of this route keeps the object it expects.
   */
  if (new URL(request.url).searchParams.get("stream") === "1") {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let count = 0;
        try {
          for await (const event of streamPdfThumbnails(bytes, THUMB_DPI, request.signal)) {
            if (event.type === "count") {
              count = event.pageCount;
              // The page limit is enforced before any image is sent, so an over-long document is
              // refused at the same point in the flow as before rather than after a grid appears.
              if (exceedsPageLimit(count)) {
                controller.enqueue(
                  encoder.encode(JSON.stringify({ type: "error", error: tooManyPagesMessage(count) }) + "\n"),
                );
                controller.close();
                return;
              }
              controller.enqueue(encoder.encode(JSON.stringify({ type: "count", pageCount: count }) + "\n"));
              continue;
            }
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "page",
                  pageNumber: event.pageNumber,
                  thumbnail: `data:image/png;base64,${event.png}`,
                  excerpt: event.excerpt,
                }) + "\n",
              ),
            );
          }
          // No pages at all means the Python pipeline is off or unavailable — a degradation the
          // caller handles by letting the student pick pages by number.
          if (count === 0) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "unavailable",
                  reason: "Page previews are unavailable on this server.",
                }) + "\n",
              ),
            );
          }
          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "error",
                error: error instanceof Error ? error.message : "Could not render those pages.",
              }) + "\n",
            ),
          );
          controller.close();
        }
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        // Proxies that buffer a response would undo the streaming entirely.
        "X-Accel-Buffering": "no",
      },
    });
  }

  const pages = await renderPdfWithPython(bytes, THUMB_DPI);

  /*
   * Refuse an over-long document HERE, at the first thing that touches it.
   *
   * This route is where an upload actually begins, so this is where the student finds out. Leaving
   * the check to parsing would show them a grid of forty thumbnails, let them choose pages and type
   * a question, and only then say no — after the one step in the flow that feels like progress.
   */
  if (pages && exceedsPageLimit(pages.length)) {
    return NextResponse.json({ error: tooManyPagesMessage(pages.length) }, { status: 413 });
  }

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
