"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { Highlight, SearchMatch } from "@/lib/viewerTypes";
import type { PageQueue } from "@/lib/pdfPageQueue";

/**
 * One page of the document: a rendered canvas with a REAL, invisible, selectable text layer laid
 * exactly on top of it. This is the difference between "a picture of a PDF" and "a PDF" — the text
 * the student sees is glyphs pdf.js drew; the text the browser can select, search-highlight and
 * copy is a separate DOM layer of positioned spans pdf.js generates from the actual PDF text
 * content stream, invisible but pixel-aligned to the canvas underneath it.
 *
 * LAZY BY DEFAULT. A page starts as an empty placeholder sized to its own aspect ratio (so the
 * scrollbar and surrounding layout never jump once real content arrives) and only asks pdf.js to
 * decode and render once an IntersectionObserver says it is near the viewport. This is what keeps
 * a 300-page document from decoding 300 pages of raster + text on open — see PageList.tsx for the
 * observer setup this component plugs into.
 */
export const PageCanvas = memo(function PageCanvas({
  queue,
  pageNumber,
  scale,
  visible,
  activeMatch,
  highlights,
  onMeasured,
  registerRef,
}: {
  /** Shared, concurrency-limited getPage() queue for the whole document — see lib/pdfPageQueue.ts. */
  queue: PageQueue;
  pageNumber: number;
  /** CSS pixels per PDF point. 1.0 is "100%"; fit-to-width computes this from the container. */
  scale: number;
  /** True once the page has entered (or is near) the viewport — gates the actual render. */
  visible: boolean;
  /** The current search match on THIS page, if any, to draw a highlight ring around. */
  activeMatch: SearchMatch | null;
  /** Persisted highlights on THIS page. */
  highlights: Highlight[];
  /** Reports the page's natural (scale=1) size once known, so the shell can size placeholders. */
  onMeasured: (pageNumber: number, size: { width: number; height: number }) => void;
  /** Lets the parent scroll to / measure this exact page element. */
  registerRef: (pageNumber: number, el: HTMLDivElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [rendered, setRendered] = useState(false);
  const renderGenerationRef = useRef(0);
  /*
   * The CURRENT visibility, readable from a cleanup closure.
   *
   * Assigned during render rather than in an effect on purpose: React runs the previous effect's
   * cleanup BEFORE the next effect body, but after the render that changed `visible`. So by the
   * time the cleanup asks "is this page still on screen?", this ref already says no — which is
   * exactly the question it needs answered, and the one the captured `visible` could never answer.
   */
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // Natural size is fetched through the shared, concurrency-limited queue (lib/pdfPageQueue.ts)
  // rather than calling doc.getPage() directly — every PageCanvas in the document mounts at once,
  // so an unqueued call here means hundreds of simultaneous requests flooding the single pdf.js
  // worker connection on a large PDF, starving the render() calls for pages actually on screen.
  // Visible pages jump the queue; off-screen ones wait their turn so the placeholder still ends up
  // correctly sized without competing with what the student is looking at right now.
  useEffect(() => {
    // Once the size is known there is nothing left to fetch — without this check, every
    // visibility toggle (scrolling a page in and out of the observer's margin repeatedly) would
    // re-request it from the queue for no reason.
    if (naturalSize) return;
    let cancelled = false;
    const request = queue.getPage(pageNumber, visible);
    request.promise.then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      const size = { width: viewport.width, height: viewport.height };
      setNaturalSize(size);
      onMeasured(pageNumber, size);
    });
    return () => {
      cancelled = true;
      request.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMeasured is a stable dispatcher from the parent
  }, [queue, pageNumber, visible, naturalSize]);

  useEffect(() => {
    if (!visible || !naturalSize) return;
    const generation = ++renderGenerationRef.current;
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    const pageRequest = queue.getPage(pageNumber, true);

    (async () => {
      const page = await pageRequest.promise;
      if (cancelled || renderGenerationRef.current !== generation) return;

      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Device pixel ratio makes text crisp on a retina display instead of upscaled and blurry —
      // the canvas is drawn at native resolution and shrunk back down with CSS.
      /*
       * DPR IS CAPPED, and the total pixel count with it.
       *
       * The raw ratio was used unbounded, multiplied onto a fit-width scale that can itself reach
       * 3.5. On a retina display that is a 7x linear multiplier — roughly 57 million pixels for one
       * page, ~228 MB of backing store, for a page displayed a few hundred CSS pixels wide. Several
       * of those render at once inside the 100% observer margin.
       *
       * 2 is the point past which more pixels stop being visible on screen; a 3x phone display
       * gains nothing legible from the third multiple at this physical size. The area cap then
       * catches the other direction — a big zoom on a large page — by scaling the ratio down just
       * enough to stay under budget, so the page still renders sharp rather than failing or
       * freezing the tab.
       */
      const MAX_DPR = 2;
      const MAX_CANVAS_PIXELS = 16_000_000;
      let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const wanted = viewport.width * viewport.height * dpr * dpr;
      if (wanted > MAX_CANVAS_PIXELS) {
        dpr = Math.max(1, dpr * Math.sqrt(MAX_CANVAS_PIXELS / wanted));
      }
      canvas.width = Math.ceil(viewport.width * dpr);
      canvas.height = Math.ceil(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderTask = page.render({ canvasContext: ctx, canvas, viewport });
      await renderTask.promise;
      if (cancelled || renderGenerationRef.current !== generation) return;

      // The text layer: an absolutely-positioned, transparent DOM copy of the page's real text,
      // sized and placed to line up glyph-for-glyph with what the canvas just drew. This is what
      // gives the browser something real to select, Ctrl/Cmd+C, and search — not a screenshot.
      const textLayerEl = textLayerRef.current;
      if (textLayerEl) {
        textLayerEl.replaceChildren();
        textLayerEl.style.width = `${viewport.width}px`;
        textLayerEl.style.height = `${viewport.height}px`;
        const { TextLayer } = await import("pdfjs-dist");
        const textContent = await page.getTextContent();
        const layer = new TextLayer({ textContentSource: textContent, container: textLayerEl, viewport });
        await layer.render();
      }

      if (!cancelled && renderGenerationRef.current === generation) setRendered(true);
    })().catch((err) => {
      // A cancelled render throws by design (pdf.js's own RenderingCancelledException) whenever a
      // page scrolls out of view mid-render; that is expected traffic, not a failure to surface.
      if (!cancelled && renderGenerationRef.current === generation) {
        console.error(`[viewer] page ${pageNumber} render failed`, err);
      }
    });

    return () => {
      cancelled = true;
      pageRequest.cancel();
      renderTask?.cancel();

      /*
       * ACTUALLY RELEASE THE PAGE. Cancelling the render was never enough.
       *
       * PageList's own comment claims "PageCanvas can drop its canvas/text-layer content and the
       * browser reclaims that memory" — it did not. The canvas kept its full backing store and the
       * text layer kept its thousands of positioned spans for the life of the document, so
       * scrolling a long PDF accumulated every page ever rendered: at devicePixelRatio 2 that is
       * roughly 4-8 MB per page, hundreds of megabytes over a few hundred pages. That is the
       * "long PDFs become unstable" symptom.
       *
       * Setting width/height to 0 is what actually frees a canvas's memory — clearRect only paints
       * over it. Resetting `rendered` matters too: it was left true, so the placeholder never came
       * back and a freed page showed a blank canvas instead of its skeleton.
       *
       * READ VISIBILITY FROM A REF, NOT THE CLOSURE. This guard used to test `visible` directly and
       * was therefore dead code: the effect body above returns early unless `visible` is true, so a
       * cleanup only ever exists for a render where it was true, and the closure captured that
       * `true`. Scrolling a page out ran this cleanup with `visible === true` in scope, the guard
       * never passed, and nothing was ever freed — the exact growth the comment above describes,
       * left in place by the fix that claimed to have solved it.
       */
      if (!visibleRef.current) {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        textLayerRef.current?.replaceChildren();
        setRendered(false);
      }
    };
  }, [queue, pageNumber, scale, visible, naturalSize]);

  const width = naturalSize ? naturalSize.width * scale : 0;
  const height = naturalSize ? naturalSize.height * scale : 0;

  return (
    <div
      ref={(el) => registerRef(pageNumber, el)}
      data-page-number={pageNumber}
      className="viewer-page relative mx-auto mb-4 rounded-lg bg-white shadow-[0_2px_24px_rgba(0,0,0,0.35)]"
      style={{ width: width || undefined, height: height || 400 }}
    >
      {!rendered && (
        <div className="absolute inset-0 grid animate-pulse place-items-center rounded-lg bg-[var(--hud-surface)]">
          <span className="text-xs font-semibold text-[var(--hud-text-faint)]">Page {pageNumber}</span>
        </div>
      )}
      <canvas ref={canvasRef} className="block" />
      {naturalSize &&
        highlights.map((h) => (
          <div key={h.id}>
            {h.rects.map((rect, i) => (
              <div
                key={i}
                className="viewer-highlight-mark"
                style={{
                  left: rect.x * scale,
                  top: (naturalSize.height - rect.y - rect.height) * scale,
                  width: rect.width * scale,
                  height: rect.height * scale,
                  background: h.color,
                }}
              />
            ))}
          </div>
        ))}
      <div
        ref={textLayerRef}
        className="viewer-text-layer pointer-events-auto absolute inset-0 origin-top-left select-text"
        style={{ ["--total-scale-factor" as string]: scale }}
      />
      {activeMatch && naturalSize && (
        <div
          className="pointer-events-none absolute rounded-sm ring-2 ring-[var(--hud-cyan-bright)] ring-offset-1"
          style={{
            left: activeMatch.rect.x * scale,
            top: (naturalSize.height - activeMatch.rect.y - activeMatch.rect.height) * scale,
            width: activeMatch.rect.width * scale,
            height: activeMatch.rect.height * scale,
            background: "rgba(240, 171, 252, 0.35)",
          }}
        />
      )}
    </div>
  );
});
