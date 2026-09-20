/**
 * Voice↔visual synchronisation, and the teaching state that decides how the board moves.
 *
 * Both exist because of reported failures: Aria saying "this graph" before the graph was drawn, and
 * going deeper on one sub-topic producing a fresh slide each time instead of continuing underneath.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  opVisible,
  resolveOpTiming,
  sentenceFraction,
  syncCoverage,
  type TimedOp,
} from "../board/sentenceSync";
import {
  EMPTY_TEACHING_STATE,
  MAX_BOARDS_PER_CONCEPT,
  alreadyTaught,
  decideBoardMove,
  priorKnowledge,
  recordTaught,
} from "../board/teachingState";

const at = (index: number, total: number, progress = 0): { index: number; total: number; progress: number } => ({
  index,
  total,
  progress,
});

// --- Synchronisation -------------------------------------------------------------------------

test("THE DESYNC: a sentence-bound op appears exactly when its sentence is spoken", () => {
  const graph: TimedOp = { atSentence: 3 };
  assert.equal(opVisible(graph, at(2, 8), 0.99), false, "must not appear early, even at 99% elapsed");
  assert.equal(opVisible(graph, at(3, 8), 0.0), true, "appears on its sentence, even at 0% elapsed");
  assert.equal(opVisible(graph, at(7, 8), 1), true, "and stays");
});

test("sentence binding survives a speech-rate change, which a time fraction cannot", () => {
  // At 1.25x the same sentence arrives at a different elapsed fraction. The op must not care.
  const op: TimedOp = { atSentence: 2 };
  for (const elapsed of [0.1, 0.35, 0.8]) {
    assert.equal(opVisible(op, at(2, 6, elapsed), elapsed), true, `elapsed ${elapsed}`);
  }
});

test("legacy ops with only `at` still play, so old boards are not broken", () => {
  const legacy: TimedOp = { at: 0.5 };
  assert.equal(opVisible(legacy, at(0, 4), 0.49), false);
  assert.equal(opVisible(legacy, at(0, 4), 0.5), true);
});

test("an op can be retired at a later sentence, for a mark that should not linger", () => {
  const pointer: TimedOp = { atSentence: 2, untilSentence: 3 };
  assert.equal(opVisible(pointer, at(1, 6), 0), false);
  assert.equal(opVisible(pointer, at(2, 6), 0), true);
  assert.equal(opVisible(pointer, at(3, 6), 0), true);
  assert.equal(opVisible(pointer, at(4, 6), 0), false, "gone once its moment passes");
});

test("sentence fractions follow sentence LENGTH, not sentence count", () => {
  // "Watch." and a forty-word explanation are one sentence each; treating them as equal thirds is
  // how a board drifts half a sentence out by the end of a beat.
  const weights = [2, 40, 18];
  const second = sentenceFraction(1, weights);
  assert.ok(second > 0 && second < 0.1, `a 2-word opener should end early, got ${second}`);
  assert.ok(sentenceFraction(2, weights) > 0.6, "the third starts after the long middle");
  assert.equal(sentenceFraction(0, weights), 0);
});

test("resolveOpTiming gives sentence-bound ops an `at`, so old renderers still work", () => {
  const ops: TimedOp[] = [{ atSentence: 1 }, { at: 0.9 }];
  const resolved = resolveOpTiming(ops, [10, 10, 10]);
  assert.ok(Math.abs((resolved[0].at ?? 0) - 1 / 3) < 1e-9, "derived from its sentence");
  assert.equal(resolved[1].at, 0.9, "an unbound op is left alone");
});

test("a board that dumps everything up front is reported, not silently shipped", () => {
  const frontLoaded: TimedOp[] = [{ atSentence: 0 }, { atSentence: 0 }, { atSentence: 0 }];
  const spread: TimedOp[] = [{ atSentence: 0 }, { atSentence: 2 }, { atSentence: 5 }];
  assert.ok(syncCoverage(frontLoaded, 8).coverage < syncCoverage(spread, 8).coverage);
  assert.equal(syncCoverage(frontLoaded, 8).sentencesCovered, 1);
  assert.equal(syncCoverage(spread, 8).bound, 3);
  assert.equal(syncCoverage([{ at: 0.2 }], 8).unbound, 1);
});

// --- Teaching state --------------------------------------------------------------------------

const concept = (id: string, title: string, objective: string) => ({ conceptId: id, title, objective });

test("THE CAROUSEL: going deeper on one concept continues the board instead of replacing it", () => {
  let state = recordTaught(EMPTY_TEACHING_STATE, {
    beatId: "b1", conceptId: "c-regression", sequence: 0, title: "Line of best fit", script: "A line summarises the cloud.",
  });
  const next = decideBoardMove(state, concept("c-regression", "Measuring error", "Squared residuals"));
  assert.equal(next.move, "continue", next.reason);
});

test("a genuinely new concept starts a clean board", () => {
  const state = recordTaught(EMPTY_TEACHING_STATE, {
    beatId: "b1", conceptId: "c-regression", sequence: 0, title: "Line of best fit", script: "…",
  });
  assert.equal(decideBoardMove(state, concept("c-gradient", "Gradient descent", "Stepping downhill")).move, "fresh");
});

test("the first board of a lesson is always fresh", () => {
  assert.equal(decideBoardMove(EMPTY_TEACHING_STATE, concept("c1", "Anything", "…")).move, "fresh");
});

test("a concept cannot scroll past what a student can follow", () => {
  let state = EMPTY_TEACHING_STATE;
  for (let i = 0; i < MAX_BOARDS_PER_CONCEPT; i++) {
    state = recordTaught(state, { beatId: `b${i}`, conceptId: "c1", sequence: i, title: `Part ${i}`, script: "…" });
  }
  const decision = decideBoardMove(state, concept("c1", "Still the same idea", "…"));
  assert.equal(decision.move, "fresh", decision.reason);
  assert.match(decision.reason, /screens/);
});

test("returning to a concept already taught is a callback, not new material", () => {
  let state = recordTaught(EMPTY_TEACHING_STATE, {
    beatId: "b1", conceptId: "c-regression", sequence: 0, title: "Line of best fit", script: "…",
  });
  state = recordTaught(state, { beatId: "b2", conceptId: "c-error", sequence: 1, title: "Error", script: "…" });
  const decision = decideBoardMove(state, concept("c-regression", "Back to the line", "…"));
  assert.equal(decision.move, "refer-back");
  assert.match(decision.reason, /Line of best fit/);
});

test("depth within a concept is counted, and resets when the concept changes", () => {
  let state = recordTaught(EMPTY_TEACHING_STATE, { beatId: "a", conceptId: "c1", sequence: 0, title: "A", script: "…" });
  assert.equal(state.boardsInConcept, 1);
  state = recordTaught(state, { beatId: "b", conceptId: "c1", sequence: 1, title: "B", script: "…" });
  assert.equal(state.boardsInConcept, 2, "deeper on the same idea");
  state = recordTaught(state, { beatId: "c", conceptId: "c2", sequence: 2, title: "C", script: "…" });
  assert.equal(state.boardsInConcept, 1, "a new idea starts its own count");
});

test("the state knows what was actually said, so the next beat can build on it", () => {
  let state = EMPTY_TEACHING_STATE;
  state = recordTaught(state, { beatId: "b1", conceptId: "c1", sequence: 0, title: "Slope", script: "The slope is rise over run." });
  state = recordTaught(state, { beatId: "b2", conceptId: "c1", sequence: 1, title: "Intercept", script: "The intercept is where x is zero." });
  const prior = priorKnowledge(state);
  assert.equal(prior.length, 2);
  assert.match(prior[0].gist, /rise over run/);
});

test("a beat that duplicates something already taught is flagged", () => {
  const state = recordTaught(EMPTY_TEACHING_STATE, {
    beatId: "b1", conceptId: "c1", sequence: 0, title: "Gradient descent",
    script: "Gradient descent steps downhill along the slope to reduce the loss.",
  });
  const dup = alreadyTaught(state, { title: "Gradient descent again", objective: "Steps downhill along the slope to reduce loss" });
  assert.equal(dup.duplicate, true, `overlap was ${dup.overlap}`);
  const fresh = alreadyTaught(state, { title: "Overfitting", objective: "When a model memorises noise in the training sample" });
  assert.equal(fresh.duplicate, false, `overlap was ${fresh.overlap}`);
});

// --- Tall canvas -----------------------------------------------------------------------------

/**
 * The pan geometry, isolated from the renderer. Mirrors `panFrame`/`boardHeight` in LiveSketch:
 * a board taller than one screen descends as the narration advances, and holds at the bottom.
 */
