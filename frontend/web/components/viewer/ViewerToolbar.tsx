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
    <div className="flex items-center gap-2 border-b border-[var(--hud-line)] bg-[var(--hud-bg-2)] px-3 py-2 sm:px-4">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
      >
        <ArrowLeft className="size-4" />
        <span className="hidden md:inline">Back</span>
      </button>

      <button
        onClick={onToggleSidebar}
        aria-label="Toggle page thumbnails"
        aria-pressed={sidebarOpen}
        className={`shrink-0 rounded-lg p-1.5 transition ${
          sidebarOpen ? "bg-[var(--hud-cyan-glow-soft)] text-[var(--hud-cyan-bright)]" : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]"
        }`}
      >
        <PanelLeft className="size-4" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--hud-text)]">{documentName}</p>
      </div>

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
          className="w-12 rounded-md border border-[var(--hud-line)] bg-transparent px-2 py-1 text-center text-xs text-[var(--hud-text)] focus:border-[var(--hud-cyan)] focus:outline-none"
        />
        <span className="text-xs text-[var(--hud-text-faint)]">/ {pageCount}</span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[var(--hud-line)] p-0.5">
        <button
          onClick={onZoomOut}
          aria-label="Zoom out"
          className="rounded-md p-1.5 text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="w-10 text-center text-xs font-semibold text-[var(--hud-text-dim)]">{zoomPercent}%</span>
        <button
          onClick={onZoomIn}
          aria-label="Zoom in"
          className="rounded-md p-1.5 text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          onClick={onFitWidth}
          aria-label="Fit to width"
          title="Fit to width"
          className="rounded-md p-1.5 text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>

      <button
        onClick={onToggleSearch}
        aria-label="Search document"
        aria-pressed={searchOpen}
        className={`shrink-0 rounded-lg p-1.5 transition ${
          searchOpen ? "bg-[var(--hud-cyan-glow-soft)] text-[var(--hud-cyan-bright)]" : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]"
        }`}
      >
        <Search className="size-4" />
      </button>
    </div>
  );
}
