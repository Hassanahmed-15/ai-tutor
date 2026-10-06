"use client";

import { useEffect, useState } from "react";
import { AlertCircle, FileText, Layers, MessageSquare, Presentation as PresentationIcon, Loader2, Video } from "lucide-react";
import type { Beat } from "@/lib/lessonContent";
import type { LectureMode } from "@/lib/db/cosmos";

type HistoryItem = {
  id: string;
  topic: string;
  sourceType: "prompt" | "pdf" | "pptx" | "suprnotes" | "task-folder" | "youtube";
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
  /** A video lecture's source: its key points and transcript, for the chat (lib/lectureArchive.ts). */
  sourceDocument?: unknown;
};

const SOURCE_LABELS: Record<HistoryItem["sourceType"], string> = {
  prompt: "Prompt",
  pdf: "PDF",
  pptx: "Presentation",
  suprnotes: "Suprnotes",
  "task-folder": "Task folder",
  youtube: "Video",
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
  youtube: Video,
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
  /** Every lecture this learner has, not just the page of them shown below. */
  const [total, setTotal] = useState(0);
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
        if (controller.signal.aborted) return;
        const lectures: HistoryItem[] = Array.isArray(data.lectures) ? data.lectures : [];
        setItems(lectures);
        // An older server that does not send a total still gets a number, just the page's own.
        setTotal(typeof data.total === "number" ? data.total : lectures.length);
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
    return <p className="px-3 py-2 text-[0.8125rem] text-[var(--hud-text-dim)]">Loading your lecture history…</p>;
  }
  /*
   * THE SIDEBAR LIST, the way ChatGPT and Claude show past conversations: one compact row per
   * lecture, the title first, and a quiet line saying what kind of lecture it was and when. The
   * kind is a small grey icon and a word, never a colour.
   */
  return (
    <section className="flex min-h-0 flex-col" aria-labelledby="lecture-history-heading">
      <div className="flex items-baseline justify-between gap-3 px-3 pb-1.5 pt-1">
        <h2 id="lecture-history-heading" className="text-[0.75rem] font-medium text-[var(--hud-text-dim)]">
          Lecture history
        </h2>
        <span className="text-[0.75rem] text-[var(--hud-text-faint)]">
          {/* Say so when the list is only part of the total, rather than quietly reporting the page. */}
          {total > items.length ? `${items.length} of ${total}` : `${total} saved`}
        </span>
      </div>

      {error && (
        <p role="alert" className="mx-2 flex items-start gap-2 rounded-[var(--radius)] bg-[var(--danger-dim)] px-3 py-2 text-[0.8125rem] text-[var(--hud-danger)]">
          <AlertCircle aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {!error && items.length === 0 && (
        <p className="px-3 py-2 text-[0.8125rem] text-[var(--hud-text-dim)]">
          No saved lectures yet. A lecture appears here as soon as generation finishes.
        </p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-0.5 px-2 pb-3">
          {items.map((item) => {
            const processing = item.status === "processing-videos";
            const failed = item.status === "failed";
            const opening = openingId === item.id;
            const Icon = SOURCE_ICONS[item.sourceType];
            const date = new Date(item.createdAt);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void openLecture(item)}
                  disabled={failed || openingId !== null}
                  title={item.topic}
                  className="group flex w-full items-start gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--sidebar-hover)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--hud-text-dim)]">
                    {opening ? <Loader2 size={15} className="animate-spin" /> : failed ? <AlertCircle size={15} className="text-[var(--hud-danger)]" /> : <Icon size={15} strokeWidth={1.8} />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[0.875rem] text-[var(--hud-text)]">{item.topic}</span>
                    <span className="truncate text-[0.75rem] text-[var(--hud-text-dim)]">
                      {failed ? "Save failed · " : ""}
                      {SOURCE_LABELS[item.sourceType]}
                      {" · "}
                      {item.beatCount} sections
                      {(item.mode ?? "standard") !== "standard" ? ` · ${MODE_LABELS[item.mode ?? "standard"]}` : ""}
                      {" · "}
                      {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      {processing && " · videos preparing"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
