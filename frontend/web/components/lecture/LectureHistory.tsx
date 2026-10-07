"use client";

import { useEffect, useState } from "react";
import { AlertCircle, FileText, Layers, MessageSquare, Presentation as PresentationIcon, Loader2, Video } from "lucide-react";
import type { Beat } from "@/lib/lessonContent";
import type { LectureMode } from "@/lib/db/cosmos";

export type HistoryItem = {
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
  prompt: "Lesson",
  pdf: "PDF",
  pptx: "Slides",
  suprnotes: "Notes",
  "task-folder": "Folder",
  youtube: "Video",
};

/** The kind of lecture at a glance, before a word is read. */
export const SOURCE_ICONS: Record<HistoryItem["sourceType"], typeof FileText> = {
  prompt: MessageSquare,
  pdf: FileText,
  pptx: PresentationIcon,
  suprnotes: Layers,
  "task-folder": Layers,
  youtube: Video,
};

/** "Today", "Yesterday", "This week", else the month — the shelves of the library. */
export function shelfFor(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= start) return "Today";
  if (d.getTime() >= start - day) return "Yesterday";
  if (d.getTime() >= start - 6 * day) return "This week";
  return d.toLocaleDateString(undefined, { month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** Opens one saved lecture as a replay package; throws with a message the student can read. */
export async function fetchReplay(id: string): Promise<ReplayPackage> {
  const response = await fetch(`/api/lectures/${encodeURIComponent(id)}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.beats)) throw new Error(data.error || "That lecture could not be loaded.");
  return data as ReplayPackage;
}

/** The student's lectures, newest first, and how many there are in all. */
export function useLectureHistory(refreshKey = 0) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/lectures", { cache: "no-store", signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not load your lectures.");
        if (controller.signal.aborted) return;
        const lectures: HistoryItem[] = Array.isArray(data.lectures) ? data.lectures : [];
        setItems(lectures);
        setTotal(typeof data.total === "number" ? data.total : lectures.length);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError.message : "Could not load your lectures.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [refreshKey]);
  return { items, total, loading, error };
}

/**
 * THE LIBRARY: every saved lecture on shelves by day, one quiet row each — the kind as a small
 * icon, the title, and nothing else to read. Opened from the front page; the page itself shows only
 * the last lecture.
 */
export function LectureHistory({
  onReplay,
  refreshKey = 0,
}: {
  onReplay: (lecture: ReplayPackage) => void;
  /** Increment after a lecture is saved so an already-mounted history does not stay stale. */
  refreshKey?: number;
}) {
  const { items, total, loading, error: loadError } = useLectureHistory(refreshKey);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openLecture(item: HistoryItem) {
    setOpeningId(item.id);
    setError(null);
    try {
      onReplay(await fetchReplay(item.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "That lecture could not be loaded.");
    } finally {
      setOpeningId(null);
    }
  }

  if (loading) {
    return (
      <ul className="flex flex-col gap-2 px-3 py-2" aria-label="Loading your lectures">
        {[0, 1, 2, 3].map((i) => <li key={i} className="h-9 animate-pulse rounded-[var(--radius)] bg-[var(--sidebar-hover)]" />)}
      </ul>
    );
  }
  const shown = error ?? loadError;
  const shelves: Array<{ name: string; items: HistoryItem[] }> = [];
  for (const item of items) {
    const name = shelfFor(item.createdAt);
    const shelf = shelves[shelves.length - 1];
    if (shelf && shelf.name === name) shelf.items.push(item);
    else shelves.push({ name, items: [item] });
  }
  return (
    <section className="flex min-h-0 flex-col" aria-label="Your lectures">
      {shown && (
        <p role="alert" className="mx-2 flex items-start gap-2 rounded-[var(--radius)] bg-[var(--danger-dim)] px-3 py-2 text-[0.8125rem] text-[var(--hud-danger)]">
          <AlertCircle aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
          {shown}
        </p>
      )}
      {!shown && items.length === 0 && (
        <p className="px-3 py-2 text-[0.8125rem] text-[var(--hud-text-dim)]">Your lectures will appear here.</p>
      )}
      {shelves.map((shelf) => (
        <div key={shelf.name} className="pb-2">
          <p className="hud-label px-3 pb-1 pt-2 text-[0.6875rem] text-[var(--hud-text-faint)]">{shelf.name}</p>
          <ul className="flex flex-col gap-0.5 px-2">
            {shelf.items.map((item) => {
              const failed = item.status === "failed";
              const opening = openingId === item.id;
              const Icon = SOURCE_ICONS[item.sourceType];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openLecture(item)}
                    disabled={failed || openingId !== null}
                    title={`${SOURCE_LABELS[item.sourceType]} · ${item.beatCount} parts`}
                    className="group flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--sidebar-hover)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                  >
                    <span aria-hidden="true" className="shrink-0 text-[var(--hud-text-faint)] group-hover:text-[var(--hud-text-dim)]">
                      {opening ? <Loader2 size={15} className="animate-spin" /> : failed ? <AlertCircle size={15} className="text-[var(--hud-danger)]" /> : <Icon size={15} strokeWidth={1.8} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.875rem] text-[var(--hud-text)]">{item.topic}</span>
                    <span className="shrink-0 font-[family-name:var(--font-hud-mono)] text-[0.6875rem] tabular-nums text-[var(--hud-text-faint)]">{item.beatCount}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {total > items.length && (
        <p className="px-3 pb-3 pt-1 text-[0.6875rem] text-[var(--hud-text-faint)]">{items.length} of {total}</p>
      )}
    </section>
  );
}
