import type { SuprnotesContentBlock } from "./suprnotes";

/**
 * Choosing the slice of an uploaded document that ONE beat is written from.
 *
 * WHY THIS IS ITS OWN MODULE. The rule it encodes is easy to get wrong in a way that is invisible
 * in the output — a beat written from the wrong pages still reads fluently, it is just about the
 * wrong thing — so it deserves tests. `progressiveLectureWorker.ts` imports `server-only` and
 * cannot be loaded by the CommonJS test build, hence the split.
 *
 * THE BUG THIS FIXES. Every beat used to receive the whole document, truncated to a character
 * budget. Two failures followed, both visible in real lectures:
 *
 *   1. A beat planned from page 9 read pages 1-4 first and wrote about them, so the lecture drifted
 *      back toward the opening pages instead of advancing through the source.
 *   2. Truncation is positional, so on a long PDF the later pages were simply absent — a beat could
 *      be planned from page 15 and then written from text that never mentioned page 15.
 */

/** A block reduced to what a prompt needs. Mirrors the fields of `SuprnotesContentBlock`. */
export type ScopeBlock = Pick<SuprnotesContentBlock, "id" | "text"> & {
  heading?: string;
  pageNumber?: number;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * The text of just the blocks this beat was planned from.
 *
 * Returns "" when the beat names no blocks, or names blocks that are not in the document. That is
 * deliberate and the caller depends on it: an empty result means "this beat has no scope of its
 * own", and the caller falls back to the unscoped document text. Widening to the whole document
 * here would silently reintroduce the drift this exists to prevent.
 */
export function scopedBlockText(blocks: ScopeBlock[], sourceBlockIds?: string[]): string {
  if (!sourceBlockIds || sourceBlockIds.length === 0) return "";
  const wanted = new Set(sourceBlockIds);
  const selected = blocks.filter((block) => wanted.has(block.id));
  if (selected.length === 0) return "";
  return selected
    .map((block) => {
      // The page number travels with the text so the model can say where something came from, and
      // so a beat cannot silently attribute page 9's content to page 2.
      const where = block.pageNumber ? `[page ${block.pageNumber}] ` : "";
      const heading = clean(block.heading);
      const body = clean(block.text);
      if (!body && !heading) return "";
      return `${where}${heading ? `${heading}\n` : ""}${body}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

const SELECTION_STOPWORDS = new Set(["which", "there", "these", "those", "their", "about", "would", "could", "should", "other", "where", "while"]);

/**
 * The blocks a DRAGGED SELECTION covers — what a lecture "from this area" is built from.
 *
 * The student drags a box over part of a page; parse-pdf reads that crop, but the page's own
 * blocks still describe the whole page. A lecture scoped to all of them teaches the whole page —
 * which is exactly the reported bug ("the lecture is generated generally from the pdf, not from
 * that part"). So the beats are scoped to:
 *   1. the crop's own block (parse-pdf emits one, headed "Page N (selected area)"), and
 *   2. the page's blocks that share words with what was read off the crop,
 * falling back to every block on the selected pages only when nothing matches at all.
 */
export function blocksForSelection(
  blocks: ScopeBlock[],
  selection: { pages: number[]; transcript: string },
): string[] {
  const pages = new Set(selection.pages);
  const onPages = blocks.filter((block) => block.pageNumber !== undefined && pages.has(block.pageNumber));
  const crop = onPages.filter((block) => /\(selected area\)/i.test(block.heading ?? ""));
  const words = new Set(
    (selection.transcript.toLowerCase().match(/[a-z_][a-z0-9_]{4,}/g) ?? []).filter((w) => !SELECTION_STOPWORDS.has(w)),
  );
  const overlapping = onPages.filter((block) => {
    if (crop.includes(block)) return false;
    const text = `${block.heading ?? ""} ${block.text ?? ""}`.toLowerCase();
    let shared = 0;
    for (const word of words) {
      if (text.includes(word) && ++shared >= 2) return true;
    }
    return false;
  });
  const chosen = [...crop, ...overlapping];
  return (chosen.length > 0 ? chosen : onPages).map((block) => block.id);
}

/**
 * How many beats a lecture should have at this depth.
 *
 * Shared by the topic path and the document path. They used to disagree: the topic path honoured
 * depth (6/8/10) while the document path took a flat 12 blocks, so an uploaded PDF produced a
 * longer lecture than the same request typed as a sentence, and "concise" changed only the words
 * per beat. One function so the two cannot drift apart again.
 */
export function beatCountForDepth(depth: string | undefined): number {
  if (depth === "deep") return 10;
  if (depth === "concise") return 6;
  return 8;
}
