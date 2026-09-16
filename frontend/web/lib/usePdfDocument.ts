"use client";

import { useEffect, useState } from "react";

/**
 * Loads a PDF with pdf.js and exposes the live document handle.
 *
 * WORKER SETUP IS THE WHOLE TRICK. pdf.js does its actual parsing in a Web Worker so a 300-page
 * file does not freeze the tab while it loads — but the worker has to be told where its own script
 * lives, and that has to happen before the FIRST `getDocument()` call anywhere in the app, once per
 * page load. `workerSrc` is set at module scope for exactly that reason: it runs once on import,
 * not once per component instance, so opening a second document (or two viewers in the same
 * session, however unlikely) does not race to set it twice.
 *
 * THE WORKER SCRIPT IS A STATIC FILE, NOT A BUNDLED IMPORT. See scripts/copy-pdf-worker.mjs for
 * why: the standalone Docker build only copies what Next's tracer sees referenced statically, and
 * pdf.js constructs the worker's path at runtime in a way the tracer cannot follow. `/pdf.worker.min.mjs`
 * is copied into public/ at build time from whatever pdfjs-dist version is actually installed, so
 * the worker and the library loaded here are always the same version — a mismatch is the single
 * most common way pdf.js breaks silently in production and works everywhere else.
 */
export type PdfDocumentState =
  | { status: "loading" }
  | { status: "ready"; doc: import("pdfjs-dist").PDFDocumentProxy; pageCount: number }
  | { status: "error"; message: string };

/** Internal only — `forSource` is what lets the render-time reset below compare against STATE
 *  (which React already guarantees is read consistently during render) instead of a ref. */
type InternalState = PdfDocumentState & { forSource: string | null };

let workerConfigured = false;

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  if (!workerConfigured) {
    lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerConfigured = true;
  }
  return lib;
}

export function usePdfDocument(source: string | null): PdfDocumentState {
  const [state, setState] = useState<InternalState>({ status: "loading", forSource: source });

  /*
   * Reset to "loading" during render, not inside the effect — React's own documented pattern for
   * "state must change immediately when a prop changes" (their example is exactly this: an
   * incoming id no longer matching the id state was last computed for).
   *
   * The comparison is against `state.forSource`, part of STATE itself, rather than a ref: reading
   * a ref during render is unsafe (React does not guarantee it reflects the render actually being
   * committed), while state read during its own render always does. The effect below still does
   * every bit of the real async work and is the only place `state` moves to "ready" or "error";
   * this only stops a new document's screen from showing one stale frame of the PREVIOUS
   * document's state before that effect has had a chance to run.
   */
  if (source !== state.forSource) {
    setState({ status: "loading", forSource: source });
  }

  useEffect(() => {
    if (!source) return;

    let cancelled = false;
    // The LOADING TASK, not the resolved document, is what carries `destroy()` — a detail worth
    // getting right, since PDFDocumentProxy itself only exposes `cleanup()`, which frees caches
    // but leaves the worker thread and its connection alive. Keeping the task (rather than the
    // doc) is what lets teardown fully release the worker-side parse when a document is closed.
    let task: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;

    (async () => {
      try {
        const lib = await pdfjs();
        task = lib.getDocument({
          url: source,
          // Sent as a cookie-carrying same-origin request — the viewer document route is
          // auth-gated, so pdf.js needs the session cookie on every ranged fetch it makes.
          withCredentials: true,
          // Real range requests, not one big download: this is what lets a 300-page file start
          // rendering its first page before the last byte of the document has arrived.
          disableRange: false,
          disableStream: false,
        });
        const doc = await task.promise;
        // `cancelled` alone is the correct staleness guard here: it is set by THIS effect's own
        // cleanup, and React always runs that cleanup before the next run of this effect starts —
        // so by the time `source` has changed again, this closure's `cancelled` is already true.
        if (cancelled) {
          void task.destroy();
          return;
        }
        setState({ status: "ready", doc, pageCount: doc.numPages, forSource: source });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Could not open this document.",
          forSource: source,
        });
      }
    })();

    return () => {
      cancelled = true;
      // Releases the worker-side document and its cached pages. Without this, switching documents
      // in one tab leaks a full parsed PDF (and its worker connection) per switch.
      void task?.destroy();
    };
  }, [source]);

  return state;
}
