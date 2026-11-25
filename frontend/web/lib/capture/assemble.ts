import { applyGlobalSourceOrder, buildPdfLessonPlan } from "../pdfLessonPipeline";
import type { SuprnotesAsset, SuprnotesContentBlock, SuprnotesLessonInput } from "../suprnotes";

/**
 * THE PHOTOGRAPHED PAGES AS ONE DOCUMENT (pure; unit-tested in lib/anim/capture.test.ts). Each photo was read on its
 * own as a one-page PDF, so every one of them is "page 1": its blocks are `ocr-p1-…` / `p1-b…`, its figures
 * `p1-figure-…`, its text labelled "[page 1]". Here page k of the student's order becomes page k everywhere —
 * ids, every reference to an id, page numbers, the text labels — and the lesson plan is built again over the
 * whole, exactly as for a PDF (lib/pdfLessonPipeline.ts). The answer has the shape /api/parse-pdf returns, so the
 * computer goes on to the reference/strict choice as it does for a PDF.
 */

export type CapturedPage = {
  sourceDocument: SuprnotesLessonInput;
  title?: string;
  fullDocumentText?: string;
  ocrTranscript?: string;
  costUsd?: number;
  warnings?: string[];
};

/** A one-page id as page k's: "ocr-p1-0-3" → "ocr-p3-0-3", "p1-figure-2" → "p3-figure-2"; anything else is prefixed. */
export function pageId(id: string, k: number): string {
  if (/(^|-)p1(?=-)/.test(id)) return id.replace(/(^|-)p1(?=-)/, `$1p${k}`);
  return `pg${k}-${id}`;
}

/** "[page 1]" (and "[page 1 formulas, as printed]") and the transcript's "--- page 1 ---" as page k's. */
export function pageLabels(text: string | undefined, k: number): string {
  return (text ?? "").replace(/\[page 1(?=[\] ])/g, `[page ${k}`).replace(/^--- page 1(?=[ ,])/gm, `--- page ${k}`);
}

const PLACEHOLDER_TITLE = /^(?:photo[- ]?\d+|page \d+|untitled)$/i;

function renumbered(page: CapturedPage, k: number): { blocks: SuprnotesContentBlock[]; assets: SuprnotesAsset[] } {
  const doc = page.sourceDocument;
  const map = (id: string) => pageId(id, k);
  const blocks = (doc.contentBlocks ?? []).map((b): SuprnotesContentBlock => ({
    ...b,
    id: map(b.id),
    pageNumber: k,
    ...(b.assetIds ? { assetIds: b.assetIds.map(map) } : {}),
  }));
  const assets = (doc.assets ?? []).map((a): SuprnotesAsset => ({
    ...a,
    id: map(a.id),
    pageNumber: k,
    ...(a.sourceBlockIds ? { sourceBlockIds: a.sourceBlockIds.map(map) } : {}),
  }));
  return { blocks, assets };
}

export function assembleCapturedPages(pages: CapturedPage[], options: { fileName?: string } = {}) {
  if (!pages.length) throw new Error("No page was read.");
  const blocks: SuprnotesContentBlock[] = [];
  const assets: SuprnotesAsset[] = [];
  pages.forEach((page, i) => {
    const r = renumbered(page, i + 1);
    blocks.push(...r.blocks);
    assets.push(...r.assets);
  });
  applyGlobalSourceOrder(blocks);
  blocks.sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  const lessonPlan = buildPdfLessonPlan(blocks, assets);
  const title = pages.map((p) => (p.title ?? "").trim()).find((t) => t && !PLACEHOLDER_TITLE.test(t))
    || ((lessonPlan as { beats?: Array<{ title?: string }> }).beats?.[0]?.title ?? "").trim()
    || "Photographed pages";
  const first = pages[0].sourceDocument;
  const fileName = options.fileName ?? `Phone photos (${pages.length} page${pages.length === 1 ? "" : "s"}).pdf`;
  const sourceDocument: SuprnotesLessonInput = {
    ...first,
    source: { ...((first.source as Record<string, unknown> | undefined) ?? {}), adapter: "phone-capture", fileName, pageCount: pages.length, generatedAt: new Date().toISOString() },
    lesson: { ...(first.lesson ?? {}), title },
    contentBlocks: blocks,
    assets,
    lessonPlan,
    suggestedLecturePlan: lessonPlan,
  };
  return {
    sourceDocument,
    title,
    fileName,
    pageCount: pages.length,
    pagesUsed: pages.map((_, i) => i + 1),
    fullDocumentText: pages.map((p, i) => pageLabels(p.fullDocumentText, i + 1)).filter(Boolean).join("\n\n"),
    ocrTranscript: pages.map((p, i) => pageLabels(p.ocrTranscript, i + 1)).filter(Boolean).join("\n\n"),
    costUsd: pages.reduce((s, p) => s + (p.costUsd ?? 0), 0),
    warnings: pages.flatMap((p) => p.warnings ?? []),
    blockCount: blocks.length,
    assetCount: assets.length,
    figureCount: assets.length,
  };
}
