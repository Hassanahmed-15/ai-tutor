import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyStudentTurn,
  getTutorTurnCompletionActions,
  isAddressedToTeacher,
} from "../useGeminiLiveTutor";

/**
 * The classifier decides whether finalised student speech should pause the lecture for a real
 * exchange, or whether the lecture should simply carry on.
 *
 * It is deliberately asymmetric, and these tests pin that asymmetry: a missed question means the
 * student is ignored, while a false positive costs a brief pause. So anything ambiguous must
 * resolve to "yes, listen".
 */

test("a question mark is decisive, whatever the wording", () => {
  assert.equal(isAddressedToTeacher("wait what?"), true);
  assert.equal(isAddressedToTeacher("so ATP is the currency?"), true);
});

test("pure acknowledgement does not interrupt the lecture", () => {
  for (const filler of ["mm-hm", "okay", "yeah", "right", "uh-huh", "hmm", "yeah yeah"]) {
    assert.equal(isAddressedToTeacher(filler), false, `"${filler}" should be treated as backchannel`);
  }
});

test("an interrogative opener counts even without punctuation", () => {
  // Speech-to-text frequently drops the question mark, which is why punctuation cannot be the
  // only signal.
  assert.equal(isAddressedToTeacher("what does that actually mean"), true);
  assert.equal(isAddressedToTeacher("why does the cycle run twice"), true);
});

test("an instruction counts as addressed even though it is not a question", () => {
  assert.equal(isAddressedToTeacher("draw the electron transport chain"), true);
  assert.equal(isAddressedToTeacher("slow down a bit"), true);
  assert.equal(isAddressedToTeacher("go back to the previous board"), true);
});

test("being addressed by name counts", () => {
  assert.equal(isAddressedToTeacher("aria I lost you there"), true);
});

test("ambiguity resolves toward listening, never toward ignoring", () => {
  // One unfamiliar word could be a mumbled question; the cost of pausing is far lower than the
  // cost of talking over a student who asked something.
  assert.equal(isAddressedToTeacher("chloroplast"), true);
  // A full sentence with no interrogative opener is still a turn.
  assert.equal(isAddressedToTeacher("I do not follow the second step"), true);
});

test("empty or whitespace transcripts never interrupt", () => {
  assert.equal(isAddressedToTeacher(""), false);
  assert.equal(isAddressedToTeacher("   "), false);
});

test("trailing punctuation does not turn an acknowledgement into a turn", () => {
  assert.equal(isAddressedToTeacher("okay."), false);
  assert.equal(isAddressedToTeacher("yeah!"), false);
});

test("student turns distinguish backchannels, controls, and questions", () => {
  assert.equal(classifyStudentTurn("okay"), "incidental");
  assert.equal(classifyStudentTurn("please pause the lecture"), "pause");
  assert.equal(classifyStudentTurn("keep going"), "resume");
  assert.equal(classifyStudentTurn("why did demand move left?"), "question");
  assert.equal(classifyStudentTurn("draw the supply curve"), "drawing");
  assert.equal(classifyStudentTurn("plot price against quantity on the board"), "drawing");
});

test("a Gemini resume tool call releases a deferred lecture resume after audio drains", () => {
  assert.deepEqual(getTutorTurnCompletionActions(true, false), ["resume-lecture", "complete-turn"]);
  assert.deepEqual(getTutorTurnCompletionActions(false, false), ["complete-turn"]);
  assert.deepEqual(getTutorTurnCompletionActions(true, true), ["complete-turn"]);
  assert.deepEqual(getTutorTurnCompletionActions(true, false, "pause"), ["complete-turn"]);
});
