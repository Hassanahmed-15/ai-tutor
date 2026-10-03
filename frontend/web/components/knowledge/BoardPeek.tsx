"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { LessonCanvas } from "@/components/canvas/LessonCanvas";
import type { Beat } from "@/lib/lessonContent";
import type { CanvasBoardSpec } from "@/lib/canvas/types";

/**
 * ONE BOARD FROM AN EARLIER LECTURE, in a window: where the student learned a concept ("↩ from
 * Photosynthesis" on a board, or a star on the knowledge map), shown finished and explorable.
 *
 * As a REVIEW (`review`), the board's own Predict-it question is asked again and the answer is
 * evidence; a board with no question asks the student to rate their recall instead. Either way the
 * concept's review is rescheduled (POST /api/knowledge/evidence).
 */
export type PeekTarget = {
  lectureId: string;
  sequence: number;
  beatId: string;
  title: string;
  topic: string;
  /** For a review: the concepts it tests, so a self-rated recall can be recorded against them. */
  review?: { concepts: Array<{ key: string; label: string }> };
};

type Loaded = { beat: Beat; spec?: CanvasBoardSpec } | { error: string };

export function BoardPeek({ target, onClose, onReviewed }: { target: PeekTarget; onClose: () => void; onReviewed?: (correct: boolean) => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rated, setRated] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/lectures/${encodeURIComponent(target.lectureId)}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { beats?: Beat[]; error?: string };
        if (!res.ok || !Array.isArray(data.beats)) throw new Error(data.error || "That lecture is no longer saved.");
        const beat = data.beats.find((b) => b.id === target.beatId) ?? data.beats[target.sequence];
        if (!beat) throw new Error("That board is no longer in the lecture.");
        const op = beat.draw?.ops.find((o) => (o as { kind: string }).kind === "canvasBoard") as { spec?: CanvasBoardSpec } | undefined;
        if (alive) setLoaded({ beat, spec: op?.spec });
      })
      .catch((error: Error) => {
        if (alive) setLoaded({ error: error.message });
      });
    return () => {
      alive = false;
    };
  }, [target.lectureId, target.beatId, target.sequence]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const panels = useMemo(() => (loaded && "beat" in loaded && loaded.spec ? [{ key: loaded.beat.id, spec: loaded.spec }] : []), [loaded]);
  const hasQuiz = panels[0]?.spec.interaction?.kind === "quiz";
  const record = (correct: boolean, body: Record<string, unknown>) => {
    void fetch("/api/knowledge/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, correct }) }).catch(() => {});
    onReviewed?.(correct);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`${target.title}, from ${target.topic}`} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-[min(80vh,620px)] w-[min(96vw,1040px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0f14] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300/80">{target.review ? "Review" : "Where you learned it"}</p>
            <p className="truncate text-sm font-semibold text-white">{target.title} <span className="font-normal text-white/50">· {target.topic}</span></p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {!loaded && (
            <div className="grid h-full place-items-center text-white/60">
              <Loader2 className="animate-spin" size={20} />
            </div>
          )}
          {loaded && "error" in loaded && <p className="grid h-full place-items-center px-6 text-center text-sm text-white/70">{loaded.error}</p>}
          {loaded && "beat" in loaded && !loaded.spec && (
            <div className="h-full overflow-y-auto px-8 py-6 text-white/85">
              <h3 className="text-lg font-bold text-white">{loaded.beat.title}</h3>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
                {(loaded.beat.points ?? []).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
              <p className="mt-4 text-sm leading-relaxed text-white/70">{loaded.beat.script}</p>
            </div>
          )}
          {panels.length > 0 && (
            <LessonCanvas
              panels={panels}
              currentIndex={0}
              sentence={Number.MAX_SAFE_INTEGER}
              sentenceProgress={1}
              finished={Boolean(target.review && hasQuiz)}
              waitingForStudent={false}
              playing={false}
              topic={target.topic}
              onSpeak={() => {}}
              onTellAria={() => {}}
              onContinue={onClose}
              onTaskResult={target.review ? (kind, correct, options) => record(correct, { session: target.lectureId, sequence: target.sequence, kind, options }) : undefined}
            />
          )}
        </div>
        {target.review && loaded && !hasQuiz && (
          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
            <p className="text-sm text-white/75">{rated === null ? "Look it over. Do you still remember this?" : rated ? "Nice — it will come back later, further apart." : "No problem — it will come back sooner."}</p>
            {rated === null && (
              <div className="flex gap-2">
                <button type="button" onClick={() => { setRated(false); record(false, { kind: "review", concepts: target.review!.concepts, topic: target.topic }); }} className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold text-white/85 hover:bg-white/10">
                  Not sure yet
                </button>
                <button type="button" onClick={() => { setRated(true); record(true, { kind: "review", concepts: target.review!.concepts, topic: target.topic }); }} className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-400">
                  I remembered it
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
