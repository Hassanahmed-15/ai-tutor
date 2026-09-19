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
