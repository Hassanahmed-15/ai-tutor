"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { PromptTile } from "@/lib/promptTiles";

/**
 * Three ways in, picked for this student from their profile and their map (lib/promptTiles.ts,
 * /api/learner-profile/tiles): what they found tricky, what is due, what comes next. Chips, not
 * cards — the prompt is the label and the reason is a whisper under it. Pressing one starts that
 * lesson exactly as if it had been typed. Renders nothing while loading, without a profile, or
 * when the request fails: the field above is always the way in, and this row only ever adds to it.
 */
/** The home page's chips before (or without) this student's own picks: the owner's design, 2026-11-27. */
export const STARTER_CHIPS = ["What comes after Photosynthesis?", "Explain time complexity using Big O notation", "Implement a binary search tree"];

/**
 * `variant="chips"`: the home page's plain chips under the ask box. They never vanish — the starter chips stand
 * in until this student's own picks arrive — and pressing one is handled by `onPick` (the home page puts the
 * words in the box, as the design does).
 */
export function PromptTiles({ onPick, max = 3, variant = "tiles", center = false }: { onPick: (prompt: string) => void; max?: number; variant?: "tiles" | "chips"; center?: boolean }) {
  const [tiles, setTiles] = useState<PromptTile[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/learner-profile/tiles", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setTiles(Array.isArray(data?.tiles) ? (data.tiles as PromptTile[]) : []))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (variant === "chips") {
    const chips = tiles.length > 0 ? tiles.slice(0, max).map((t) => ({ key: t.id, prompt: t.prompt, reason: t.reason })) : STARTER_CHIPS.slice(0, max).map((prompt) => ({ key: prompt, prompt, reason: undefined }));
    return (
      <ul className="home-chips" aria-label="Suggested lessons">
        {chips.map((c) => (
          <li key={c.key} className="min-w-0 max-w-full">
            <button type="button" className="home-chip" title={c.reason} onClick={() => onPick(c.prompt)}>{c.prompt}</button>
          </li>
        ))}
      </ul>
    );
  }
  if (tiles.length === 0) return null;
  return (
    <ul className={`hud-materialize flex flex-wrap gap-2 ${center ? "justify-center" : ""}`} aria-label="Suggested lessons for you">
      {tiles.slice(0, max).map((t) => (
        <li key={t.id} className="min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => onPick(t.prompt)}
            title={t.reason}
            className="group flex max-w-full items-center gap-2 rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] py-1.5 pl-3.5 pr-2.5 text-left transition-colors hover:border-[var(--hud-line-strong)] hover:bg-[var(--hud-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hud-cyan)]"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[0.875rem] text-[var(--hud-text)]">{t.prompt}</span>
              <span className="truncate text-[0.6875rem] text-[var(--hud-text-faint)]">{t.reason}</span>
            </span>
            <ArrowUpRight aria-hidden="true" size={14} className="shrink-0 text-[var(--hud-text-faint)] transition-colors group-hover:text-[var(--hud-cyan)]" />
          </button>
        </li>
      ))}
    </ul>
  );
}
