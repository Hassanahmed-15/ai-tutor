"use client";

import { useEffect, useState } from "react";
import { FileText, Layers, MessageSquare, Presentation as PresentationIcon, Loader2 } from "lucide-react";
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

/** One glance at the icon tells you what kind of lecture this was, before reading a word of the
 *  metadata line — the flat text-only list gave every row, prompt or PDF alike, the exact same
 *  silhouette. */
const SOURCE_ICONS: Record<HistoryItem["sourceType"], typeof FileText> = {
  prompt: MessageSquare,
  pdf: FileText,
  pptx: PresentationIcon,
  suprnotes: Layers,
  "task-folder": Layers,
};

/**
 * Each source type gets its OWN colour, not just the one cyan the whole card grid used to share.
 * A monochrome icon badge on an otherwise identical bordered box still reads as one repeated
 * template with a different glyph swapped in — real visual distinction needs a second channel
 * (hue) alongside shape, so a page of cards actually looks like a page of different things.
 */
const SOURCE_ACCENTS: Record<HistoryItem["sourceType"], { text: string; wash: string; ring: string }> = {
  prompt: { text: "text-violet-300", wash: "from-violet-500/20 via-violet-500/5 to-transparent", ring: "group-hover:border-violet-400/50" },
  pdf: { text: "text-rose-300", wash: "from-rose-500/20 via-rose-500/5 to-transparent", ring: "group-hover:border-rose-400/50" },
  pptx: { text: "text-amber-300", wash: "from-amber-500/20 via-amber-500/5 to-transparent", ring: "group-hover:border-amber-400/50" },
  suprnotes: { text: "text-emerald-300", wash: "from-emerald-500/20 via-emerald-500/5 to-transparent", ring: "group-hover:border-emerald-400/50" },
  "task-folder": { text: "text-emerald-300", wash: "from-emerald-500/20 via-emerald-500/5 to-transparent", ring: "group-hover:border-emerald-400/50" },
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

      {/*
        REAL CARDS, NOT A REPEATED TEMPLATE. The previous pass added an icon and tags but kept
        every card the same monochrome bordered box, so the grid still read as one shape stamped
        out N times. Each card now gets: its own source-type ACCENT COLOUR (not just cyan) as a
        soft gradient wash behind a larger icon block, a two-line title area with real vertical
        room instead of a single truncated line, a hover lift (translate + shadow, not just a
        border-colour change), and the play control moved down into its own footer row next to
        the date instead of floating in the corner beside the title.
      */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const processing = item.status === "processing-videos";
          const failed = item.status === "failed";
          const opening = openingId === item.id;
          const Icon = SOURCE_ICONS[item.sourceType];
          const accent = SOURCE_ACCENTS[item.sourceType];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => void openLecture(item)}
              disabled={failed || openingId !== null}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--hud-line)] bg-white/[0.025] text-left shadow-[0_1px_0_rgba(255,255,255,0.03)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.05] hover:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.6)] disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none ${accent.ring}`}
            >
              {/* The accent wash — the one thing that makes a prompt card and a PDF card look
                  like different KINDS of object, not the same card recoloured on hover. */}
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${accent.wash} opacity-70`}
              />

              <div className="relative z-10 flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/20 backdrop-blur-sm"
                  >
                    <Icon size={20} strokeWidth={1.7} className={accent.text} />
                  </span>
                  {failed && (
                    <span className="rounded-full border border-rose-400/40 bg-rose-500/10 px-2 py-0.5 text-[0.65rem] font-bold text-rose-300">
                      Save failed
                    </span>
                  )}
                </div>

                <span className="line-clamp-2 min-h-[2.6rem] font-bold leading-snug text-[var(--hud-text)]">
                  {item.topic}
                </span>

                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.68rem] font-semibold text-[var(--hud-text-faint)]">
                    {MODE_LABELS[item.mode ?? "standard"]}
                  </span>
                  <span className={`rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[0.68rem] font-semibold ${accent.text}`}>
                    {SOURCE_LABELS[item.sourceType]}
                  </span>
                  <span className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.68rem] font-semibold text-[var(--hud-text-faint)]">
                    {item.beatCount} sections
                  </span>
                </span>
              </div>

              {/* Footer — date on the left, the play control on the right, both anchored to the
                  bottom so cards of different title lengths still align. */}
              <div className="relative z-10 mt-auto flex items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3">
                <span className="text-[0.7rem] text-[var(--hud-text-faint)]/80">
                  {new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {" · "}
                  {new Date(item.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  {processing && <span className="ml-1.5 text-[var(--hud-text-faint)]/60">· videos preparing</span>}
                </span>
                <span
                  aria-hidden="true"
                  className={`grid size-8 shrink-0 place-items-center rounded-full border transition ${
                    failed
                      ? "border-rose-400/40 text-rose-300"
                      : `border-white/10 bg-black/20 ${accent.text} group-hover:scale-105 group-hover:border-white/20`
                  }`}
                >
                  {opening ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : failed ? (
                    "!"
                  ) : (
                    <span className="text-[0.72rem]">▶</span>
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
