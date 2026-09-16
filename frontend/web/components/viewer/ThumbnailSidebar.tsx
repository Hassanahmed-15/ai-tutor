"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * The page-picker rail. Each thumbnail is its OWN tiny render at a fixed low scale — not a
 * downscaled copy of the full-size canvas already drawn in PageList, because that canvas may not
 * exist yet (the real page could be far outside the virtualization window) and a thumbnail must
 * work regardless of whether its page has ever been opened.
 *
 * LAZY THE SAME WAY THE MAIN LIST IS. A 300-page document does not render 300 thumbnails on open
 * either; the sidebar has its own (smaller-margin) IntersectionObserver, because the failure mode
 * this exists to avoid — decoding every page at once — is exactly as real at postage-stamp size.
 */
const THUMB_SCALE = 0.18;

export function ThumbnailSidebar({
  doc,
  pageCount,
  currentPage,
  onSelect,
}: {
  doc: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  onSelect: (pageNumber: number) => void;
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
            }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: "200% 0px", threshold: 0 },
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
            <ThumbnailImage doc={doc} pageNumber={pageNumber} active={visible.has(pageNumber)} />
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
  doc,
  pageNumber,
  active,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!active || rendered) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
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
      renderTask?.cancel();
    };
  }, [doc, pageNumber, active, rendered]);

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded bg-white shadow-sm">
      {!rendered && <div className="absolute inset-0 animate-pulse bg-[var(--hud-surface)]" />}
      <canvas ref={canvasRef} className="block h-full w-full object-contain" />
    </div>
  );
});
