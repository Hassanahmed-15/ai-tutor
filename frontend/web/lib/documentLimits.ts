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
  MAX_BYTES: 20 * 1024 * 1024,
} as const;

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
