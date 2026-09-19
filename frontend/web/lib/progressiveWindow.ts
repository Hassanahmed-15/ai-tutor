/**
 * Which beats of a progressive lecture should be generated NOW.
 *
 * WHY THIS EXISTS. Beats used to be generated in fixed lanes: when beat n finished, beat n+4 was
 * queued, regardless of where the student was. Two things followed.
 *
 *   1. Personalisation came too late. The whole lecture was usually written before the student had
 *      asked a single question, so their questions and checkpoint answers only reached a beat by
 *      forcing it to be rewritten.
 *   2. A lecture could stall for good. An adaptive change reset every unplayed beat to
 *      "generating" but re-queued only two of them; lanes stepping by four then skipped the rest,
 *      and playback stopped at the first beat nobody would ever write.
 *
 * Now a beat is written only when it comes within reach of the playhead — two beats ahead, three
 * when it is an animation, because animations take 66-206 s to render against a 35-55 s beat — so
 * it is written with everything the student has done up to that point. And "due" is computed from
 * the state of every beat, not remembered by a lane, so a reset beat cannot be orphaned.
 *
 * Pure: no database, no queue. lib/progressiveDispatch.ts applies it.
 */

export type WindowBeatState = "planned" | "generating" | "playable" | "ready" | "failed";

export type WindowBeat = {
  sequence: number;
  state: WindowBeatState;
  /** ISO time of the last write, used to recognise a generation that died. */
  updatedAt: string;
};

export type WindowInput = {
  planLength: number;
  /** The beat being played, or -1 before playback starts. */
  playhead: number;
  /** Which planned beats are animations; they get a longer lead. */
  isAnimation: (sequence: number) => boolean;
  beats: WindowBeat[];
  now: number;
  lookahead?: number;
  animationLookahead?: number;
  staleMs?: number;
};

export const DEFAULT_LOOKAHEAD = 2;
export const DEFAULT_ANIMATION_LOOKAHEAD = 3;
/** Longer than any real generation (the slowest measured board took ~4 min), so only the dead expire. */
export const STALE_GENERATION_MS = 10 * 60_000;

/** The configured lead, read per call so a deploy can tune it without a code change. */
export function lookaheadFromEnv(env: Record<string, string | undefined> = process.env): {
  lookahead: number;
  animationLookahead: number;
} {
  const clamp = (raw: string | undefined, fallback: number) => {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 1 ? Math.min(12, n) : fallback;
  };
  const lookahead = clamp(env.PROGRESSIVE_LOOKAHEAD, DEFAULT_LOOKAHEAD);
  return {
    lookahead,
    animationLookahead: Math.max(lookahead, clamp(env.PROGRESSIVE_ANIMATION_LOOKAHEAD, DEFAULT_ANIMATION_LOOKAHEAD)),
  };
}

/**
 * Sequences to dispatch now, lowest first.
 *
 * A beat is due when it is within reach of the playhead and nobody is working on it:
 *   - it has no record yet;
 *   - it was reset by an adaptation ("planned");
 *   - its generation has been silent for longer than any real one takes (the worker died).
 * A beat being generated, awaiting its visuals, finished, or failed for good is left alone —
 * dispatching it again would pay twice for the same beat.
 */
export function dueSequences(input: WindowInput): number[] {
  const lookahead = input.lookahead ?? DEFAULT_LOOKAHEAD;
  const animationLookahead = Math.max(lookahead, input.animationLookahead ?? DEFAULT_ANIMATION_LOOKAHEAD);
  const staleMs = input.staleMs ?? STALE_GENERATION_MS;
  // Before playback starts the playhead is -1; the opening beats are measured from beat 0.
  const base = Math.max(0, Math.floor(input.playhead));
  const bySequence = new Map(input.beats.map((beat) => [beat.sequence, beat]));
  const due: number[] = [];

  for (let sequence = 0; sequence < input.planLength; sequence += 1) {
    const reach = input.isAnimation(sequence) ? animationLookahead : lookahead;
    if (sequence > base + reach) continue;
    const beat = bySequence.get(sequence);
    if (!beat || beat.state === "planned") {
      due.push(sequence);
      continue;
    }
    if (beat.state === "generating") {
      const age = input.now - Date.parse(beat.updatedAt);
      if (Number.isFinite(age) && age > staleMs) due.push(sequence);
    }
  }
  return due;
}
