import "server-only";
import { PDFDocument } from "pdf-lib";
import { parsePdfForm } from "@/lib/parsePdf";
import { dropDocumentImages } from "@/lib/pageImageStore";
import { withSpendScope } from "@/lib/spend/scope";
import { getFile, putJson } from "./store";
import { names, readSlot, writeSlot } from "./session";
import type { CaptureSession } from "./rules";

/**
 * READING ONE PHOTO, the moment it arrives. The straightened photo becomes a one-page PDF and is read by the very
 * parser a PDF upload uses (lib/parsePdf.ts): a photo has no text layer, so it takes the scanned-page path —
 * transcription, Tesseract's line boxes, figures found and cropped with their labels. The page is sized so its long
 * side is 792 pt (a Letter page): the parser's 400-DPI render and 110-DPI vision copy are then the sizes a scanned
 * page gets. The result is kept as `p<n>-v<k>-result.json`, and the slot is marked ready only if it still holds
 * this version — a retake made meanwhile wins.
 *
 * At most CAPTURE_READ_CONCURRENCY reads run at once in a process (default 2): each holds a 400-DPI page, a
 * Python render and Tesseract, and six at once would not fit this machine's memory. Photos arrive seconds apart,
 * so the queue keeps up.
 */

export type PageResult = {
  sourceDocument?: unknown;
  title?: string;
  fullDocumentText?: string;
  ocrTranscript?: string;
  costUsd?: number;
  warnings?: string[];
};

const LIMIT = Math.max(1, Number(process.env.CAPTURE_READ_CONCURRENCY ?? 2));
const READS_KEY = Symbol.for("aria.captureReads");
type ReadState = { running: number; queue: Array<() => void>; inFlight: Map<string, Promise<PageResult | null>> };
const globalRef = globalThis as unknown as Record<symbol, ReadState>;
const reads: ReadState = globalRef[READS_KEY] ?? { running: 0, queue: [], inFlight: new Map() };
globalRef[READS_KEY] = reads;

async function turn<T>(work: () => Promise<T>): Promise<T> {
  if (reads.running >= LIMIT) await new Promise<void>((resolve) => reads.queue.push(resolve));
  reads.running++;
  try {
    return await work();
  } finally {
    reads.running--;
    reads.queue.shift()?.();
  }
}

const key = (id: string, n: number, v: number) => `${id}:${n}:${v}`;

/** A read of this photo already running in this process (finish waits on it rather than on storage). */
export function readInFlight(id: string, n: number, v: number): Promise<PageResult | null> | undefined {
  return reads.inFlight.get(key(id, n, v));
}

/**
 * The photo as a one-page PDF whose long side is 792 pt (11 in), and the resolution to render it at so the render is
 * the photo's own size: a 2400 px photo at 218 DPI, never upscaled to 400 DPI (4400 px), which only made the crops
 * and Tesseract slower (re-test, 2026-11-25: 65–78 s a photo).
 */
export async function onePagePdf(jpeg: Buffer): Promise<{ bytes: Uint8Array; renderDpi: number }> {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(jpeg);
  const scale = 792 / Math.max(image.width, image.height);
  const page = pdf.addPage([image.width * scale, image.height * scale]);
  page.drawImage(image, { x: 0, y: 0, width: image.width * scale, height: image.height * scale });
  const renderDpi = Math.max(150, Math.min(400, Math.round(Math.max(image.width, image.height) / 11)));
  return { bytes: await pdf.save(), renderDpi };
}

/** Reads photo n, version v of the session. Never throws: a failure is the slot's state. */
export function readPhoto(session: CaptureSession, n: number, v: number): Promise<PageResult | null> {
  const k = key(session.id, n, v);
  const running = reads.inFlight.get(k);
  if (running) return running;
  const work = turn(async (): Promise<PageResult | null> => {
    const started = Date.now();
    try {
      const jpeg = await getFile(names.page(session.id, n, v));
      if (!jpeg) throw new Error("the photo was not found");
      const { bytes, renderDpi } = await onePagePdf(jpeg);
      const form = new FormData();
      form.append("file", new File([new Uint8Array(bytes)], `photo-${n}.pdf`, { type: "application/pdf" }));
      const response = await withSpendScope({ tag: session.spendTag, kind: "document", userId: session.userId }, () => parsePdfForm(form, { renderDpi, photo: true }));
      const data = (await response.json().catch(() => ({}))) as PageResult & { error?: string; documentId?: string };
      // The parse kept this one page's images for a viewer that will never ask: the assembled document has its own.
      dropDocumentImages(data.documentId);
      if (!response.ok || !data.sourceDocument) throw new Error(data.error || "the page could not be read");
      const result: PageResult = { sourceDocument: data.sourceDocument, title: data.title, fullDocumentText: data.fullDocumentText, ocrTranscript: data.ocrTranscript, costUsd: data.costUsd, warnings: data.warnings };
      await putJson(names.result(session.id, n, v), result, { immutable: true });
      const slot = await readSlot(session.id, n);
      if (slot && slot.version === v && slot.state !== "deleted") await writeSlot(session.id, { ...slot, state: "ready", error: null });
      console.log(`[capture] ${session.id.slice(0, 8)} photo ${n} v${v} read in ${Math.round((Date.now() - started) / 1000)}s, $${(result.costUsd ?? 0).toFixed(4)}`);
      return result;
    } catch (error) {
      const message = (error as Error).message.slice(0, 200);
      console.warn(`[capture] ${session.id.slice(0, 8)} photo ${n} v${v} not read: ${message}`);
      const slot = await readSlot(session.id, n).catch(() => null);
      if (slot && slot.version === v && slot.state !== "deleted") await writeSlot(session.id, { ...slot, state: "failed", error: message }).catch(() => undefined);
      return null;
    }
  }).finally(() => reads.inFlight.delete(k));
  reads.inFlight.set(k, work);
  return work;
}
