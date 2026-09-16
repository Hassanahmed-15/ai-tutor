"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { usePdfDocument } from "@/lib/usePdfDocument";
import { highlightFromSelection, pageForSelection } from "@/lib/viewerSelection";
import { DEFAULT_HIGHLIGHT_COLOR, type CollectedSnippet, type Highlight, type SearchMatch } from "@/lib/viewerTypes";
import type { PageTextCache } from "@/lib/viewerSearch";
import { ViewerToolbar } from "./ViewerToolbar";
import { PageList } from "./PageList";
import { ThumbnailSidebar } from "./ThumbnailSidebar";
import { SelectionToolbar } from "./SelectionToolbar";
import { CollectedTextPanel } from "./CollectedTextPanel";
import { SearchPanel } from "./SearchPanel";
import type { UploadedDocument } from "./UploadScreen";

const MIN_SCALE = 0.4;
const MAX_SCALE = 3.5;
const ZOOM_STEP = 0.15;

/**
 * The open document: toolbar, thumbnail rail, the page stack, and the collected-text side panel.
 *
 * OWNS SELECTION STATE, NOT PageCanvas. Text selection is a single browser-wide concept (there is
 * one `window.getSelection()`, not one per page), so tracking it here — via a document-level
 * `selectionchange` listener — is the only correct place for it; a page owning "its own" selection
 * state would either miss selections or fight other pages for the same underlying browser API.
 */
