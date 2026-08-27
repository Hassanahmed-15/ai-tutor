import test from "node:test";
import assert from "node:assert/strict";

import { narrationRecovery, type ChannelSnapshot } from "../narrationRecovery";

/**
 * "It stops at the whiteboard and stays there unless I pause and resume."
 *
 * Reported from a real run. The lecture froze mid-beat — board still, narration silent, captions
 * stuck on the last sentence — and only Pause-then-Resume brought it back, continuing from the exact
 * same spot rather than replaying. That last detail is the whole diagnosis: the audio was still
 * there, FROZEN, and nothing ever told it to continue.
 *
 * Three things freeze a running lecture without the lesson machine leaving `teaching` (the chatbot
 * taking the channel, the teacher's comprehension question, an ADHD reproach line), and every path
 * back was `lesson.requestResume()` — whose `go("teaching")` from `teaching` sets both pieces of
 * state to the values React already holds. React bails out, `lesson.mode` never changes, the
 * players' `[lesson.mode]` effect never re-runs, `resumeTeacher()` is never called. Pause/Resume
 * worked because it is two real transitions.
 *
 * These pin the recovery decision. The cases that must return "none" matter as much as the ones that
 * recover: resuming under a voice is the bug this whole subsystem exists to prevent.
 */

const RUNNING: ChannelSnapshot = {
  mode: "teaching",
  chatbotHoldsChannel: false,
  utteranceInFlight: false,
  lectureFrozen: false,
  startRefused: false,
};

const snapshot = (overrides: Partial<ChannelSnapshot>): ChannelSnapshot => ({ ...RUNNING, ...overrides });

/* ── The four ways the lecture got stranded ───────────────────────────────── */

test("the comprehension question's verdict finishes and the frozen lecture continues", () => {
  // useTeacherQuiz speaks question and verdict as utterances, which freeze the lecture. enterQuiz()
  // is never called, so the mode stayed `teaching` throughout and onPassed's requestResume() was a
  // no-op. This fires on a fixed cadence — which is why it read as "after some beats".
  assert.equal(narrationRecovery(snapshot({ lectureFrozen: true })), "resume");
});

test("a dropped live session leaves the lecture running, not parked on the whiteboard", () => {
  // Gemini's teardown clears its speaking refs and reports the session ended; the player answers with
  // requestResume(), which does nothing when the lecture never left `teaching`.
  assert.equal(narrationRecovery(snapshot({ lectureFrozen: true, chatbotHoldsChannel: false })), "resume");
});

test("a beat refused at the start is retried once the channel is free", () => {
  // speakAsTeacher plays nothing while the chatbot holds the floor. There is nothing frozen to
  // continue here — the beat never started — so it has to begin again.
  assert.equal(narrationRecovery(snapshot({ startRefused: true })), "restart");
});

test("a refusal that has not cleared yet is still not honoured while she is talking", () => {
  assert.equal(narrationRecovery(snapshot({ startRefused: true, chatbotHoldsChannel: true })), "none");
});

test("a hold released WITHOUT an onEnd still hands the lecture back", () => {
  /*
   * THE ONE STILL BROKEN after the first fix, and the user's exact report: "quick question arrives,
   * user answers it or skips it — in either case beats get stuck and paused even when lec is not
   * paused."
   *
   * Two routes end a question without the director ever hearing about it. Skipping runs
   * `quiz.cancel()` -> `stopUtterance()` -> the handle's `cancel()`, which never fires `onEnd`, so
   * `release()` never runs and `voice.owner` is still "teacher". A verdict that cannot be spoken
   * (`if (!spoke) done()`) never creates an utterance at all. Either way NOTHING observable changes,
   * which is why the recovery effect was not merely wrong — it was never asked.
   *
   * The decision for that snapshot was always right; the fix is that `requestResume()` now continues
   * the audio itself instead of relying on a mode transition, and `quiz.phase` re-triggers this.
   */
  assert.equal(narrationRecovery(snapshot({ lectureFrozen: true, utteranceInFlight: false })), "resume");
});

/* ── What must NOT happen ─────────────────────────────────────────────────── */

test("nothing resumes under the chatbot's voice", () => {
  assert.equal(narrationRecovery(snapshot({ lectureFrozen: true, chatbotHoldsChannel: true })), "none");
});

test("nothing resumes under an interjection that has been requested but has not spoken yet", () => {
  /*
   * THE WINDOW THAT MATTERS. A question is "in flight" from the moment it is asked for, not from the
   * moment it makes sound — cloud TTS fetches for seconds first, and the director's `owner` says
   * nothing during that gap. Resuming there puts the lecture underneath the question.
   */
  assert.equal(narrationRecovery(snapshot({ lectureFrozen: true, utteranceInFlight: true })), "none");
});

test("a deliberate pause stays paused", () => {
  // Every non-teaching mode is somebody's decision: the pause button, a check-in, a focus drop, the
  // student asking something. Recovery must never overrule one.
  for (const mode of ["paused", "chatting", "quizzing", "idle"] as const) {
    assert.equal(narrationRecovery(snapshot({ mode, lectureFrozen: true })), "none", mode);
    assert.equal(narrationRecovery(snapshot({ mode, startRefused: true })), "none", mode);
  }
});

test("a beat waiting on the learner is left alone", () => {
  // A checkpoint or MCQ holds the beat with its narration ENDED, not frozen, and nothing refused —
  // so the snapshot is indistinguishable from a healthy lecture, and both must be left untouched.
  // This is what stops the retry from replaying a beat the learner is answering.
  assert.equal(narrationRecovery(RUNNING), "none");
});
