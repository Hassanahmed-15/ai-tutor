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
import {
  planTranscription, pixelRect, assembleTranscript, blocksFromTranscript, TRANSCRIBE_PROMPT,
  type PageRegion, type TranscriptPart,
} from "@/lib/pdfOcr";
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

// "high" gives tighter, more accurate figure coordinates (the crop quality the user cares about);
// overridable to "low" via PDF_VISION_DETAIL to save tokens.
const VISION_DETAIL = process.env.PDF_VISION_DETAIL === "low" ? "low" : "high";

/** Compact list of the page's TEXT rectangles (normalized), so the model excludes body text and
 *  returns figure boxes that live in the gaps between text — not paragraphs mistaken for figures. */
function textRegionsHint(textRegions: Array<{ x: number; y: number; width: number; height: number }>): string {
  if (!textRegions.length) return "";
  const boxes = textRegions
    .slice(0, 40)
    .map((r) => `[${r.x.toFixed(3)},${r.y.toFixed(3)},${r.width.toFixed(3)},${r.height.toFixed(3)}]`)
    .join(" ");
  return `\n\nThe following normalized [x,y,width,height] rectangles are TEXT already extracted from this page — they are NOT figures. Do not return any figure box that merely covers one of these text rectangles; real figures sit in the space between them:\n${boxes}`;
}

// Genuine graphical artifacts worth cropping and showing the student.
const ARTIFACT_TYPES = new Set(["diagram", "chart", "graph", "table", "flowchart", "formula", "map", "illustration", "photo"]);
// Types whose value is graphical/structural, so a box that is almost entirely text is really a
// paragraph the detector mistook for a figure. Tables and formulas are inherently text, so they are
// exempt from this text-coverage rejection.
const PROSE_IF_TEXT_HEAVY = new Set(["diagram", "chart", "graph", "flowchart", "map", "illustration", "photo"]);

/** Fraction of `box` (page-normalized) covered by the union of extracted text rectangles. */
function textCoverageOfBox(
  box: { x: number; y: number; width: number; height: number },
  textRegions: Array<{ x: number; y: number; width: number; height: number }>,
): number {
  const area = box.width * box.height;
  if (area <= 0) return 0;
  let covered = 0;
  for (const region of textRegions) {
    const xOverlap = Math.max(0, Math.min(box.x + box.width, region.x + region.width) - Math.max(box.x, region.x));
    const yOverlap = Math.max(0, Math.min(box.y + box.height, region.y + region.height) - Math.max(box.y, region.y));
    covered += xOverlap * yOverlap;
  }
  return Math.min(1, covered / area);
}

/**
 * Deterministic guard against the failure the user reported: cropping whole pages / body text
 * instead of real artifacts. Keeps only recognized artifact types, drops near-whole-page grabs, and
 * drops graphical-type boxes that are almost entirely running text (a paragraph, not a figure).
 */
function keepArtifactFigures(
  figures: PdfDetectedFigure[],
  textRegions: Array<{ x: number; y: number; width: number; height: number }>,
): PdfDetectedFigure[] {
  return figures.filter((figure) => {
    if (!ARTIFACT_TYPES.has(figure.type)) return false;
    if (figure.width * figure.height >= 0.9) return false; // whole-page grab
    if (PROSE_IF_TEXT_HEAVY.has(figure.type) && textCoverageOfBox(figure, textRegions) > 0.7) return false;
    return true;
  });
}

/**
 * Second-opinion vision pass on the ACTUAL crop. Page-level detection can be fooled by a nearby
 * caption (e.g. a two-column prose block sitting under a "TABLE III" heading gets boxed as a table).
 * Here the model sees only the cropped pixels — no surrounding caption to mislead it — and decides
 * whether the crop is a real standalone graphical artifact or just running text. Returns the kept
 * flag plus a possibly-corrected type.
 */
