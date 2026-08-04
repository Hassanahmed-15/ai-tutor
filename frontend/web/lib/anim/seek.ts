/**
 * Seek coalescing for scrubbed video.
 *
 * ManimBoard holds a video paused and assigns `currentTime` from narration progress. Assigning
 * `currentTime` starts an ASYNCHRONOUS seek; assigning again while one is in flight CANCELS it
 * and starts over. The board was re-rendering 30-60 times a second, so every seek was cancelled
 * by the next one, the compositor never painted, and the video sat on frame 0 — a blank board.
 *
 * The fix is the standard scrub pattern: never interrupt an in-flight seek, just remember where
 * you wanted to go and make one more hop when it lands. Kept as a pure function so the decision
 * is unit-testable without a DOM — the event wiring is not the interesting part, this is.
 */

export interface SeekDecision {
  /** Time to assign to `currentTime`, or null to leave the element alone. */
  seekTo: number | null;
  /** Target to remember and re-apply once the in-flight seek completes. */
  pending: number | null;
}

export interface SeekInput {
  /** The element's current playback position. */
  current: number;
  /** Where progress says we should be. */
  target: number;
  /** Whether a seek is already in flight (`video.seeking`). */
  seeking: boolean;
  /** Frame rate, used to ignore moves too small to change the picture. */
  fps?: number;
}

export function nextSeekTarget({ current, target, seeking, fps = 30 }: SeekInput): SeekDecision {
  if (!Number.isFinite(target) || !Number.isFinite(current)) {
    return { seekTo: null, pending: null };
  }

  // A seek is already running. Record where we actually want to be and let it finish —
  // interrupting is what starved the seek and froze the board on frame 0.
  if (seeking) {
    return { seekTo: null, pending: target };
  }

  // Below half a frame the decode cannot change what is on screen, so the seek is pure cost.
  const epsilon = 0.5 / Math.max(1, fps);
  if (Math.abs(target - current) < epsilon) {
    return { seekTo: null, pending: null };
  }

  return { seekTo: target, pending: null };
}
