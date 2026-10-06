"use client";

import { groupSlides } from "@/lib/anim/slideGroups";
import { useEffect, useState } from "react";
import { Check, Play, Square } from "lucide-react";
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
 * What it shows instead is the thing the student actually came for: which slide is being written
 * right now, which are finished, and how much is left. The data was already being collected by the
 * worker per beat (BeatTiming); it was previously rendered only as a developer's timing breakdown
 * — attempt counts, model names, "Critic", "Database" — beneath the chat. Here it is the whole
 * screen, in the student's terms.
 */

type BeatRow = NonNullable<ProgressiveLectureSnapshot["beatStatus"]>[number];

export type LessonBuildScreenProps = {
  topic: string;
  progress: DesignProgress;
  ready: boolean;
  beatStatus?: BeatRow[];
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

const seconds = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);

export function LessonBuildScreen({
  topic,
  progress,
  ready,
  beatStatus,
  buildStartedAt,
  onStop,
  onStart,
}: LessonBuildScreenProps) {
  /*
   * Starts at 0, not Date.now().
   *
   * The server renders this component too, and a clock read during render differs between the
   * server's HTML and the client's first paint — React then discards the tree with a hydration
   * error. Zero means "no clock yet", every duration below falls back to a server-safe value until
   * the first tick, and one interval drives the elapsed time and all per-slide durations together
   * so they cannot drift apart.
   */
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const percent = ready ? 1 : progressFor(progress.stage, progress.stageFraction);
  const currentStage = stageIndex(progress.stage);
  const remaining = ready ? null : formatRemaining(estimateRemainingMs(progress.elapsedMs, percent));

  const slides = beatStatus ?? [];
  const readyCount = slides.filter((s) => s.state === "ready").length;
  // Before the first tick (server render, and the instant before the effect runs) fall back to the
  // caller's own elapsed figure, which is the same on both sides.
  const elapsed = buildStartedAt && now > 0 ? now - Date.parse(buildStartedAt) : progress.elapsedMs;

  return (
    /*
     * `data-quiet-screen` asks the app-wide "Talk to Aria" control to stay out of the way while
     * this screen is up. It is a marker rather than a prop because that button is mounted globally,
     * beside the whole app, and threading a "hide me" flag from here up to the root would couple
     * two unrelated trees for one boolean.
     */
    <div
      data-quiet-screen="lesson-build"
      className="min-h-screen bg-[var(--hud-bg)] px-5 py-10 text-[var(--hud-text)]"
    >
      <div className="mx-auto w-full max-w-3xl">
        <header className="text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--hud-text-faint)]">
            Preparing your lesson
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{topic}</h1>
          <p className="mt-2 text-sm text-[var(--hud-text-dim)]">
            {ready
              ? "Your lesson is ready."
              : slides.length > 0
                ? `${readyCount} of ${slides.length} slides ready`
                : (progress.detail ?? progress.status)}
          </p>
        </header>

        {/* THE HEADLINE BAR. One number, one bar — the answer to "how much longer". */}
        <section className="mt-8 rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">
              {ready ? "Finished" : (LESSON_DESIGN_STAGES[currentStage]?.label ?? progress.status)}
            </span>
            <span className="text-2xl font-bold tabular-nums text-[var(--hud-cyan)]">{Math.round(percent * 100)}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--hud-surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--hud-cyan)] transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(2, percent * 100)}%` }}
            />
          </div>
          <p className="mt-2.5 flex flex-wrap justify-between gap-x-4 text-[11px] text-[var(--hud-text-faint)]">
            <span>{seconds(elapsed)} elapsed</span>
            {remaining && <span>about {remaining} left</span>}
          </p>
        </section>

        {/* THE SLIDES. The centre of the screen, because it is the only part that answers "what is
            happening right now" rather than "how far along". */}
        {slides.length > 0 && (
          <section className="mt-6 rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5">
            <h2 className="text-sm font-semibold">Slides</h2>
            <ul className="mt-3 space-y-1.5">
              {groupSlides(slides).map((group) => {
                // One line per subtopic: the stage of its most advanced board still in progress.
                const active = group.rows.find((r) => slideStage(r).tone === "active");
                const row = active ?? (group.readyCount === group.rows.length ? group.rows[0] : group.rows[group.rows.length - 1]);
                const { label, tone } = group.readyCount === group.rows.length ? slideStage(group.rows[0]) : slideStage(row);
                const started = row.timing?.textStartedAt ? Date.parse(row.timing.textStartedAt) : null;
                const running = tone === "active" && started && now > 0 ? now - started : null;
                const many = group.rows.length > 1;
                return (
                  <li
                    key={group.first}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                      tone === "active" ? "bg-[var(--hud-cyan)]/[0.07] ring-1 ring-inset ring-[var(--hud-cyan)]/25" : ""
                    }`}
                  >
                    <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center">
                      {tone === "done" ? (
                        <Check size={13} strokeWidth={3} className="text-[var(--hud-cyan)]" />
                      ) : tone === "active" ? (
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--hud-cyan)]" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full border border-[var(--hud-text-faint)]/50" />
                      )}
                    </span>
                    <span className="w-9 shrink-0 text-[11px] tabular-nums text-[var(--hud-text-faint)]">
                      {many ? `${group.first + 1}–${group.last + 1}` : group.first + 1}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-[13px] ${
                        tone === "waiting" ? "text-[var(--hud-text-faint)]/60" : "text-[var(--hud-text)]"
                      }`}
                    >
                      {group.title}
                      {many && <span className="ml-2 text-[11px] text-[var(--hud-text-faint)]">{group.rows.length} boards</span>}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] tabular-nums ${
                        tone === "active" ? "text-[var(--hud-cyan)]" : "text-[var(--hud-text-faint)]"
                      }`}
                    >
                      {label}
                      {many && tone !== "done" && group.readyCount > 0 ? ` · ${group.readyCount} of ${group.rows.length} ready` : ""}
                      {running !== null ? ` · ${seconds(running)}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* THE STAGES. Kept small and secondary: it explains the phase the build is in, which the
            slide list cannot show before any slide has been planned. */}
        <section className="mt-6 rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5">
          <h2 className="text-sm font-semibold">Steps</h2>
          <ul className="mt-3 space-y-1">
            {LESSON_DESIGN_STAGES.map((stage, index) => {
              const done = ready || index < currentStage;
              const active = !ready && index === currentStage;
              return (
                <li
                  key={stage.id}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-2 text-[11px] leading-6 ${
                    done
                      ? "text-[var(--hud-text-dim)]"
                      : active
                        ? "font-semibold text-[var(--hud-cyan)]"
                        : "text-[var(--hud-text-faint)]/40"
                  }`}
                >
                  <span aria-hidden className="grid h-3 w-3 shrink-0 place-items-center">
                    {done ? (
                      <Check size={11} strokeWidth={3} />
                    ) : active ? (
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--hud-cyan)]" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full border border-current" />
                    )}
                  </span>
                  {stage.label}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mt-7 flex items-center justify-center gap-3">
          <button
            onClick={onStop}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--hud-line)] px-4 text-xs font-semibold text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)]"
          >
            <Square size={14} aria-hidden /> Stop
          </button>
          {ready && (
            <button
              onClick={onStart}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--hud-cyan)] px-6 text-xs font-black uppercase tracking-[0.14em] text-[var(--accent-on)] transition hover:brightness-110"
            >
              <Play size={15} aria-hidden /> Start lecture
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
