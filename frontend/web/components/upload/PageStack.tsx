"use client";

import { Check } from "lucide-react";
import { PageAreaSelect } from "@/components/upload/PageAreaSelect";
import type { DocumentPage, NormalisedRect } from "@/components/upload/PageSelector";

/**
 * A continuous, Acrobat-style scroller through every page of the upload, replacing what used to be
 * a single static preview of just the focused page plus a separate thumbnail-grid side panel.
 *
 * NO VIRTUALIZATION NEEDED HERE. Unlike the standalone document viewer (components/viewer/PageList
 * + PageCanvas), this pipeline caps uploads at DOCUMENT_LIMITS.MAX_PAGES = 20 — the whole lesson is
 * written from the complete document in one model call, so twenty already-rendered `data:` URI
 * thumbnails is nothing to lazily gate; mounting all of them plainly is simpler and cannot repeat
 * the "hundreds of getPage() calls flood the worker" bug that virtualization exists to prevent
 * in the viewer. Each page keeps its own independent crop-region selector (PageAreaSelect) so a
 * region can be dragged on any page without first "opening" it, and its own selection control, so
 * choosing pages happens in the document itself rather than in a separate grid.
 */
export function PageStack({
  pages,
  regions,
  onRegionChange,
  selected,
  onToggleSelected,
  onUseRegion,
  label = "pages",
}: {
  pages: DocumentPage[];
  regions: Record<number, NormalisedRect>;
  onRegionChange: (pageNumber: number, rect: NormalisedRect | undefined) => void;
  /** Page numbers chosen so far, in the order they were chosen. */
  selected: number[];
  onToggleSelected: (pageNumber: number) => void;
  /** Build a lecture from just this page's cropped region right now, without waiting for the
   *  header's "Use N pages" button. */
  onUseRegion: (pageNumber: number) => void;
  /** "pages" for a PDF, "slides" for a deck. */
  label?: "pages" | "slides";
}) {
  const order = new Map(selected.map((n, i) => [n, i + 1]));

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain px-6 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        {pages.map((page) => {
          const position = order.get(page.pageNumber);
          const isSelected = position !== undefined;
          return (
            <div key={page.pageNumber} data-page-number={page.pageNumber} className="relative">
              <div className="mb-2 flex items-center justify-center gap-3">
                <p className="text-[0.72rem] font-semibold text-[var(--hud-text-faint)]">
                  {label === "pages" ? "Page" : "Slide"} {page.pageNumber}
                </p>
                {/* Selection lives here, not in a separate grid — a small control next to the page
                    label, deliberately outside the draggable image so it never fights the
                    crop-region drag gesture. */}
                <button
                  type="button"
                  onClick={() => onToggleSelected(page.pageNumber)}
                  aria-pressed={isSelected}
                  aria-label={
                    isSelected
                      ? `Deselect ${label === "pages" ? "page" : "slide"} ${page.pageNumber} (position ${position})`
                      : `Select ${label === "pages" ? "page" : "slide"} ${page.pageNumber}`
                  }
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold transition-colors"
                  style={{
                    borderColor: isSelected ? "var(--hud-cyan)" : "var(--hud-line)",
                    background: isSelected ? "var(--hud-cyan)" : "transparent",
                    color: isSelected ? "var(--hud-bg)" : "var(--hud-text-faint)",
                  }}
                >
                  {isSelected ? (
                    <>
                      <Check size={11} strokeWidth={3} aria-hidden="true" />
                      {position}
                    </>
                  ) : (
                    "Select"
                  )}
                </button>
              </div>
              <div
                className="rounded-[var(--radius)] transition-shadow"
                style={{ boxShadow: isSelected ? "0 0 0 3px var(--hud-cyan)" : "none" }}
              >
                <PageAreaSelect
                  src={page.thumbnail}
                  alt={`Page ${page.pageNumber}`}
                  rect={regions[page.pageNumber]}
                  onChange={(rect) => onRegionChange(page.pageNumber, rect)}
                  fill={false}
                  onUseRegion={() => onUseRegion(page.pageNumber)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
