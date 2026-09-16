"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Maximize2,
  Minus,
  PanelLeft,
  Plus,
  Search,
} from "lucide-react";

/** The persistent top bar: back, page counter/jump, zoom, fit-to-width, search, sidebar toggle. */
export function ViewerToolbar({
  documentName,
  currentPage,
  pageCount,
  zoomPercent,
  sidebarOpen,
  searchOpen,
  onBack,
  onJumpToPage,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onToggleSidebar,
  onToggleSearch,
}: {
  documentName: string;
  currentPage: number;
  pageCount: number;
  zoomPercent: number;
  sidebarOpen: boolean;
  searchOpen: boolean;
  onBack: () => void;
  onJumpToPage: (pageNumber: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onToggleSidebar: () => void;
  onToggleSearch: () => void;
}) {
  const [pageInput, setPageInput] = useState(String(currentPage));

  // Keep the input showing the real current page whenever it changes from scrolling, unless the
  // student is actively typing a new one (tracked by the input still being focused would be more
  // precise, but re-syncing on every prop change is simpler and the input is small enough that a
  // student mid-edit finishing quickly is the common case).
  if (String(currentPage) !== pageInput && document.activeElement?.id !== "viewer-page-input") {
    setPageInput(String(currentPage));
  }

  return (
    /*
     * FLOATS OVER THE PAGE, DOESN'T PUSH IT DOWN. The reader itself should be the whole screen —
     * this is a translucent overlay strip anchored to the top, not a permanent header claiming its
     * own row. It stays put (no auto-hide-on-scroll) because a control bar that vanishes mid-read
     * and has to be summoned back is its own kind of friction; staying thin and translucent is what
     * keeps it out of the way instead.
     */
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-3 pt-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full border border-[var(--hud-line)] bg-[var(--hud-bg-2)]/90 px-2 py-1.5 shadow-lg backdrop-blur-md">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex shrink-0 items-center gap-1 rounded-full p-1.5 text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
        >
          <ArrowLeft className="size-4" />
        </button>

        <p className="hidden max-w-[10rem] truncate pl-0.5 text-xs font-semibold text-[var(--hud-text-dim)] sm:block sm:max-w-[16rem]">
          {documentName}
        </p>

        <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--hud-line)]" />

        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          <input
            id="viewer-page-input"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const n = Number(pageInput);
              if (Number.isFinite(n) && n >= 1 && n <= pageCount) onJumpToPage(n);
            }}
            onBlur={() => {
              const n = Number(pageInput);
              if (Number.isFinite(n) && n >= 1 && n <= pageCount) onJumpToPage(n);
              else setPageInput(String(currentPage));
            }}
            aria-label="Go to page"
            className="w-10 rounded-md border border-transparent bg-black/20 px-1.5 py-1 text-center text-xs text-[var(--hud-text)] focus:border-[var(--hud-cyan)] focus:outline-none"
          />
          <span className="text-xs text-[var(--hud-text-faint)]">/ {pageCount}</span>
        </div>

        <button
          onClick={onZoomOut}
          aria-label="Zoom out"
          className="shrink-0 rounded-full p-1.5 text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="hidden w-9 shrink-0 text-center text-xs font-semibold text-[var(--hud-text-dim)] sm:inline">{zoomPercent}%</span>
        <button
          onClick={onZoomIn}
          aria-label="Zoom in"
          className="shrink-0 rounded-full p-1.5 text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          onClick={onFitWidth}
          aria-label="Fit to width"
          title="Fit to width"
          className="hidden shrink-0 rounded-full p-1.5 text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)] sm:block"
        >
          <Maximize2 className="size-3.5" />
        </button>

        <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--hud-line)]" />

        <button
          onClick={onToggleSidebar}
          aria-label="Toggle page thumbnails"
          aria-pressed={sidebarOpen}
          className={`hidden shrink-0 rounded-full p-1.5 transition sm:block ${
            sidebarOpen ? "bg-[var(--hud-cyan-glow-soft)] text-[var(--hud-cyan-bright)]" : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]"
          }`}
        >
          <PanelLeft className="size-4" />
        </button>

        <button
          onClick={onToggleSearch}
          aria-label="Search document"
          aria-pressed={searchOpen}
          className={`shrink-0 rounded-full p-1.5 transition ${
            searchOpen ? "bg-[var(--hud-cyan-glow-soft)] text-[var(--hud-cyan-bright)]" : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]"
          }`}
        >
          <Search className="size-4" />
        </button>
      </div>
    </div>
  );
}
