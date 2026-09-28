"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadDocumentPages } from "@/lib/documentPages";
import { contentStems } from "@/lib/sourceGrounding";

type Box = { x: number; y: number; width: number; height: number };

/**
 * THE TEXTBOOK'S OWN FIGURE, TAUGHT PART BY PART.
 *
 * A board redrawn by a model from a PDF figure was never the figure: its shapes were guesses, its
 * parts misplaced, and its labels the weakest thing on screen. When a part of the lesson has a
 * printed figure, this board shows THAT figure — cropped from the student's own page and enlarged —
 * and lights up each part the moment Aria names it, using where the book printed that part's label.
 * Nothing on it is generated, so nothing on it can be wrong, and it costs no model call.
 */
export function SourceFigureBoard({
  documentId,
  pageNumber,
  crop,
  labels,
  sentence,
  spoken,
}: {
  documentId: string;
  pageNumber: number;
  /** The figure's region of the page, 0..1. */
  crop: Box;
  /** Each printed label and where it sits on the page, 0..1. */
  labels: Array<{ text: string; bbox: Box }>;
  /** The sentence being spoken now. */
  sentence: string;
  /** Everything spoken on this board so far — parts named earlier stay softly marked. */
  spoken: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    let alive = true;
    loadDocumentPages(documentId)
      .then((data) => {
        const page = data.pages.find((item) => item.pageNumber === pageNumber);
        if (alive && page) setSrc(page.dataUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [documentId, pageNumber]);

  useEffect(() => {
    if (!src) return;
    const image = new Image();
    image.onload = () => setNatural({ w: image.naturalWidth, h: image.naturalHeight });
    image.src = src;
  }, [src]);

  useLayoutEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const measure = () => setHost({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A part is "named" when every content word of its label is in the sentence ("cell wall" needs
  // both); a one-word label needs that word.
  const named = (text: string, said: Set<string>) => {
    const stems = contentStems(text);
    return stems.length > 0 && stems.every((stem) => said.has(stem));
  };
  const now = useMemo(() => new Set(contentStems(sentence)), [sentence]);
  const before = useMemo(() => new Set(contentStems(spoken)), [spoken]);

  // Fit the crop into the board at its true aspect ratio.
  const aspect = natural ? (crop.width * natural.w) / Math.max(1, crop.height * natural.h) : crop.width / Math.max(0.01, crop.height);
  const pad = 32;
  const maxW = Math.max(0, host.w - pad * 2);
  const maxH = Math.max(0, host.h - pad * 2);
  const width = Math.min(maxW, maxH * aspect);
  const height = width / aspect;

  return (
    <div ref={hostRef} className="relative flex h-full w-full items-center justify-center bg-[#fbfbf8]">
      {src && width > 0 && (
        <div
          className="relative overflow-hidden rounded-lg shadow-[0_2px_18px_rgba(15,23,42,0.12)] ring-1 ring-slate-200"
          style={{ width, height }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the student's own page, a private data URL. */}
          <img
            src={src}
            alt={`Figure from page ${pageNumber}`}
            className="absolute max-w-none select-none"
            draggable={false}
            style={{
              width: `${100 / crop.width}%`,
              left: `${(-crop.x / crop.width) * 100}%`,
              top: `${(-crop.y / crop.height) * 100}%`,
            }}
          />
          {labels.map((label) => {
            const active = named(label.text, now);
            const earlier = !active && named(label.text, before);
            if (!active && !earlier) return null;
            const box = {
              left: `${((label.bbox.x - crop.x) / crop.width) * 100}%`,
              top: `${((label.bbox.y - crop.y) / crop.height) * 100}%`,
              width: `${(label.bbox.width / crop.width) * 100}%`,
              height: `${(label.bbox.height / crop.height) * 100}%`,
            };
            return (
              <span key={label.text} className="pointer-events-none absolute" style={box}>
                <span
                  className={`absolute -inset-1.5 rounded-md border-[3px] transition-all duration-300 ${
                    active ? "border-amber-500 bg-amber-300/35 shadow-[0_0_0_4px_rgba(245,158,11,0.2)]" : "border-amber-400/50 bg-amber-200/20"
                  }`}
                />
                {active && (
                  <span aria-hidden="true" className="absolute top-1/2 -translate-y-1/2 animate-pulse text-[1.4rem] leading-none text-amber-500 drop-shadow" style={{ right: "calc(100% + 10px)" }}>
                    ▶
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
      <span className="pointer-events-none absolute bottom-2 right-3 rounded-md bg-white/85 px-2 py-0.5 text-[0.7rem] font-semibold text-slate-500">
        From your source · page {pageNumber}
      </span>
    </div>
  );
}

/**
 * The printed figure a beat teaches, if its source blocks include one: the page, the figure's region
 * (the labels' extent, widened to take in the drawing they surround), and each label's position.
 */
export function sourceFigureFor(
  blocks: Array<{ id: string; role?: string; pageNumber?: number; bbox?: Box; labelRegions?: Array<{ text: string; bbox: Box }> }>,
  sourceBlockIds: string[] | undefined,
): { pageNumber: number; crop: Box; labels: Array<{ text: string; bbox: Box }> } | null {
  if (!sourceBlockIds?.length) return null;
  const wanted = new Set(sourceBlockIds);
  const figure = blocks.find((block) => wanted.has(block.id) && block.role === "figure-labels" && block.bbox && block.labelRegions?.length && typeof block.pageNumber === "number");
  if (!figure || !figure.bbox || typeof figure.pageNumber !== "number") return null;
  const b = figure.bbox;
  const padX = Math.max(0.03, b.width * 0.08);
  const padY = Math.max(0.03, b.height * 0.12);
  const x = Math.max(0, b.x - padX);
  const y = Math.max(0, b.y - padY);
  const crop = { x, y, width: Math.min(1, b.x + b.width + padX) - x, height: Math.min(1, b.y + b.height + padY) - y };
  return { pageNumber: figure.pageNumber, crop, labels: figure.labelRegions ?? [] };
}
