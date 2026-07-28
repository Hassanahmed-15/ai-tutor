import { NextRequest, NextResponse } from "next/server";
import type { SuprnotesAsset, SuprnotesContentBlock, SuprnotesLessonInput } from "@/lib/suprnotes";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * PDF upload — builds a real, grounded `SuprnotesLessonInput` directly (not the flat
 * slideContext/diagramHints text fallback the legacy .pptx path used), so a PDF lecture gets the
 * same full pipeline a task-folder upload does: vision-verified assets, image-only mode (no
 * hallucinated AI images), the image-callout labeling agent, and content-block-grounded
 * chalkboard boards — all already gated on `Boolean(sourceDocument)` in generate-lecture/route.ts.
 *
 * Image strategy: full-page rasterization (render each page to a PNG), not embedded XObject
 * extraction. A PDF's internal image encoding (DCTDecode/FlateDecode streams, indexed
 * colorspaces, soft masks) is far messier than pptx's plain zip-of-PNGs, so reliably pulling out
 * the exact original embedded bytes isn't worth the fragility — a rendered page always produces a
 * usable, faithful visual, which is what actually matters for grounding a lecture's boards.
 */

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 60;
// Below this raw PNG byte size, a rendered page is almost certainly blank/near-blank — skip
// embedding it as an asset (mirrors the pptx route's 5000-byte floor for tiny placeholder images).
const MIN_PAGE_PNG_BYTES = 4000;
const RENDER_SCALE = 1.5;

function titleFromText(text: string): string {
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return firstLine ? firstLine.slice(0, 120) : "";
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded. Send the .pdf as 'file' in form-data." }, { status: 400 });
  }

  const fileObj = file as File;
  if (!fileObj.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only .pdf files are supported." }, { status: 400 });
  }
  if (fileObj.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large. Maximum size is 20 MB." }, { status: 413 });
  }

  // Dynamic import: pdfjs-dist's legacy Node build does its own `require("@napi-rs/canvas")` at
  // import time and touches Node-only globals — loading it lazily (rather than a static top-level
  // import) keeps it out of any client-bundle analysis, matching the pattern already used for
  // react-dom/server in lib/reactAnimationVisionCritic.ts.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let buffer: ArrayBuffer;
  try {
    buffer = await fileObj.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 422 });
  }

  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    // No standardFontDataUrl: pdfjs-dist's internal fetch for it passes a bare string to
    // fs.readFile, which Node only accepts as a path or URL object (not a "file://" string) — a
    // library-internal quirk, not something fixable from here. Omitting it just means pages using
    // a non-embedded standard font fall back to a generic substitute glyph shape; text extraction
    // (what grounding actually depends on) is unaffected. verbosity: 0 keeps that non-fatal case
    // from spamming warnings for every such page.
    pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  } catch {
    return NextResponse.json({ error: "Could not read the file as a .pdf. Make sure it's a valid PDF." }, { status: 422 });
  }

  if (pdf.numPages === 0) {
    return NextResponse.json({ error: "No pages found in the uploaded file." }, { status: 422 });
  }
  if (pdf.numPages > MAX_PAGES) {
    return NextResponse.json({ error: `PDF has too many pages (${pdf.numPages}). Maximum is ${MAX_PAGES}.` }, { status: 413 });
  }

  let metadataTitle = "";
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as { Title?: string } | undefined;
    if (info?.Title && info.Title.trim()) metadataTitle = info.Title.trim();
  } catch {
    // Non-critical — fall through to text-derived title.
  }

  const contentBlocks: SuprnotesContentBlock[] = [];
  const assets: SuprnotesAsset[] = [];
  let firstPageText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    let pageText = "";
    try {
      const textContent = await page.getTextContent();
      pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      pageText = "";
    }
    if (i === 1) firstPageText = pageText;

    let dataUrl = "";
    try {
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      type CanvasFactory = { create: (w: number, h: number) => { canvas: unknown; context: unknown }; destroy: (entry: { canvas: unknown; context: unknown }) => void };
      const canvasFactory = (pdf as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
      const canvasAndContext = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        // pdfjs-dist's types want a DOM HTMLCanvasElement, but at runtime (Node) this is the
        // @napi-rs/canvas object its own NodeCanvasFactory just created — exactly what its
        // internal rendering code expects despite the DOM-shaped type signature.
        await page.render({
          canvas: canvasAndContext.canvas as unknown as HTMLCanvasElement,
          canvasContext: canvasAndContext.context as CanvasRenderingContext2D,
          viewport,
        }).promise;
        const canvas = canvasAndContext.canvas as { toBuffer: (mime: "image/png") => Buffer };
        const pngBuffer = canvas.toBuffer("image/png");
        if (pngBuffer.length >= MIN_PAGE_PNG_BYTES) {
          dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
        }
      } finally {
        canvasFactory.destroy(canvasAndContext);
      }
    } catch {
      dataUrl = "";
    }

    if (!pageText && !dataUrl) continue; // Genuinely blank page — nothing to teach from.

    const blockId = `page-${i}`;
    const assetIds: string[] = [];
    if (dataUrl) {
      const assetId = `${blockId}-img`;
      assets.push({
        id: assetId,
        type: "image",
        mimeType: "image/png",
        url: dataUrl,
        sourceBlockIds: [blockId],
      });
      assetIds.push(assetId);
    }

    contentBlocks.push({
      id: blockId,
      type: "section",
      heading: `Page ${i}`,
      text: pageText || undefined,
      assetIds: assetIds.length ? assetIds : undefined,
      sourceOrder: i,
    });
  }

  if (contentBlocks.length === 0) {
    return NextResponse.json({ error: "Couldn't extract any readable content from that PDF." }, { status: 422 });
  }

  const title = metadataTitle || titleFromText(firstPageText) || fileObj.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " ").trim();

  const sourceDocument: SuprnotesLessonInput = {
    schemaVersion: "suprnotes.lesson_input.v1",
    source: { adapter: "pdf-upload", generatedAt: new Date().toISOString() },
    lesson: { title, subject: title, language: "en" },
    generationDirectives: {
      imagePolicy: "use_provided_images_only",
      disableAiImageGeneration: true,
      preferredLectureStyle: "grounded_from_notes",
      preserveExistingLecturePrompting: true,
    },
    contentGovernance: {
      groundingPolicy: "prefer_provided_content",
      hallucinationPolicy: "hedge_when_unsupported",
      requireClaimSourceTags: false,
    },
    webPreview: { status: "not_requested" },
    assets,
    contentBlocks,
  };

  return NextResponse.json({
    sourceDocument,
    title,
    pageCount: pdf.numPages,
    assetCount: assets.length,
  });
}
