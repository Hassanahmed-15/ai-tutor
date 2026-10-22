/**
 * Which beats get written when: two ahead of the student, three before an animation, and never a
 * beat orphaned after an adaptation.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { dueSequences, lookaheadFromEnv, STALE_GENERATION_MS, type WindowBeat } from "../progressiveWindow";

const NOW = Date.parse("2026-09-19T12:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const beat = (sequence: number, state: WindowBeat["state"], msAgo = 1_000): WindowBeat => ({ sequence, state, updatedAt: at(msAgo) });
const noAnimations = () => false;

test("before playback, only the opening beats are written", () => {
  assert.deepEqual(dueSequences({ planLength: 8, playhead: -1, isAnimation: noAnimations, beats: [], now: NOW }), [0, 1, 2]);
});

test("the window follows the student, two beats ahead", () => {
  const beats = [0, 1, 2].map((s) => beat(s, "ready"));
  assert.deepEqual(dueSequences({ planLength: 8, playhead: 1, isAnimation: noAnimations, beats, now: NOW }), [3]);
  assert.deepEqual(dueSequences({ planLength: 8, playhead: 3, isAnimation: noAnimations, beats, now: NOW }), [3, 4, 5]);
});

test("an animation is started one beat earlier, because it takes longer to make", () => {
  const beats = [0, 1, 2].map((s) => beat(s, "ready"));
  const due = dueSequences({ planLength: 8, playhead: 0, isAnimation: (s) => s === 3, beats, now: NOW });
  assert.deepEqual(due, [3]);
});

test("a beat someone is already writing is not paid for twice", () => {
  const beats = [beat(0, "ready"), beat(1, "generating"), beat(2, "playable")];
  assert.deepEqual(dueSequences({ planLength: 8, playhead: 0, isAnimation: noAnimations, beats, now: NOW }), []);
});

test("a generation that died is picked up again", () => {
  const beats = [beat(0, "ready"), beat(1, "generating", STALE_GENERATION_MS + 1), beat(2, "ready")];
  assert.deepEqual(dueSequences({ planLength: 8, playhead: 0, isAnimation: noAnimations, beats, now: NOW }), [1]);
});

test("after an adaptation, every reset beat in reach is written — the stall this replaces", () => {
  // The student asked a question on beat 1; beats 3..7 were reset for the new revision. The old code
  // re-queued only 3 and 4, and lanes stepping by 4 never reached 5 or 6: playback stopped at 5.
  const beats = [beat(0, "ready"), beat(1, "ready"), beat(2, "ready"), ...[3, 4, 5, 6, 7].map((s) => beat(s, "planned"))];
  assert.deepEqual(dueSequences({ planLength: 8, playhead: 1, isAnimation: noAnimations, beats, now: NOW }), [3]);
  // As the student moves on, each reset beat comes due in turn, so none is left behind.
  for (let playhead = 2; playhead <= 7; playhead += 1) {
    const due = dueSequences({ planLength: 8, playhead, isAnimation: noAnimations, beats, now: NOW });
    const expected = [3, 4, 5, 6, 7].filter((s) => s <= playhead + 2);
    assert.deepEqual(due, expected, `playhead ${playhead}`);
  }
});

test("finished and permanently failed beats are left alone", () => {
  const beats = [beat(0, "ready"), beat(1, "failed")];
  assert.deepEqual(dueSequences({ planLength: 2, playhead: 0, isAnimation: noAnimations, beats, now: NOW }), []);
});

test("the lead is configurable, and an animation's lead is never shorter than a normal beat's", () => {
  assert.deepEqual(lookaheadFromEnv({}), { lookahead: 2, animationLookahead: 3 });
  assert.deepEqual(lookaheadFromEnv({ PROGRESSIVE_LOOKAHEAD: "4" }), { lookahead: 4, animationLookahead: 4 });
  assert.deepEqual(lookaheadFromEnv({ PROGRESSIVE_LOOKAHEAD: "junk", PROGRESSIVE_ANIMATION_LOOKAHEAD: "5" }), { lookahead: 2, animationLookahead: 5 });
});

test("with nothing else to do, the rest of the lecture is finished one beat at a time — so it reaches history", () => {
  // The student stopped on beat 1 of 8; everything within reach is ready and nothing is in flight.
  const beats = [0, 1, 2, 3].map((s) => beat(s, "ready"));
  assert.deepEqual(dueSequences({ planLength: 8, playhead: 1, isAnimation: noAnimations, beats, now: NOW }), [4]);
  // While that one is being written, nothing more is started: the student's next beats come first.
  assert.deepEqual(dueSequences({ planLength: 8, playhead: 1, isAnimation: noAnimations, beats: [...beats, beat(4, "generating")], now: NOW }), []);
  assert.deepEqual(dueSequences({ planLength: 8, playhead: 1, isAnimation: noAnimations, beats: [...beats, beat(4, "playable")], now: NOW }), []);
  // And when every beat exists there is nothing left to do.
  const all = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => beat(s, "ready"));
  assert.deepEqual(dueSequences({ planLength: 8, playhead: 1, isAnimation: noAnimations, beats: all, now: NOW }), []);
});

test("a canvas lecture: three boards written at a time, always the earliest unfinished ones", async () => {
  const { canvasDueSequences } = await import("../progressiveWindow");
  const now = Date.parse("2026-10-21T12:00:00Z");
  const at = new Date(now - 5_000).toISOString();
  const b = (sequence: number, state: "generating" | "ready" | "failed" | "planned") => ({ sequence, state, updatedAt: at });
  assert.deepEqual(canvasDueSequences({ planLength: 8, beats: [], now }), [0, 1, 2], "the plan exists: the opening three");
  assert.deepEqual(canvasDueSequences({ planLength: 8, beats: [b(0, "ready"), b(1, "generating"), b(2, "ready")], now }), [3, 4], "three in flight: board 1 and the next two");
  assert.deepEqual(canvasDueSequences({ planLength: 8, beats: [b(0, "ready"), b(1, "ready"), b(2, "ready")], now }), [3, 4, 5], "the opening is ready: the next three, in order");
  assert.deepEqual(canvasDueSequences({ planLength: 8, beats: [b(0, "ready"), b(1, "ready"), b(2, "ready"), b(3, "generating"), b(4, "generating"), b(5, "generating")], now }), [], "never more than three at once");
  assert.deepEqual(canvasDueSequences({ planLength: 8, beats: [b(0, "ready"), b(1, "ready"), b(2, "ready"), b(3, "generating"), b(4, "ready"), b(5, "generating")], now }), [6], "a finished board frees a place for the next");
  assert.deepEqual(canvasDueSequences({ planLength: 8, beats: [0, 1, 2, 3, 4, 5].map((i) => b(i, "ready")).concat([b(6, "failed")]), now }), [7], "a failed board does not stall the rest");
  const stale = { sequence: 3, state: "generating" as const, updatedAt: new Date(now - 11 * 60_000).toISOString() };
  assert.deepEqual(canvasDueSequences({ planLength: 8, beats: [b(0, "ready"), b(1, "ready"), b(2, "ready"), stale], now }), [3, 4, 5], "a dead generation is picked up again, with the next two");
  assert.deepEqual(canvasDueSequences({ planLength: 2, beats: [], now }), [0, 1]);
});
