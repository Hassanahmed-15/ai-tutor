import type { DocumentPage } from "@/components/upload/PageSelector";

/**
 * Reading page previews off an NDJSON stream, one page at a time.
 *
 * WHY THIS EXISTS. `/api/document-pages` used to answer with a single JSON body containing every
 * page of the document as a base64 data URI. Nothing could be shown until the last page of the
 * last file had rendered AND the whole body had transferred — measured at 0.79 s of rendering for
 * a twenty-page PDF plus 7.0 MB of base64 on the wire. Rendering was never the slow part; waiting
 * for all of it was.
 *
 * The route now emits one line per page and this reads them as they land, so the picker paints
 * page one while the rest are still encoding. Same total work, very different first paint.
 *
 * Kept out of the component so the line framing can be tested without a browser — a base64 page is
 * hundreds of kilobytes, so lines routinely span several network chunks and the reassembly below
 * is the part most likely to break.
 */

/** One line of the stream. `unavailable` is a degradation, not an error — see the route. */
export type StreamedPageEvent =
  | { type: "count"; pageCount: number }
  | { type: "page"; pageNumber: number; thumbnail: string; excerpt: string }
  | { type: "unavailable"; reason: string }
  | { type: "error"; error: string };

/** What the caller ends up with, shaped like the old single-response body so callers are shared. */
export type StreamedPagesResult = {
  file: File;
  ok: boolean;
  data:
    | { kind: "pages"; fidelity: "rendered"; pageCount: number; pages: DocumentPage[] }
    | { kind: "no-thumbnails"; reason: string }
    | { error: string };
};

/**
 * Split a byte stream into complete NDJSON lines.
 *
 * Deliberately not `for await (chunk) JSON.parse(chunk)`: a single page line is far larger than a
 * network chunk, so parsing per chunk fails on essentially every page. The tail is held until a
 * newline actually arrives, and whatever is left at end-of-stream is emitted if it parses.
 */
export async function* readNdjson(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamedPageEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        const parsed = parseLine(line);
        if (parsed) yield parsed;
      }
    }
    const tail = buffer.trim();
    if (tail) {
      const parsed = parseLine(tail);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseLine(line: string): StreamedPageEvent | null {
  try {
    return JSON.parse(line) as StreamedPageEvent;
  } catch {
    // A malformed line is a bug in the emitter; dropping it keeps the pages that did parse.
    return null;
  }
}

/**
 * Consume a streamed preview response, calling `onPage` as each page arrives.
 *
 * Returns the same shape the non-streaming route returns, so the caller's completion handling does
 * not need to know which path produced it.
 */
export async function readStreamedPages(
  response: Response,
  file: File,
  onPage: (pageNumber: number, page: DocumentPage, pageCount: number | null) => void,
): Promise<StreamedPagesResult> {
  if (!response.body) {
    return { file, ok: false, data: { error: "Could not read that file." } };
  }

  const pages: DocumentPage[] = [];
  let pageCount: number | null = null;

  for await (const event of readNdjson(response.body)) {
    if (event.type === "count") {
      pageCount = event.pageCount;
      continue;
    }
    if (event.type === "page") {
      const page: DocumentPage = {
        pageNumber: event.pageNumber,
        thumbnail: event.thumbnail,
        excerpt: event.excerpt,
      };
      // Indexed by page number, not pushed: the array is pre-sized by the count line, and a gap
      // left by a page that failed must not shift every page after it by one.
      pages[event.pageNumber - 1] = page;
      onPage(event.pageNumber, page, pageCount);
      continue;
    }
    if (event.type === "unavailable") {
      return { file, ok: true, data: { kind: "no-thumbnails", reason: event.reason } };
    }
    // An error mid-stream is terminal: the page limit refusal arrives this way, and it carries the
    // sentence telling the student what to do about it.
    return { file, ok: false, data: { error: event.error } };
  }

  const rendered = pages.filter(Boolean);
  if (rendered.length === 0) {
    return {
      file,
      ok: true,
      data: { kind: "no-thumbnails", reason: "Page previews are unavailable on this server." },
    };
  }
  return {
    file,
    ok: true,
    data: { kind: "pages", fidelity: "rendered", pageCount: pageCount ?? rendered.length, pages: rendered },
  };
}
