"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

export type PageSelection = {
  /** Page numbers in the order the student picked them. Empty means "use the whole document". */
  pages: number[];
  /** What the student wants done with them. Empty is allowed — the lesson prompt still applies. */
  prompt: string;
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

  // Report upward without making the parent a dependency of the effect — a parent that recreates
  // its handler each render would otherwise loop.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current({ pages: selected, prompt: prompt.trim() });
  }, [selected, prompt]);

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
                </button>
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
      </div>
    </aside>
  );
}
