"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { PromptTile } from "@/lib/promptTiles";

/**
 * Lecture recommendations under the homepage field, from the learner profile (lib/promptTiles.ts,
 * /api/learner-profile/tiles). Pressing one starts that lesson exactly as if it had been typed.
 * Renders nothing while loading, without a profile, or when the request fails — the field above is
 * always the way in, and this row only ever adds to it.
 */
export function PromptTiles({ onPick }: { onPick: (prompt: string) => void }) {
  const [tiles, setTiles] = useState<PromptTile[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/learner-profile/tiles", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setTiles(Array.isArray(data?.tiles) ? (data.tiles as PromptTile[]) : []))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (tiles.length === 0) return null;
  return (
    <section className="hud-materialize flex flex-col gap-3 text-left" aria-label="Suggested lessons for you">
      <h2 className="text-[0.8125rem] font-medium text-[var(--hud-text-dim)]">Suggested for you</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {tiles.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onPick(t.prompt)}
              className="group flex h-full w-full items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] px-4 py-3.5 text-left transition-colors hover:border-[var(--hud-line-strong)] hover:bg-[var(--hud-surface-2)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[0.95rem] font-medium leading-snug text-[var(--hud-text)]">{t.prompt}</span>
                <span className="mt-1 block text-[0.8125rem] text-[var(--hud-text-dim)]">{t.reason}</span>
              </span>
              <ArrowUpRight aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-[var(--hud-text-faint)] transition-colors group-hover:text-[var(--hud-cyan)]" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
