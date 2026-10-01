"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileWarning, Loader2, LocateFixed, Minus, Plus, RefreshCw } from "lucide-react";
import type { Beat } from "@/lib/lessonContent";
import { pdfTeachingState } from "@/lib/pdfTeachingState";
import { loadDocumentPages } from "@/lib/documentPages";
import { contentStems } from "@/lib/sourceGrounding";
import { isSuprnotesLessonInput } from "@/lib/suprnotes";
import type { PdfFidelity } from "@/lib/sourceScope";

type PageImage = { pageNumber: number; dataUrl: string };
type PageResponse = { unit?: "page" | "slide"; pages?: PageImage[]; error?: string };

export function PdfSourcePanel({
  documentId,
  sourceDocument,
  beats,
  currentIndex,
  fidelity,
  embedded = false,
  activeSentence = "",
  onPointerRect,
}: {
  documentId: string;
  sourceDocument: unknown;
  beats: Beat[];
  currentIndex: number;
  fidelity: PdfFidelity;
  /** Joined to the board in one frame: no card of its own, a hairline on the shared edge. */
  embedded?: boolean;
  /** The sentence Aria is speaking right now — the pointer marks the part of the page it is about. */
  activeSentence?: string;
  /** Where the pointed-at passage is on screen (or null when it is scrolled out of view), so the
   *  player can draw the arrow from it to the board. */
  onPointerRect?: (rect: DOMRect | null) => void;
}) {
  const [pages, setPages] = useState<PageImage[]>([]);
  const [unit, setUnit] = useState<"page" | "slide">("page");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [followTeacher, setFollowTeacher] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const focus = useMemo(
    () => pdfTeachingState(beats, currentIndex, sourceDocument),
    [beats, currentIndex, sourceDocument],
  );

  /*
   * WHAT IS BEING SAID, ON THE PAGE. The whole part's passage used to light up at once for the
   * entire slide, so the student could not tell which lines Aria was on. Each spoken sentence is
   * matched to the block of this part that shares the most content words with it; that block gets
   * the pointer, and it moves as she speaks. A sentence that matches nothing keeps the last pointer
   * rather than flickering it away.
   */
  const blockText = useMemo(() => {
    const map = new Map<string, string>();
    if (isSuprnotesLessonInput(sourceDocument)) {
      for (const block of sourceDocument.contentBlocks ?? []) map.set(block.id, `${block.heading ?? ""} ${block.text ?? ""}`);
    }
    return map;
  }, [sourceDocument]);
  const lastPointerRef = useRef<{ index: number; blockId: string | null }>({ index: -1, blockId: null });
  const pointerBlockId = useMemo(() => {
    const said = new Set(contentStems(activeSentence));
    let best: { id: string; score: number } | null = null;
    if (said.size > 0) {
      for (const highlight of focus.highlights) {
        if (!highlight.rect) continue;
        const stems = new Set(contentStems(blockText.get(highlight.blockId) ?? ""));
        let score = 0;
        for (const stem of said) if (stems.has(stem)) score += 1;
        if (score > 0 && (!best || score > best.score)) best = { id: highlight.blockId, score };
      }
    }
    const last = lastPointerRef.current;
    if (best) return best.id;
    // Same part and no match: keep where the pointer was. A new part starts on its first block.
    if (last.index === currentIndex && last.blockId) return last.blockId;
    return focus.highlights.find((highlight) => highlight.rect)?.blockId ?? null;
  }, [activeSentence, focus.highlights, blockText, currentIndex]);
  useEffect(() => {
    lastPointerRef.current = { index: currentIndex, blockId: pointerBlockId };
  }, [currentIndex, pointerBlockId]);

  /*
   * REPORT THE POINTER'S POSITION for the PDF-to-board arrow. Re-measured on every scroll, resize
   * and pointer change (one measurement per frame), and reported as null once the passage has
   * scrolled out of the panel — an arrow must never point at something the student cannot see.
   */
  const pointerRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!onPointerRect) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const marker = pointerRef.current;
        const panel = scrollRef.current;
        if (!marker || !panel) return onPointerRect(null);
        const rect = marker.getBoundingClientRect();
        const view = panel.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        onPointerRect(middle < view.top + 8 || middle > view.bottom - 8 ? null : rect);
      });
    };
    measure();
    const panel = scrollRef.current;
    panel?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // A smooth scroll to the new passage settles over ~half a second; measure again after it.
    const settle = window.setTimeout(measure, 700);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      panel?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [onPointerRect, pointerBlockId, zoom, pages.length, currentIndex, loading]);

  const loadPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadDocumentPages(documentId);
      setPages(data.pages);
      setUnit(data.unit);
      setCurrentPage((value) => value ?? data.pages[0]?.pageNumber ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the source pages.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { void loadPages(); }, [loadPages]);

  /*
   * A NEW PART TAKES THE PANEL BACK TO THE SOURCE. Scrolling the panel by hand pauses following —
   * the student is looking at something — but it used to pause it for the rest of the lecture, so
   * one stray wheel left every later part's passage off-screen until the ⌖ button was found. The
   * pause now lasts for the part it happened in.
   */
  const [followedIndex, setFollowedIndex] = useState(currentIndex);
  if (followedIndex !== currentIndex) {
    setFollowedIndex(currentIndex);
    setFollowTeacher(true);
  }

  useEffect(() => {
    if (!followTeacher || focus.activePage === null) return;
    const target = pageRefs.current.get(focus.activePage);
    const root = scrollRef.current;
    if (!target || !root) return;
    /*
     * Scroll to the PASSAGE, not the page top. A page is taller than the panel, so aligning its top
     * showed the publisher header while the highlighted paragraph sat below the fold. The first
     * highlight on the page is placed a third of the way down the viewport.
     */
    // Follow the POINTER — the block being spoken about — not just the part's first block.
    const pointed = focus.highlights.find((highlight) => highlight.blockId === pointerBlockId && highlight.rect);
    const rect = (pointed && pointed.pageNumber === focus.activePage ? pointed.rect : null)
      ?? focus.highlights.find((highlight) => highlight.pageNumber === focus.activePage && highlight.rect)?.rect;
    const pageTop = target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    const image = target.querySelector("img");
    const passageTop = rect && image ? pageTop + image.offsetTop + rect.y * image.clientHeight - root.clientHeight / 3 : pageTop - 12;
    root.scrollTo({ top: Math.max(0, passageTop), behavior: "smooth" });
    setCurrentPage(focus.activePage);
  }, [focus.activePage, focus.highlights, currentIndex, followTeacher, pages.length, zoom, pointerBlockId]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pages.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const page = Number((visible.target as HTMLElement).dataset.sourcePage);
      if (Number.isInteger(page)) setCurrentPage(page);
    }, { root, threshold: [0.25, 0.5, 0.75] });
    pageRefs.current.forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [pages]);

  const movePage = (direction: -1 | 1) => {
    if (pages.length === 0) return;
    const index = Math.max(0, pages.findIndex((page) => page.pageNumber === currentPage));
    const target = pages[Math.max(0, Math.min(pages.length - 1, index + direction))];
    if (!target) return;
    setFollowTeacher(false);
    setCurrentPage(target.pageNumber);
    pageRefs.current.get(target.pageNumber)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const completed = focus.completedBlockIds.length;
  const total = focus.totalBlocks;
  const pageLabel = unit === "slide" ? "Slide" : "Page";
  const currentPosition = pages.findIndex((page) => page.pageNumber === currentPage);

  return (
    <section aria-label="Source document" className={`relative flex min-h-0 flex-col overflow-hidden bg-[#11100f] ${embedded ? "border-b border-[var(--hud-line)] lg:border-b-0 lg:border-r" : "rounded-[var(--radius)] border border-[var(--hud-line)]"}`}>
      {/* ONE bar, the same height as the board's "Part N" strip beside it, so the two halves line up
          as one surface. Page navigation lives here too — the footer it had cost the page a row. */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--hud-line)] px-2">
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] ${fidelity === "strict" ? "bg-amber-300/15 text-amber-200" : "bg-cyan-300/10 text-cyan-200"}`}>
          {fidelity === "strict" ? "Strict" : "Reference"}
        </span>
        <p className="hidden min-w-0 truncate px-1 text-[0.7rem] tabular-nums text-[var(--hud-text-faint)] xl:block" aria-live="polite">
          {total > 0 ? `${completed}/${total} covered` : "Following the lesson"}
        </p>
        <div className="mx-auto flex items-center">
          <button type="button" onClick={() => movePage(-1)} disabled={!pages.length || currentPage === pages[0]?.pageNumber} aria-label={`Previous ${unit}`} className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 disabled:opacity-25"><ChevronLeft size={15} /></button>
          <span className="min-w-20 text-center text-[0.72rem] font-semibold tabular-nums text-white/65">{pageLabel} {currentPage ?? "—"}{currentPosition >= 0 && pages.length > 1 ? ` · ${currentPosition + 1}/${pages.length}` : ""}</span>
          <button type="button" onClick={() => movePage(1)} disabled={!pages.length || currentPage === pages[pages.length - 1]?.pageNumber} aria-label={`Next ${unit}`} className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 disabled:opacity-25"><ChevronRight size={15} /></button>
        </div>
        <button type="button" onClick={() => setFollowTeacher((value) => !value)} aria-pressed={followTeacher} className={`grid size-8 place-items-center rounded-lg transition ${followTeacher ? "bg-amber-300/15 text-amber-200" : "text-white/50 hover:bg-white/10"}`} title={followTeacher ? "Following Aria" : "Resume following Aria"}>
          <LocateFixed size={15} />
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(0.7, Number((value - 0.1).toFixed(1))))} aria-label="Zoom out source" className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10"><Minus size={15} /></button>
        <span className="w-9 text-center text-[0.67rem] tabular-nums text-white/45">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(1.6, Number((value + 0.1).toFixed(1))))} aria-label="Zoom in source" className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10"><Plus size={15} /></button>
      </div>

      <div className="h-0.5 shrink-0 bg-white/5" aria-hidden="true">
        <div className="h-full bg-amber-300 transition-[width] duration-500" style={{ width: `${total ? (completed / total) * 100 : 0}%` }} />
      </div>

      {loading ? (
        <div className="grid min-h-0 flex-1 place-items-center text-center">
          <div><Loader2 className="mx-auto animate-spin text-white/40" size={20} /><p className="mt-2 text-xs text-white/45">Opening the selected source…</p></div>
        </div>
      ) : error ? (
        <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
          <div className="max-w-xs"><FileWarning className="mx-auto text-amber-200/70" size={24} /><p className="mt-3 text-sm font-semibold text-white/80">Source preview unavailable</p><p className="mt-1 text-xs leading-relaxed text-white/45">{error} The lesson can continue from its extracted source text.</p><button type="button" onClick={() => void loadPages()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10"><RefreshCw size={13} /> Retry preview</button></div>
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain bg-[#090807] p-3" onWheel={() => setFollowTeacher(false)}>
          <div className="mx-auto flex min-w-fit flex-col gap-5" style={{ width: `${zoom * 100}%`, maxWidth: `${zoom * 54}rem` }}>
            {pages.map((page) => {
              const active = focus.activePage === page.pageNumber;
              const pageHighlights = focus.highlights.filter((highlight) => highlight.pageNumber === page.pageNumber);
              return (
                <div key={page.pageNumber} ref={(node) => { if (node) pageRefs.current.set(page.pageNumber, node); else pageRefs.current.delete(page.pageNumber); }} data-source-page={page.pageNumber} className="scroll-mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-[0.65rem] text-white/40"><span>{pageLabel} {page.pageNumber}</span>{active && <span className="font-semibold text-amber-200">Aria is teaching here</span>}</div>
                  <div className={`relative overflow-hidden bg-white shadow-2xl transition-shadow ${active ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-[#090807]" : "ring-1 ring-white/10"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- private data URL from the parser. */}
                    <img src={page.dataUrl} alt={`${pageLabel} ${page.pageNumber}`} className="block h-auto w-full" />
                    {/* One even dim around the passage. Each box used to cast its own 9999px shadow,
                        so four boxes greyed the page four times over — highlights included. */}
                    {pageHighlights.some((highlight) => highlight.rect) && (
                      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                        <defs>
                          <mask id={`source-dim-${page.pageNumber}`}>
                            <rect width="1" height="1" fill="white" />
                            {pageHighlights.map((highlight) => highlight.rect && (
                              <rect key={highlight.blockId} x={highlight.rect.x} y={highlight.rect.y} width={highlight.rect.width} height={highlight.rect.height} fill="black" />
                            ))}
                          </mask>
                        </defs>
                        <rect width="1" height="1" fill="rgba(15,12,9,0.22)" mask={`url(#source-dim-${page.pageNumber})`} />
                      </svg>
                    )}
                    {pageHighlights.map((highlight) => highlight.rect ? (
                      highlight.blockId === pointerBlockId ? (
                        <span key={highlight.blockId} ref={pointerRef} className="pointer-events-none absolute" style={{ left: `${highlight.rect.x * 100}%`, top: `${highlight.rect.y * 100}%`, width: `${highlight.rect.width * 100}%`, height: `${highlight.rect.height * 100}%` }}>
                          {/* What Aria is saying NOW: a solid marker and an arrow pointing at it. */}
                          <span className="absolute inset-0 rounded-[3px] border-[3px] border-amber-500 bg-amber-300/30 shadow-[0_0_0_3px_rgba(245,158,11,0.18)] transition-all duration-300" />
                          <span aria-hidden="true" className="absolute top-1/2 -translate-y-1/2 animate-pulse text-[1.35rem] leading-none text-amber-500 drop-shadow" style={{ right: "calc(100% + 4px)" }}>▶</span>
                        </span>
                      ) : (
                        <span key={highlight.blockId} className="pointer-events-none absolute rounded-[2px] border border-dashed border-amber-500/50 bg-amber-300/[0.06] transition-all duration-300" title={highlight.label} style={{ left: `${highlight.rect.x * 100}%`, top: `${highlight.rect.y * 100}%`, width: `${highlight.rect.width * 100}%`, height: `${highlight.rect.height * 100}%` }} />
                      )
                    ) : (
                      <span key={highlight.blockId} className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-amber-400" title={highlight.label} />
                    ))}
                    {/* The tag that names what is being taught, on the first highlighted passage —
                        the same words as the board's "Part N" strip beside it. */}
                    {(() => {
                      const first = pageHighlights.find((highlight) => highlight.rect)?.rect;
                      const beatTitle = beats[currentIndex]?.title;
                      if (!first || !beatTitle) return null;
                      return (
                        <span
                          className="pointer-events-none absolute z-10 max-w-[70%] -translate-y-full truncate rounded-t-md bg-amber-500 px-1.5 py-0.5 text-[0.62rem] font-bold text-[#1a1206] shadow"
                          style={{ left: `${first.x * 100}%`, top: `${first.y * 100}%` }}
                        >
                          Part {currentIndex + 1} · {beatTitle}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </section>
  );
}
