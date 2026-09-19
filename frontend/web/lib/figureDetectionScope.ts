/**
 * WHICH PAGES ARE WORTH A VISION CALL.
 *
 * Figure detection costs one gpt-4o round trip per page, and it used to run on every page of every
 * upload — including pages that are a single column of prose, where the only possible answer is
 * "no figures here". Measured on a real 7-page paper, 3 of its pages (43%) paint no image and no
 * vector artwork at all; on a pure-text PDF it is every page. That spend and that wall-clock bought
 * a guaranteed empty result.
 *
 * pdf.js already knows what a page paints — see `pageMightHaveFigures` in app/api/parse-pdf/route.ts,
 * which reads the operator list. This module holds the DECISION that reads from it, separately,
 * because the route imports "server-only" and cannot be loaded by the CommonJS test build.
 *
 * THE ASYMMETRY THAT MATTERS. A false negative loses a real figure from the lesson — invisible,
 * because the beat still reads fluently without it. A false positive costs one API call. So the
 * rule fails open at every step: only a definite `false` skips, and everything else detects.
 */
export interface FigureScopeInput {
  /** Does the page paint an image or vector artwork? null = could not determine. */
  hasGraphics: boolean | null;
  /** Is a rasterised copy of the page available to send? */
  hasImage: boolean;
  /** Is a vision client configured and enabled? */
  visionAvailable: boolean;
  /** Did text extraction find anything on this page? */
  hasText: boolean;
}

export type FigureScopeDecision =
  /** Send it to the vision detector. */
  | "detect"
  /** Definitely text-only: no figure is possible, so do not pay for the call. */
  | "skip-text-only"
  /** No text and no extractable content, but something IS drawn: keep the whole page as one figure. */
  | "whole-page"
  /** Nothing to do — no image to send, or nothing drawn and nothing written. */
  | "none";

export function figureScope(input: FigureScopeInput): FigureScopeDecision {
  if (!input.hasImage) return "none";
  const textOnly = input.hasGraphics === false;
  if (input.visionAvailable && !textOnly) return "detect";
  /*
   * The image-only/scanned-page fallback, for when vision is unavailable or the page was skipped.
   * `hasGraphics !== false` keeps a genuinely BLANK page out: with no text and nothing drawn, a
   * page would otherwise ship as a full-page "figure" of nothing and be taught as if it mattered.
   */
  if (!input.hasText && input.hasGraphics !== false) return "whole-page";
  return textOnly ? "skip-text-only" : "none";
}
