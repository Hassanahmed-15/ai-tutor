/**
 * The narration clock: what lib/voice.ts reports, and what the board reads back from it.
 *
 * The one property that matters is the ROUND TRIP. Narration now plays a clip per sentence and knows
 * exactly which sentence is speaking and how far through its clip it is; it encodes that as a single
 * 0-1 progress value, and every board decodes it again through `timingFromProgress`. If the two
 * disagree by even a little, the sync this whole change exists to deliver is lost at the last step —
 * the sentence index would be right and the position inside it wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  sentenceAlignedProgress,
  sentenceWeight,
  timingFromProgress,
  SENTENCE_GAP_MS,
  CLIP_FETCH_CONCURRENCY,
  scriptClockFromNarration,
} from "../narrationClock";

/** A real beat's sentences, of uneven length — the case character weighting got wrong. */
const SENTENCES = [
  "The Minkowski distance generalises two familiar metrics.",
  "For two points x and y it is d(x,y) = (Σ |x_i − y_i|^p)^(1/p).",
  "When p is 1 it becomes the Manhattan distance.",
  "When p is 2 it becomes the Euclidean distance.",
  "Larger p lets the biggest coordinate difference dominate.",
];
const WEIGHTS = SENTENCES.map(sentenceWeight);

/* ── the round trip ──────────────────────────────────────────────────────── */

test("every sentence and position decodes back to itself", () => {
  for (let i = 0; i < WEIGHTS.length; i += 1) {
    for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const encoded = sentenceAlignedProgress(WEIGHTS, i, fraction);
      const decoded = timingFromProgress(WEIGHTS, i, encoded);
      assert.equal(decoded.index, i);
      assert.ok(
        Math.abs(decoded.progress - fraction) < 1e-9,
        `sentence ${i} at ${fraction} came back as ${decoded.progress}`,
      );
    }
  }
});

test("the formula sentence decodes exactly, which is where drift was worst", () => {
  /*
   * Measured before this change, formula-heavy beats had the largest errors: character counting
   * treats "(Σ |x_i − y_i|^p)^(1/p)" as a long stretch of speech, so the board moved on too early.
   * The clip for that sentence now reports its own position, and it must survive the trip intact.
   */
  const decoded = timingFromProgress(WEIGHTS, 1, sentenceAlignedProgress(WEIGHTS, 1, 0.4));
  assert.equal(decoded.index, 1);
  assert.ok(Math.abs(decoded.progress - 0.4) < 1e-9);
});

test("progress only ever moves forward through a beat", () => {
  // A board that stepped backwards would un-draw what it had just drawn.
  let previous = -1;
  for (let i = 0; i < WEIGHTS.length; i += 1) {
    for (const fraction of [0, 0.5, 1]) {
      const value = sentenceAlignedProgress(WEIGHTS, i, fraction);
      assert.ok(value >= previous, `went backwards at sentence ${i}, fraction ${fraction}`);
      previous = value;
    }
  }
  assert.equal(sentenceAlignedProgress(WEIGHTS, WEIGHTS.length - 1, 1), 1);
  assert.equal(sentenceAlignedProgress(WEIGHTS, 0, 0), 0);
});

/* ── edges that must not throw or produce NaN ────────────────────────────── */

test("bad inputs stay inside the 0-1 range", () => {
  assert.equal(sentenceAlignedProgress([], 0, 0.5), 1);
  assert.equal(sentenceAlignedProgress(WEIGHTS, 99, 0.5), sentenceAlignedProgress(WEIGHTS, WEIGHTS.length - 1, 0.5));
  assert.equal(sentenceAlignedProgress(WEIGHTS, -3, 0.5), sentenceAlignedProgress(WEIGHTS, 0, 0.5));
  // A clip whose duration is not yet known reports NaN progress; that must read as "just started".
  assert.equal(sentenceAlignedProgress(WEIGHTS, 2, Number.NaN), sentenceAlignedProgress(WEIGHTS, 2, 0));
  for (const value of [sentenceAlignedProgress(WEIGHTS, 2, 7), sentenceAlignedProgress(WEIGHTS, 2, -7)]) {
    assert.ok(value >= 0 && value <= 1);
  }
});