export function DocumentViewer({ doc: uploadedDoc, onBack }: { doc: UploadedDocument; onBack: () => void }) {
  const pdfState = usePdfDocument(`/api/viewer-documents/${uploadedDoc.id}`);

  const [scale, setScale] = useState(1);
  const [fitWidthBase, setFitWidthBase] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scrollToPage, setScrollToPage] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collectedPanelOpen, setCollectedPanelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeMatch, setActiveMatch] = useState<SearchMatch | null>(null);

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [collected, setCollected] = useState<CollectedSnippet[]>([]);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  // Bumped once per genuinely new selection, passed to SelectionToolbar so it can reset its own
  // local UI state (its color picker, its "copied" flash) without comparing DOMRect identity,
  // which is unstable across renders even for the same selection — see that component's comment.
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [askOpen, setAskOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const pendingSelectionRef = useRef<{ pageNumber: number; el: HTMLElement } | null>(null);

  // A stable-identity Map, not a ref: SearchPanel is a genuine consumer of it as a value (a
  // prop), not an internal implementation detail being smuggled past render — useState with a
  // lazy initializer is the idiomatic way to hold one mutable object with a stable identity
  // across renders without it being flagged as "read during render" the way a ref would be.
  const [textCache] = useState<PageTextCache>(() => new Map());
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const highlightsByPage = new Map<number, Highlight[]>();
  for (const h of highlights) {
    const list = highlightsByPage.get(h.pageNumber) ?? [];
    list.push(h);
    highlightsByPage.set(h.pageNumber, list);
  }

  // Fit-to-width is a scale computed once the container and the first page's width are both
  // known, then held as a base the +/- zoom buttons multiply against — so "fit width" is a real
  // starting point, not a mode that fights manual zoom.
  useEffect(() => {
    if (pdfState.status !== "ready" || fitWidthBase !== null) return;
    let cancelled = false;
    (async () => {
      const page = await pdfState.doc.getPage(1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      const containerWidth = (scrollAreaRef.current?.clientWidth ?? 800) - 64;
      const base = Math.max(MIN_SCALE, Math.min(MAX_SCALE, containerWidth / viewport.width));
      setFitWidthBase(base);
      setScale(base);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfState, fitWidthBase]);

  // Track selection at the document level — see the class comment for why it cannot live per-page.
  useEffect(() => {
    function onSelectionChange() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionRect(null);
        pendingSelectionRef.current = null;
        return;
      }
      const located = pageForSelection(selection);
      if (!located) {
        setSelectionRect(null);
        return;
      }
      pendingSelectionRef.current = located;
      const range = selection.getRangeAt(0);
      setSelectionRect(range.getBoundingClientRect());
      setSelectionVersion((v) => v + 1);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  const zoomIn = useCallback(() => setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP)), []);
  const fitWidth = useCallback(() => {
    if (fitWidthBase !== null) setScale(fitWidthBase);
  }, [fitWidthBase]);

  function currentSelectionInfo(): { pageNumber: number; el: HTMLElement; text: string } | null {
    const selection = window.getSelection();
    const located = pendingSelectionRef.current;
    if (!selection || !located) return null;
    const text = selection.toString();
    if (!text.trim()) return null;
    return { ...located, text };
  }

  function withNaturalSize(el: HTMLElement, scaleNow: number): { width: number; height: number } {
    // The page container's own rendered box IS its natural size times scale — reading it back this
    // way needs nothing from PageCanvas beyond what is already on screen.
    const rect = el.getBoundingClientRect();
    return { width: rect.width / scaleNow, height: rect.height / scaleNow };
  }

  function handleCopy() {
    const info = currentSelectionInfo();
    if (!info) return;
    void navigator.clipboard.writeText(info.text).catch(() => {});
  }

  function handleHighlight(color: string) {
    const selection = window.getSelection();
    const info = currentSelectionInfo();
    if (!selection || !info) return;
    const natural = withNaturalSize(info.el, scale);
    const highlight = highlightFromSelection(selection, info.el, info.pageNumber, natural, scale, color);
    if (highlight) setHighlights((prev) => [...prev, highlight]);
    selection.removeAllRanges();
    setSelectionRect(null);
  }

  function handleCollect() {
    const info = currentSelectionInfo();
    if (!info) return;
    setCollected((prev) => [
      ...prev,
      { id: crypto.randomUUID(), pageNumber: info.pageNumber, text: info.text.trim(), createdAt: Date.now() },
    ]);
    window.getSelection()?.removeAllRanges();
    setSelectionRect(null);
  }

  async function askAI(selectionText: string, question: string) {
    setAskBusy(true);
    setAskError(null);
    setAskAnswer(null);
    try {
      const res = await fetch("/api/viewer-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: selectionText,
          question,
          documentName: uploadedDoc.name,
          pageNumber: currentPage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not get an explanation.");
      setAskAnswer(data.answer);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Could not get an explanation.");
    } finally {
      setAskBusy(false);
    }
  }

  function handleAskFromSelection() {
    const info = currentSelectionInfo();
    if (!info) return;
    setAskOpen(true);
    setAskQuestion("");
    setAskAnswer(null);
    setAskError(null);
    void askAI(info.text, "");
    window.getSelection()?.removeAllRanges();
    setSelectionRect(null);
  }

  function handleAskAboutCollection() {
    if (collected.length === 0) return;
    const combined = collected.map((s) => `[Page ${s.pageNumber}] ${s.text}`).join("\n\n");
    setAskOpen(true);
    setAskQuestion("");
    setAskAnswer(null);
    setAskError(null);
    void askAI(combined, "");
  }

  if (pdfState.status === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-[var(--hud-cyan)]" />
        <p className="text-sm text-[var(--hud-text-dim)]">Opening {uploadedDoc.name}…</p>
      </div>
    );
  }

  if (pdfState.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertCircle className="size-8 text-[var(--hud-danger)]" />
        <p className="text-sm text-[var(--hud-danger)]">{pdfState.message}</p>
        <button
          onClick={onBack}
          className="rounded-lg border border-[var(--hud-line)] px-4 py-2 text-xs font-semibold text-[var(--hud-text-dim)] transition hover:text-[var(--hud-text)]"
        >
          Back
        </button>
      </div>
    );
  }

  const hasCollected = collected.length > 0;

  return (
    /*
     * FULL-BLEED READER. The page stack is the ONLY permanent layout element — it fills the whole
     * screen edge to edge, the way a native PDF viewer does. Everything else (toolbar, search,
     * thumbnails, collected text) is an overlay that floats ON TOP of the reader and can be
     * dismissed, rather than a panel that permanently claims a slice of the screen's width. This is
     * a deliberate change from the original three-column layout, which read as "an app with a PDF
     * embedded in it" rather than "a PDF, with tools available when wanted".
     */
    <div className="relative h-full">
      <div ref={scrollAreaRef} className="h-full bg-[var(--hud-bg)]">
        <PageList
          doc={pdfState.doc}
          pageCount={pdfState.pageCount}
          scale={scale}
          activeMatch={activeMatch}
          highlightsByPage={highlightsByPage}
          scrollToPage={scrollToPage}
          onCurrentPageChange={setCurrentPage}
        />
      </div>

      <ViewerToolbar
        documentName={uploadedDoc.name}
        currentPage={currentPage}
        pageCount={pdfState.pageCount}
        zoomPercent={Math.round(scale * 100)}
        sidebarOpen={sidebarOpen}
        searchOpen={searchOpen}
        onBack={onBack}
        onJumpToPage={setScrollToPage}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitWidth={fitWidth}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onToggleSearch={() => setSearchOpen((v) => !v)}
      />

      {searchOpen && (
        <div className="absolute inset-x-0 top-16 z-30 flex justify-center px-3">
          <div className="rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-bg-2)]/95 px-3 py-2 shadow-xl backdrop-blur-md">
            <SearchPanel
              doc={pdfState.doc}
              pageCount={pdfState.pageCount}
              textCache={textCache}
              onClose={() => {
                setSearchOpen(false);
                setActiveMatch(null);
              }}
              onMatchChange={(match) => {
                setActiveMatch(match);
                if (match) setScrollToPage(match.pageNumber);
              }}
            />
          </div>
        </div>
      )}

      {/* Thumbnails — a slide-out overlay, not a permanent column, so the page keeps the full
          screen width until the student actually asks to see them. */}
      {sidebarOpen && (
        <>
          <button
            aria-label="Close thumbnails"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 z-30 bg-black/40 backdrop-blur-[1px]"
          />
          <aside className="absolute inset-y-0 left-0 z-40 w-40 overflow-hidden border-r border-[var(--hud-line)] bg-[var(--hud-bg-2)] shadow-2xl">
            <ThumbnailSidebar
              doc={pdfState.doc}
              pageCount={pdfState.pageCount}
              currentPage={currentPage}
              onSelect={(p) => {
                setScrollToPage(p);
                setSidebarOpen(false);
              }}
            />
          </aside>
        </>
      )}

      {/* Collected text — a floating panel toggled from the selection toolbar's "Add to
          Collection" action, not a permanent column. Only ever mounted once there's something to
          show, or the student is mid-collecting (open state tracked by the button below). */}
      {(hasCollected || collectedPanelOpen) && (
        <>
          {collectedPanelOpen && (
            <button
              aria-label="Close collected text"
              onClick={() => setCollectedPanelOpen(false)}
              className="absolute inset-0 z-30 bg-black/40 backdrop-blur-[1px]"
            />
          )}
          {!collectedPanelOpen ? (
            <button
              onClick={() => setCollectedPanelOpen(true)}
              className="absolute bottom-4 right-4 z-30 rounded-full border border-[var(--hud-line)] bg-[var(--hud-bg-2)]/90 px-3 py-2 text-xs font-semibold text-[var(--hud-text-dim)] shadow-lg backdrop-blur-md transition hover:text-[var(--hud-text)]"
            >
              Collected ({collected.length})
            </button>
          ) : (
            <aside className="absolute inset-y-0 right-0 z-40 w-72 max-w-[85vw] overflow-hidden border-l border-[var(--hud-line)] bg-[var(--hud-bg-2)] shadow-2xl">
              <CollectedTextPanel
                snippets={collected}
                onRemove={(id) => setCollected((prev) => prev.filter((s) => s.id !== id))}
                onClear={() => setCollected([])}
                onAskAboutAll={handleAskAboutCollection}
              />
            </aside>
          )}
        </>
      )}

      <SelectionToolbar
        anchorRect={selectionRect}
        selectionVersion={selectionVersion}
        onCopy={handleCopy}
        onHighlight={(color) => handleHighlight(color || DEFAULT_HIGHLIGHT_COLOR)}
        onCollect={handleCollect}
        onAsk={handleAskFromSelection}
      />

      {askOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => setAskOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-[var(--hud-line-strong)] bg-[var(--hud-bg-2)] p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-[var(--hud-text)]">Ask AI</p>
              <button onClick={() => setAskOpen(false)} aria-label="Close" className="text-[var(--hud-text-faint)] hover:text-[var(--hud-text)]">
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto viewer-scroll">
              {askBusy && (
                <div className="flex items-center gap-2 text-sm text-[var(--hud-text-dim)]">
                  <Loader2 className="size-4 animate-spin" /> Thinking…
                </div>
              )}
              {askError && <p className="text-sm text-[var(--hud-danger)]">{askError}</p>}
              {askAnswer && <p className="text-sm leading-relaxed text-[var(--hud-text-dim)]">{askAnswer}</p>}
            </div>

            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!askQuestion.trim()) return;
                const info = currentSelectionInfo();
                void askAI(askAnswer ?? info?.text ?? "", askQuestion.trim());
              }}
            >
              <input
                value={askQuestion}
                onChange={(e) => setAskQuestion(e.target.value)}
                placeholder="Ask a follow-up…"
                className="flex-1 rounded-lg border border-[var(--hud-line)] bg-transparent px-3 py-2 text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={askBusy}
                className="rounded-lg bg-[var(--hud-cyan)] px-4 py-2 text-xs font-bold text-[#140d21] transition hover:brightness-110 disabled:opacity-50"
              >
                Ask
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
