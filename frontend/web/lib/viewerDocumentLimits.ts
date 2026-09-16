/**
 * How large a document the standalone viewer will open.
 *
 * DELIBERATELY SEPARATE FROM lib/documentLimits.ts. That 20-page ceiling exists because a lesson
 * is written from the WHOLE document in one model call — every page's text and image has to fit
 * in one prompt, so the limit binds at upload. The viewer sends nothing to a model at all; it is a
 * PDF renderer with a text layer, so its only real constraint is what a browser and this server can
 * reasonably hold in memory for one request. Reusing the lesson limit here would refuse a
 * 200-page textbook a student just wants to read and search, for a reason that has nothing to do
 * with viewing it.
 */
export const VIEWER_DOCUMENT_LIMITS = {
  MAX_PAGES: 600,
  MAX_BYTES: 100 * 1024 * 1024,
} as const;

export function viewerDocumentTooLarge(bytes: number): boolean {
  return bytes > VIEWER_DOCUMENT_LIMITS.MAX_BYTES;
}

export function viewerDocumentTooManyPages(pageCount: number): boolean {
  return Number.isFinite(pageCount) && pageCount > VIEWER_DOCUMENT_LIMITS.MAX_PAGES;
}

export function viewerTooLargeMessage(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  const limitMb = VIEWER_DOCUMENT_LIMITS.MAX_BYTES / (1024 * 1024);
  return `That file is ${mb} MB; the viewer opens files up to ${limitMb} MB.`;
}

export function viewerTooManyPagesMessage(pageCount: number): string {
  return `That document has ${pageCount} pages; the viewer opens documents up to ${VIEWER_DOCUMENT_LIMITS.MAX_PAGES} pages.`;
}
