/**
 * The two voice faults reported from the deployed app, as tests.
 *
 * Both were latches: state correct for one turn, left set into the next. Neither raised an error —
 * one merged three utterances into a run-on message, the other answered a real question in
 * silence — which is exactly why they need pinning rather than watching.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { applyTurnEdge, FRESH_TURN, type TurnFlags } from "../voice/turnLifecycle";

test("THE BUG: a turn that ends without a reply still clears the transcript", () => {
  // Reported symptom: "Gemini live? Can you hear my background noise? Hello." — three separate
  // things said at different times, delivered as one message.
  let flags: TurnFlags = { ...FRESH_TURN, studentTranscript: "Gemini live?" };
  flags = applyTurnEdge(flags, "turn-end");
  assert.equal(flags.studentTranscript, "", "the turn's words must not survive into the next turn");

  flags = applyTurnEdge(flags, "listen");
  flags = { ...flags, studentTranscript: "Can you hear my background noise?" };
  flags = applyTurnEdge(flags, "turn-end");
  assert.equal(flags.studentTranscript, "");
});

test("a discarded turn drops its words rather than flushing them to the student", () => {
  const flags = applyTurnEdge({ ...FRESH_TURN, studentTranscript: "did you lock the door" }, "discard");
  assert.equal(flags.studentTranscript, "", "the neighbour's sentence must not reach the next turn");
  assert.equal(flags.contextOnlyTurn, true, "and the model's reply to it must be suppressed");
});

test("THE BUG: suppression from a discarded turn cannot mute the NEXT real question", () => {
  // A discarded turn sets contextOnlyTurn. If the model never answers it, no turnComplete arrives
  // to clear the flag — and the student's next genuine question is answered with no audio.
  let flags = applyTurnEdge(FRESH_TURN, "discard");
  assert.equal(flags.contextOnlyTurn, true);

  // No turn-complete. The next turn opens anyway:
  flags = applyTurnEdge(flags, "listen");
  assert.equal(flags.contextOnlyTurn, false, "a new turn must never inherit the last turn's mute");
});

test("suppression still clears the normal way, on turnComplete", () => {
  let flags = applyTurnEdge(FRESH_TURN, "discard");
  flags = applyTurnEdge(flags, "turn-complete");
  assert.equal(flags.contextOnlyTurn, false);
});

test("suppression lasts exactly one turn, however the turn ends", () => {
  for (const ending of ["turn-complete", "listen"] as const) {
    const flags = applyTurnEdge(applyTurnEdge(FRESH_TURN, "discard"), ending);
    assert.equal(flags.contextOnlyTurn, false, `not cleared by ${ending}`);
  }
});

test("opening a turn never resurrects words from a previous one", () => {
  const flags = applyTurnEdge({ ...FRESH_TURN, studentTranscript: "leftovers" }, "listen");
  assert.equal(flags.studentTranscript, "");
});

test("the barge-in playback mute is not touched by turn edges", () => {
  // It is cleared only by endStudentSpeech, deliberately — see studentTurnLatch's history. A turn
  // edge clearing it would re-introduce the dead-audio bug from the other direction.
  for (const edge of ["listen", "turn-end", "discard", "turn-complete"] as const) {
    const flags = applyTurnEdge({ ...FRESH_TURN, suppressCurrentTurn: true }, edge);
    assert.equal(flags.suppressCurrentTurn, true, `${edge} must not clear the barge-in mute`);
  }
});
