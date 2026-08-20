import { NextResponse } from "next/server";
import { renderPdfWithPython } from "@/lib/pdfPythonPipeline";
import { renderPptxSlides } from "@/lib/pptxRender";
import { convertPptxToPdf } from "@/lib/pptxToPdf";

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
