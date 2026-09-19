"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageQueue } from "@/lib/pdfPageQueue";

/**
 * The page-picker rail. Each thumbnail is its OWN tiny render at a fixed low scale — not a
 * downscaled copy of the full-size canvas already drawn in PageList, because that canvas may not
 * exist yet (the real page could be far outside the virtualization window) and a thumbnail must
 * work regardless of whether its page has ever been opened.
 *
 * LAZY THE SAME WAY THE MAIN LIST IS. A 300-page document does not render 300 thumbnails on open
 * either; the sidebar has its own IntersectionObserver, because the failure mode this exists to
 * avoid — decoding every page at once — is exactly as real at postage-stamp size.
 *
 * AND IT SHARES THE DOCUMENT'S PAGE QUEUE. This rail used to call doc.getPage() directly while
 * claiming a "smaller margin" than PageList; its margin was in fact 200% against PageList's 100%,
 * over a rail so narrow that covers dozens of pages. Those unqueued requests landed on the same
 * single pdf.js worker connection and starved the renders for the page the student was actually
 * reading — the precise starvation lib/pdfPageQueue.ts was written to prevent. Thumbnails now go
 * through that queue at LOW priority, so a visible page always overtakes them.
 */
const THUMB_SCALE = 0.18;

export function ThumbnailSidebar({
  pageCount,
  currentPage,
  onSelect,
  queue,
}: {
  pageCount: number;
  currentPage: number;
  onSelect: (pageNumber: number) => void;
  /** The document's shared page queue, owned by DocumentViewer. Thumbnails use it at low priority. */
  queue: PageQueue;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const pageNumber = Number((entry.target as HTMLElement).dataset.thumbPage);
            if (!Number.isFinite(pageNumber)) continue;
            if (entry.isIntersecting && !next.has(pageNumber)) {
              next.add(pageNumber);
              changed = true;
            } else if (!entry.isIntersecting && next.has(pageNumber)) {
              /*
               * This branch did not exist, so the set only ever grew: every thumbnail scrolled past
               * stayed mounted and kept its canvas backing store for the life of the document. On a
               * long PDF that is a slow, monotonic leak sitting alongside the one in PageCanvas.
               */
              next.delete(pageNumber);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      /*
       * 50%, down from 200%. The rail is narrow and its rows are short, so 200% of its height
       * reached dozens of pages ahead — twice PageList's own margin, for images a fraction of the
       * size. Half a screen of lookahead still renders well before the student scrolls to it.
       */
      { root, rootMargin: "50% 0px", threshold: 0 },
    );
    observerRef.current = observer;
    for (const el of itemRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the active thumbnail scrolled into view as the student scrolls the main document.
  useEffect(() => {
    itemRefs.current.get(currentPage)?.scrollIntoView({ block: "nearest" });
  }, [currentPage]);

  return (
    <div ref={scrollRef} className="viewer-scroll h-full overflow-y-auto px-3 py-4">
      <div className="flex flex-col gap-3">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
          <button
            key={pageNumber}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(pageNumber, el);
                observerRef.current?.observe(el);
              } else {
                itemRefs.current.delete(pageNumber);
              }
            }}
            data-thumb-page={pageNumber}
            onClick={() => onSelect(pageNumber)}
            aria-current={currentPage === pageNumber}
            className={`group flex flex-col items-center gap-1.5 rounded-lg p-1.5 text-left transition ${
              currentPage === pageNumber
                ? "bg-[var(--hud-cyan-glow-soft)] ring-1 ring-[var(--hud-cyan)]"
                : "hover:bg-[var(--hud-surface)]"
            }`}
          >
            <ThumbnailImage pageNumber={pageNumber} active={visible.has(pageNumber)} queue={queue} />
            <span
              className={`text-[11px] font-semibold ${
                currentPage === pageNumber ? "text-[var(--hud-cyan-bright)]" : "text-[var(--hud-text-faint)]"
              }`}
            >
              {pageNumber}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const ThumbnailImage = memo(function ThumbnailImage({
  pageNumber,
  active,
  queue,
}: {
  pageNumber: number;
  active: boolean;
  /** Shared with the main page list — see the queue note in this file's header comment. */
  queue: PageQueue;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);
  /** Current visibility, readable from the cleanup — same reason as PageCanvas's visibleRef. */
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active || rendered) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | null = null;
    /*
     * LOW priority (false). A thumbnail is never what the student is reading, so it must always
     * yield to a visible page render; the queue's priority jump is what makes sharing one worker
     * connection safe.
     */
    const pageRequest = queue.getPage(pageNumber, false);

    (async () => {
      const page = await pageRequest.promise;
      if (cancelled) return;
      const viewport = page.getViewport({ scale: THUMB_SCALE });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTask = page.render({ canvasContext: ctx, canvas, viewport });
      await renderTask.promise;
      if (!cancelled) setRendered(true);
    })().catch(() => {
      // A cancelled thumbnail render is routine scroll traffic, not a failure worth surfacing.
    });

    return () => {
      cancelled = true;
      pageRequest.cancel();
      renderTask?.cancel();
      /*
       * Free the backing store once the thumbnail leaves the rail's window. Cancelling the task
       * alone left every thumbnail ever scrolled past holding its canvas for the life of the
       * document — small individually, unbounded across a long PDF.
       */
      if (!activeRef.current) {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        setRendered(false);
      }
    };
  }, [queue, pageNumber, active, rendered]);

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded bg-white shadow-sm">
      {!rendered && <div className="absolute inset-0 animate-pulse bg-[var(--hud-surface)]" />}
      <canvas ref={canvasRef} className="block h-full w-full object-contain" />
    </div>
  );
});
