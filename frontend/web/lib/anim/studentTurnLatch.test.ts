/**
 * The bug these tests exist for: Aria hears the student, answers, and no sound comes out.
 *
 * The end-of-utterance close used to call `closeActivity` directly. That ends the turn and the
 * model replies, but it never clears `suppressCurrentTurnRef`, so every audio chunk of that reply
 * is discarded — for the rest of the session, because nothing else clears the mute either.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { turnCloseAction, type TurnCloseInput } from "../studentTurnLatch";

const BASE: TurnCloseInput = {
  activityOpen: true,
  studentSpeaking: true,
  lastVoiceHeardAt: 1_000,
  now: 1_900,
  endOfUtteranceMs: 800,
};

test("a committed turn leaves through endStudentSpeech, so the playback mute is cleared", () => {
  // This is the regression. Returning "close-activity" here is the dead-audio bug.
  assert.equal(turnCloseAction(BASE), "end-student-speech");
});

test("a bracket held open without a gate commit just closes — there is no mute to clear", () => {
  assert.equal(turnCloseAction({ ...BASE, studentSpeaking: false }), "close-activity");
});

test("silence shorter than the threshold does not end the turn", () => {
  // 799ms of quiet is the pause inside a sentence, not the end of a question.
  assert.equal(turnCloseAction({ ...BASE, now: 1_799 }), "none");
});

test("the threshold itself ends the turn, rather than requiring one extra frame", () => {
  assert.equal(turnCloseAction({ ...BASE, now: 1_800 }), "end-student-speech");
});

test("no open bracket means nothing to close, even after long silence", () => {
  assert.equal(turnCloseAction({ ...BASE, activityOpen: false, now: 99_999 }), "none");
});

test("a zero timestamp means 'not speaking' and must not be read as 1970", () => {
  // Guarding this explicitly: `now - 0` is enormous and would close a turn that never opened.
  assert.equal(turnCloseAction({ ...BASE, lastVoiceHeardAt: 0 }), "none");
});