function boardHeightOf(screens: number | undefined): number {
  return 560 * Math.max(1, Math.min(3, Math.round(screens ?? 1)));
}
function panY(progress: number, canvasH: number): number {
  const travel = Math.max(0, canvasH - 560);
  return travel * Math.max(0, Math.min(1, progress));
}

test("THE CAROUSEL, PART 2: a tall board scrolls instead of becoming a second slide", () => {
  const canvas = boardHeightOf(3);
  assert.equal(canvas, 1680, "three screens of board");
  assert.equal(panY(0, canvas), 0, "starts at the top, where the teacher started writing");
  assert.ok(Math.abs(panY(0.5, canvas) - 560) < 1e-9, "halfway down by mid-narration");
  assert.equal(panY(1, canvas), 1120, "ends showing the last screen");
});

test("a one-screen board never pans, so existing lectures are untouched", () => {
  const canvas = boardHeightOf(undefined);
  assert.equal(canvas, 560);
  for (const p of [0, 0.5, 1]) assert.equal(panY(p, canvas), 0);
});

test("the canvas is capped at what a student can scroll back through", () => {
  // Matches MAX_BOARDS_PER_CONCEPT: past three screens the start of an idea is unreachable.
  assert.equal(boardHeightOf(9), 1680);
  assert.equal(boardHeightOf(0), 560);
  assert.equal(boardHeightOf(-2), 560);
});

test("the camera never scrolls past the end of the board", () => {
  const canvas = boardHeightOf(2);
  assert.equal(panY(1.8, canvas), 560, "clamped: the last screen is held, not overshot");
  assert.equal(panY(-1, canvas), 0);
});