/* ── the move out of LessonPlayer changed nothing ────────────────────────── */

/** The original inline function from components/LessonPlayer.tsx, kept verbatim as an oracle. */
function originalNarrationSentenceTiming(sentences: string[], cueIndex: number, beatProgress: number) {
  const total = Math.max(1, sentences.length);
  const weights = sentences.length ? sentences.map((sentence) => Math.max(1.35, sentence.length / 13)) : [1];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const index = Math.max(0, Math.min(total - 1, cueIndex));
  const startWeight = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
  const start = startWeight / totalWeight;
  const end = (startWeight + weights[index]) / totalWeight;
  const progress = Math.max(0, Math.min(1, (beatProgress - start) / Math.max(0.001, end - start)));
  return { index, total, progress, alignedProgress: (index + progress) / total };
}

test("the relocated timing function matches the original exactly", () => {
  // Moving it must be a pure refactor: every board already depends on this exact behaviour.
  const cases: Array<[string[], number, number]> = [
    [SENTENCES, 0, 0],
    [SENTENCES, 2, 0.43],
    [SENTENCES, 4, 1],
    [SENTENCES, 9, 0.5],
    [SENTENCES, -1, 0.2],
    [["Only one."], 0, 0.6],
    [[], 0, 0.5],
  ];
  for (const [sentences, cue, progress] of cases) {
    assert.deepEqual(
      timingFromProgress(sentences.map(sentenceWeight), cue, progress),
      originalNarrationSentenceTiming(sentences, cue, progress),
      `diverged for cue ${cue} at ${progress} over ${sentences.length} sentences`,
    );
  }
});

test("the weight formula is the one the whole app already uses", () => {
  assert.equal(sentenceWeight("short"), 1.35);
  assert.equal(sentenceWeight("x".repeat(130)), 10);
});

test("the pacing constants keep the rhythm students already hear", () => {
  // Matches the browser voice's existing `spokenMs + 240`, so switching voices changes nothing.
  assert.equal(SENTENCE_GAP_MS, 240);
  assert.ok(CLIP_FETCH_CONCURRENCY >= 2 && CLIP_FETCH_CONCURRENCY <= 8);
});

/* ── the bridge sentence that opens every beat after the first ───────────── */


const BRIDGE = "That foundation leads directly into the Minkowski distance.";
const NARRATION_WEIGHTS = [BRIDGE, ...SENTENCES].map(sentenceWeight);

test("while the bridge is spoken the board waits at the start of the script", () => {
  for (const fraction of [0, 0.5, 1]) {
    const encoded = sentenceAlignedProgress(NARRATION_WEIGHTS, 0, fraction);
    assert.deepEqual(scriptClockFromNarration(NARRATION_WEIGHTS, 1, 0, encoded), {
      onBridge: true,
      scriptIndex: 0,
      scriptProgress: 0,
    });
  }
});

test("after the bridge, narration sentence k is script sentence k-1, at the same position", () => {
  // The bug: the board was handed k itself, and ran one sentence ahead for the whole beat.
  for (let k = 1; k < NARRATION_WEIGHTS.length; k += 1) {
    for (const fraction of [0, 0.3, 0.8, 1]) {
      const encoded = sentenceAlignedProgress(NARRATION_WEIGHTS, k, fraction);
      const clock = scriptClockFromNarration(NARRATION_WEIGHTS, 1, k, encoded);
      assert.equal(clock.onBridge, false);
      assert.equal(clock.scriptIndex, k - 1);
      const decoded = timingFromProgress(WEIGHTS, k - 1, clock.scriptProgress);
      assert.equal(decoded.index, k - 1);
      assert.ok(Math.abs(decoded.progress - fraction) < 1e-9, `k=${k} f=${fraction} came back as ${decoded.progress}`);
    }
  }
});

test("with no bridge the clock passes straight through", () => {
  assert.deepEqual(scriptClockFromNarration(WEIGHTS, 0, 2, 0.4), { onBridge: false, scriptIndex: 2, scriptProgress: 0.4 });
});
