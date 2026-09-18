/**
 * The clock the board follows while the teacher speaks.
 *
 * WHY THIS EXISTS. Narration used to be one audio clip per beat, and which sentence was playing had
 * to be GUESSED by mapping playback progress onto a layout that assumed speech advances in
 * proportion to character count. It does not — sentence-final pauses and spoken-out numbers,
 * symbols and formulas all break the assumption — and the guess drifted. Measured on 12 real beats
 * (scripts/measure-sentence-sync.mjs): median 0.69 s, 90th percentile 1.93 s, worst 2.66 s, and 28
 * of 87 sentence boundaries off by a second or more. The worst were formula-heavy beats, where the
 * board drew the next step while the teacher was still explaining the last one.
 *
 * Narration now plays one clip PER SENTENCE, so which sentence is playing is a fact rather than an
 * estimate. What remains is reporting that position in the form every board already understands.
 *
 * WHY THE PROGRESS IS REPORTED IN CHARACTER-WEIGHT SPACE. Every consumer of `onProgress` feeds it to
 * the board as `drawProgress`, and `narrationSentenceTiming` in components/LessonPlayer.tsx turns it
 * back into "which sentence, and how far through it" using these same character weights. Emitting
 * the value in that space, anchored to the real clip, means the board recovers the sentence AND the
 * position within it exactly — with no change to any consumer. Emitting raw elapsed time instead
 * would have fixed the sentence index and quietly broken the position within the sentence.
 *
 * Pure: no audio, no DOM. The playback lives in lib/voice.ts.
 */

/** The weight the whole app uses for a sentence. Must match lib/voice.ts and LessonPlayer. */
export function sentenceWeight(sentence: string): number {
  return Math.max(1.35, sentence.length / 13);
}

/**
 * Beat progress (0-1) for "sentence `index`, `fraction` of the way through its clip".
 *
 * Inverse of the calculation in `narrationSentenceTiming`: feeding this value back through it yields
 * exactly `index` and `fraction`. That round trip is the whole contract, and it is what the tests pin.
 */
export function sentenceAlignedProgress(weights: number[], index: number, fraction: number): number {
  if (weights.length === 0) return 1;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 1;
  const i = Math.max(0, Math.min(weights.length - 1, index));
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  let before = 0;
  for (let k = 0; k < i; k += 1) before += weights[k];
  return Math.max(0, Math.min(1, (before + f * weights[i]) / total));
}

/**
 * How long to wait between sentence clips.
 *
 * A clip ends where its speech ends, so without a gap sentences run together with none of the pause
 * a speaker leaves at a full stop. Matches the browser path's existing `spokenMs + 240`, so switching
 * voices does not change the rhythm the student hears.
 */
export const SENTENCE_GAP_MS = 240;

/**
 * How many sentence clips may be synthesising at once.
 *
 * Enough that the next sentence is normally ready before the current one ends — a cold synthesis
 * takes seconds — and bounded so a fifteen-sentence beat does not fire fifteen simultaneous requests
 * at the TTS route the instant it starts.
 */
export const CLIP_FETCH_CONCURRENCY = 4;

export type SentenceTiming = {
  /** Which sentence is being spoken. */
  index: number;
  /** How many sentences the beat has. */
  total: number;
  /** How far through the current sentence, 0-1. */
  progress: number;
  /** Position through the beat with every sentence given an equal share — what LiveSketch reads. */
  alignedProgress: number;
};

/**
 * Which sentence is playing, and how far through it, from the board's progress value.
 *
 * Moved here from `narrationSentenceTiming` in components/LessonPlayer.tsx, unchanged in behaviour,
 * so that it and `sentenceAlignedProgress` live side by side and their round trip can be tested
 * against the real code rather than a copy that could quietly drift from it.
 */
export function timingFromProgress(weightsIn: number[], cueIndex: number, beatProgress: number): SentenceTiming {
  const weights = weightsIn.length ? weightsIn : [1];
  const total = weights.length;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const index = Math.max(0, Math.min(total - 1, cueIndex));
  let startWeight = 0;
  for (let k = 0; k < index; k += 1) startWeight += weights[k];
  const start = startWeight / totalWeight;
  const end = (startWeight + weights[index]) / totalWeight;
  const progress = Math.max(0, Math.min(1, (beatProgress - start) / Math.max(0.001, end - start)));
  return { index, total, progress, alignedProgress: (index + progress) / total };
}

/**
 * Where the board is, when the narration opens with a bridge sentence the board knows nothing about.
 *
 * WHY. Every beat after the first is narrated as `${bridge} ${script}` ("That foundation leads
 * directly into…"), but the board's sentence tags number the SCRIPT alone. Cue indices were passed to
 * the board unchanged, so from the second beat on the board ran one sentence ahead of the voice:
 * each sentence's drawing appeared complete the moment it began, and the next one started drawing
 * before the teacher reached it. Measured on real playback, every sentence of every bridged beat
 * showed the next sentence's steps early.
 *
 * Given the narration's weights, how many leading sentences are the bridge, and what voice.ts
 * reported, this returns the board's view: the script sentence, and beat progress re-expressed in
 * the script's own weight space so `timingFromProgress` decodes it exactly.
 */
export function scriptClockFromNarration(
  narrationWeights: number[],
  bridgeSentences: number,
  cueIndex: number,
  narrationProgress: number,
  scriptWeights: number[] = narrationWeights.slice(Math.max(0, bridgeSentences)),
): { onBridge: boolean; scriptIndex: number; scriptProgress: number } {
  const bridge = Math.max(0, Math.min(bridgeSentences, narrationWeights.length));
  if (bridge === 0) {
    return { onBridge: false, scriptIndex: Math.max(0, cueIndex), scriptProgress: Math.max(0, Math.min(1, narrationProgress)) };
  }
  const { index, progress } = timingFromProgress(narrationWeights, cueIndex, narrationProgress);
  if (index < bridge) return { onBridge: true, scriptIndex: 0, scriptProgress: 0 };
  const scriptIndex = index - bridge;
  return { onBridge: false, scriptIndex, scriptProgress: sentenceAlignedProgress(scriptWeights, scriptIndex, progress) };
}
