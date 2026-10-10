import "server-only";

/**
 * THE TEXT OF EVERY PAGE OF A PDF, read straight from its text layer with pdf.js — the library
 * /api/parse-pdf already opens the file with. No rendering, no model: a 20-page paper takes a few
 * hundred milliseconds.
 *
 * Two jobs share it. /api/document-pages measures the whole file against the 30,000-character
 * limit (lib/documentLimits.ts) before the page picker opens, and /api/parse-pdf returns the whole
 * file's text for the lecture chat even when only some pages were parsed for the lecture.
 *
 * A scanned page has no text layer, so it reads as empty here; its words are only known after OCR.
 */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js takes ownership of the array it is given and detaches it: it gets its own copy.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useWorkerFetch: false });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : ""))
        .join("")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      pages.push(text);
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** How many characters of text a PDF has, counted the way the limit counts them (spaces collapsed). */
export function textLength(pages: string[]): number {
  return pages.reduce((total, page) => total + page.replace(/\s+/g, " ").trim().length, 0);
}