async function verifyCropIsArtifact(
  client: OpenAI,
  pngBuffer: Buffer,
  claimedType: PdfDetectedFigure["type"],
): Promise<{ keep: boolean; type: PdfDetectedFigure["type"] }> {
  try {
    const completion = await client.chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 200,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${pngBuffer.toString("base64")}`, detail: "high" } },
          {
            type: "text",
            text: `This is a single image cropped from a PDF. Judge ONLY the pixels shown, ignoring any assumption from a title.

Decide if it is a genuine standalone graphical artifact worth showing a student on its own:
- a real DATA TABLE with a visible grid of rows AND columns (not just paragraphs in two columns),
- a chart, graph, or plot with axes/bars/lines/points,
- a diagram, flowchart, labeled illustration, map, or a displayed mathematical equation/formula,
- a meaningful photo/figure.

REJECT it (keep=false) if the crop is actually just paragraphs, sentences, a numbered or bulleted list, a heading/title, references, or running text — even if it is arranged in columns and even if a caption calls it a "table". A numbered list of text items is NOT a table.

Return JSON only: { "keep": true|false, "type": "table|chart|graph|diagram|flowchart|illustration|formula|map|photo|other", "reason": "<=8 words" }`,
          },
        ],
      }],
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { keep?: unknown; type?: unknown };
    const keep = parsed.keep === true;
    const type = typeof parsed.type === "string" && ARTIFACT_TYPES.has(parsed.type)
      ? (parsed.type as PdfDetectedFigure["type"])
      : claimedType;
    return { keep, type };
  } catch (error) {
    // On a verification failure, keep the crop (fail open) so a transient error never drops a real
    // figure — the page-level detector + deterministic filter already screened it once.
    console.error(`[pdf] crop verification failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return { keep: true, type: claimedType };
  }
}

