"use client";

import { useEffect, useState } from "react";
import { LessonPlayer } from "@/components/LessonPlayer";
import { LectureCostBadge } from "@/components/LectureCostBadge";
import { ReactAnimationSandbox } from "@/components/sketch/ReactAnimationSandbox";
import { RendererBadge } from "@/components/sketch/RendererBadge";
import { animationChipDetail } from "@/lib/animationModels";
import { BuildTimeline } from "@/components/design/BuildTimeline";
import type { ProgressiveLectureSnapshot } from "@/lib/progressiveLectureTypes";
import type { Beat } from "@/lib/lessonContent";

/**
 * `/playback-lab` — the real LessonPlayer on a lecture supplied by a test.
 *
 * Dev-only, like /sandbox-lab and /board-lab. Sync between the voice and the board can only be
 * judged on real playback: the real narration pipeline, the real board, the real clock. Reaching
 * that through the app means planning, a profile and a fresh generation every time, so this page
 * skips straight to the player with beats the test injects as `window.__PLAYBACK_BEATS__` (see
 * scripts/measure-playback-sync.mjs). No model call is made here; the only spend is narration.
 */
declare global {
  interface Window {
    __PLAYBACK_BEATS__?: { title: string; beats: Beat[] };
    /** One finished board to render fully drawn, for side-by-side screenshots of the model comparison. */
    __BOARD_STILL__?: { code: string; assetIds?: string[]; sentenceTotal: number; model?: string; costUsd?: number };
    /** Measured beat timings to render the build screen's timeline with (scripts/measure-lecture-latency.mjs). */
    __BUILD_TIMELINE__?: { beats: NonNullable<ProgressiveLectureSnapshot["beatStatus"]>; createdAt?: string };
  }
}

export default function PlaybackLab() {
  const [lecture, setLecture] = useState<Window["__PLAYBACK_BEATS__"]>(undefined);
  const [still, setStill] = useState<Window["__BOARD_STILL__"]>(undefined);
  const [timeline, setTimeline] = useState<Window["__BUILD_TIMELINE__"]>(undefined);

  useEffect(() => {
    const read = () => {
      if (window.__PLAYBACK_BEATS__) setLecture(window.__PLAYBACK_BEATS__);
      if (window.__BOARD_STILL__) setStill(window.__BOARD_STILL__);
      if (window.__BUILD_TIMELINE__) setTimeline(window.__BUILD_TIMELINE__);
    };
    read();
    const t = window.setInterval(read, 200);
    return () => window.clearInterval(t);
  }, []);

  if (timeline) {
    return (
      <main data-timeline className="mx-auto max-w-xl bg-[#0b0a14] p-6">
        <BuildTimeline beats={timeline.beats} createdAt={timeline.createdAt} />
      </main>
    );
  }
  if (still) {
    // The board as it stands once the teacher has finished: every sentence spoken, fully drawn.
    return (
      <section data-still className="relative h-[620px] w-[1100px] overflow-hidden bg-slate-950 p-3">
        <ReactAnimationSandbox
          code={still.code}
          assetIds={still.assetIds}
          progress={1}
          sentenceIndex={Math.max(0, still.sentenceTotal - 1)}
          sentenceProgress={1}
          sentenceTotal={still.sentenceTotal}
        />
        <RendererBadge kind="sandbox" detail={animationChipDetail(still.model, still.costUsd)} />
      </section>
    );
  }
  if (!lecture) return <p style={{ padding: 24 }}>Waiting for beats (window.__PLAYBACK_BEATS__)…</p>;
  // The same badge LearnPage shows, so a playback run also checks that narration cost reaches it.
  return (
    <div className="relative">
      <LessonPlayer beats={lecture.beats} title={lecture.title} autoVoiceAssistant={false} />
      <LectureCostBadge />
    </div>
  );
}
