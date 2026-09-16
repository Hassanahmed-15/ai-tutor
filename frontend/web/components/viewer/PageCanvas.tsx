"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Highlight, SearchMatch } from "@/lib/viewerTypes";

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
  doc,
  pageNumber,
  scale,
  visible,
  activeMatch,
  highlights,
  onMeasured,
  registerRef,
}: {
  doc: PDFDocumentProxy;
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

  // Natural size is fetched once per page regardless of visibility, so the placeholder is
  // correctly sized immediately rather than jumping when the page first scrolls into view.
  useEffect(() => {
    let cancelled = false;
    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      const size = { width: viewport.width, height: viewport.height };
      setNaturalSize(size);
      onMeasured(pageNumber, size);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMeasured is a stable dispatcher from the parent
  }, [doc, pageNumber]);

  useEffect(() => {
    if (!visible || !naturalSize) return;
    const generation = ++renderGenerationRef.current;
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled || renderGenerationRef.current !== generation) return;

      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Device pixel ratio makes text crisp on a retina display instead of upscaled and blurry —
      // the canvas is drawn at native resolution and shrunk back down with CSS.
      const dpr = window.devicePixelRatio || 1;
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
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale, visible, naturalSize]);

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
