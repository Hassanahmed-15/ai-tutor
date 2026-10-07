"use client";

import { groupSlides } from "@/lib/anim/slideGroups";
import { Play, Square } from "lucide-react";
import {
  LESSON_DESIGN_STAGES,
  estimateRemainingMs,
  formatRemaining,
  progressFor,
  stageIndex,
} from "@/lib/lessonDesignStages";
import type { DesignProgress } from "./LessonDesignMode";
import type { ProgressiveLectureSnapshot } from "@/lib/progressiveLectureTypes";

/**
 * THE WAIT, WITHOUT A CONVERSATION.
 *
 * The build screen used to open a Gemini Live session: an avatar, a microphone, a transcript and a
 * text box, all so Aria could talk to the student while the lecture generated. That is a second
 * voice session competing with the lecture's own, and — asked for directly — it is not what someone
 * watching a progress bar wants. This screen makes no sound, opens no socket and asks for nothing.
 *
 * What it shows instead is the lesson appearing: its parts as frames that fill in as each board is
 * written, one thin line for how far along, and one whisper for how long is left. The per-slide
 * timings the worker collects (BeatTiming) are not shown; a student waiting for a lesson wants to
 * see it appear, not read a report about it appearing.
 */

type BeatRow = NonNullable<ProgressiveLectureSnapshot["beatStatus"]>[number];

export type LessonBuildScreenProps = {
  topic: string;
  progress: DesignProgress;
  ready: boolean;
  beatStatus?: BeatRow[];
  /** Kept for callers; the screen no longer shows elapsed time. */
  buildStartedAt?: string;
  onStop: () => void;
  onStart: () => void;
};

/** What a slide is doing, said plainly. The worker's state names are for the worker. */
function slideStage(row: BeatRow): { label: string; tone: "done" | "active" | "waiting" } {
  switch (row.state) {
    case "ready":
      return { label: "Ready", tone: "done" };
    case "playable":
      return { label: "Drawing the board", tone: "active" };
    case "generating":
      return { label: "Writing the script", tone: "active" };
    default:
      return { label: "Queued", tone: "waiting" };
  }
}

export function LessonBuildScreen({
  topic,
  progress,
  ready,
  beatStatus,
  onStop,
  onStart,
}: LessonBuildScreenProps) {
  const percent = ready ? 1 : progressFor(progress.stage, progress.stageFraction);
  const currentStage = stageIndex(progress.stage);
  const remaining = ready ? null : formatRemaining(estimateRemainingMs(progress.elapsedMs, percent));

  const slides = beatStatus ?? [];
  const readyCount = slides.filter((s) => s.state === "ready").length;

  return (
    /*
     * `data-quiet-screen` asks the app-wide "Talk to Aria" control to stay out of the way while
     * this screen is up. It is a marker rather than a prop because that button is mounted globally,
     * beside the whole app, and threading a "hide me" flag from here up to the root would couple
     * two unrelated trees for one boolean.
     */
    <div
      data-quiet-screen="lesson-build"
      className="hud-canvas flex min-h-screen flex-col items-center justify-center px-5 py-10 text-[var(--hud-text)]"
    >
      {/*
       * THE BUILD, WITH ALMOST NOTHING TO READ. The lesson's parts as frames that fill in as each
       * board is written (the one being written breathes), one thin line for how far along, and
       * one whisper for how long is left. The percentage, the slide table with its states and the
       * seven-step checklist are gone: a student waiting for a lesson wants to see it appear, not
       * read a report about it appearing.
       */}
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center text-center">
        <h1 className="font-display text-[2.2rem] leading-[1.1] text-[var(--hud-text)] sm:text-[2.8rem]" style={{ textWrap: "balance" }}>{topic}</h1>
        <p className="mt-3 font-[family-name:var(--font-hud-mono)] text-[0.75rem] uppercase tracking-[0.1em] text-[var(--hud-text-faint)]" aria-live="polite">
          {ready ? "Ready" : remaining ? `about ${remaining}` : (LESSON_DESIGN_STAGES[currentStage]?.label ?? progress.status)}
        </p>

        <div className="mt-8 h-[3px] w-full max-w-md overflow-hidden rounded-full bg-[var(--hud-surface-2)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent * 100)}>
          <div className="h-full rounded-full bg-[var(--hud-cyan)] transition-[width] duration-700 ease-out" style={{ width: `${Math.max(2, percent * 100)}%` }} />
        </div>

        {slides.length > 0 && (
          <ol className="mt-10 flex flex-wrap justify-center gap-3" aria-label={`${readyCount} of ${slides.length} boards ready`}>
            {groupSlides(slides).map((group) => {
              const active = group.rows.find((r) => slideStage(r).tone === "active");
              const done = group.readyCount === group.rows.length;
              const tone = done ? "done" : active ? "active" : "waiting";
              return (
                <li key={group.first} title={group.title} className="flex flex-col items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`relative block h-12 w-16 rounded-[6px] border transition-colors duration-500 ${
                      tone === "done" ? "border-[var(--hud-line-strong)] bg-[var(--hud-surface)]" : tone === "active" ? "border-[var(--hud-cyan)] bg-[var(--accent-soft)]" : "border-dashed border-[var(--hud-line)]"
                    }`}
                  >
                    {tone === "done" && (
                      <svg viewBox="0 0 64 48" className="absolute inset-0 h-full w-full">
                        <line x1="12" y1="14" x2="42" y2="14" stroke="var(--hud-cyan)" strokeWidth="2.2" strokeLinecap="round" />
                        <line x1="12" y1="22" x2="34" y2="22" stroke="var(--hud-text-faint)" strokeWidth="1.6" strokeLinecap="round" />
                        <line x1="12" y1="30" x2="38" y2="30" stroke="var(--hud-text-faint)" strokeWidth="1.6" strokeLinecap="round" />
                        <circle cx="50" cy="31" r="5" fill="none" stroke="var(--hud-text-faint)" strokeWidth="1.4" />
                      </svg>
                    )}
                    {tone === "active" && <span className="aria-breathe absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--hud-cyan)]" />}
                  </span>
                  <span className="max-w-16 truncate text-[0.625rem] text-[var(--hud-text-faint)]">{group.title}</span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-12 flex items-center gap-3">
          <button
            onClick={onStop}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--hud-line)] px-4 text-[0.8125rem] font-medium text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)]"
          >
            <Square size={13} aria-hidden /> Stop
          </button>
          {ready && (
            <button
              onClick={onStart}
              className="hud-btn-primary inline-flex h-11 items-center gap-2 rounded-full px-7 text-[1rem]"
            >
              <Play size={15} fill="currentColor" aria-hidden /> Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
