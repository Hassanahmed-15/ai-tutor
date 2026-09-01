import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PdfDetectedFigure, PdfTextSpan } from "./pdfLessonPipeline";
import { appPath } from "./appPaths";

const execFileAsync = promisify(execFile);
const PYTHON = process.env.PDF_PYTHON_BINARY ?? "python3";
const SCRIPT = appPath("scripts", "pdf_pipeline.py");
const DPI = Math.max(300, Math.min(600, Number(process.env.PDF_RENDER_DPI ?? 400)));

/**
 * Resolution of the page image handed to the lecture model.
 *
 * 110 DPI puts a Letter page at roughly 935x1210. A vision model rescales anything larger to a
 * 768px short edge before tiling it, so a bigger render costs identical tokens and only buys
 * transfer size — while a smaller one starts losing body text, which is the one thing this image
 * exists to let the model read.
 */
export const VISION_DPI = Math.max(60, Math.min(200, Number(process.env.PDF_VISION_PAGE_DPI ?? 110)));

type RenderManifest = {
  pages?: Array<{
    pageNumber?: number;
    path?: string;
    width?: number;
    height?: number;
    pageWidth?: number;
    pageHeight?: number;
    text?: string;
    spans?: PdfTextSpan[];
    visionPath?: string;
    visionMime?: string;
    visionWidth?: number;
    visionHeight?: number;
  }>;
};

type CropManifest = {
  crops?: Array<{
    index?: number;
    pageIndex?: number;
    path?: string;
    width?: number;
    height?: number;
    bbox?: { x?: number; y?: number; width?: number; height?: number };
    ocrVerified?: boolean;
  }>;
};

/** One page's cropping job: the rendered page, its detected figures, and its body-text boxes. */
export type CropPageJob = {
  pagePng: Buffer;
  figures: PdfDetectedFigure[];
  textBoxes: Array<{ x: number; y: number; width: number; height: number }>;
};

export type PythonRenderedPage = {
  pageNumber: number;
  png: Buffer;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  text: string;
  spans: PdfTextSpan[];
  /** The small copy meant for a vision model. Null when the caller did not ask for one. */
  visionImage: Buffer | null;
  visionMime: string;
};

export type PythonCrop = {
  index: number;
  buffer: Buffer;
  width: number;
  height: number;
  bbox: { x: number; y: number; width: number; height: number };
  ocrVerified: boolean;
};

async function runPython(args: string[]): Promise<void> {
  await execFileAsync(PYTHON, [SCRIPT, ...args], {
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
}

/**
 * @param dpi Render resolution. Defaults to the full-quality DPI used by the lesson pipeline.
 *   Thumbnail callers pass something much lower — rendering small is far cheaper than rendering
 *   at 400 DPI and downscaling afterwards, and it avoids pulling in a native image library just
 *   to resize (which is its own deployment risk, as @tailwindcss/oxide demonstrated).
 */
export async function renderPdfWithPython(
  pdfBytes: Uint8Array,
  dpi: number = DPI,
  visionDpi: number = 0,
): Promise<PythonRenderedPage[] | null> {
  if (process.env.PDF_PYTHON_PIPELINE === "0") return null;
  const directory = await mkdtemp(path.join(os.tmpdir(), "aria-pdf-render-"));
  try {
    const inputPath = path.join(directory, "input.pdf");
    await writeFile(inputPath, pdfBytes);
    await runPython([
      "render", "--input", inputPath, "--output-dir", directory, "--dpi", String(dpi),
      "--vision-dpi", String(Math.max(0, Math.round(visionDpi))),
    ]);
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as RenderManifest;
    const pages = await Promise.all((manifest.pages ?? []).map(async (page, index) => {
      if (!page.path) throw new Error(`Missing rendered path for page ${index + 1}.`);
      return {
        pageNumber: Number(page.pageNumber) || index + 1,
        png: await readFile(path.join(directory, page.path)),
        width: Number(page.width) || 1,
        height: Number(page.height) || 1,
        pageWidth: Number(page.pageWidth) || 1,
        pageHeight: Number(page.pageHeight) || 1,
        text: typeof page.text === "string" ? page.text : "",
        spans: Array.isArray(page.spans) ? page.spans : [],
        // A missing vision image is normal (thumbnail callers pass 0) and never fatal.
        visionImage: page.visionPath
          ? await readFile(path.join(directory, page.visionPath)).catch(() => null)
          : null,
        visionMime: typeof page.visionMime === "string" ? page.visionMime : "image/jpeg",
      };
    }));
    return pages;
  } catch (error) {
    console.error(`[pdf-python] render fallback: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Crop every page's figures in ONE Python process.
 *
 * The per-page function below spawns an interpreter each time, and importing cv2, fitz, numpy and
 * pytesseract costs about 1.4 seconds — so a nine-page document spent roughly twelve seconds doing
 * nothing but starting Python, for work that takes milliseconds once the modules are loaded.
 *
 * Returns crops grouped per input page, positionally aligned with `jobs`, so a caller can map them
 * straight back to the figures it passed in. A page whose crops failed comes back as an empty array
 * rather than shifting every later page's results.
 */
export async function cropFigurePagesWithPython(
  jobs: CropPageJob[],
): Promise<PythonCrop[][] | null> {
  if (process.env.PDF_PYTHON_PIPELINE === "0") return null;
  if (!jobs.some((job) => job.figures.length > 0)) return null;

  const directory = await mkdtemp(path.join(os.tmpdir(), "aria-pdf-crop-"));
  try {
    const manifest = await Promise.all(jobs.map(async (job, index) => {
      const name = `page-${index}.png`;
      await writeFile(path.join(directory, name), job.pagePng);
      return {
        path: name,
        regions: job.figures.map(({ x, y, width, height }) => ({ x, y, width, height })),
        // Used to stop box-expansion at body-text boundaries so a crop never swallows a paragraph.
        textBoxes: job.textBoxes.map(({ x, y, width, height }) => ({ x, y, width, height })),
      };
    }));
    const regionsPath = path.join(directory, "regions.json");
    await writeFile(regionsPath, JSON.stringify({ pages: manifest }));
    await runPython(["crop", "--regions", regionsPath, "--output-dir", directory]);

    const parsed = JSON.parse(await readFile(path.join(directory, "crops.json"), "utf8")) as CropManifest;
    const grouped: PythonCrop[][] = jobs.map(() => []);
    await Promise.all((parsed.crops ?? []).map(async (crop) => {
      const pageIndex = Number(crop.pageIndex);
      if (
        !crop.path ||
        typeof crop.index !== "number" ||
        !Number.isInteger(pageIndex) ||
        pageIndex < 0 ||
        pageIndex >= grouped.length ||
        !crop.bbox ||
        ![crop.bbox.x, crop.bbox.y, crop.bbox.width, crop.bbox.height].every((value) => Number.isFinite(value))
      ) return;
      grouped[pageIndex].push({
        index: crop.index,
        buffer: await readFile(path.join(directory, crop.path)),
        width: Number(crop.width) || 1,
        height: Number(crop.height) || 1,
        bbox: {
          x: Number(crop.bbox.x),
          y: Number(crop.bbox.y),
          width: Number(crop.bbox.width),
          height: Number(crop.bbox.height),
        },
        ocrVerified: crop.ocrVerified === true,
      });
    }));
    return grouped;
  } catch (error) {
    console.error(`[pdf-python] batched crop fallback: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
