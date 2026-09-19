"use client";

import { useEffect, useState } from "react";
import type { BeatTiming, ProgressiveLectureSnapshot } from "@/lib/progressiveLectureTypes";

/**
 * How the lesson is being built, beat by beat, with where each beat's time went.
 *
 * Measured by the worker (see BeatTiming), not estimated. Shown while the student waits so the wait
 * is legible — and so a slow build can be attributed at a glance: a beat stuck on "drawing the
 * board" with three attempts is a different problem from one stuck in the queue.
 */

type BeatRow = NonNullable<ProgressiveLectureSnapshot["beatStatus"]>[number];

const SEGMENTS: Array<{ key: string; label: string; colour: string; value: (t: BeatTiming) => number }> = [
  { key: "queue", label: "Queue", colour: "#6b7280", value: (t) => (t.queuedMs ?? 0) + (t.enrichQueuedMs ?? 0) },
  { key: "script", label: "Script", colour: "#38bdf8", value: (t) => t.scriptMs ?? 0 },
  { key: "io", label: "Database", colour: "#a78bfa", value: (t) => t.textOverheadMs ?? 0 },
  { key: "choice", label: "Pick board", colour: "#f59e0b", value: (t) => t.visualChoiceMs ?? 0 },
  { key: "model", label: "Draw board", colour: "#f472b6", value: (t) => t.animation?.modelMs ?? (t.premiumMs ?? 0) },
  { key: "checks", label: "Checks", colour: "#34d399", value: (t) => t.animation?.checkMs ?? 0 },
  { key: "critic", label: "Critic", colour: "#fb923c", value: (t) => t.animation?.criticMs ?? 0 },
  { key: "refine", label: "Refine", colour: "#e879f9", value: (t) => t.animation?.refineMs ?? 0 },
];

const seconds = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);

function stageLabel(row: BeatRow): string {
  if (row.state === "ready") return "ready";
  if (row.state === "playable") return "drawing the board";
  if (row.state === "generating") return "writing the script";
  if (row.state === "planned" || row.state === "not-started") return "waiting for its turn";
  return row.state;
}

/** Total measured time for a finished beat: from the script starting to the board being ready. */
function totalMs(t: BeatTiming): number {
  if (t.textStartedAt && t.readyAt) return Date.parse(t.readyAt) - Date.parse(t.textStartedAt);
  return (t.textMs ?? 0) + (t.enrichQueuedMs ?? 0) + (t.enrichMs ?? 0);
}

export function BuildTimeline({ beats, createdAt }: { beats: BeatRow[]; createdAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (beats.length === 0) return null;
  const finished = beats.filter((b) => b.state === "ready" && b.timing);
  const scale = Math.max(30_000, ...finished.map((b) => totalMs(b.timing as BeatTiming)));

  // Across finished beats: where the time went in total, the answer to "what is slow".
  const totals = SEGMENTS.map((seg) => ({ ...seg, ms: finished.reduce((sum, b) => sum + seg.value(b.timing as BeatTiming), 0) }));
  const grand = totals.reduce((sum, seg) => sum + seg.ms, 0);

  return (
    <section data-build-timeline className="mt-6 rounded-xl border border-[var(--hud-line)] bg-black/30 p-4 text-left">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--hud-text)]">How your lesson is being built</h3>
        {createdAt && <span className="text-xs text-[var(--hud-text-faint)]">started {seconds(now - Date.parse(createdAt))} ago</span>}
      </div>

      <ul className="mt-3 space-y-2">
        {beats.map((row) => {
          const t = row.timing;
          const running = row.state !== "ready" && t?.textStartedAt ? now - Date.parse(t.textStartedAt) : null;
          const total = row.state === "ready" && t ? totalMs(t) : null;
          return (
            <li key={row.sequence} data-beat-row={row.sequence}>
              <button
                type="button"
                onClick={() => setOpen(open === row.sequence ? null : row.sequence)}
                className="flex w-full items-center gap-3 text-left"
              >
                <span className="w-5 shrink-0 text-xs text-[var(--hud-text-faint)]">{row.sequence + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs text-[var(--hud-text-dim)]">{row.title}</span>
                    <span className="shrink-0 text-[11px] text-[var(--hud-text-faint)]">
                      {total !== null ? seconds(total) : running !== null ? `${stageLabel(row)} · ${seconds(running)}` : stageLabel(row)}
                      {t?.animation ? ` · ${t.animation.attempts.length} attempt${t.animation.attempts.length === 1 ? "" : "s"}` : ""}
                    </span>
                  </span>
                  <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                    {t && row.state === "ready"
                      ? SEGMENTS.map((seg) => {
                          const ms = seg.value(t);
                          return ms > 0 ? (
                            <span key={seg.key} title={`${seg.label} ${seconds(ms)}`} style={{ width: `${(ms / scale) * 100}%`, background: seg.colour }} />
                          ) : null;
                        })
                      : running !== null && (
                          <span className="animate-pulse" style={{ width: `${Math.min(100, (running / scale) * 100)}%`, background: "#64748b" }} />
                        )}
                  </span>
                </span>
              </button>
              {open === row.sequence && t && (
                <div className="ml-8 mt-2 space-y-1 text-[11px] text-[var(--hud-text-faint)]">
                  <p>
                    {SEGMENTS.filter((seg) => seg.value(t) > 0).map((seg) => `${seg.label} ${seconds(seg.value(t))}`).join(" · ")}
                    {t.visualKind ? ` · board: ${t.visualKind}` : ""}
                  </p>
                  {t.animation?.attempts.map((a, i) => (
                    <p key={i}>
                      attempt {i + 1} ({a.model}): {seconds(a.ms)} — {a.outcome}
                    </p>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {grand > 0 && (
        <div className="mt-4 border-t border-[var(--hud-line)] pt-3">
          <p className="text-[11px] text-[var(--hud-text-faint)]">Where the time went ({finished.length} finished beat{finished.length === 1 ? "" : "s"})</p>
          <div className="mt-1.5 flex h-2 overflow-hidden rounded-full">
            {totals.filter((seg) => seg.ms > 0).map((seg) => (
              <span key={seg.key} title={`${seg.label} ${seconds(seg.ms)}`} style={{ width: `${(seg.ms / grand) * 100}%`, background: seg.colour }} />
            ))}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--hud-text-faint)]">
            {totals.filter((seg) => seg.ms > 0).map((seg) => (
              <span key={seg.key}>
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: seg.colour }} />
                {seg.label} {Math.round((seg.ms / grand) * 100)}%
              </span>
            ))}
          </p>
        </div>
      )}
    </section>
  );
}
