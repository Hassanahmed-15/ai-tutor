import test from "node:test";
import assert from "node:assert/strict";
import { lectureDepthStats } from "../drawSanitize";
import type { Beat } from "../lessonContent";

/**
 * A depth floor steers generation. It must never destroy a finished lecture.
 *
 * THE REGRESSION THIS PINS. A focused floor of 125 words was added to stop thin answers, and it
 * then rejected a perfectly usable lecture outright: a student uploaded a one-page PDF, waited
 * minutes, and got "Model returned shallow PDF teaching beats (111 words per teaching beat; 125
 * required)" instead of a lesson. 111 words a beat is a real explanation. The floor was doing the
 * opposite of its job.
 *
 * This is the same shape as the beat-count cap removed earlier: a quality target that had become a
 * refusal, spending the student's time and then throwing away the result. The rule that came out of
 * it — a target may trigger another attempt, never a discard — is what these assert.
 */

const beat = (words: number, kind: Beat["slideKind"] = "definition"): Beat =>
  ({
    id: `b${words}-${kind}`,
    title: "t",
    teacherMove: "",
    stepLabel: "",
    slideKind: kind,
    points: [],
    script: Array.from({ length: words }, (_, i) => `word${i}`).join(" "),
  }) as Beat;

test("111 words a beat is a real lecture, not a failure", () => {
  // The exact number the student saw rejected.
  const stats = lectureDepthStats([beat(111), beat(111), beat(111), beat(111)]);
  assert.equal(Math.round(stats.avgTeachingWords), 111);
  assert.ok(stats.avgTeachingWords > 100, "well past the point of being usable");
  assert.equal(stats.teachingBeatCount, 4);
});

test("checkpoints are excluded from the average, so a short quiz cannot drag a lecture under", () => {
  // A checkpoint is a question, not an explanation — counting its ~40 words as a teaching beat
  // would fail lectures whose teaching is fine.
  const withCheckpoint = lectureDepthStats([beat(140), beat(140), beat(35, "checkpoint")]);
  assert.equal(withCheckpoint.teachingBeatCount, 2);
  assert.equal(Math.round(withCheckpoint.avgTeachingWords), 140);
});

test("the stats report, and reporting is all they do", () => {
  // lectureDepthStats is pure measurement — the decision of what to do about a low number belongs
  // to the caller, which after a deepen pass is now "ship it and log", not "throw".
  const thin = lectureDepthStats([beat(40), beat(40)]);
  assert.ok(thin.avgTeachingWords < 100);
  assert.equal(thin.teachingBeatCount, 2, "measuring a thin lecture must not throw");
});

test("an empty lecture reports zero rather than NaN", () => {
  const empty = lectureDepthStats([]);
  assert.equal(empty.avgTeachingWords, 0);
  assert.equal(empty.teachingBeatCount, 0);
});
