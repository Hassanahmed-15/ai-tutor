import test from "node:test";
import assert from "node:assert/strict";
import { checkpointDueAt, questionSourceFor, mcqForCheckpoint } from "../adhd/games/mcq";
import { applyAll, initialScore, needsCheckin } from "../adhd/score";
import type { Beat } from "../lessonContent";

/**
 * Three skips and the assessment collide, and a persona change is a reconnect.
 *
 * Both of these were reported as working locally and broken once deployed, which is the shape of a
 * race: on a developer machine teardown and connection are effectively instant, so the window never
 * opens.
 */

const beat = (i: number, withCheckpoint = false): Beat =>
  ({
    id: `b${i}`,
    title: `Beat ${i}`,
    teacherMove: "",
    stepLabel: "",
    slideKind: withCheckpoint ? "checkpoint" : "definition",
    points: [`point one about beat ${i}`, `point two about beat ${i}`],
    definitionTerm: `Term ${i}`,
    definitionMeaning: `What term ${i} means, at some length so it is usable.`,
    script: "word ".repeat(120),
    ...(withCheckpoint
      ? {
          checkpoint: {
            prompt: `What did beat ${i} say?`,
            acceptableKeywords: [["term"]],
            correctFeedback: "Yes.",
            hintFeedback: "Think about the term.",
            revealAnswer: `Term ${i}.`,
          },
        }
      : {}),
  }) as Beat;

test("THE COLLISION: three consecutive skips land exactly on a checkpoint beat", () => {
  // The skip run that triggers a check-in and the checkpoint cadence are both 3, so a learner who
  // skips into a check-in is skipping into the assessment as well. Suppressing the checkpoint for
  // the overlay therefore removes the very question they were due.
  const score = applyAll(initialScore(), [
    { type: "beat-skipped" },
    { type: "beat-skipped" },
    { type: "beat-skipped" },
  ]);
  assert.equal(score.skipRun, 3);
  assert.ok(needsCheckin(score), "three skips must ask for a check-in");
  assert.ok(checkpointDueAt(3), "and index 3 is exactly where a checkpoint is due");
});

test("a check-in clears the run, so the next one needs a fresh three", () => {
  const after = applyAll(initialScore(), [
    { type: "beat-skipped" },
    { type: "beat-skipped" },
    { type: "beat-skipped" },
    { type: "checkin-cleared" },
  ]);
  assert.equal(after.skipRun, 0);
  assert.ok(!needsCheckin(after));
  assert.equal(after.skipped, 3, "the receipt still remembers them");
});

test("a real generated lecture can still build the question at every cadence point", () => {
  // The maze needs a source with usable content, not merely a beat marked "checkpoint". This is the
  // shape a generated lecture actually has: one checkpoint among ordinary beats.
  const beats = [beat(0), beat(1), beat(2), beat(3), beat(4), beat(5), beat(6, true), beat(7)];
  for (let i = 0; i < beats.length; i++) {
    if (!checkpointDueAt(i)) continue;
    const source = questionSourceFor(i, beats);
    assert.ok(source, `no question source at due index ${i}`);
    const mcq = mcqForCheckpoint(source, beats, i + 1);
    assert.ok(mcq, `no MCQ built at due index ${i}`);
    assert.ok(mcq.options.length >= 2, "a question needs options to be answerable");
  }
});

test("a skipped beat pays no completion award", () => {
  // Skipping used to RAISE the score, which made it the fastest way to earn.
  const skipped = applyAll(initialScore(), [{ type: "beat-skipped" }]);
  assert.equal(skipped.xp, 0);
  assert.equal(skipped.streak, 0, "a skip breaks the streak");
});
