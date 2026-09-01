import test from "node:test";
import assert from "node:assert/strict";
import {
  LESSON_DESIGN_STAGES,
  completedStages,
  estimateRemainingMs,
  formatRemaining,
  progressFor,
  spokenPercent,
  stageIndex,
} from "../lessonDesignStages";

/**
 * What the design screen's progress bar is allowed to claim.
 *
 * The rule these pin is that progress is EARNED, not timed. The screen it replaces showed a
 * spinner, and the tempting fix — animate a bar over an estimated duration — produces a bar that
 * hits 100% while the build is still running, which is worse than the spinner because it is a
 * specific lie rather than a vague one. So: never reach 1 while running, never go backwards, and
 * never estimate a time from a sample too small to support one.
 */

test("weights sum to one, so the bar can actually reach the end", () => {
  const total = LESSON_DESIGN_STAGES.reduce((sum, stage) => sum + stage.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights summed to ${total}`);
});

test("progress never reaches 100% while a stage is still running", () => {
  // Even the last stage, reported as fully complete, stays below 1: only the caller's `ready` flag
  // may show 100%, because only the job knows the lecture actually exists.
  const last = LESSON_DESIGN_STAGES[LESSON_DESIGN_STAGES.length - 1];
  assert.ok(progressFor(last.id, 1) < 1);
  assert.ok(progressFor(last.id, 1) >= 0.9, "the final stage should still read as nearly done");
});

test("progress increases monotonically through the stages", () => {
  let previous = -1;
  for (const stage of LESSON_DESIGN_STAGES) {
    const value = progressFor(stage.id, 0);
    assert.ok(value > previous, `${stage.id} did not advance past the previous stage`);
    previous = value;
  }
});

test("a stage's fraction only moves within that stage's own share", () => {
  const index = stageIndex("structuring");
  const before = progressFor("structuring", 0);
  const after = progressFor("structuring", 1);
  const next = progressFor(LESSON_DESIGN_STAGES[index + 1].id, 0);
  assert.ok(after > before);
  // Finishing a stage cannot overshoot the start of the next one — that is what would make the bar
  // jump forwards and then appear to stall.
  assert.ok(after <= next + 1e-9);
});

test("an unknown stage reads as zero rather than throwing", () => {
  // A poll from an older replica can carry a stage this build does not know. Showing 0 is wrong but
  // harmless; throwing would take down the whole design screen mid-build.
  assert.equal(progressFor("not-a-stage"), 0);
  assert.deepEqual(completedStages("not-a-stage"), []);
});

test("completed stages are exactly those before the current one", () => {
  assert.deepEqual(completedStages("analyzing"), []);
  assert.deepEqual(completedStages("structuring"), ["analyzing", "concepts"]);
});

test("no time estimate is offered from a sample too small to support one", () => {
  // 2% into a build, extrapolation produces confident nonsense like "47 minutes remaining".
  assert.equal(estimateRemainingMs(3_000, 0.02), null);
  assert.equal(estimateRemainingMs(0, 0.5), null);
});

test("the time estimate extrapolates from the build's own measured pace", () => {
  // 40% took 60s, so the remaining 60% should read as about 90s.
  const remaining = estimateRemainingMs(60_000, 0.4);
  assert.ok(remaining !== null);
  assert.ok(Math.abs(remaining - 90_000) < 1_000, `got ${remaining}`);
});

test("remaining time is phrased for a person, not a stopwatch", () => {
  assert.equal(formatRemaining(null), null);
  assert.equal(formatRemaining(4_000), "a few seconds");
  assert.equal(formatRemaining(80_000), "1 min 20 sec");
  assert.equal(formatRemaining(120_000), "2 min");
});

test("spoken percentages are rounded to something sayable", () => {
  // "sixty-eight point four percent" is a readout; "seventy percent" is a sentence.
  assert.equal(spokenPercent(0.684), "70 percent");
  assert.equal(spokenPercent(0.5), "50 percent");
});
