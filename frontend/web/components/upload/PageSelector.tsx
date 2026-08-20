"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VoicePromptButton } from "@/components/upload/VoicePromptButton";
import { Check, FileText, Loader2 } from "lucide-react";

/**
 * Pick which pages of an upload the lesson should be built from.
 *
 * WHY THIS EXISTS. Uploading a 40-page paper and asking "explain the method" wastes most of the
 * work: every page is parsed, cropped and fed to the model, and the answer is diluted by 35 pages
 * of related-work and references. Selecting three pages makes the lesson sharper AND cheaper,
 * which is unusual — most quality improvements cost more.
 *
 * DESIGN NOTES.
 * - Selection is conveyed three ways: a ring, a numbered check badge, and `aria-pressed`. Never
 *   colour alone (WCAG 2.2 AA 1.4.1), and the badge shows selection ORDER, because the order pages
 *   are chosen is meaningful when a student is assembling an explanation.
 * - Thumbnails are `data:` URIs from the server, so there is no second network round trip and
 *   nothing to clean up. See app/api/document-pages/route.ts for why files were rejected.
 * - Nothing is selected by default. "All pages" is the existing behaviour and stays the default
 *   path; this panel only appears once a document has pages to show.
 */
export type DocumentPage = {
  pageNumber: number;
  thumbnail: string;
  excerpt: string;
};

/** A rectangle on a page, 0-1 on both axes, origin top-left. */
export type NormalisedRect = { x: number; y: number; width: number; height: number };

export type PageSelection = {
  /** Page numbers in the order the student picked them. Empty means "use the whole document". */
  pages: number[];
  /** What the student wants done with them. Empty is allowed — the lesson prompt still applies. */
  prompt: string;
  /**
   * The part of a page the student pointed at, when they narrowed it further.
   *
   * Normalised rather than in pixels: this is drawn on a preview image whose size has nothing to do
   * with the resolution the server renders the page at for reading.
   */
  regions: { page: number; rect: NormalisedRect }[];
};

