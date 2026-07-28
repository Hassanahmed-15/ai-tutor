import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  applyGlobalSourceOrder,
  buildPdfLessonPlan,
  sanitizeDetectedFigures,
  structurePdfPage,
  type PdfDetectedFigure,
  type PdfTextSpan,
} from "@/lib/pdfLessonPipeline";
import { cropFiguresWithPython, renderPdfWithPython } from "@/lib/pdfPythonPipeline";
import type {
  SuprnotesAsset,
  SuprnotesContentBlock,
  SuprnotesLessonInput,
} from "@/lib/suprnotes";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 60;
const MIN_PNG_BYTES = 1_000;
const RENDER_SCALE = 2;
const PAGE_CONCURRENCY = 3;
const VISION_MODEL = process.env.OPENAI_PDF_VISION_MODEL ?? "gpt-4o";

type RenderedPage = {
  pageNumber: number;
  text: string;
  blocks: SuprnotesContentBlock[];
  png: Buffer | null;
  width: number;
  height: number;
};

type CropResult = {
  buffer: Buffer;
  width: number;
  height: number;
  cropBox: { x: number; y: number; width: number; height: number };
};

function clean(value: unknown, max = 500): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function titleFromText(text: string): string {
  const firstLine = text.split(/\n+/).map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 120) : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function detectFigures(client: OpenAI, dataUrl: string): Promise<PdfDetectedFigure[]> {
  try {
    const completion = await client.chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 2_400,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          {
            type: "text",
            text: `Inspect this rendered PDF page and locate EVERY meaningful educational visual: photo, scientific diagram, chart, graph, table, flowchart, illustration, displayed formula, map, or multi-panel figure.

Return JSON only:
{
  "figures": [{
    "type": "photo|diagram|chart|graph|table|flowchart|illustration|formula|map|other",
    "x": 0.0,
    "y": 0.0,
    "width": 0.0,
    "height": 0.0,
    "caption": "short source caption",
    "description": "precise description of what is visibly present",
    "instructionalPriority": "high|medium|low",
    "useInLesson": true,
    "annotationNeeded": true,
    "focusRegions": [{ "label": "visible part", "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 }]
  }]
}

Rules:
- Figure x/y/width/height are fractions of the FULL PAGE.
- Focus-region coordinates are fractions INSIDE THAT FIGURE.
- Include the complete visual itself with all internal labels, arrows, legends, axes, and annotations. Include a caption only when it directly names the figure. Never include surrounding paragraphs, exercises, question boxes, section headers, or unrelated page text.
- Treat a multi-panel or multi-column visual that belongs together as ONE complete figure.
- Return separate boxes only for genuinely independent visuals.
- Exclude ordinary paragraphs, decorative rules, page headers, footers, logos, chapter banners, stylized heading graphics, and isolated bullet text.
- useInLesson is true only when the visual materially improves understanding of the source concept. Decorative photos, repeated icons, banners, and layout graphics must be false.
- instructionalPriority is high for an essential diagram/chart/photo discussed by the source, medium for useful supporting evidence, and low for incidental/decorative visuals.
- annotationNeeded is true only when pointing to specific visible regions improves the explanation. A visual does not need labels merely because it exists.
- Use an empty figures array when the page has no meaningful visual.
- Give 1-8 focus regions for visible parts worth pointing to while teaching; do not invent parts.`,
          },
        ],
      }],
    });
    return sanitizeDetectedFigures(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));
  } catch (error) {
    console.error(`[pdf] visual detection failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return [];
  }
}

function positionedSpans(items: unknown[], pageWidth: number, pageHeight: number): PdfTextSpan[] {
  const spans: PdfTextSpan[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw) || !("transform" in raw)) continue;
    const item = raw as {
      str?: unknown;
      transform?: unknown;
      width?: unknown;
      height?: unknown;
      fontName?: unknown;
    };
    const text = typeof item.str === "string" ? item.str.trim() : "";
    const transform = Array.isArray(item.transform) ? item.transform.map(Number) : [];
    if (!text || transform.length < 6 || transform.some((value) => !Number.isFinite(value))) continue;
    const rawHeight = Number(item.height);
    const transformedHeight = Math.hypot(transform[2], transform[3]);
    const fontSize = Math.max(1, Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : transformedHeight);
    const x = clamp(transform[4], 0, pageWidth);
    const top = clamp(pageHeight - transform[5] - fontSize, 0, pageHeight);
    const width = Math.max(1, Number(item.width) || text.length * fontSize * 0.5);
    spans.push({
      text,
      x,
      top,
      width,
      height: Math.max(fontSize, Number(item.height) || fontSize),
      fontSize,
      fontName: typeof item.fontName === "string" ? item.fontName : undefined,
    });
  }
  return spans;
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

async function renderPage(
  pdf: Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs").getDocument>["promise"]>,
  pageNumber: number,
): Promise<RenderedPage> {
  const page = await pdf.getPage(pageNumber);
  const textViewport = page.getViewport({ scale: 1 });
  let text = "";
  let blocks: SuprnotesContentBlock[] = [];

  try {
    const textContent = await page.getTextContent();
    const spans = positionedSpans(textContent.items as unknown[], textViewport.width, textViewport.height);
    blocks = structurePdfPage(spans, pageNumber, textViewport.width, textViewport.height);
    text = spans.map((span) => span.text).join(" ").replace(/\s+/g, " ").trim();
  } catch {
    blocks = [];
    text = "";
  }

  let png: Buffer | null = null;
  let width = 0;
  let height = 0;
  try {
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    width = Math.ceil(viewport.width);
    height = Math.ceil(viewport.height);
    type CanvasFactory = {
      create: (w: number, h: number) => { canvas: unknown; context: unknown };
      destroy: (entry: { canvas: unknown; context: unknown }) => void;
    };
    const canvasFactory = (pdf as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const entry = canvasFactory.create(width, height);
    try {
      await page.render({
        canvas: entry.canvas as unknown as HTMLCanvasElement,
        canvasContext: entry.context as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const buffer = (entry.canvas as { toBuffer: (mime: "image/png") => Buffer }).toBuffer("image/png");
      if (buffer.length >= MIN_PNG_BYTES) png = buffer;
    } finally {
      canvasFactory.destroy(entry);
    }
  } catch {
    png = null;
  }

  return { pageNumber, text, blocks, png, width, height };
}

function expandedPixelBox(
  figure: PdfDetectedFigure,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const marginX = Math.max(pageWidth * 0.025, figure.width * pageWidth * 0.04);
  const marginY = Math.max(pageHeight * 0.018, figure.height * pageHeight * 0.04);
  const left = clamp(figure.x * pageWidth - marginX, 0, pageWidth - 1);
  const top = clamp(figure.y * pageHeight - marginY, 0, pageHeight - 1);
  const right = clamp((figure.x + figure.width) * pageWidth + marginX, left + 1, pageWidth);
  const bottom = clamp((figure.y + figure.height) * pageHeight + marginY, top + 1, pageHeight);
  return {
    x: Math.floor(left),
    y: Math.floor(top),
    width: Math.ceil(right - left),
    height: Math.ceil(bottom - top),
  };
}

function focusRegionsInsideCrop(
  figure: PdfDetectedFigure,
  cropBox: { x: number; y: number; width: number; height: number },
) {
  return figure.focusRegions.map((region) => {
    const pageX = figure.x + region.x * figure.width;
    const pageY = figure.y + region.y * figure.height;
    return {
      label: region.label,
      x: clamp((pageX - cropBox.x) / cropBox.width, 0, 1),
      y: clamp((pageY - cropBox.y) / cropBox.height, 0, 1),
      width: clamp((region.width * figure.width) / cropBox.width, 0, 1),
      height: clamp((region.height * figure.height) / cropBox.height, 0, 1),
    };
  });
}

function sourceBlockIdsNearFigure(
  blocks: SuprnotesContentBlock[],
  figure: PdfDetectedFigure,
): string[] {
  const figureCenterX = figure.x + figure.width / 2;
  const figureCenterY = figure.y + figure.height / 2;
  const ranked = blocks
    .filter((block) => block.bbox)
    .map((block) => {
      const bbox = block.bbox!;
      const centerX = bbox.x + bbox.width / 2;
      const centerY = bbox.y + bbox.height / 2;
      const verticalDistance = Math.abs(centerY - figureCenterY);
      const horizontalDistance = Math.abs(centerX - figureCenterX);
      const immediatelyAbove = centerY <= figure.y && figure.y - centerY < 0.16;
      const score = verticalDistance * 1.7 + horizontalDistance * 0.35 - (immediatelyAbove ? 0.16 : 0);
      return { id: block.id, score };
    })
    .sort((a, b) => a.score - b.score);
  return ranked.slice(0, Math.min(4, ranked.length)).map((item) => item.id);
}

async function cropFigure(
  pageBuffer: Buffer,
  figure: PdfDetectedFigure,
  pageWidth: number,
  pageHeight: number,
  loadImage: (source: Buffer) => Promise<{ width: number; height: number }>,
  createCanvas: (width: number, height: number) => {
    getContext: (kind: "2d") => {
      drawImage: (...args: unknown[]) => void;
      getImageData: (x: number, y: number, width: number, height: number) => { data: Uint8ClampedArray };
    };
    toBuffer: (mime: "image/png") => Buffer;
  },
): Promise<CropResult | null> {
  try {
    const image = await loadImage(pageBuffer);
    let box = expandedPixelBox(figure, pageWidth || image.width, pageHeight || image.height);
    let initial = createCanvas(box.width, box.height);
    let context = initial.getContext("2d");

    // Vision boxes can land through a long label or arrow. Expand only the touched edges until
    // there is a clean page-colored boundary, then trim. This prevents half words and cut legends.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      initial = createCanvas(box.width, box.height);
      context = initial.getContext("2d");
      context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
      const edgePixels = context.getImageData(0, 0, box.width, box.height).data;
      const band = Math.max(2, Math.round(Math.min(box.width, box.height) * 0.006));
      const edgeInkRatio = (edge: "left" | "right" | "top" | "bottom") => {
        let ink = 0;
        let sampled = 0;
        const xStart = edge === "right" ? box.width - band : 0;
        const xEnd = edge === "left" ? band : box.width;
        const yStart = edge === "bottom" ? box.height - band : 0;
        const yEnd = edge === "top" ? band : box.height;
        for (let y = yStart; y < yEnd; y += 1) {
          for (let x = xStart; x < xEnd; x += 1) {
            if ((edge === "left" || edge === "right") && y % 2 !== 0) continue;
            if ((edge === "top" || edge === "bottom") && x % 2 !== 0) continue;
            const offset = (y * box.width + x) * 4;
            sampled += 1;
            if (edgePixels[offset + 3] > 10 && (edgePixels[offset] < 242 || edgePixels[offset + 1] < 242 || edgePixels[offset + 2] < 242)) {
              ink += 1;
            }
          }
        }
        return sampled ? ink / sampled : 0;
      };
      const growLeft = edgeInkRatio("left") > 0.025 && box.x > 0;
      const growRight = edgeInkRatio("right") > 0.025 && box.x + box.width < pageWidth;
      const growTop = edgeInkRatio("top") > 0.025 && box.y > 0;
      const growBottom = edgeInkRatio("bottom") > 0.025 && box.y + box.height < pageHeight;
      if (!growLeft && !growRight && !growTop && !growBottom) break;
      const stepX = Math.max(20, Math.round(pageWidth * 0.035));
      const stepY = Math.max(20, Math.round(pageHeight * 0.025));
      const left = Math.max(0, box.x - (growLeft ? stepX : 0));
      const top = Math.max(0, box.y - (growTop ? stepY : 0));
      const right = Math.min(pageWidth, box.x + box.width + (growRight ? stepX : 0));
      const bottom = Math.min(pageHeight, box.y + box.height + (growBottom ? stepY : 0));
      box = { x: left, y: top, width: right - left, height: bottom - top };
    }

    // Trim only near-white outer rows/columns, then restore padding. This removes page whitespace
    // without risking internal labels, legends, arrowheads, or faint chart axes.
    const pixels = context.getImageData(0, 0, box.width, box.height).data;
    let minX = box.width;
    let minY = box.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < box.height; y += 1) {
      for (let x = 0; x < box.width; x += 1) {
        const offset = (y * box.width + x) * 4;
        if (pixels[offset + 3] > 10 && (pixels[offset] < 247 || pixels[offset + 1] < 247 || pixels[offset + 2] < 247)) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX < minX || maxY < minY) return null;
    const padding = Math.max(14, Math.round(Math.min(box.width, box.height) * 0.018));
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(box.width - 1, maxX + padding);
    maxY = Math.min(box.height - 1, maxY + padding);
    const finalWidth = maxX - minX + 1;
    const finalHeight = maxY - minY + 1;
    const finalCanvas = createCanvas(finalWidth, finalHeight);
    finalCanvas.getContext("2d").drawImage(
      initial,
      minX,
      minY,
      finalWidth,
      finalHeight,
      0,
      0,
      finalWidth,
      finalHeight,
    );
    const buffer = finalCanvas.toBuffer("image/png");
    if (buffer.length < MIN_PNG_BYTES) return null;
    return {
      buffer,
      width: finalWidth,
      height: finalHeight,
      cropBox: {
        x: (box.x + minX) / pageWidth,
        y: (box.y + minY) / pageHeight,
        width: finalWidth / pageWidth,
        height: finalHeight / pageHeight,
      },
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
    return NextResponse.json({ error: "No PDF uploaded." }, { status: 400 });
  }
  const fileObj = file as File;
  if (!fileObj.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only .pdf files are supported." }, { status: 400 });
  }
  if (fileObj.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large. Maximum size is 20 MB." }, { status: 413 });
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const canvasModule = await import("@napi-rs/canvas");
  const openaiKey = process.env.OPENAI_API_KEY;
  const visionEnabled = process.env.PDF_VISION_ENABLED !== "0";
  const client = openaiKey && visionEnabled ? new OpenAI({ apiKey: openaiKey }) : null;

  let uploadedBytes: Uint8Array;
  let pythonBytes: Uint8Array;
  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    const buffer = await fileObj.arrayBuffer();
    uploadedBytes = new Uint8Array(buffer);
    pythonBytes = new Uint8Array(uploadedBytes);
    pdf = await pdfjs.getDocument({ data: uploadedBytes, verbosity: 0 }).promise;
  } catch {
    return NextResponse.json({ error: "Could not read this PDF. Make sure the file is valid." }, { status: 422 });
  }

  if (pdf.numPages < 1) {
    return NextResponse.json({ error: "No pages found in the PDF." }, { status: 422 });
  }
  if (pdf.numPages > MAX_PAGES) {
    return NextResponse.json({ error: `PDF has ${pdf.numPages} pages; the current limit is ${MAX_PAGES}.` }, { status: 413 });
  }

  let metadataTitle = "";
  try {
    const metadata = await pdf.getMetadata();
    metadataTitle = clean((metadata.info as { Title?: string } | undefined)?.Title, 120);
  } catch {
    metadataTitle = "";
  }

  const pythonPages = await renderPdfWithPython(pythonBytes);
  const pageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
  const renderedPages: RenderedPage[] = pythonPages?.length === pdf.numPages
    ? pythonPages.map((page) => ({
        pageNumber: page.pageNumber,
        text: page.text,
        blocks: structurePdfPage(page.spans, page.pageNumber, page.pageWidth, page.pageHeight),
        png: page.png,
        width: page.width,
        height: page.height,
      }))
    : await mapLimit(pageNumbers, PAGE_CONCURRENCY, (pageNumber) => renderPage(pdf, pageNumber));
  const pageResults = await mapLimit(renderedPages, PAGE_CONCURRENCY, async (page) => {
    const pageBlocks = [...page.blocks];
    const pageAssets: SuprnotesAsset[] = [];
    let figures: PdfDetectedFigure[] = [];

    if (page.png && client) {
      const dataUrl = `data:image/png;base64,${page.png.toString("base64")}`;
      figures = await detectFigures(client, dataUrl);
    } else if (page.png && !page.text) {
      // Image-only/scanned pages remain teachable even if Vision is unavailable. The whole page is
      // preserved because there is no separately extractable text to duplicate on the board.
      figures = [{
        type: "other",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        caption: `Page ${page.pageNumber}`,
        description: "Complete image-only PDF page.",
        focusRegions: [],
        instructionalPriority: "high",
        useInLesson: true,
        annotationNeeded: false,
      }];
    }

    if (!pageBlocks.length && figures.length) {
      pageBlocks.push({
        id: `p${page.pageNumber}-visual`,
        type: "image-reference",
        heading: `Page ${page.pageNumber}`,
        text: figures.map((figure) => figure.caption || figure.description).filter(Boolean).join(". "),
        sourceOrder: 0,
        pageNumber: page.pageNumber,
        role: "visual",
      });
    }
    const verifiedCrops = page.png ? await cropFiguresWithPython(page.png, figures) : null;
    const verifiedByIndex = new Map((verifiedCrops ?? []).map((crop) => [crop.index, crop]));
    if (page.png) {
      for (let index = 0; index < figures.length; index += 1) {
        const figure = figures[index];
        const verified = verifiedByIndex.get(index);
        const crop = verified
          ? {
              buffer: verified.buffer,
              width: verified.width,
              height: verified.height,
              cropBox: verified.bbox,
            }
          : await cropFigure(
              page.png,
              figure,
              page.width,
              page.height,
              canvasModule.loadImage as unknown as (source: Buffer) => Promise<{ width: number; height: number }>,
              canvasModule.createCanvas as unknown as Parameters<typeof cropFigure>[5],
            );
        if (!crop) continue;
        const id = `p${page.pageNumber}-figure-${index + 1}`;
        const focusRegions = focusRegionsInsideCrop(figure, crop.cropBox);
        const labels = focusRegions.map((region) => region.label).filter(Boolean);
        const sourceBlockIds = sourceBlockIdsNearFigure(pageBlocks, figure);
        pageAssets.push({
          id,
          type: "image",
          mimeType: "image/png",
          url: `data:image/png;base64,${crop.buffer.toString("base64")}`,
          width: crop.width,
          height: crop.height,
          caption: figure.caption || `${figure.type} from page ${page.pageNumber}`,
          description: figure.description,
          sourceBlockIds,
          pageNumber: page.pageNumber,
          visualType: figure.type,
          bbox: crop.cropBox,
          visionVerified: Boolean(client),
          teachingUse: {
            kind: "pdf-figure",
            focusRegions,
            suggestedCallouts: labels,
            sourcePage: page.pageNumber,
            instructionalPriority: figure.instructionalPriority,
            useInLesson: figure.useInLesson,
            annotationNeeded: figure.annotationNeeded,
            ocrVerified: verified?.ocrVerified === true,
          },
        });
        for (const block of pageBlocks) {
          if (!sourceBlockIds.includes(block.id)) continue;
          block.assetIds = [...new Set([...(block.assetIds ?? []), id])];
        }
      }
    }

    return { ...page, blocks: pageBlocks, assets: pageAssets };
  });

  const contentBlocks = pageResults.flatMap((page) => page.blocks);
  const assets = pageResults.flatMap((page) => page.assets);
  if (!contentBlocks.length) {
    return NextResponse.json({ error: "No readable text or teachable visuals were found in this PDF." }, { status: 422 });
  }
  applyGlobalSourceOrder(contentBlocks);

  const title =
    metadataTitle ||
    titleFromText(pageResults[0]?.text ?? "") ||
    fileObj.name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
  const lessonPlan = buildPdfLessonPlan(contentBlocks, assets);
  const sourceDocument: SuprnotesLessonInput = {
    schemaVersion: "suprnotes.lesson_input.v1",
    source: {
      adapter: "pdf-upload",
      generatedAt: new Date().toISOString(),
      fileName: fileObj.name,
      pageCount: pdf.numPages,
      extractionVersion: "pdf-multistage-animated-v4",
      renderPipeline: pythonPages?.length === pdf.numPages
        ? `pymupdf-${Number(process.env.PDF_RENDER_DPI ?? 400)}dpi-opencv-tesseract`
        : "pdfjs-canvas-fallback",
    },
    lesson: {
      title,
      subject: title,
      language: "en",
      estimatedTeachingMinutes: Math.max(5, lessonPlan.beats.length * 2),
    },
    generationDirectives: {
      imagePolicy: "use_provided_images_only",
      disableAiImageGeneration: true,
      preferredLectureStyle: "semantic_prompt_quality",
      preserveExistingLecturePrompting: true,
      visualUsage: {
        explainEveryExtractedVisual: true,
        progressiveAnnotation: true,
        maintainAspectRatio: true,
      },
    },
    contentGovernance: {
      groundingPolicy: "strict_provided_content_only",
      hallucinationPolicy: "omit_unsupported",
      allowedSourceTypes: ["uploaded_pdf"],
      requireClaimSourceTags: true,
    },
    webPreview: { status: "not_requested" },
    assets,
    contentBlocks,
    lessonPlan,
    suggestedLecturePlan: lessonPlan,
  };

  return NextResponse.json({
    sourceDocument,
    title,
    pageCount: pdf.numPages,
    blockCount: contentBlocks.length,
    assetCount: assets.length,
    figureCount: assets.length,
    warnings: client ? [] : ["PDF visual detection was unavailable; image-only pages were preserved in full."],
  });
}
