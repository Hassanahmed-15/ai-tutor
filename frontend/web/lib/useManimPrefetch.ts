"use client";

import { useEffect } from "react";

/**
 * Kicks off a Manim render for every beat of a lecture as soon as it loads.
 *
 * THE PROBLEM THIS SOLVES. Rendering on demand means the student waits for the beat they are
 * already listening to: a beat takes seconds to render, the narration does not pause, and by
 * the time the video appears Aria has finished explaining it. Rendering is only viable if it
 * happens *ahead* of the student.
 *
 * So: hand the server every beat at once, up front. The server queues them across a warm
 * worker pool and returns immediately — it does not wait for the renders. By the time the
 * student reaches beat 3, it has been sitting in the cache for a minute. Beat 0 is the only
 * one that can still be late, and ManimBoard covers that by drawing the live SVG board until
 * the video arrives.
 *
 * Cheap to call repeatedly: results are cached by content hash, so a re-render of an already
 * rendered lecture costs one request and no CPU.
 */
export function useManimPrefetch(
  scripts: unknown[],
  { enabled = true, quality = "medium" }: { enabled?: boolean; quality?: "low" | "medium" | "high" } = {},
) {
  // Identity of the SET of beats, so this fires once per lecture rather than on every render.
  const key = enabled ? JSON.stringify(scripts).length + ":" + scripts.length : "";

  useEffect(() => {
    if (!enabled || scripts.length === 0) return;
    const controller = new AbortController();

    fetch("/api/manim-render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scripts, quality }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { prefetching?: number; poolSize?: number } | null) => {
        if (data?.prefetching) {
          console.info(`[manim] prefetching ${data.prefetching} beats across ${data.poolSize} workers`);
        }
      })
      // A failed prefetch is not an error the student should ever see: every beat still
      // renders on demand, and falls back to the live board while it does.
      .catch(() => {});

    return () => controller.abort();
    // `key` stands in for the beat set; `scripts` itself is a new array identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, quality]);
}
