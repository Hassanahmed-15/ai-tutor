/**
 * Shared types for the standalone document viewer.
 *
 * Kept separate from lib/db/cosmos.ts's ViewerDocumentDoc (the server-side persisted record) —
 * this is what the CLIENT holds while a document is open: pdf.js handles, per-page render state,
 * highlights, and the collected-text panel. None of it is server state, so it does not belong next
 * to the Cosmos types.
 */

export type ViewerSourceKind = "pdf" | "pptx";

/** One rectangle a student highlighted, in PDF page-space (points, not pixels) so it re-renders
 *  correctly at any zoom level. */
export type Highlight = {
  id: string;
  pageNumber: number;
  /** pdf.js text-layer rects for this selection, in page coordinates (origin bottom-left, pdf.js
   *  convention) — one highlight can span multiple rects when the selection wraps a line. */
  rects: { x: number; y: number; width: number; height: number }[];
  text: string;
  color: string;
  createdAt: number;
};

/** One piece of text a student collected from the document, with where it came from. */
export type CollectedSnippet = {
  id: string;
  pageNumber: number;
  text: string;
  createdAt: number;
};

/** A search hit: which page, and the rect to scroll to / draw a marker on. */
export type SearchMatch = {
  pageNumber: number;
  /** Index of this match within the page's own match list — for "3 of 7 on this page". */
  indexOnPage: number;
  rect: { x: number; y: number; width: number; height: number };
};

export const HIGHLIGHT_COLORS = [
  { name: "yellow", value: "rgba(250, 204, 21, 0.38)" },
  { name: "pink", value: "rgba(240, 171, 252, 0.38)" },
  { name: "green", value: "rgba(74, 222, 128, 0.32)" },
  { name: "blue", value: "rgba(96, 165, 250, 0.32)" },
] as const;

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].value;
