"use client";

import { useEffect, useRef } from "react";
import { splitNarrationSentences } from "./voice";
import { recordTtsResponse } from "./costLedger";

/**
 * Warms the server-side TTS cache for beats the student has not reached yet.
 *
 * WHY THIS EXISTS. Narration is synthesised on demand, and a cold call to /api/tts takes 6-8
 * seconds for a beat-length script (measured). The board is driven by the audio clock, so nothing
 * on screen moves until that audio exists — the student sees a finished-looking board sitting
 * still, then everything arrives at once. It reads as the lesson being out of sync with the voice
 * when in fact the voice simply had not started.
 *
 * The route already caches by exact text (`${model}:${voice}:${input}`), and a cache hit returns in
 * ~12ms rather than ~7s. So the fix is not new infrastructure: it is asking for the audio earlier.
 * This mirrors useManimPrefetch, which exists for exactly the same reason — "a render takes seconds
 * and the narration does not wait, so on-demand rendering always loses the race."
 *
 * Deliberately conservative:
 *   - Only `lookahead` beats ahead, so a long lecture does not synthesise every beat up front and
 *     bill for audio the student may never hear (~$0.015/min).
 *   - One request in flight at a time, so prefetching never competes with the audio the student is
 *     actually waiting on.
 *   - Every failure is swallowed. This is a warm-up; if it fails the normal on-demand path runs
 *     exactly as before, just slower. It must never be able to break playback.
 */
/**
 * Warm these sentences now, from outside a component.
 *
 * The hook only runs once the player is mounted, which is after the build finishes — too late for
 * the lecture's own opening line. The build screen calls this the moment the first beat's text
 * exists, so by the time the student presses Start the opening clip is a cache hit.
 */
export async function warmNarration(sentences: string[]): Promise<void> {
  if (typeof window === "undefined") return;
  for (const text of sentences) {
    if (!text || warmed.has(text)) continue;
    warmed.add(text);
    await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
      .then((r) => {
        recordTtsResponse(r);
        return r.blob();
      })
      .catch(() => undefined);
  }
}

const warmed = new Set<string>();

export function useNarrationPrefetch(scripts: string[], currentIndex: number, lookahead = 2): void {
  // Text already requested, so re-renders and re-visits never refetch. Keyed by the script itself
  // because that is what the server cache keys on.
  const requested = useRef<Set<string>>(new Set());
  const inFlight = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    /*
     * Warm each SENTENCE, not the whole script.
     *
     * Narration now plays one clip per sentence (see lib/voice.ts), and the server cache keys on the
     * exact text it is asked for. Warming the whole script would fill the cache with an entry the
     * player never requests — every lookahead fetch wasted, and every upcoming sentence still a cold
     * synthesis of several seconds.
     */
    const pending: string[] = [];
    // From the CURRENT beat, not the next one. The beat the student is on is the one whose first
    // clip they are waiting for in silence; on beat one that wait is the pause at the start of the
    // lecture. Its sentences are already in `requested` once it has played, so this costs nothing
    // after the first beat.
    for (let i = currentIndex; i <= currentIndex + lookahead && i < scripts.length; i += 1) {
      for (const sentence of splitNarrationSentences(scripts[i] ?? "")) {
        if (sentence && !requested.current.has(sentence)) pending.push(sentence);
      }
    }
    if (pending.length === 0) return;

    const run = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        for (const text of pending) {
          if (cancelled) break;
          requested.current.add(text);
          // The response body is intentionally discarded: the point is to populate the server's
          // cache, not to hold audio in memory here. The player fetches it again when it needs it
          // and gets the cached copy.
          await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          })
            .then((r) => {
              // Warming spends real money on a miss, so it is this lecture's cost too.
              recordTtsResponse(r);
              return r.blob();
            })
            .catch(() => undefined);
        }
      } finally {
        inFlight.current = false;
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [scripts, currentIndex, lookahead]);
}
