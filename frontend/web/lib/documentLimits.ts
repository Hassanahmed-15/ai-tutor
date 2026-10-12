/**
 * How large an uploaded document is allowed to be.
 *
 * WHY A HARD CEILING AND NOT A PROCESSING BUDGET. The lecture is now written from the WHOLE
 * document — every page's text and every page's image go into one model call together, so the
 * question can be answered against the complete source rather than against whichever fragment
 * retrieval happened to surface. That only holds while the whole document actually fits, so the
 * limit has to bind at upload rather than at processing: accepting a 40-page file and quietly
 * teaching 20 of it would break the guarantee the design is built on, and do it invisibly.
 *
 * Pages and slides share the number deliberately. A deck and a paper take the same road through
 * the pipeline, and a limit that differed between them would be a difference the student has to
 * discover rather than one the product means.
 */
export const DOCUMENT_LIMITS = {
  /** Maximum pages in a PDF, or slides in a deck. */
  MAX_PAGES: 20,
  /**
   * The longest file the page picker opens. A 21-page lecture deck used to be turned away before
   * the student could even choose pages — "That file could not be read" — though 20 of its pages
   * are exactly what a lesson carries. MAX_PAGES now binds on what is TAUGHT (the pages chosen);
   * this only stops a whole book from being thumbnailed.
   */
  MAX_PREVIEW_PAGES: 400,
  MAX_BYTES: 20 * 1024 * 1024,
  /**
   * The most text a PDF may have, counted over the WHOLE file before any page is chosen (the
   * student's rule, 2026-10-10). The lecture and its chat read the whole document, and the chat's
   * context holds 30,000 characters — so a longer file is refused at upload rather than read in
   * part. A scanned page has no text layer and counts as nothing here.
   */
  MAX_PDF_TEXT_CHARS: 30_000,
} as const;

/** The message shown when a PDF has more text than one lesson can read. */
export function tooMuchTextMessage(actual: number): string {
  return (
    `This PDF has ${actual.toLocaleString("en-US")} characters of text, and the limit is ` +
    `${DOCUMENT_LIMITS.MAX_PDF_TEXT_CHARS.toLocaleString("en-US")}. Aria reads the whole document, so it has to fit. ` +
    `Upload a shorter file, or split this one and upload the part you want to learn.`
  );
}

/** True when a PDF with this much text must be refused. */
export function exceedsTextLimit(characters: number): boolean {
  return Number.isFinite(characters) && characters > DOCUMENT_LIMITS.MAX_PDF_TEXT_CHARS;
}

/**
 * The message shown when a document is too long.
 *
 * It states the actual count, because "too long" without a number leaves the student guessing how
 * much to cut, and splitting a document is work they can only do if they know the target.
 */
export function tooManyPagesMessage(actual: number, unit: "page" | "slide" = "page"): string {
  const plural = unit === "page" ? "pages" : "slides";
  return (
    `This file has ${actual} ${plural}, and up to ${DOCUMENT_LIMITS.MAX_PAGES} can be taught at once. ` +
    `Every ${unit} is read in full — text and images together — so the whole document has to fit. ` +
    `Split it into parts of ${DOCUMENT_LIMITS.MAX_PAGES} ${plural} or fewer and upload the part you want to learn.`
  );
}

/** True when a document of this length must be refused. */
export function exceedsPageLimit(pageCount: number): boolean {
  return Number.isFinite(pageCount) && pageCount > DOCUMENT_LIMITS.MAX_PAGES;
}

/** True when a document is too long even to open in the page picker. */
export function exceedsPreviewLimit(pageCount: number): boolean {
  return Number.isFinite(pageCount) && pageCount > DOCUMENT_LIMITS.MAX_PREVIEW_PAGES;
}

/** Shown when a book is too long to open at all. */
export function tooLongToPreviewMessage(actual: number): string {
  return (
    `This file has ${actual} pages — too long to open here (up to ${DOCUMENT_LIMITS.MAX_PREVIEW_PAGES}). ` +
    `Upload the chapter you want to learn, and pick up to ${DOCUMENT_LIMITS.MAX_PAGES} of its pages.`
  );
}

/** Shown when more pages are chosen than one lesson carries, or none are chosen from a long file. */
export function selectFewerPagesMessage(pageCount: number, selected: number): string {
  return selected > 0
    ? `You chose ${selected} pages; up to ${DOCUMENT_LIMITS.MAX_PAGES} can be taught at once. Unselect some and try again.`
    : `This file has ${pageCount} pages, and up to ${DOCUMENT_LIMITS.MAX_PAGES} can be taught at once. Press "Select page" on the pages you want to learn.`;
}
