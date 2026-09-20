/**
 * WHEN A VISUAL APPEARS, RELATIVE TO THE WORDS THAT DESCRIBE IT.
 *
 * Every draw op carries `at: 0.42` — a fraction of the beat's duration — and nothing else. There is
 * no link between an op and the sentence that talks about it, so "when she says *this graph*, the
 * graph is on the board" depends entirely on the model having guessed a number that happens to
 * line up with where that phrase lands in the narration. It frequently does not:
 *
 *   - Narration length varies with the voice, the rate setting and the student's playback speed,
 *     while `at` is a fixed fraction. A board authored against a 45s read desynchronises the moment
 *     the student sets 1.25x.
 *   - A beat that is paused and resumed, or re-read after a question, restarts the fraction against
 *     a different elapsed time.
 *   - The model writes the script and the board in the same call but has no mechanism to say "this
 *     arrow belongs to sentence four" — only to estimate a decimal.
 *
 * `atSentence` fixes the binding directly: the op names the sentence it belongs to, and the player
 * already knows which sentence is being spoken right now (`sentenceCue.index`). Reveal becomes
 * exact at any speech rate, through any pause, on any re-read.
 *
 * MIGRATION IS THE POINT OF THIS MODULE. Every board already generated — in the cache, in lecture
 * history, in a session mid-flight — has only `at`. `resolveOpTiming` accepts both and prefers
 * `atSentence` when present, so old and new boards play correctly side by side and nothing has to
 * be regenerated.
 */

export interface SentenceTiming {
  /** Which sentence of the narration is being spoken, 0-based. */
  index: number;
  /** How many sentences the narration has. */
  total: number;
  /** 0..1 through the whole narration. */
  progress: number;
}

export interface TimedOp {
  /** Legacy: a fraction of the beat's duration. Always present on boards authored before sync. */
  at?: number;
  /**
   * The sentence this op belongs to, 0-based. When set, the op appears as that sentence begins.
   * This is what makes "this graph" true rather than hopeful.
   */
  atSentence?: number;
  /** Optional: keep the op on screen only until this sentence. Omitted means "stays". */
  untilSentence?: number;
}

/**
 * Should this op be visible right now?
 *
 * Deliberately takes BOTH clocks. A board mixes ops that know their sentence with ops that only
 * know a fraction — during migration, and permanently for decorative ops that belong to no
 * particular phrase (a background grid, a frame) and are better placed by time.
 */
export function opVisible(op: TimedOp, sentence: SentenceTiming, elapsedFraction: number): boolean {
  if (typeof op.atSentence === "number") {
    if (sentence.index < op.atSentence) return false;
    if (typeof op.untilSentence === "number" && sentence.index > op.untilSentence) return false;
    return true;
  }
  return elapsedFraction >= (op.at ?? 0);
}

/**
 * The fraction of the beat a sentence-bound op corresponds to, for renderers that can only think
 * in fractions (the drawing animation's own internal timeline).
 *
 * Uses the sentence's share of the narration rather than `index / total`, because sentences are
 * not equal lengths — a two-word "Watch." and a forty-word explanation are one sentence each, and
 * treating them as equal thirds is how a board drifts half a sentence out by the end of a beat.
 */
export function sentenceFraction(atSentence: number, weights: number[]): number {
  if (weights.length === 0) return 0;
  const clamped = Math.max(0, Math.min(weights.length - 1, atSentence));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return clamped / weights.length;
  let before = 0;
  for (let i = 0; i < clamped; i++) before += weights[i];
  return before / total;
}

/**
 * Give every op a usable `at`, derived from its sentence when it has one.
 *
 * Renderers that predate sync only read `at`, so this lets a sentence-bound board play correctly
 * through them without each renderer learning the new field.
 */
export function resolveOpTiming<T extends TimedOp>(ops: T[], sentenceWeights: number[]): T[] {
  return ops.map((op) =>
    typeof op.atSentence === "number"
      ? { ...op, at: sentenceFraction(op.atSentence, sentenceWeights) }
      : op,
  );
}

/**
 * Does this board actually track its narration?
 *
 * Reported rather than enforced. A board whose ops all sit in the first 20% while the narration
 * runs the full beat is technically valid and pedagogically broken — everything appears at once and
 * the teacher then talks over a static picture for ninety seconds. Surfacing it is what lets a
 * generation be rejected or repaired instead of shipped.
 */
export function syncCoverage(ops: TimedOp[], sentenceCount: number): {
  bound: number;
  unbound: number;
  sentencesCovered: number;
  coverage: number;
} {
  const bound = ops.filter((op) => typeof op.atSentence === "number").length;
  const covered = new Set(
    ops
      .map((op) => op.atSentence)
      .filter((value): value is number => typeof value === "number"),
  );
  return {
    bound,
    unbound: ops.length - bound,
    sentencesCovered: covered.size,
    coverage: sentenceCount > 0 ? covered.size / sentenceCount : 0,
  };
}
