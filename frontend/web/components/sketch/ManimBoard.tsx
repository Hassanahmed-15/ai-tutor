"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "../../lib/anim/useReducedMotion";
import { nextSeekTarget } from "../../lib/anim/seek";
import { LiveSketch } from "./LiveSketch";
import { RendererBadge } from "./RendererBadge";

/**
 * Plays a Manim-rendered beat, scrubbed by narration progress.
 *
 * THE VIDEO IS NEVER PLAYED. It stays paused and we set `currentTime` every frame from
 * `progress`. That sounds odd for a video element, but it is the only way to keep the same
 * contract LiveSketch has: the visual follows the narration exactly, including when the
 * student pauses, scrubs back, or the TTS runs slower than expected. Calling `play()` would
 * hand timing to the video clock and the two would drift apart within seconds.
 *
 * It also means no audio track, no autoplay policy to fight, and no buffering stall changing
 * what is on screen — the frame shown is purely a function of progress, exactly as in the
 * SVG renderer.
 *
 * Props mirror LiveSketch's `{ script, progress }` shape so VisualDirector can swap renderers
 * with a one-line conditional.
 */

type RenderState =
  | { status: "rendering" }
  | { status: "ready"; url: string; unsupportedOps: string[] }
  | { status: "failed"; reason: string };

export function ManimBoard({
  script,
  progress,
  quality = "medium",
  onError,
}: {
  script: unknown;
  progress?: number;
  quality?: "low" | "medium" | "high";
  onError?: () => void;
}) {
  // Starts in "rendering" rather than being set there by the effect: VisualDirector mounts
  // this with key={beat.id}, so a new beat is a fresh component and the initial state is
  // already correct. Setting it synchronously in the effect would just be a wasted render.
  const [state, setState] = useState<RenderState>({ status: "rendering" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Where progress wants the video to be, recorded while a seek is already in flight.
  const pendingSeekRef = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  // `onError` is passed as an inline arrow by VisualDirector, so it is a new function on every
  // parent render — and the parent re-renders on every narration tick. Held in a ref and kept
  // OUT of the effect deps below: a callback prop must never be able to restart a network
  // request. It could, and it did: 985 POSTs for 4 beats.
  const onErrorRef = useRef(onError);
  // Synced in an effect, not during render — React 19 forbids writing refs while rendering.
  useEffect(() => {
    onErrorRef.current = onError;
  });

  // Depend on content, not object identity, so a caller passing an equal-but-new object does
  // not trigger a refetch either.
  const scriptKey = useMemo(() => JSON.stringify(script), [script]);

  // Ask the server to render (or serve from cache). Aborted if the beat changes mid-flight.
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/manim-render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ script, quality }),
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          url?: string;
          error?: string;
          unsupportedOps?: string[];
        };
        if (controller.signal.aborted) return;
        if (!res.ok || !data.url) {
          setState({ status: "failed", reason: data.error ?? `Render request failed (${res.status}).` });
          onErrorRef.current?.();
          return;
        }
        const url = data.url;
        // Never re-set identical state: a fresh object would re-render the board and re-run
        // the seek effect for no reason.
        setState((prev) =>
          prev.status === "ready" && prev.url === url
            ? prev
            : { status: "ready", url, unsupportedOps: data.unsupportedOps ?? [] },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "failed",
          reason: error instanceof Error ? error.message : "Render request failed.",
        });
        onErrorRef.current?.();
      }
    })();

    return () => controller.abort();
    // `scriptKey` is `script` by content — depending on the object itself would refetch on
    // every parent render, which is the loop this exists to kill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptKey, quality]);

  // Scrub. Uses the video's OWN duration rather than the requested one: Manim quantises each
  // animation to whole frames, so the real file is a few tens of milliseconds longer than
  // asked for. Mapping against the actual duration makes progress->frame exact anyway.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || state.status !== "ready") return;

    const seek = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;

      // If the element does not consider the resource seekable there is nothing to do —
      // assigning currentTime would be silently discarded. That is what happened when the
      // video route ignored Range requests: every seek vanished and the board sat on frame 0.
      if (video.seekable.length === 0) return;

      // Reduced motion: show the finished board rather than animating through it.
      let target = reducedMotion ? duration : Math.max(0, Math.min(1, progress ?? 0)) * duration;
      // A tiny epsilon back from the end: seeking exactly to `duration` can land past the
      // last frame and show black in some browsers.
      target = Math.min(target, duration - 0.001);
      // Stay inside what is actually buffered/seekable, so a partially loaded video moves as
      // far as it can rather than refusing the seek outright.
      target = Math.max(video.seekable.start(0), Math.min(target, video.seekable.end(video.seekable.length - 1)));

      const { seekTo, pending } = nextSeekTarget({
        current: video.currentTime,
        target,
        seeking: video.seeking,
      });
      pendingSeekRef.current = pending;
      if (seekTo !== null) video.currentTime = seekTo;
    };

    // `loadeddata` (readyState >= HAVE_CURRENT_DATA), not `loadedmetadata`: with only metadata
    // there is no decoded frame to move to and an early seek can be dropped.
    if (video.readyState >= 2) seek();
    else video.addEventListener("loadeddata", seek, { once: true });
    return () => video.removeEventListener("loadeddata", seek);
  }, [progress, state, reducedMotion]);

  // The follow-up hop, registered ONCE for the element's lifetime. Putting it in the
  // progress-dependent effect above would detach it mid-seek on every narration tick, which is
  // precisely the window it needs to survive.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || state.status !== "ready") return;

    const onSeeked = () => {
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (target === null) return;
      const { seekTo } = nextSeekTarget({ current: video.currentTime, target, seeking: false });
      if (seekTo !== null) video.currentTime = seekTo;
    };

    video.addEventListener("seeked", onSeeked);
    return () => video.removeEventListener("seeked", onSeeked);
  }, [state.status]);

  // Until the video exists, draw the SAME script live in SVG. A Manim render takes seconds,
  // and the narration does not wait — showing a "rendering…" card meant the student heard the
  // entire beat explained over a placeholder. The live board is the same content from the same
  // DrawScript, so this is a real fallback, not a spinner: the lesson is never interrupted,
  // and the video takes over the moment it is ready (usually instantly, from prefetch).
  if (state.status !== "ready") {
    return (
      <div className="relative h-full min-h-0 w-full">
        <LiveSketch script={script as Parameters<typeof LiveSketch>[0]["script"]} progress={progress} />
        {/* Badge tells the truth about what is actually on screen, not what was intended. */}
        <RendererBadge kind="svg" />
        {state.status === "failed" && (
          <span className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-rose-200/90 backdrop-blur-md">
            Manim unavailable — live board
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-slate-800 bg-black">
      <video
        ref={videoRef}
        src={state.url}
        className="absolute inset-0 h-full w-full object-contain"
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <RendererBadge kind="manim" />
      {state.unsupportedOps.length > 0 && (
        <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-amber-200/90 backdrop-blur-md">
          {state.unsupportedOps.join(", ")} not rendered
        </span>
      )}
    </div>
  );
}
