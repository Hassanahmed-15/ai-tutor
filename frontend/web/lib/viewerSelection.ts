"use client";

import type { Highlight } from "./viewerTypes";

/**
 * Turns the browser's own text selection into a Highlight, reading geometry straight off the
 * rendered DOM rather than pdf.js's internal layout math.
 *
 * WHY FROM THE DOM AND NOT FROM PDF.JS'S TEXT GEOMETRY. viewerSearch.ts computes rects from raw
 * text-item transforms because a search has no DOM to read — nothing has been selected yet. A
 * highlight is the opposite case: the browser has ALREADY laid the text-layer spans out in real
 * screen pixels (that positioning is the entire reason a text layer exists), so the most accurate
 * source for "where is this selection" is `getClientRects()` on the selection itself. Re-deriving
 * the same geometry from PDF transforms would be duplicate work at higher risk of drifting from
 * what the browser is actually showing.
 *
 * PAGE SPACE, NOT SCREEN SPACE, IS STILL WHAT GETS STORED. A highlight must survive a zoom change,
 * so screen pixels are converted to PDF page-space points (origin bottom-left, pdf.js's own
 * convention — the same one viewerSearch.ts and PageCanvas.tsx's rect math already use) before
 * being kept. Screen space is only the READING step; page space is the STORAGE format.
 */
export function highlightFromSelection(
  selection: Selection,
  pageEl: HTMLElement,
  pageNumber: number,
  naturalSize: { width: number; height: number },
  scale: number,
  color: string,
): Highlight | null {
  const text = selection.toString();
  if (!text.trim()) return null;

  const pageRect = pageEl.getBoundingClientRect();
  const rects: Highlight["rects"] = [];

  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    // getClientRects() on a Range spans exactly the highlighted glyphs, including a mid-line
    // partial word — unlike measuring whole elements, which would over-select to the nearest span
    // boundary.
    for (const clientRect of Array.from(range.getClientRects())) {
      if (clientRect.width <= 0 || clientRect.height <= 0) continue;
      // Screen pixels relative to the page container, then divided by scale to land in the same
      // page-space unit search results and stored highlights already use, and then flipped from
      // top-left screen origin to bottom-left PDF origin.
      const screenX = clientRect.left - pageRect.left;
      const screenY = clientRect.top - pageRect.top;
      const pageX = screenX / scale;
      const pageY = naturalSize.height - screenY / scale - clientRect.height / scale;
      rects.push({
        x: pageX,
        y: pageY,
        width: clientRect.width / scale,
        height: clientRect.height / scale,
      });
    }
  }

  if (rects.length === 0) return null;
  return {
    id: crypto.randomUUID(),
    pageNumber,
    rects,
    text,
    color,
    createdAt: Date.now(),
  };
}

/**
 * Finds which page a selection is on and its container element, by walking up from the anchor node
 * to the nearest `[data-page-number]` ancestor PageCanvas.tsx marks its root with.
 *
 * A selection may visually span two pages (dragging past a page boundary); this attributes it to
 * whichever page the selection STARTED on, since splitting one drag into two stored highlights
 * would be surprising and the toolbar only ever needs one page number to label the snippet.
 */
export function pageForSelection(selection: Selection): { pageNumber: number; el: HTMLElement } | null {
  const anchor = selection.anchorNode;
  if (!anchor) return null;
  const el = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>("[data-page-number]");
  if (!el) return null;
  const pageNumber = Number(el.dataset.pageNumber);
  if (!Number.isFinite(pageNumber)) return null;
  return { pageNumber, el };
}
