"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageTextCache } from "@/lib/viewerSearch";
import { searchDocument } from "@/lib/viewerSearch";
import type { SearchMatch } from "@/lib/viewerTypes";

/**
 * Search-with-navigation: find every match across the document, jump between them one at a time.
 *
 * STREAMED, NOT BLOCKING. searchDocument yields matches page-by-page as it scans, so the counter
 * and the first jump target appear as soon as page 1 has a hit rather than after every one of a
 * few hundred pages has been checked — the same reasoning as PageList's virtualization: a long
 * document must never make the student wait for the whole thing before anything useful happens.
 */
export function SearchPanel({
  doc,
  pageCount,
  textCache,
  onClose,
  onMatchChange,
}: {
  doc: PDFDocumentProxy;
  pageCount: number;
  textCache: PageTextCache;
  onClose: () => void;
  /** Fired whenever the active match changes, so the page list can scroll to and ring it. */
  onMatchChange: (match: SearchMatch | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchGenerationRef = useRef(0);
  // Tracks which query the CURRENT `matches`/`activeIndex` were computed for, so the "query went
  // empty" reset below (a render-time adjustment, not an effect) can tell "already reset" apart
  // from "needs resetting" — the same reason usePdfDocument.ts keys its state on the prop it was
  // computed from rather than reading a ref during render.
  const [matchesForQuery, setMatchesForQuery] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /*
   * An emptied query clears results immediately, during render — see usePdfDocument.ts for the
   * general pattern this follows. The debounced async scan below remains the only place a NON-empty
   * query actually finds anything; this only handles the instant, synchronous case of the query
   * becoming empty, which needs no debounce and no network/worker round trip to resolve.
   */
  if (query.trim() === "" && matchesForQuery !== "") {
    setMatches([]);
    setActiveIndex(0);
    setMatchesForQuery("");
    onMatchChange(null);
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const generation = ++searchGenerationRef.current;

    // Debounced by a short delay rather than searching on every keystroke — a 300-page scan is
    // real work, and a student typing "photosynthesis" should not trigger it nine times. Every
    // state change this effect makes, including marking the search as started, happens inside
    // this callback rather than synchronously in the effect body — the effect itself only ever
    // schedules the timer.
    const timer = setTimeout(async () => {
      setSearching(true);
      setMatches([]);
      setActiveIndex(0);
      setMatchesForQuery(trimmed);

      const found: SearchMatch[] = [];
      let announcedFirst = false;
      for await (const pageMatches of searchDocument(doc, pageCount, trimmed, textCache)) {
        if (searchGenerationRef.current !== generation) return;
        found.push(...pageMatches);
        setMatches([...found]);
        if (!announcedFirst) {
          announcedFirst = true;
          onMatchChange(found[0]);
        }
      }
      if (searchGenerationRef.current === generation) setSearching(false);
    }, 250);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMatchChange is a stable dispatcher from the parent
  }, [query, doc, pageCount, textCache]);

  function jump(delta: 1 | -1) {
    if (matches.length === 0) return;
    const next = (activeIndex + delta + matches.length) % matches.length;
    setActiveIndex(next);
    onMatchChange(matches[next]);
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--hud-line-strong)] bg-[var(--hud-bg-2)] px-3 py-2 shadow-lg">
      <Search className="size-4 shrink-0 text-[var(--hud-text-faint)]" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") jump(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") onClose();
        }}
        placeholder="Search document…"
        aria-label="Search document"
        className="w-48 bg-transparent text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none sm:w-64"
      />
      <span className="w-16 shrink-0 whitespace-nowrap text-xs text-[var(--hud-text-faint)]">
        {searching && matches.length === 0 ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : query.trim() ? (
          matches.length > 0 ? (
            `${activeIndex + 1} of ${matches.length}${searching ? "+" : ""}`
          ) : (
            "No matches"
          )
        ) : null}
      </span>
      <button
        onClick={() => jump(-1)}
        disabled={matches.length === 0}
        aria-label="Previous match"
        className="rounded-md p-1 text-[var(--hud-text-faint)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)] disabled:opacity-30"
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        onClick={() => jump(1)}
        disabled={matches.length === 0}
        aria-label="Next match"
        className="rounded-md p-1 text-[var(--hud-text-faint)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)] disabled:opacity-30"
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        onClick={onClose}
        aria-label="Close search"
        className="rounded-md p-1 text-[var(--hud-text-faint)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