export function PageSelector({
  pages,
  loading,
  unavailableReason,
  label = "pages",
  onChange,
}: {
  pages: DocumentPage[];
  loading?: boolean;
  /** Set when previews could not be produced — PowerPoint, or the Python renderer being off. */
  unavailableReason?: string | null;
  /** "pages" for a PDF, "slides" for a deck. Used in every visible string. */
  label?: "pages" | "slides";
  onChange: (selection: PageSelection) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [prompt, setPrompt] = useState("");
  /** Regions by page number. A page can have at most one — a second drag replaces the first. */
  const [regions, setRegions] = useState<Record<number, NormalisedRect>>({});
  /**
   * The page open in the area picker.
   *
   * Dragging on the grid thumbnail was the obvious approach and is the wrong one: at ~150px a
   * drag over a formula lands several lines out, and cropping the wrong part of the page is the
   * exact failure this feature exists to fix. The picker shows the page large enough to aim at.
   */
  const [pickingArea, setPickingArea] = useState<DocumentPage | null>(null);

  // Report upward without making the parent a dependency of the effect — a parent that recreates
  // its handler each render would otherwise loop.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current({
      pages: selected,
      prompt: prompt.trim(),
      // Only for pages still selected: deselecting a page must not leave its region behind to be
      // read from a page the student has since taken out of the lesson.
      regions: selected
        .filter((page) => regions[page])
        .map((page) => ({ page, rect: regions[page] })),
    });
  }, [selected, prompt, regions]);

  const order = useMemo(() => new Map(selected.map((n, i) => [n, i + 1])), [selected]);

  function toggle(pageNumber: number) {
    setSelected((current) =>
      current.includes(pageNumber)
        ? current.filter((n) => n !== pageNumber)
        : [...current, pageNumber],
    );
  }

  if (loading) {
    return (
      <aside className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Loader2 aria-hidden="true" size={18} className="animate-spin text-[var(--hud-text-faint)]" />
        <p className="text-[0.85rem] text-[var(--hud-text-dim)]">Rendering {label}…</p>
      </aside>
    );
  }

  if (unavailableReason) {
    return (
      <aside className="flex h-full flex-col justify-center gap-2 p-6 text-center">
        <FileText aria-hidden="true" size={18} className="mx-auto text-[var(--hud-text-faint)]" />
        <p className="text-[0.85rem] text-[var(--hud-text-dim)]">{unavailableReason}</p>
        <p className="text-[0.78rem] text-[var(--hud-text-faint)]">
          The whole document will be used.
        </p>
      </aside>
    );
  }

  if (pages.length === 0) return null;

  const allSelected = selected.length === pages.length;

  return (
    <aside className="flex h-full min-h-0 flex-col" aria-label={`Select ${label}`}>
      <div
        className="flex shrink-0 items-baseline justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--hud-line)" }}
      >
        <div>
          <h2 className="text-[0.88rem] font-medium text-[var(--hud-text)]">
            {selected.length > 0 ? `${selected.length} of ${pages.length} selected` : `${pages.length} ${label}`}
          </h2>
          <p className="mt-0.5 text-[0.72rem] text-[var(--hud-text-faint)]">
            {selected.length > 0
              ? `Only these ${label} will be used`
              : `Choose ${label}, or leave empty to use all`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSelected(allSelected ? [] : pages.map((p) => p.pageNumber))}
          className="shrink-0 text-[0.76rem] text-[var(--hud-text-dim)] underline decoration-[var(--hud-line-strong)] underline-offset-4 transition-colors hover:text-[var(--hud-text)]"
        >
          {allSelected ? "Clear" : "Select all"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        <ul className="grid grid-cols-2 gap-2.5">
          {pages.map((page) => {
            const position = order.get(page.pageNumber);
            const isSelected = position !== undefined;
            return (
              <li key={page.pageNumber}>
                <button
                  type="button"
                  onClick={() => toggle(page.pageNumber)}
                  aria-pressed={isSelected}
                  aria-label={`${label === "pages" ? "Page" : "Slide"} ${page.pageNumber}${
                    isSelected ? `, selected, position ${position}` : ""
                  }${page.excerpt ? `. ${page.excerpt}` : ""}`}
                  className="group relative block w-full overflow-hidden rounded-[var(--radius)] border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud-cyan)]"
                  style={{
                    borderColor: isSelected ? "var(--hud-cyan)" : "var(--hud-line)",
                    boxShadow: isSelected ? "0 0 0 1px var(--hud-cyan)" : "none",
                    transitionDuration: "var(--motion-fast)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI has no
                      remote host to optimise and next/image would only add overhead here. */}
                  <img
                    src={page.thumbnail}
                    alt=""
                    className="block aspect-[3/4] w-full bg-white object-cover object-top transition-opacity"
                    style={{ opacity: isSelected ? 1 : 0.62 }}
                  />

                  {/* Selection badge: carries the ORDER, not just the fact of selection. */}
                  <span
                    aria-hidden="true"
                    className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full text-[0.62rem] font-semibold"
                    style={{
                      background: isSelected ? "var(--hud-cyan)" : "rgba(0,0,0,0.55)",
                      color: isSelected ? "var(--hud-bg)" : "var(--hud-text-dim)",
                    }}
                  >
                    {isSelected ? position : page.pageNumber}
                  </span>

                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full"
                      style={{ background: "var(--hud-cyan)", color: "var(--hud-bg)" }}
                    >
                      <Check size={12} strokeWidth={3} />
                    </span>
                  )}

                  {/* The chosen area, drawn back onto the thumbnail so the choice is visible in the
                      grid rather than only inside the picker that made it. */}
                  {isSelected && regions[page.pageNumber] && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute border-2"
                      style={{
                        borderColor: "var(--hud-cyan)",
                        background: "color-mix(in srgb, var(--hud-cyan) 18%, transparent)",
                        left: `${regions[page.pageNumber].x * 100}%`,
                        top: `${regions[page.pageNumber].y * 100}%`,
                        width: `${regions[page.pageNumber].width * 100}%`,
                        height: `${regions[page.pageNumber].height * 100}%`,
                      }}
                    />
                  )}
                </button>

                {isSelected && (
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      data-pick-area={page.pageNumber}
                      onClick={() => setPickingArea(page)}
                      className="text-[0.66rem] underline underline-offset-2 transition-colors"
                      style={{ color: "var(--hud-text-dim)" }}
                    >
                      {regions[page.pageNumber] ? "Change area" : "Select an area"}
                    </button>
                    {regions[page.pageNumber] && (
                      <button
                        type="button"
                        onClick={() => setRegions((current) => {
                          const next = { ...current };
                          delete next[page.pageNumber];
                          return next;
                        })}
                        className="text-[0.66rem] transition-colors"
                        style={{ color: "var(--hud-text-faint)" }}
                      >
                        clear
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="shrink-0 border-t p-3" style={{ borderColor: "var(--hud-line)" }}>
        <label htmlFor="page-prompt" className="sr-only">
          What should Aria explain about the selected {label}?
        </label>
        {/* Grows with the text instead of hiding it.
            A fixed 2-row box silently clipped anything longer, so a student writing a real
            question could not see what they had typed. The height is driven off scrollHeight and
            capped so the grid above never disappears. */}
        <textarea
          id="page-prompt"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
          }}
          rows={2}
          placeholder={
            selected.length > 0
              ? `What should Aria explain about ${selected.length === 1 ? "this page" : `these ${label}`}?`
              : `Ask about specific ${label}…`
          }
          className="max-h-[180px] w-full resize-none overflow-y-auto rounded-[var(--radius)] border bg-transparent px-3 py-2 text-[0.85rem] leading-relaxed text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1"
          style={{ borderColor: "var(--hud-line)" }}
        />
        {/* Dictation for the same field. Placed under it rather than inside, because this textarea
            is multi-line and grows — an absolutely positioned control would collide with the text
            as it wraps. */}
        <div className="mt-1.5 flex items-center gap-2">
          <VoicePromptButton
            baseText={prompt}
            onTranscript={setPrompt}
            title="Speak your question"
            showLabel
            className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-[0.75rem] transition-colors"
          />
        </div>
      </div>

      {pickingArea && (
        <AreaPicker
          page={pickingArea}
          initial={regions[pickingArea.pageNumber]}
          label={label}
          onCancel={() => setPickingArea(null)}
          onSave={(rect) => {
            setRegions((current) => ({ ...current, [pickingArea.pageNumber]: rect }));
            setPickingArea(null);
          }}
        />
      )}
    </aside>
  );
}


/**
 * Drag a rectangle over one page.
 *
 * Shown large on purpose. The first version let the student drag on the grid thumbnail, which is
 * about 150px wide — a drag over a formula there lands several lines out, and cropping the wrong
 * part of the page is exactly the failure this feature exists to fix.
 *
 * The rectangle is reported NORMALISED (0-1). The image here is whatever size the viewport allows
 * and the server reads the page at a far higher resolution, so pixels measured here would mean
 * nothing there.
 */
function AreaPicker({
  page,
  initial,
  label,
  onSave,
  onCancel,
}: {
  page: DocumentPage;
  initial?: NormalisedRect;
  label: "pages" | "slides";
  onSave: (rect: NormalisedRect) => void;
  onCancel: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [rect, setRect] = useState<NormalisedRect | null>(initial ?? null);
  const [dragFrom, setDragFrom] = useState<{ x: number; y: number } | null>(null);

  /** Where a pointer sits within the image, 0-1, clamped so a drag off the edge still tracks. */
  function pointIn(event: React.PointerEvent): { x: number; y: number } | null {
    const box = imageRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }

  function update(to: { x: number; y: number }, from: { x: number; y: number }) {
    // Normalised here rather than at the end, so a drag in any direction produces a positive box.
    setRect({
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4"
      style={{ background: "rgba(0,0,0,0.82)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Select an area of ${label === "pages" ? "page" : "slide"} ${page.pageNumber}`}
    >
      <p className="text-[0.8rem]" style={{ color: "var(--hud-text-dim)" }}>
        Drag over the part you want explained — a formula, a table, a figure.
      </p>

      <div className="relative max-h-[74vh] overflow-hidden rounded-[var(--radius)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI has no remote host to
            optimise, and next/image would only add overhead. */}
        <img
          ref={imageRef}
          src={page.thumbnail}
          alt={`${label === "pages" ? "Page" : "Slide"} ${page.pageNumber}`}
          draggable={false}
          className="block max-h-[74vh] w-auto select-none bg-white"
          style={{ touchAction: "none", cursor: "crosshair" }}
          onPointerDown={(event) => {
            const at = pointIn(event);
            if (!at) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragFrom(at);
            setRect({ x: at.x, y: at.y, width: 0, height: 0 });
          }}
          onPointerMove={(event) => {
            if (!dragFrom) return;
            const at = pointIn(event);
            if (at) update(at, dragFrom);
          }}
          onPointerUp={(event) => {
            if (dragFrom) {
              const at = pointIn(event);
              if (at) update(at, dragFrom);
            }
            setDragFrom(null);
          }}
        />

        {rect && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute border-2"
            style={{
              borderColor: "var(--hud-cyan)",
              background: "color-mix(in srgb, var(--hud-cyan) 16%, transparent)",
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-1.5 text-[0.8rem]"
          style={{ background: "rgba(255,255,255,0.08)", color: "var(--hud-text-dim)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          data-save-area
          disabled={!rect || rect.width < 0.02 || rect.height < 0.02}
          onClick={() => rect && onSave(rect)}
          className="rounded-full px-4 py-1.5 text-[0.8rem] font-semibold disabled:opacity-40"
          style={{ background: "var(--hud-cyan)", color: "var(--hud-bg)" }}
        >
          Use this area
        </button>
      </div>
    </div>
  );
}
