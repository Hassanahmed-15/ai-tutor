"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PageCanvas } from "./PageCanvas";
import type { PageQueue } from "@/lib/pdfPageQueue";
import type { Highlight, SearchMatch } from "@/lib/viewerTypes";

/**
 * The scrollable page stack — virtualization lives here, not in PageCanvas.
 *
 * ONE OBSERVER, MANY TARGETS. A single IntersectionObserver watches every page element at once
 * (rather than one observer per page) with a generous rootMargin, so pages a couple of screens away
 * start decoding before they are actually visible — the student should never see a blank flash
 * while scrolling. "Visible" here means "close enough to render", not "on screen right now"; a page
 * that leaves that margin is marked not-visible again, so PageCanvas can drop its canvas/text-layer
 * content and the browser reclaims that memory. THIS is what keeps a 300-page document usable: at
 * any moment only a handful of pages actually hold decoded raster + text, however many the document
 * has.
 */
export function PageList({
  doc,
  pageCount,
  scale,
  activeMatch,
  highlightsByPage,
  scrollToPage,
  onCurrentPageChange,
  queue,
}: {
  doc: PDFDocumentProxy;
  pageCount: number;
  scale: number;
  activeMatch: SearchMatch | null;
  highlightsByPage: Map<number, Highlight[]>;
  /** Set by the parent (page-number input, thumbnail click, search jump) to request a scroll. */
  scrollToPage: number | null;
  /** Reported upward so the page-counter UI can show "12 of 240" as the student scrolls. */
  onCurrentPageChange: (pageNumber: number) => void;
  /**
   * The document's ONE page queue, owned by DocumentViewer.
   *
   * It used to be created here, which left the thumbnail rail with no way to reach it — so the rail
   * called doc.getPage() directly and flooded the single pdf.js worker that this queue exists to
   * protect. One queue per document, shared by everything that touches it.
   */
  queue: PageQueue;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
  const naturalSizesRef = useRef<Map<number, { width: number; height: number }>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const registerRef = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    const map = pageElsRef.current;
    const existing = map.get(pageNumber);
    if (existing && observerRef.current) observerRef.current.unobserve(existing);
    if (el) {
      map.set(pageNumber, el);
      observerRef.current?.observe(el);
    } else {
      map.delete(pageNumber);
    }
  }, []);

  const onMeasured = useCallback((pageNumber: number, size: { width: number; height: number }) => {
    naturalSizesRef.current.set(pageNumber, size);
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
            if (!Number.isFinite(pageNumber)) continue;
            const was = next.has(pageNumber);
            if (entry.isIntersecting && !was) {
              next.add(pageNumber);
              changed = true;
            } else if (!entry.isIntersecting && was) {
              next.delete(pageNumber);
              changed = true;
            }
          }
          return changed ? next : prev;
        });

        // The topmost intersecting page becomes "current" for the page counter — not the whole
        // set, since several pages are legitimately visible at once mid-scroll.
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length > 0) {
          const top = intersecting.reduce((min, e) =>
            e.boundingClientRect.top < min.boundingClientRect.top ? e : min,
          );
          const pageNumber = Number((top.target as HTMLElement).dataset.pageNumber);
          if (Number.isFinite(pageNumber)) onCurrentPageChange(pageNumber);
        }
      },
      // A page one full viewport away in either direction starts rendering — generous enough that
      // fast scrolling rarely outruns it, cheap enough that it is not effectively "render everything".
      { root, rootMargin: "100% 0px", threshold: 0 },
    );
    observerRef.current = observer;
    for (const el of pageElsRef.current.values()) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onCurrentPageChange is a stable dispatcher from the parent
  }, []);

  useEffect(() => {
    if (scrollToPage == null) return;
    const el = pageElsRef.current.get(scrollToPage);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToPage]);

  return (
    <div ref={scrollRef} className="viewer-scroll h-full overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-8">
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
        <PageCanvas
          key={pageNumber}
          queue={queue}
          pageNumber={pageNumber}
          scale={scale}
          visible={visiblePages.has(pageNumber)}
          activeMatch={activeMatch?.pageNumber === pageNumber ? activeMatch : null}
          highlights={highlightsByPage.get(pageNumber) ?? []}
          onMeasured={onMeasured}
          registerRef={registerRef}
        />
      ))}
    </div>
  );
}
