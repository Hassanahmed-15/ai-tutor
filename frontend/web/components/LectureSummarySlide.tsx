"use client";

import { useMemo } from "react";
import { HudEyebrow } from "@/components/hud/HudKit";
import { CODE_THEME, highlightLines } from "@/components/sketch/CodeBoard";
import type { LectureSummary } from "@/lib/lectureSummary";

/**
 * The whole lecture on one slide: its crux, the points that carry it, and the one snippet worth
 * keeping when it was about code (lib/lectureSummary.ts).
 *
 * `fixed` covers the viewport (the end-of-lecture screens); otherwise it fills its positioned
 * parent, the way ExplainOverlay covers the board inside the player.
 */
export function LectureSummarySlide({
  summary,
  loading,
  error,
  onRetry,
  onClose,
  fixed = false,
}: {
  summary: LectureSummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
  fixed?: boolean;
}) {
  const codeLines = useMemo(
    () => (summary?.code && summary.language ? highlightLines(summary.code, summary.language) : []),
    [summary],
  );

  return (
    <div
      data-lecture-summary=""
      className={`${fixed ? "fixed" : "absolute"} hud-materialize inset-0 z-50 flex flex-col bg-black/95 p-3 backdrop-blur-md lg:p-6`}
      role="dialog"
      aria-label="Lecture summary"
    >
      <div className="mb-3 flex items-center justify-between">
        <HudEyebrow>The whole lecture, on one slide</HudEyebrow>
        <button onClick={onClose} className="hud-btn-ghost rounded-full px-4 py-1.5 text-xs font-bold">
          Close summary
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid h-full place-items-center text-sm font-semibold text-[var(--hud-text-dim)]">
            Summarizing your lecture…
          </div>
        ) : error || !summary ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="text-sm text-[var(--hud-text-dim)]">{error ?? "The summary isn't available."}</p>
              <button onClick={onRetry} className="hud-btn-primary mt-4 rounded-full px-5 py-2 text-sm font-bold">
                Try again
              </button>
            </div>
          </div>
        ) : (
          <article
            data-summary-slide=""
            className="mx-auto flex min-h-full max-w-4xl flex-col justify-center rounded-2xl border border-slate-200 bg-white px-6 py-8 text-slate-900 lg:px-12 lg:py-10"
          >
            <h2 className="text-2xl font-black tracking-tight text-slate-900 lg:text-3xl">{summary.title}</h2>
            <p data-summary-crux="" className="mt-4 border-l-4 border-amber-400 pl-4 text-lg font-semibold leading-relaxed text-slate-800 lg:text-xl">
              {summary.crux}
            </p>
            <ol className="mt-6 space-y-2.5">
              {summary.points.map((point, i) => (
                <li key={i} data-summary-point={i + 1} className="flex gap-3 text-[0.95rem] leading-relaxed text-slate-700 lg:text-base">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-black text-white">
                    {i + 1}
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ol>
            {codeLines.length > 0 && (
              <div className="code-board mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 py-3 font-mono text-[13px] leading-6">
                <style>{CODE_THEME}</style>
                {codeLines.map((html, i) => (
                  <div key={i} className="flex pr-4">
                    <span className="w-9 shrink-0 select-none pr-3 text-right text-slate-400">{i + 1}</span>
                    <code className="min-w-0 flex-1 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: html || " " }} />
                  </div>
                ))}
              </div>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
