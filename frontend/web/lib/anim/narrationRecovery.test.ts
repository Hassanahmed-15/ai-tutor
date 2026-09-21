import test from "node:test";
import assert from "node:assert/strict";

import { backstopRecovery, narrationRecovery, type ChannelSnapshot } from "../narrationRecovery";
import { isAdaptiveQuestion } from "../adaptiveQuestion";

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
  narrationLost: false,
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

/* ── "Pause on the button, nothing heard, and Pause/Resume cannot help" ─────────────── */

test("a lecture cancelled under Aria's voice is restarted once she stops, not left silent", () => {
  // Resuming while she still held the channel failed; the fallback re-ran the narration effect,
  // whose cleanup CANCELLED the lecture. Nothing was frozen and no refusal was on record, so every
  // path here used to answer "none" and the lecture never spoke again.
  assert.equal(narrationRecovery(snapshot({ narrationLost: true })), "restart");
  // ...but never over her: the loss waits until the channel is free.
  assert.equal(narrationRecovery(snapshot({ narrationLost: true, chatbotHoldsChannel: true })), "none");
});

test("a frozen lecture refused only because she is talking is left frozen, then resumed in place", () => {
  // The fix to the mode effect: do not restart (and so cancel) a frozen lecture. While she talks it
  // waits; the moment she is quiet it continues mid-sentence rather than replaying the beat.
  assert.equal(narrationRecovery(snapshot({ lectureFrozen: true, chatbotHoldsChannel: true })), "none");
  assert.equal(narrationRecovery(snapshot({ lectureFrozen: true })), "resume");
});

test("the backstop overrides refs that claim she is talking after React has said she is silent", () => {
  const stuck = { ...snapshot({ chatbotHoldsChannel: true }), tutorSpeaking: false };
  // The ordinary recovery bows out to the refs...
  assert.equal(narrationRecovery(stuck), "none");
  // ...the backstop does not: it continues a frozen lecture, or restarts one that was refused or lost.
  assert.equal(backstopRecovery({ ...stuck, lectureFrozen: true }), "resume");
  assert.equal(backstopRecovery({ ...stuck, narrationLost: true }), "restart");
  assert.equal(backstopRecovery({ ...stuck, startRefused: true }), "restart");
});

test("the backstop never replays a beat that is merely waiting", () => {
  // Narration finished and the next beat is still being generated; or a checkpoint awaits an answer.
  // Nothing refused, nothing lost, nothing frozen — restarting here would replay the beat in a loop.
  assert.equal(backstopRecovery({ ...RUNNING, tutorSpeaking: false }), "none");
  // And it does nothing while she is genuinely speaking, or a question is in flight.
  assert.equal(backstopRecovery({ ...snapshot({ narrationLost: true }), tutorSpeaking: true }), "none");
  assert.equal(backstopRecovery({ ...snapshot({ narrationLost: true, utteranceInFlight: true }), tutorSpeaking: false }), "none");
  assert.equal(backstopRecovery({ ...snapshot({ narrationLost: true, mode: "paused" }), tutorSpeaking: false }), "none");
});

test("filler and commands do not re-plan the lecture; real questions do", () => {
  // From the stuck lecture: each of these was posted as a question and re-planned the upcoming beats.
  for (const filler of ["Okay okay, carry on.", "carry on", "go on", "continue the lecture", "Hello hello", "hi aria", "ok", "yeah", "thank you"]) {
    assert.equal(isAdaptiveQuestion(filler), false, `"${filler}" should not re-plan the lecture`);
  }
  for (const question of ["Aarya, what is a rebellion?", "why did the sepoys revolt?", "can you explain the Doctrine of Lapse again?"]) {
    assert.equal(isAdaptiveQuestion(question), true, `"${question}" is a real question`);
  }
});
