"use client";

import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import type { CollectedSnippet } from "@/lib/viewerTypes";

/**
 * Text a student collected while reading, kept across pages. Removing one snippet or clearing the
 * whole panel is local-only (the collection lives in the viewer's own state, not persisted server
 * side) — it is scratch space for the current reading session, not a saved document.
 */
export function CollectedTextPanel({
  snippets,
  onRemove,
  onClear,
  onAskAboutAll,
}: {
  snippets: CollectedSnippet[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onAskAboutAll: () => void;
}) {
  const [copiedAll, setCopiedAll] = useState(false);

  async function copyAll() {
    const text = snippets
      .map((s) => `[Page ${s.pageNumber}]\n${s.text}`)
      .join("\n\n");
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1600);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--hud-line)] px-4 py-3">
        <div>
          <p className="text-sm font-bold text-[var(--hud-text)]">Collected Text</p>
          <p className="text-xs text-[var(--hud-text-faint)]">
            {snippets.length === 0 ? "Nothing collected yet" : `${snippets.length} snippet${snippets.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {snippets.length > 0 && (
          <button
            onClick={onClear}
            className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--hud-text-faint)] transition hover:bg-[var(--danger-dim)] hover:text-[var(--hud-danger)]"
          >
            Clear
          </button>
        )}
      </div>

      {snippets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm text-[var(--hud-text-faint)]">
            Select text in the document and choose <span className="text-[var(--hud-text-dim)]">Add to Collection</span> to
            gather passages here.
          </p>
        </div>
      ) : (
        <div className="viewer-scroll flex-1 overflow-y-auto px-3 py-3">
          <div className="flex flex-col gap-2.5">
            {snippets.map((s) => (
              <div
                key={s.id}
                className="group relative rounded-lg border border-[var(--hud-line)] bg-[var(--hud-surface)] p-3 text-sm leading-relaxed text-[var(--hud-text-dim)]"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--hud-cyan)]">
                    Page {s.pageNumber}
                  </span>
                  <button
                    onClick={() => onRemove(s.id)}
                    aria-label="Remove snippet"
                    className="rounded p-0.5 text-[var(--hud-text-faint)] opacity-0 transition hover:text-[var(--hud-danger)] group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <p className="line-clamp-6">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {snippets.length > 0 && (
        <div className="flex gap-2 border-t border-[var(--hud-line)] p-3">
          <button
            onClick={copyAll}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--hud-line)] px-3 py-2 text-xs font-semibold text-[var(--hud-text-dim)] transition hover:border-[var(--hud-line-strong)] hover:text-[var(--hud-text)]"
          >
            {copiedAll ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copiedAll ? "Copied" : "Copy All"}
          </button>
          <button
            onClick={onAskAboutAll}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--hud-cyan)] px-3 py-2 text-xs font-bold text-[#140d21] transition hover:brightness-110"
          >
            Ask AI about this
          </button>
        </div>
      )}
    </div>
  );
}
