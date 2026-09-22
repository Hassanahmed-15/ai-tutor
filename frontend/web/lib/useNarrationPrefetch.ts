"use client";

import { useEffect } from "react";
import { splitNarrationSentences } from "./voice";
import { recordTtsResponse } from "./costLedger";

/**
 * Warms the server-side TTS cache for what the student is about to hear.
 *
 * WHY THIS EXISTS. Narration is synthesised on demand, and a cold call to /api/tts takes seconds. The
 * board is driven by the audio clock, so until that audio exists nothing moves and nothing is heard.
 * The route caches by exact text and a cache hit returns in ~12 ms, so the fix is not new
 * infrastructure: it is asking for the audio earlier.
 *
 * THE BUG THIS VERSION FIXES — "when slides change there is a pause". Measured on a real lecture:
 * through the whole of beat one (0–110 s) not a single sentence of beat two was warmed, so every one
 * of them was a cold fetch the moment the slide changed — 2.8 s of silence before the transition
 * sentence. The old warm-up was one loop guarded by an "already running" flag. Any re-run of its
 * effect while a fetch was in flight (a re-render handing it a new `scripts` array is enough)
 * cancelled the running loop, and the new run saw the flag, gave up, and scheduled nothing — so
 * warming was dead until the next beat change.
 *
 * Now there is ONE shared queue and a small pool that drains it. A run never drops work: it puts its
 * priorities at the front and leaves the rest queued. And the priorities are the right ones —
 * what is heard next first:
 *   1. the opening of the current beat (the first words after Start, or after a resume);
 *   2. the NEXT beat, transition sentence first — the join the student hears as a pause;
 *   3. the beats after that, up to `lookahead`.
 * The rest of the current beat is left alone: the player fetches it itself, several at a time.
 *
 * Every failure is swallowed (and the sentence may be tried again): this is a warm-up, and if it
 * fails the normal on-demand path runs exactly as before, just slower.
 */

const CONCURRENCY = 2;
/** Sentences of the current beat worth warming: its opening, which is what a start or resume waits on. */
const CURRENT_BEAT_OPENING = 2;

const warmed = new Set<string>();
let queue: string[] = [];
let active = 0;

/** What to warm, most urgent first. Pure, so the ordering can be pinned by tests. */
export function warmOrder(scripts: string[], currentIndex: number, lookahead = 2): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (sentences: string[]) => {
    for (const sentence of sentences) {
      if (sentence && !seen.has(sentence)) {
        seen.add(sentence);
        order.push(sentence);
      }
    }
  };
  if (currentIndex >= 0 && currentIndex < scripts.length) {
    add(splitNarrationSentences(scripts[currentIndex] ?? "").slice(0, CURRENT_BEAT_OPENING));
  }
  for (let i = currentIndex + 1; i <= currentIndex + lookahead && i < scripts.length; i += 1) {
    add(splitNarrationSentences(scripts[i] ?? ""));
  }
  return order;
}

async function drain(): Promise<void> {
  active += 1;
  try {
    for (let text = queue.shift(); text !== undefined; text = queue.shift()) {
      if (warmed.has(text)) continue;
      warmed.add(text);
      // The body is discarded: the point is to fill the server's cache, not to hold audio here.
      const ok = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then(async (r) => {
          // Warming spends real money on a miss, so it is this lecture's cost too.
          recordTtsResponse(r);
          await r.blob();
          return r.ok;
        })
        .catch(() => false);
      if (!ok) warmed.delete(text);
    }
  } finally {
    active -= 1;
  }
}

/** Puts these at the front of the queue (most urgent first) and makes sure the pool is draining it. */
function prioritise(texts: string[]): void {
  if (typeof window === "undefined") return;
  const fresh = texts.filter((text) => text && !warmed.has(text));
  if (fresh.length === 0) return;
  const front = new Set(fresh);
  queue = [...fresh, ...queue.filter((text) => !front.has(text))];
  while (active < CONCURRENCY && queue.length > 0) void drain();
}

/**
 * Warm these sentences now, from outside a component.
 *
 * The hook only runs once the player is mounted, which is after the build finishes — too late for
 * the lecture's own opening line. The build screen calls this the moment the first beat's text
 * exists, so by the time the student presses Start the opening clip is a cache hit.
 */
export function warmNarration(sentences: string[]): void {
  prioritise(sentences);
}

export function useNarrationPrefetch(scripts: string[], currentIndex: number, lookahead = 2): void {
  useEffect(() => {
    // Re-running is safe and cheap: it re-prioritises, it never cancels what is already queued.
    prioritise(warmOrder(scripts, currentIndex, lookahead));
  }, [scripts, currentIndex, lookahead]);
}