async function detectFigures(
  client: OpenAI,
  dataUrl: string,
  textRegions: Array<{ x: number; y: number; width: number; height: number }> = [],
): Promise<PdfDetectedFigure[]> {
  try {
    const completion = await client.chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 2_400,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl, detail: VISION_DETAIL } },
          {
            type: "text",
            text: `Inspect this rendered PDF page and locate ONLY genuine graphical artifacts: a scientific diagram, chart, graph, plot, table with a visible row/column grid, flowchart, labeled illustration, displayed equation/formula, map, or photo/figure. Precision matters far more than recall — it is better to return nothing than to box ordinary text.

DO NOT box any of these, even when they sit inside a border, colored panel, or column: running prose/paragraphs, sentences, bullet lists, section headers, titles, author/affiliation lines, page numbers, captions on their own, references, or the whole page. A region that is mostly words in sentence form is NOT a figure. A table only counts if it has a real gridded structure of rows and columns.

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
- Return an empty figures array when the page is only text — that is the correct and common answer for a prose page.
- Give 1-8 focus regions for visible parts worth pointing to while teaching; do not invent parts.${textRegionsHint(textRegions)}`,
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

    /**
     * Two INDEPENDENT copies, not two views of one buffer.
     *
     * `pdfjs.getDocument({ data })` takes ownership of the array it is given and detaches the
     * underlying ArrayBuffer once parsing begins. `new Uint8Array(uploadedBytes)` copies the
     * elements but, when both are built from the same ArrayBuffer, the detach still empties what
     * the Python pipeline later reads — so rendering silently receives zero bytes.
     *
     * Slicing the ArrayBuffer gives each consumer its own memory. A PDF here is at most 20 MB, so
     * the duplicate is cheap next to a parse that already costs tens of seconds.
     */
    uploadedBytes = new Uint8Array(buffer.slice(0));
    pythonBytes = new Uint8Array(buffer.slice(0));

    /**
     * `useWorkerFetch: false` + `isEvalSupported: false` keep pdfjs on the main thread.
     *
     * pdfjs spawns a worker by default and resolves it relative to its own module — a path that
     * exists in node_modules but NOT in Next's standalone bundle, which traces only the modules it
     * can see imported. In production that surfaced as:
     *
     *   Setting up fake worker failed: Cannot find module
     *   '/app/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
     *
     * …on every upload, while working locally where the full node_modules is present.
     *
     * A worker buys nothing here regardless: this is a server route that already runs off the
     * request thread, and parsing is bounded by the vision calls that follow, not by pdfjs.
     */
    pdf = await pdfjs.getDocument({
      data: uploadedBytes,
      verbosity: 0,
      useWorkerFetch: false,
    }).promise;
  } catch (error) {
    // Report WHY. A bare catch here turned every distinct failure — an encrypted file, a truncated
    // upload, a detached buffer — into the same "make sure the file is valid", which is unhelpful
    // to the student and actively misleading during debugging, because the file usually IS valid.
    const detail = error instanceof Error ? error.message : "";
    console.error(`[parse-pdf] could not open document: ${detail || "unknown error"}`);
    const encrypted = /password|encrypt/i.test(detail);
    return NextResponse.json(
      {
        error: encrypted
          ? "This PDF is password-protected. Remove the password and upload it again."
          : `Could not read this PDF${detail ? `: ${detail}` : ". Make sure the file is valid."}`,
      },
      { status: 422 },
    );
  }

  if (pdf.numPages < 1) {
    return NextResponse.json({ error: "No pages found in the PDF." }, { status: 422 });
  }

  let metadataTitle = "";
  try {
    const metadata = await pdf.getMetadata();
    metadataTitle = clean((metadata.info as { Title?: string } | undefined)?.Title, 120);
  } catch {
    metadataTitle = "";
  }

  const pythonPages = await renderPdfWithPython(pythonBytes);

  /**
   * Optional page scoping.
   *
   * `pages` is a comma-separated list of 1-based page numbers. When present, everything downstream
   * — text extraction, figure cropping, vision calls — sees only those pages, so a student asking
   * about the method section of a 40-page paper does not pay for the other 37 pages or get a
   * lesson diluted by them.
   *
   * Absent or empty means the whole document, which is the existing behaviour and stays the
   * default: every current caller is unaffected. Out-of-range and duplicate values are dropped
   * rather than rejected, because a stale selection should degrade to "use everything" rather
   * than fail an upload the student already waited for.
   */
  const requestedPages = String(formData.get("pages") ?? "")
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= pdf.numPages);
  const scopedPages = [...new Set(requestedPages)].sort((a, b) => a - b);

  /**
   * Regions the student drew on the page thumbnails, in normalised (0-1) coordinates.
   *
   * Normalised because the selector draws on a thumbnail and the server crops a full-resolution
   * render; passing pixels would crop the wrong part of the page the first time either size changed.
   */
  let regions: PageRegion[] = [];
  try {
    const raw = formData.get("regions");
    if (typeof raw === "string" && raw.trim()) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        regions = parsed
          .filter((r): r is PageRegion => !!r && typeof r === "object" && typeof (r as PageRegion).page === "number")
          .map((r) => ({ page: r.page, rect: r.rect }));
      }
    }
  } catch {
    // A malformed regions field means "no region", not a failed upload: the student still gets the
    // whole-page transcription, which is the same thing they would have got by not drawing one.
  }

  const pageNumbers = scopedPages.length > 0
    ? scopedPages
    : Array.from({ length: pdf.numPages }, (_, index) => index + 1);

  /**
   * The limit applies to pages actually PROCESSED, not to the document's length.
   *
   * It used to reject the upload outright on numPages, which made a 108-page book unusable even
   * to ask about three of its pages — and page selection now exists precisely so that a long
   * document can be used. What the limit really protects is cost and runtime: every processed page
   * is rendered, cropped and sent to a vision model. Scoped requests are bounded by the selection,
   * so only an unscoped long document needs refusing, and the message now says how to proceed
   * instead of just saying no.
   */
  if (pageNumbers.length > MAX_PAGES) {
    return NextResponse.json(
      {
        error: `This PDF has ${pdf.numPages} pages, and up to ${MAX_PAGES} can be processed at once. Select the pages you want and try again.`,
      },
      { status: 413 },
    );
  }
  // The Python renderer always rasterises the whole document (one process is cheaper than one per
  // page), so the scope has to be applied to its OUTPUT. Filtering here rather than only in
  // `pageNumbers` matters: without it a scoped request would still run cropping and vision over
  // every page, which is exactly the cost the selection exists to avoid.
  const renderedPages: RenderedPage[] = pythonPages?.length === pdf.numPages
    ? pythonPages
        .filter((page) => pageNumbers.includes(page.pageNumber))
        .map((page) => ({
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
    // Normalized rectangles of the page's extracted TEXT — handed to the vision detector (so it
    // excludes paragraphs) AND to the Python cropper (so a crop never grows across body text).
    const textRegions = pageBlocks
      .map((block) => block.bbox)
      .filter((bbox): bbox is { x: number; y: number; width: number; height: number } =>
        Boolean(bbox) && [bbox!.x, bbox!.y, bbox!.width, bbox!.height].every((v) => typeof v === "number"));

    if (page.png && client) {
      const dataUrl = `data:image/png;base64,${page.png.toString("base64")}`;
      figures = keepArtifactFigures(await detectFigures(client, dataUrl, textRegions), textRegions);
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
    const verifiedCrops = page.png ? await cropFiguresWithPython(page.png, figures, textRegions) : null;
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
        // Second-opinion pass on the crop itself: rejects prose that page-level detection mislabeled
        // as a table/figure because of a nearby caption. Skipped when Vision is unavailable.
        const verdict = client
          ? await verifyCropIsArtifact(client, crop.buffer, figure.type)
          : { keep: true, type: figure.type };
        if (!verdict.keep) continue;
        const resolvedType = verdict.type;
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
          caption: figure.caption || `${resolvedType} from page ${page.pageNumber}`,
          description: figure.description,
          sourceBlockIds,
          pageNumber: page.pageNumber,
          visualType: resolvedType,
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

  /**
   * READ THE PIXELS.
   *
   * Text extraction returns the text objects a PDF declares, and on a real paper that is often only
   * the captions: measured on this repo's AblationStudy_V3.pdf, page 4 declares 985 characters, all
   * of them "Fig. N: ..." lines, while the three images they refer to carry the actual content — the
   * correlation matrix, the axis labels, the distributions. A student asking about that figure was
   * being answered from its caption.
   *
   * So the region the student pointed at is transcribed from the RENDERED PAGE, which is the only
   * representation that contains everything they can see. A drawn region is cropped exactly; with no
   * region, the selected pages are read whole; with no selection at all, nothing is read, because
   * that request is already served by the whole-document lecture.
   */
  const extractedBlocks = pageResults.flatMap((page) => page.blocks);

  /*
   * A document with NO extractable text must be read, not refused.
   *
   * A scanned or image-only PDF produces no text objects, so this used to return "No readable text
   * or teachable visuals were found in this PDF" — turning away the one kind of document that can
   * only be read by looking at it. When extraction comes back empty, every page the student chose
   * is transcribed regardless of the usual cost rule, because there is no cheaper way to read it
   * and the alternative is the upload failing.
   */
  const requested = planTranscription(scopedPages, regions);
  const transcriptionPlan = requested.length > 0
    ? requested
    : extractedBlocks.length === 0
      ? planTranscription(renderedPages.map((page) => page.pageNumber), [])
      : [];
  const transcriptParts: TranscriptPart[] = client && transcriptionPlan.length > 0
    ? (await mapLimit(transcriptionPlan, PAGE_CONCURRENCY, async (target): Promise<TranscriptPart | null> => {
        const page = renderedPages.find((p) => p.pageNumber === target.page);
        if (!page) return null;

        // A page rendered without a PNG cannot be read; skip it rather than crop nothing.
        if (!page.png) return null;
        let png: Buffer = page.png;
        if (target.rect) {
          const box = pixelRect(target.rect, page.width, page.height);
          const source = await canvasModule.loadImage(page.png);
          const surface = canvasModule.createCanvas(box.width, box.height);
          surface.getContext("2d").drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
          png = surface.toBuffer("image/png");
        }

        try {
          const completion = await client.chat.completions.create({
            model: VISION_MODEL,
            max_tokens: 2000,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: TRANSCRIBE_PROMPT },
                { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}`, detail: "high" } },
              ],
            }],
          });
          return { page: target.page, rect: target.rect, text: completion.choices[0]?.message?.content ?? "" };
        } catch {
          // One unreadable page must not lose the others, or a transient failure on page 3 throws
          // away a transcription of the page the student actually asked about.
          return null;
        }
      })).filter((part): part is TranscriptPart => part !== null)
    : [];

  const ocrTranscript = assembleTranscript(transcriptParts);

  const contentBlocks = [
    ...extractedBlocks,
    // Blocks read off the pixels, used when extraction found nothing at all. On a document that
    // does have text, the transcript is still carried separately as the focus passage — it does not
    // need to be duplicated into the block list as well.
    ...(extractedBlocks.length === 0 ? blocksFromTranscript(transcriptParts) : []),
  ];
  const assets = pageResults.flatMap((page) => page.assets);
  if (!contentBlocks.length) {
    return NextResponse.json(
      {
        error: client
          ? "Nothing could be read from this PDF — no text, no figures, and the pages could not be transcribed."
          : "No readable text was found in this PDF, and image reading is unavailable (no OPENAI_API_KEY).",
      },
      { status: 422 },
    );
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
    /**
     * What was read off the rendered pages, and the pages it came from.
     *
     * Empty when nothing was transcribed — no selection and no region — which the caller treats as
     * "use the document as before" rather than as a failure.
     */
    ocrTranscript,
    ocrPages: transcriptParts.map((p) => p.page),
    title,
    pageCount: pdf.numPages,
    // Which pages this parse actually covered. Equals every page unless the caller scoped the
    // request; surfaced so the UI can say "built from pages 3, 7, 8" rather than implying the
    // whole document was read.
    pagesUsed: pageNumbers,
    blockCount: contentBlocks.length,
    assetCount: assets.length,
    figureCount: assets.length,
    warnings: client ? [] : ["PDF visual detection was unavailable; image-only pages were preserved in full."],
  });
}
