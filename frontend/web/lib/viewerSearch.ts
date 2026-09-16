"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { SearchMatch } from "./viewerTypes";

/**
 * The subset of pdf.js's internal `TextItem` shape this file actually reads.
 *
 * pdf.js does not re-export `TextItem` from its package root (only from a deep internal path that
 * is not part of its public API), so this is the smallest compatible type rather than an import —
 * `getTextContent()`'s runtime result satisfies it exactly, this just gives TypeScript a name for
 * the fields used here.
 */
export type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
};

/**
 * Finds every occurrence of a query across a whole PDF, in PDF page-space coordinates.
 *
 * WHY PAGE SPACE, NOT SCREEN SPACE. A match's rect is computed once, from the document's own text
 * geometry, and PageCanvas.tsx converts it to screen pixels at whatever the CURRENT zoom happens to
 * be. Computing screen-space rects here instead would mean re-searching on every zoom change; this
 * way a zoom is just a multiplication the render layer already does for everything else on the
 * page.
 *
 * ONE PASS PER PAGE, CACHED. `getTextContent()` is not cheap on a long page, and the same page is
 * searched again on every keystroke while a student types a query — so each page's text items are
 * fetched once and kept for the life of the document, not re-fetched per search.
 */
export type PageTextCache = Map<number, TextItem[]>;

async function pageTextItems(doc: PDFDocumentProxy, pageNumber: number, cache: PageTextCache): Promise<TextItem[]> {
  const cached = cache.get(pageNumber);
  if (cached) return cached;
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  // `content.items` is a mix of real text runs and marked-content markers from a pdf.js type this
  // module does not import (see the TextItem comment above) — filtered and cast to our local shape
  // rather than narrowed by a type predicate, since the two types are structurally incompatible as
  // far as TypeScript can tell even though the runtime values satisfy ours exactly.
  const items = content.items.filter(
    (item): boolean => "str" in item && typeof (item as { str: unknown }).str === "string",
  ) as unknown as TextItem[];
  cache.set(pageNumber, items);
  return items;
}

/**
 * Searches one page's text for every occurrence of `query`, case-insensitively.
 *
 * pdf.js gives text as a sequence of positioned RUNS, not one string — a word can be split across
 * runs (kerning, a font change mid-word) and a search match can straddle two runs. This walks the
 * page's runs as one continuous string with an index map back to each run's rect, so a match is
 * found the same way a reading eye would find it: by the letters, not by which run they happened
 * to be chunked into.
 */
export function searchPage(items: TextItem[], pageNumber: number, query: string): SearchMatch[] {
  if (!query.trim()) return [];
  const lowerQuery = query.toLowerCase();
  const matches: SearchMatch[] = [];

  // Build one continuous string for the page, with a map from each character's index back to
  // which run produced it and that run's offset within it — the run boundary is invisible to the
  // search itself, only used afterward to translate a hit back into a rect.
  let combined = "";
  const runStarts: { start: number; item: TextItem }[] = [];
  for (const item of items) {
    runStarts.push({ start: combined.length, item });
    combined += item.str;
    // A newline between runs (pdf.js sets hasEOL) must not glue two words together into a false
    // match, but must also not be searchable itself.
    if (item.hasEOL) combined += " ";
  }
  const lowerCombined = combined.toLowerCase();

  let fromIndex = 0;
  let indexOnPage = 0;
  for (;;) {
    const hitIndex = lowerCombined.indexOf(lowerQuery, fromIndex);
    if (hitIndex === -1) break;
    fromIndex = hitIndex + Math.max(1, lowerQuery.length);

    // Find the run the match STARTS in, to anchor the rect. A match spanning multiple runs is
    // drawn as the rect of its first run extended to the match's own width — precise enough to
    // land the eye on the right line without reconstructing multi-run bounding boxes for a
    // feature that only needs to scroll a student to roughly the right spot.
    let runIndex = runStarts.findIndex(
      (r, i) => hitIndex >= r.start && (i === runStarts.length - 1 || hitIndex < runStarts[i + 1].start),
    );
    if (runIndex === -1) runIndex = runStarts.length - 1;
    const run = runStarts[runIndex];
    if (!run) continue;

    const item = run.item;
    // transform is [a, b, c, d, e, f] — e,f is the run's origin in PDF page space (bottom-left
    // origin), and item.height/width describe its box from that origin.
    const [, , , , originX, originY] = item.transform;
    const charOffsetInRun = hitIndex - run.start;
    const perCharWidth = item.str.length > 0 ? item.width / item.str.length : 0;
    matches.push({
      pageNumber,
      indexOnPage: indexOnPage++,
      rect: {
        x: originX + perCharWidth * charOffsetInRun,
        y: originY,
        width: perCharWidth * lowerQuery.length || item.width,
        height: item.height || 10,
      },
    });
  }
  return matches;
}

/**
 * Searches the whole document, page by page, yielding results as they are found rather than
 * waiting for every page — a 300-page document should show its first match immediately, not after
 * scanning all 300.
 */
export async function* searchDocument(
  doc: PDFDocumentProxy,
  pageCount: number,
  query: string,
  cache: PageTextCache,
): AsyncGenerator<SearchMatch[], void, unknown> {
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const items = await pageTextItems(doc, pageNumber, cache);
    const matches = searchPage(items, pageNumber, query);
    if (matches.length > 0) yield matches;
  }
}
