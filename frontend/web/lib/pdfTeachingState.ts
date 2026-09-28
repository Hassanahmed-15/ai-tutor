import type { Beat } from "./lessonContent";
import { isSuprnotesLessonInput, type SuprnotesContentBlock } from "./suprnotes";

export type PdfHighlight = {
  blockId: string;
  pageNumber: number;
  rect: { x: number; y: number; width: number; height: number } | null;
  label: string;
};

export type PdfTeachingState = {
  activePage: number | null;
  activeBlockIds: string[];
  completedBlockIds: string[];
  remainingBlockIds: string[];
  highlights: PdfHighlight[];
  totalBlocks: number;
};

function validRect(value: SuprnotesContentBlock["bbox"]): PdfHighlight["rect"] {
  if (!value) return null;
  const x = Math.max(0, Math.min(1, value.x));
  const y = Math.max(0, Math.min(1, value.y));
  const width = Math.max(0.01, Math.min(1 - x, value.width));
  const height = Math.max(0.01, Math.min(1 - y, value.height));
  return { x, y, width, height };
}

/**
 * Derive the PDF's position and coverage from the same beat provenance that drives teaching.
 * There is no second progress counter to drift: a block becomes complete only after its beat has
 * actually been left, and the active highlight is exactly the current beat's sourceBlockIds.
 */
export function pdfTeachingState(
  beats: Pick<Beat, "sourceBlockIds">[],
  currentIndex: number,
  sourceDocument: unknown,
): PdfTeachingState {
  const allBlocks = isSuprnotesLessonInput(sourceDocument) ? sourceDocument.contentBlocks ?? [] : [];
  // Page furniture (publisher header, copyright footer) is left out of the lesson plan, so it must
  // not count toward "N of M source blocks covered" either — the bar could never reach the end.
  const planned = isSuprnotesLessonInput(sourceDocument) ? (sourceDocument.lessonPlan as { contentBlockIds?: unknown } | undefined)?.contentBlockIds : undefined;
  const plannedIds = Array.isArray(planned) ? new Set(planned.filter((id): id is string => typeof id === "string")) : null;
  const blocks = plannedIds?.size ? allBlocks.filter((block) => plannedIds.has(block.id)) : allBlocks;
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const orderedIds = blocks
    .slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .map((block) => block.id);
  const activeBlockIds = [...new Set(beats[currentIndex]?.sourceBlockIds ?? [])].filter((id) => byId.has(id));
  const completed = new Set(
    beats
      .slice(0, Math.max(0, currentIndex))
      .flatMap((beat) => beat.sourceBlockIds ?? [])
      .filter((id) => byId.has(id)),
  );
  const activeSet = new Set(activeBlockIds);
  const remainingBlockIds = orderedIds.filter((id) => !completed.has(id) && !activeSet.has(id));
  const highlights = activeBlockIds.flatMap((blockId): PdfHighlight[] => {
    const block = byId.get(blockId);
    if (!block || typeof block.pageNumber !== "number") return [];
    const label = (block.heading || block.text || `Source block ${blockId}`).replace(/\s+/g, " ").trim().slice(0, 120);
    return [{ blockId, pageNumber: block.pageNumber, rect: validRect(block.bbox), label }];
  });
  const activePage = highlights[0]?.pageNumber
    ?? blocks.find((block) => activeSet.has(block.id) && typeof block.pageNumber === "number")?.pageNumber
    ?? null;
  return {
    activePage,
    activeBlockIds,
    completedBlockIds: orderedIds.filter((id) => completed.has(id)),
    remainingBlockIds,
    highlights,
    totalBlocks: orderedIds.length,
  };
}

/** True only when every extracted source block belongs to a generated teaching beat. */
export function hasCompleteSourcePlan(beats: Pick<Beat, "sourceBlockIds">[], sourceDocument: unknown): boolean {
  if (!isSuprnotesLessonInput(sourceDocument)) return false;
  const planned = new Set(beats.flatMap((beat) => beat.sourceBlockIds ?? []));
  const blocks = sourceDocument.contentBlocks ?? [];
  return blocks.length > 0 && blocks.every((block) => planned.has(block.id));
}
