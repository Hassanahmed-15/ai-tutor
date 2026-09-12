"use client";

import { useEffect, useState } from "react";
import type { Beat } from "@/lib/lessonContent";
import type { LectureMode } from "@/lib/db/cosmos";

type HistoryItem = {
  id: string;
  topic: string;
  sourceType: "prompt" | "pdf" | "pptx" | "suprnotes" | "task-folder";
  mode?: LectureMode;
  status: "processing-videos" | "ready" | "ready-with-errors" | "failed";
  beatCount: number;
  manimVideoCount: number;
  createdAt: string;
  error: string | null;
};

export type ReplayPackage = {
  lectureId: string;
  topic: string;
  sourceType: HistoryItem["sourceType"];
  mode?: LectureMode;
  beats: Beat[];
};

const SOURCE_LABELS: Record<HistoryItem["sourceType"], string> = {
  prompt: "Prompt",
  pdf: "PDF",
  pptx: "Presentation",
  suprnotes: "Suprnotes",
  "task-folder": "Task folder",
};

const MODE_LABELS: Record<LectureMode, string> = {
  standard: "Standard",
  blind: "Blind",
  "low-vision": "Low vision",
  adhd: "ADHD",
  dyslexia: "Dyslexia",
  deaf: "Deaf",
};

export function LectureHistory({
  onReplay,
  refreshKey = 0,
}: {
  onReplay: (lecture: ReplayPackage) => void;
  /** Increment after a lecture is saved so an already-mounted history does not stay stale. */
  refreshKey?: number;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/lectures", { cache: "no-store", signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not load lecture history.");
        if (!controller.signal.aborted) setItems(Array.isArray(data.lectures) ? data.lectures : []);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError.message : "Could not load lecture history.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [refreshKey]);

  async function openLecture(item: HistoryItem) {
    setOpeningId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/lectures/${encodeURIComponent(item.id)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.beats)) {
        throw new Error(data.error || "That lecture could not be loaded.");
      }
      onReplay(data as ReplayPackage);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "That lecture could not be loaded.");
    } finally {
      setOpeningId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--hud-text-faint)]">Loading your lecture history…</p>;
  }
  return (
    <section className="mb-12" aria-labelledby="lecture-history-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Saved in Azure</p>
          <h2 id="lecture-history-heading" className="mt-1 font-display text-2xl text-[var(--hud-text)]">
            Lecture history
          </h2>
        </div>
        <span className="text-xs font-semibold text-[var(--hud-text-faint)]">
          {items.length} saved
        </span>
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/[0.08] px-4 py-3 text-sm font-semibold text-rose-200">
          {error}
        </p>
      )}

      {!error && items.length === 0 && (
        <p className="rounded-2xl border border-[var(--hud-line)] bg-white/[0.025] px-5 py-4 text-sm text-[var(--hud-text-faint)]">
          No saved lectures yet. A lecture appears here as soon as generation finishes.
        </p>
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const processing = item.status === "processing-videos";
          const failed = item.status === "failed";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => void openLecture(item)}
              disabled={failed || openingId !== null}
              className="flex w-full items-center justify-between gap-4 rounded-2xl border border-[var(--hud-line)] bg-white/[0.025] px-5 py-4 text-left transition hover:border-[var(--hud-cyan)]/50 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block truncate font-bold text-[var(--hud-text)]">{item.topic}</span>
                <span className="mt-1 block text-xs font-semibold text-[var(--hud-text-faint)]">
                  {MODE_LABELS[item.mode ?? "standard"]} · {SOURCE_LABELS[item.sourceType]} · {item.beatCount} sections · {new Date(item.createdAt).toLocaleString()}
                </span>
              </span>
              <span className="shrink-0 text-xs font-black text-[var(--hud-cyan)]">
                {openingId === item.id
                  ? "Opening…"
                  : failed
                    ? "Save failed"
                    : processing
                      ? "Play · videos preparing"
                      : "Play →"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
