/**
 * Reading the page as PIXELS, because that is the only place all of its content lives.
 *
 * WHY THIS EXISTS. Text extraction is PyMuPDF's `page.get_text` — it returns the text objects a PDF
 * *declares*. Anything typeset as vector strokes, pasted as an image, or scanned is simply not
 * there. Measured on this repo's own `AblationStudy_V3.pdf`: page 4 declares 985 characters, and all
 * of them are captions — "Fig. 2: Per-feature distributions…", "Fig. 3: Lower-triangular Pearson
 * correlation matrix…" — while the three images those captions refer to (1846x819, 793x706,
 * 549x868) contain the actual content. Ask about figure 3 and text extraction can only hand you the
 * sentence describing it.
 *
 * That is also why retrieval alone did not fix this: it was searching a haystack the needle was
 * never in.
 *
 * WHY A VISION MODEL AND NOT `pytesseract`. Tesseract is already a dependency, and it stays where it
 * is (crop-edge checks in `scripts/pdf_pipeline.py`). It is built for prose: a fraction bar becomes a
 * dash, subscripts and summation limits are dropped or inlined. That is exactly the content being
 * asked about, so an OCR pass that mangles it is worse than none — it produces confident nonsense
 * the lecture would then teach.
 *
 * Everything in this file is pure. The vision call itself lives in the route; the geometry, the
 * limits and the prompt live here so they can be tested without an API key.
 */

/** A rectangle in normalised page coordinates: 0-1 on both axes, origin top-left. */
export type NormalisedRect = { x: number; y: number; width: number; height: number };

/** A rectangle in rendered-image pixels. */
export type PixelRect = { x: number; y: number; width: number; height: number };

/** What the student pointed at: a page, and optionally a part of it. */
export type PageRegion = { page: number; rect?: NormalisedRect };

/** One transcribed piece of the document. */
export type TranscriptPart = { page: number; rect?: NormalisedRect; text: string };

export const OCR_RULES = {
  /**
   * Ceiling on pages transcribed in one upload.
   *
   * One vision call per page, so an unbounded pass over a thirty-page paper is real money spent on
   * pages nobody asked about. The student has already narrowed the document by selecting pages;
   * this is the backstop for when they select a lot of them.
   */
  MAX_PAGES: 8,
  /**
   * A crop smaller than this is a stray click, not a selection, and would be transcribed as noise.
   * Expressed as a fraction of the page.
   */
  MIN_REGION: 0.02,
  MAX_TRANSCRIPT_CHARS: 12_000,
} as const;

/**
 * Turn a rectangle drawn on a thumbnail into a box in the full-resolution render.
 *
 * Normalised on purpose: the selector draws on a thumbnail that is a different size from the page
 * the server renders at OCR DPI, and every version of this that passed pixels ended up cropping the
 * wrong part of the page the first time a thumbnail size changed.
 *
 * Clamped to the page, because a drag that ends outside the image is a normal thing to do with a
 * mouse and must not produce a crop with negative width or one that runs off the canvas.
 */
export function pixelRect(rect: NormalisedRect, pageWidth: number, pageHeight: number): PixelRect {
  const x0 = clamp01(rect.x);
  const y0 = clamp01(rect.y);
  const x1 = clamp01(rect.x + rect.width);
  const y1 = clamp01(rect.y + rect.height);

  // A drag upward or leftward yields a negative width; normalise rather than reject, because the
  // student did make a real selection.
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);

  const px = Math.round(left * pageWidth);
  const py = Math.round(top * pageHeight);
  return {
    x: px,
    y: py,
    width: Math.max(1, Math.round((right - left) * pageWidth)),
    height: Math.max(1, Math.round((bottom - top) * pageHeight)),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Is this rectangle a real selection, or a stray click? */
export function isUsableRegion(rect: NormalisedRect | undefined): rect is NormalisedRect {
  if (!rect) return false;
  const w = Math.abs(rect.width);
  const h = Math.abs(rect.height);
  return w >= OCR_RULES.MIN_REGION && h >= OCR_RULES.MIN_REGION;
}

/**
 * Decide what to transcribe.
 *
 * The rules, in the student's own terms: a region drawn means transcribe that part; no region means
 * transcribe the pages they selected; and taking the whole document while drawing nothing means
 * transcribe nothing, because that is a request for the existing whole-document lecture and running
 * a vision call per page over it buys no precision at all.
 */
export function planTranscription(selectedPages: number[], regions: PageRegion[]): PageRegion[] {
  const usable = regions.filter((r) => isUsableRegion(r.rect));
  if (usable.length > 0) return usable.slice(0, OCR_RULES.MAX_PAGES);

  /*
   * No region: transcribe the pages the student selected.
   *
   * An empty selection means "use the whole document", and falls out of here as an empty plan —
   * deliberately, not incidentally. A vision call per page across a thirty-page paper buys no
   * precision over the whole-document lecture that request already gets. An explicit early return
   * for it was removed: mutation testing showed no test could tell it apart from this line, because
   * an empty set produces an empty plan anyway, and a guard nothing can protect is just a claim.
   */
  return [...new Set(selectedPages)]
    .sort((a, b) => a - b)
    .slice(0, OCR_RULES.MAX_PAGES)
    .map((page) => ({ page }));
}

/**
 * What the vision model is asked to do.
 *
 * TRANSCRIBE, not describe. A model asked about an image writes a summary, and a summary of a
 * formula is not a formula — the whole failure being fixed is content arriving as a paraphrase of
 * itself. LaTeX is requested for mathematics because it is the only plain-text form that survives
 * subscripts, superscripts and summation limits intact.
 */
export const TRANSCRIBE_PROMPT = [
  "Transcribe everything visible in this image, exactly as it appears.",
  "",
  "- Mathematics: write it in LaTeX. Preserve every subscript, superscript, index, summation limit",
  "  and operator. Do not simplify, rename variables, or 'clean up' notation.",
  "- Tables: transcribe as rows of cells, keeping the header row and every value exactly.",
  "- Charts and diagrams: transcribe the axis labels, tick values, series names, legend entries and",
  "  any text inside the figure. Then, on a separate line beginning 'SHAPE:', state briefly what the",
  "  data does — the trend, the relationship, or the flow between labelled parts.",
  "- Ordinary prose: transcribe verbatim.",
  "",
  "Do not summarise, do not explain, and do not add anything that is not in the image.",
  "If part of it is illegible, write [illegible] there rather than guessing.",
].join("\n");

/**
 * Assemble the parts into the passage the lecture will be about.
 *
 * Page-labelled, so a lecture can say where something came from, and so a student asking about
 * "page 7" can see that page 7 is what was read.
 */
export function assembleTranscript(parts: TranscriptPart[]): string {
  const usable = parts.filter((p) => p.text.trim().length > 0);
  if (usable.length === 0) return "";

  let out = usable
    .map((p) => {
      const where = p.rect ? `page ${p.page}, selected region` : `page ${p.page}`;
      return `--- ${where} ---\n${p.text.trim()}`;
    })
    .join("\n\n");

  if (out.length > OCR_RULES.MAX_TRANSCRIPT_CHARS) {
    out = `${out.slice(0, OCR_RULES.MAX_TRANSCRIPT_CHARS)}\n[transcript truncated]`;
  }
  return out;
}
