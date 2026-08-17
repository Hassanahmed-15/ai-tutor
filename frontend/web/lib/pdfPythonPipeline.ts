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
  }>;
};

type CropManifest = {
  crops?: Array<{
    index?: number;
    path?: string;
    width?: number;
    height?: number;
    bbox?: { x?: number; y?: number; width?: number; height?: number };
    ocrVerified?: boolean;
  }>;
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
): Promise<PythonRenderedPage[] | null> {
  if (process.env.PDF_PYTHON_PIPELINE === "0") return null;
  const directory = await mkdtemp(path.join(os.tmpdir(), "aria-pdf-render-"));
  try {
    const inputPath = path.join(directory, "input.pdf");
    await writeFile(inputPath, pdfBytes);
    await runPython(["render", "--input", inputPath, "--output-dir", directory, "--dpi", String(dpi)]);
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

export async function cropFiguresWithPython(
  pagePng: Buffer,
  figures: PdfDetectedFigure[],
  textBoxes: Array<{ x: number; y: number; width: number; height: number }> = [],
): Promise<PythonCrop[] | null> {
  if (process.env.PDF_PYTHON_PIPELINE === "0" || !figures.length) return null;
  const directory = await mkdtemp(path.join(os.tmpdir(), "aria-pdf-crop-"));
  try {
    const pagePath = path.join(directory, "page.png");
    const regionsPath = path.join(directory, "regions.json");
    await writeFile(pagePath, pagePng);
    await writeFile(regionsPath, JSON.stringify({
      regions: figures.map(({ x, y, width, height }) => ({ x, y, width, height })),
      // The cropper uses these to stop box-expansion at body-text boundaries so a figure crop
      // never swallows adjacent paragraphs.
      textBoxes: textBoxes.map(({ x, y, width, height }) => ({ x, y, width, height })),
    }));
    await runPython(["crop", "--page", pagePath, "--regions", regionsPath, "--output-dir", directory]);
    const manifest = JSON.parse(await readFile(path.join(directory, "crops.json"), "utf8")) as CropManifest;
    return Promise.all((manifest.crops ?? []).flatMap((crop) => {
      if (
        !crop.path ||
        typeof crop.index !== "number" ||
        !crop.bbox ||
        ![crop.bbox.x, crop.bbox.y, crop.bbox.width, crop.bbox.height].every((value) => Number.isFinite(value))
      ) return [];
      return [readFile(path.join(directory, crop.path)).then((buffer) => ({
        index: crop.index as number,
        buffer,
        width: Number(crop.width) || 1,
        height: Number(crop.height) || 1,
        bbox: {
          x: Number(crop.bbox!.x),
          y: Number(crop.bbox!.y),
          width: Number(crop.bbox!.width),
          height: Number(crop.bbox!.height),
        },
        ocrVerified: crop.ocrVerified === true,
      }))];
    }));
  } catch (error) {
    console.error(`[pdf-python] crop fallback: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
