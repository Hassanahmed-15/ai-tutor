import test from "node:test";
import assert from "node:assert/strict";
import {
  addJobSteering,
  cancelJob,
  createJob,
  finishJob,
  getJob,
  jobSteering,
  LectureJobCancelledError,
  pauseJob,
  resumeJob,
  setJobStage,
  waitForJobRunnable,
} from "../lectureJobs";

/**
 * The job's stage bookkeeping.
 *
 * The guard worth pinning is monotonicity. The fill passes in generate-lecture run concurrently
 * inside one Promise.all, so without a guard a slow board pass reporting after a fast callout pass
 * would drag the stage — and therefore the bar — backwards. A progress bar going backwards reads as
 * a failure to a student who cannot see the pipeline, so it is enforced in the store rather than
 * left as a rule each call site has to remember.
 */

test("a new job starts at the first stage with no progress inside it", () => {
  const job = createJob();
  assert.equal(job.stage, "analyzing");
  assert.equal(job.stageFraction, 0);
  assert.deepEqual(job.steering, []);
});

test("stages may advance", () => {
  const job = createJob();
  setJobStage(job.id, "visuals", { status: "Preparing the board content" });
  assert.equal(getJob(job.id)?.stage, "visuals");
  assert.equal(getJob(job.id)?.status, "Preparing the board content");
});

test("stages may never go backwards", () => {
  const job = createJob();
  setJobStage(job.id, "activities");
  setJobStage(job.id, "concepts");
  assert.equal(getJob(job.id)?.stage, "activities", "a late-finishing pass must not rewind the bar");
});

test("advancing a stage clears the previous stage's fraction", () => {
  const job = createJob();
  setJobStage(job.id, "structuring", { fraction: 0.8 });
  setJobStage(job.id, "explanations");
  assert.equal(getJob(job.id)?.stageFraction, 0);
});

test("within one stage the fraction only moves forward", () => {
  const job = createJob();
  setJobStage(job.id, "structuring", { fraction: 0.6, detail: "Section 6 of 10" });
  setJobStage(job.id, "structuring", { fraction: 0.3, detail: "Section 3 of 10" });
  const after = getJob(job.id);
  assert.equal(after?.stageFraction, 0.6);
  assert.equal(after?.detail, "Section 6 of 10", "the stale detail must not overwrite the newer one");
});

test("a finished job stops accepting stage updates", () => {
  const job = createJob();
  finishJob(job.id, { beats: [] });
  setJobStage(job.id, "finalizing");
  assert.equal(getJob(job.id)?.stage, "analyzing");
});

test("spoken steering is recorded for the passes that have not run yet", () => {
  const job = createJob();
  addJobSteering(job.id, "Explain gradient descent from scratch first.");
  assert.deepEqual(jobSteering(job.id), ["Explain gradient descent from scratch first."]);
});

test("steering is de-duplicated and bounded", () => {
  const job = createJob();
  addJobSteering(job.id, "Make it simpler.");
  addJobSteering(job.id, "make it simpler.");
  assert.equal(jobSteering(job.id).length, 1, "the same instruction twice is still one instruction");

  for (let i = 0; i < 20; i++) addJobSteering(job.id, `note ${i}`);
  assert.ok(jobSteering(job.id).length <= 8, "a long conversation must not grow the prompt without limit");
});

test("steering a finished job is dropped rather than silently queued", () => {
  const job = createJob();
  finishJob(job.id, { beats: [] });
  addJobSteering(job.id, "Make it easier.");
  assert.deepEqual(jobSteering(job.id), []);
});

test("pause and resume control the real job state", () => {
  const job = createJob();
  assert.equal(pauseJob(job.id), true);
  assert.equal(getJob(job.id)?.state, "paused");
  assert.equal(resumeJob(job.id), true);
  assert.equal(getJob(job.id)?.state, "running");
});

test("a paused job blocks the next pipeline boundary until resume", async () => {
  const job = createJob();
  pauseJob(job.id);
  let passed = false;
  const waiting = waitForJobRunnable(job.id).then(() => { passed = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(passed, false);
  resumeJob(job.id);
  await waiting;
  assert.equal(passed, true);
});

test("cancelled jobs reject later work and cannot finish", async () => {
  const job = createJob();
  cancelJob(job.id);
  await assert.rejects(waitForJobRunnable(job.id), LectureJobCancelledError);
  finishJob(job.id, { beats: ["should not land"] });
  assert.equal(getJob(job.id)?.state, "cancelled");
  assert.equal(getJob(job.id)?.result, undefined);
});
