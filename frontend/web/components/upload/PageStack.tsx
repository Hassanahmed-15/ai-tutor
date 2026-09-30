"use client";

import { Check } from "lucide-react";
import type { DocumentPage } from "@/components/upload/PageSelector";

/**
 * A continuous, Acrobat-style scroller through every page of the upload, replacing what used to be
 * a single static preview of just the focused page plus a separate thumbnail-grid side panel.
 *
 * NO VIRTUALIZATION NEEDED HERE. Unlike the standalone document viewer (components/viewer/PageList
 * + PageCanvas), this pipeline caps uploads at DOCUMENT_LIMITS.MAX_PAGES = 20 — the whole lesson is
 * written from the complete document in one model call, so twenty already-rendered `data:` URI
 * thumbnails is nothing to lazily gate; mounting all of them plainly is simpler and cannot repeat
 * the "hundreds of getPage() calls flood the worker" bug that virtualization exists to prevent
 * in the viewer. Each page has its own selection control, so choosing pages happens in the document
 * itself rather than in a separate grid. Pages are chosen whole: dragging a box over part of a page
 * was removed — a question now uses every page, and otherwise the ticked pages are the lecture.
 */
export function PageStack({
  pages,
  selected,
  onToggleSelected,
  label = "pages",
}: {
  pages: DocumentPage[];
  /** Page numbers chosen so far, in the order they were chosen. */
  selected: number[];
  onToggleSelected: (pageNumber: number) => void;
  /** "pages" for a PDF, "slides" for a deck. */
  label?: "pages" | "slides";
}) {
  const order = new Map(selected.map((n, i) => [n, i + 1]));

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain px-6 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        {/*
         * HOW TO USE THIS, in plain words. The page picker explained nothing: a student did not know
         * they could pick pages or ask a question — so they uploaded and hoped.
         */}
        <div className="rounded-xl border border-[var(--hud-line-strong)] bg-white/[0.03] px-5 py-4">
          <p className="text-[0.95rem] font-semibold text-[var(--hud-text)]">How to learn from your {label === "pages" ? "PDF" : "slides"}</p>
          <ol className="mt-2.5 space-y-2 text-[0.88rem] leading-relaxed text-[var(--hud-text-dim)]">
            <li><span className="mr-2 font-semibold text-[var(--hud-cyan)]">1</span>Press <span className="font-semibold text-[var(--hud-text)]">Select {label === "pages" ? "page" : "slide"}</span> on the {label} you want to learn from. Skip this to use all of them.</li>
            <li><span className="mr-2 font-semibold text-[var(--hud-cyan)]">2</span>Have a question? Type it in the box at the bottom, for example <span className="italic text-[var(--hud-text)]">&ldquo;What is starch?&rdquo;</span> Aria answers it from all of the {label}, whichever you selected. Leave it empty to learn the {label} you selected.</li>
            <li><span className="mr-2 font-semibold text-[var(--hud-cyan)]">3</span>Press <span className="font-semibold text-[var(--hud-text)]">Use</span> at the top right to start.</li>
          </ol>
        </div>
        {pages.map((page) => {
          const position = order.get(page.pageNumber);
          const isSelected = position !== undefined;
          return (
            <div key={page.pageNumber} data-page-number={page.pageNumber} className="relative">
              <div className="mb-2 flex items-center justify-center gap-3">
                <p className="text-[0.72rem] font-semibold text-[var(--hud-text-faint)]">
                  {label === "pages" ? "Page" : "Slide"} {page.pageNumber}
                </p>
                {/* Selection lives here, not in a separate grid — a small control next to the page label. */}
                <button
                  type="button"
                  onClick={() => onToggleSelected(page.pageNumber)}
                  aria-pressed={isSelected}
                  aria-label={
                    isSelected
                      ? `Deselect ${label === "pages" ? "page" : "slide"} ${page.pageNumber} (position ${position})`
                      : `Select ${label === "pages" ? "page" : "slide"} ${page.pageNumber}`
                  }
                  // Solid and legible in BOTH states: the unselected button was transparent with faint
                  // text on a dark page — students could not find how to pick a page at all.
                  className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[0.8rem] font-semibold transition-colors hover:brightness-110"
                  style={{
                    borderColor: isSelected ? "var(--hud-cyan)" : "rgba(255,255,255,0.35)",
                    background: isSelected ? "var(--hud-cyan)" : "rgba(255,255,255,0.1)",
                    color: isSelected ? "var(--hud-bg)" : "var(--hud-text)",
                  }}
                >
                  {isSelected ? (
                    <>
                      <Check size={13} strokeWidth={3} aria-hidden="true" />
                      Selected · {position}
                    </>
                  ) : (
                    <>+ Select {label === "pages" ? "page" : "slide"}</>
                  )}
                </button>
              </div>
              <div
                className="rounded-[var(--radius)] transition-shadow"
                style={{ boxShadow: isSelected ? "0 0 0 3px var(--hud-cyan)" : "none" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI has no remote host to
                    optimise and next/image would only add overhead here. */}
                <img
                  src={page.thumbnail}
                  alt={`${label === "pages" ? "Page" : "Slide"} ${page.pageNumber}`}
                  draggable={false}
                  data-page-image
                  className="block w-full max-w-2xl select-none rounded-[var(--radius)] border bg-white object-contain"
                  style={{ borderColor: "var(--hud-line)" }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
