import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
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
 * extraction — a PDF's internal image encoding (DCTDecode/FlateDecode streams, indexed
 * colorspaces, soft masks) is far messier than pptx's plain zip-of-PNGs, so reliably pulling out
 * the exact original embedded bytes isn't worth the fragility. But a full page (with its own body
 * text baked in) is a poor stand-in for "the photo/diagram on this page" — so a vision call looks
 * at the rendered page and finds the bounding box of the actual figure, and only THAT region is
 * cropped out and kept as the asset. Pages with no distinct figure (pure text) get no image asset
 * at all — the content block still carries the page's text either way.
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

type FigureBox = { x: number; y: number; width: number; height: number };

/**
 * Ask GPT-4o Vision whether this rendered page contains one distinct photo/diagram/figure
 * (as opposed to being plain text, or the whole page just being a slide-style graphic with no
 * single distinguishable figure) and, if so, its bounding box as fractions of the page (0-1).
 * Returns null on "no distinct figure" OR on any failure — callers must treat null as "no crop",
 * never as an error worth surfacing.
 */
async function detectFigureBox(client: OpenAI, dataUrl: string): Promise<FigureBox | null> {
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
            {
              type: "text",
              text:
                "This is a rendered page from a document. Does it contain ONE distinct photo, illustration, chart, or diagram that is clearly separate from the body text (not just text/paragraphs, and not a full-page slide graphic with no single distinguishable figure)? " +
                'Reply JSON only: { "hasFigure": boolean, "x": number, "y": number, "width": number, "height": number }. ' +
                "x/y/width/height are the figure's bounding box as FRACTIONS of the full page (0 to 1, x/y = top-left corner). Tight box around just the figure, excluding surrounding body text/captions where possible. If hasFigure is false, x/y/width/height can be 0.",
            },
          ],
        },
      ],
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    if (parsed.hasFigure !== true) return null;
    const x = typeof parsed.x === "number" ? parsed.x : NaN;
    const y = typeof parsed.y === "number" ? parsed.y : NaN;
    const width = typeof parsed.width === "number" ? parsed.width : NaN;
    const height = typeof parsed.height === "number" ? parsed.height : NaN;
    if (![x, y, width, height].every((v) => Number.isFinite(v) && v >= 0)) return null;
    if (width < 0.03 || height < 0.03) return null; // Too small to be a meaningful figure.
    return {
      x: Math.min(x, 0.98),
      y: Math.min(y, 0.98),
      width: Math.min(width, 1 - Math.min(x, 0.98)),
      height: Math.min(height, 1 - Math.min(y, 0.98)),
    };
  } catch {
    return null;
  }
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
  const { loadImage, createCanvas: createCropCanvas } = await import("@napi-rs/canvas");

  const openaiKey = process.env.OPENAI_API_KEY;
  const client = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

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

    let pagePngBuffer: Buffer | null = null;
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
        const buf = canvas.toBuffer("image/png");
        if (buf.length >= MIN_PAGE_PNG_BYTES) pagePngBuffer = buf;
      } finally {
        canvasFactory.destroy(canvasAndContext);
      }
    } catch {
      pagePngBuffer = null;
    }

    // Don't use the whole rendered page as the asset — it bakes in the page's own body text and
    // reads as a screenshot, not a photo. Ask Vision for the actual figure's bounding box on the
    // page and crop to just that region; pages with no distinct figure get no image asset at all
    // (their text still becomes a content block below). Without a vision client configured, fall
    // back to the uncropped full page — a coarser asset is still better than none.
    let dataUrl = "";
    if (pagePngBuffer && client) {
      const fullPageDataUrl = `data:image/png;base64,${pagePngBuffer.toString("base64")}`;
      const box = await detectFigureBox(client, fullPageDataUrl);
      if (box) {
        try {
          const img = await loadImage(pagePngBuffer);
          const cropX = Math.round(box.x * img.width);
          const cropY = Math.round(box.y * img.height);
          const cropW = Math.max(1, Math.round(box.width * img.width));
          const cropH = Math.max(1, Math.round(box.height * img.height));
          const cropCanvas = createCropCanvas(cropW, cropH);
          const cropCtx = cropCanvas.getContext("2d");
          cropCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          const cropBuffer = cropCanvas.toBuffer("image/png");
          if (cropBuffer.length >= MIN_PAGE_PNG_BYTES / 4) {
            dataUrl = `data:image/png;base64,${cropBuffer.toString("base64")}`;
          }
        } catch {
          dataUrl = "";
        }
      }
    } else if (pagePngBuffer && !client) {
      dataUrl = `data:image/png;base64,${pagePngBuffer.toString("base64")}`;
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
