import { randomUUID } from "node:crypto";
import { FIRST_STAGE, type LessonDesignStageId } from "./lessonDesignStages";

/**
 * Background lecture jobs.
 *
 * WHY THIS EXISTS. Generating a lecture takes 3-20 minutes, but Azure Container Apps enforces a
 * hard ~240s ingress timeout that cannot be raised — `requestTimeout` is not a supported property on
 * Container Apps ingress, so no configuration change fixes it. Past that deadline the proxy returns
 * `504 stream timeout` as PLAIN TEXT, so the client's `data.error` was undefined and every long
 * lecture surfaced as "Couldn't build that lecture. Try a different topic." — blaming the student's
 * topic for an infrastructure limit.
 *
 * So the request that starts a lecture no longer waits for it. It returns a job id immediately and
 * the client polls. Nothing about generation itself changed; only who waits, and where.
 *
 * IN MEMORY, DELIBERATELY. Jobs live in the process, not in Cosmos. A lecture is only useful to the
 * one browser tab that asked for it, generation cannot be resumed if the replica dies (the work is
 * not checkpointed), and the finished lecture already has its own durable cache
 * (readCachedLecture/writeCachedLecture). Persisting job rows would add RU cost and a second source
 * of truth to keep in sync while buying nothing the cache does not already provide. The app runs a
 * single replica; if it is ever scaled out, this needs sticky sessions or a shared store, which is
 * why `replicaHint` is returned to make a mismatch diagnosable rather than mysterious.
 */

export type LectureJobState = "running" | "paused" | "done" | "error" | "cancelled";

export type LectureJob = {
  id: string;
  state: LectureJobState;
  createdAt: number;
  updatedAt: number;
  /** Set when state is "done". */
  result?: unknown;
  /** Set when state is "error" — the real message, never a generic one. */
  error?: string;
  /** Coarse progress text for the waiting UI. */
  status?: string;
  /**
   * Which pipeline stage is running, and how far into it the pipeline can actually count.
   *
   * Separate from `status` rather than replacing it: `status` is free prose the pipeline writes for
   * a human, `stage` is a closed set the design UI maps to a checklist and a percentage. Collapsing
   * them would mean either the UI parsing English or the pipeline losing the ability to say
   * something specific ("section 4 of 11") that no enum could carry.
   */
  stage: LessonDesignStageId;
  /**
   * Progress WITHIN the current stage, 0-1. Only set where the pipeline genuinely counts something
   * — chunked document generation knows how many sections it has finished. Left at 0 elsewhere,
   * which the progress model treats as "no information", never as an excuse to interpolate.
   */
  stageFraction: number;
  /**
   * Free-text detail for the current stage, e.g. "Section 4 of 11". Shown under the stage name and
   * available to the live tutor, so the student hears something specific instead of the same
   * sentence for two minutes.
   */
  detail?: string;
  /**
   * Steering the student gave BY VOICE while the build was running ("make this easier", "I don't
   * know gradient descent yet").
   *
   * Recorded on the job because the parts of the pipeline that have not run yet can still read it.
   * See `addJobSteering` for why this is worth doing even though the early stages are already past.
   */
  steering: string[];
  /** Time excluded from progress estimates while the student intentionally paused the build. */
  pausedAt?: number;
  pausedMs: number;
};

/**
 * Finished jobs are kept briefly so a poll that arrives just after completion still finds the
 * result, then dropped so a long-lived replica does not accumulate whole lectures in memory.
 */
const DONE_TTL_MS = 10 * 60 * 1000;
/** A job that has not been touched in this long is presumed dead and is swept. */
const RUNNING_TTL_MS = 45 * 60 * 1000;

const globalForJobs = globalThis as unknown as {
  ariaLectureJobs?: Map<string, LectureJob>;
  ariaReplicaId?: string;
};

function jobs(): Map<string, LectureJob> {
  // Cached on globalThis so hot reloads in dev do not orphan running jobs.
  globalForJobs.ariaLectureJobs ??= new Map();
  return globalForJobs.ariaLectureJobs;
}

/** Stable per-process id, so a poll landing on the wrong replica is diagnosable. */
export function replicaHint(): string {
  globalForJobs.ariaReplicaId ??= randomUUID().slice(0, 8);
  return globalForJobs.ariaReplicaId;
}

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of jobs()) {
    const age = now - job.updatedAt;
    if (job.state === "running" || job.state === "paused" ? age > RUNNING_TTL_MS : age > DONE_TTL_MS) jobs().delete(id);
  }
}

export function createJob(status = "Starting"): LectureJob {
  sweep();
  const job: LectureJob = {
    id: randomUUID(),
    state: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status,
    stage: FIRST_STAGE,
    stageFraction: 0,
    steering: [],
    pausedMs: 0,
  };
  jobs().set(job.id, job);
  return job;
}

export function getJob(id: string): LectureJob | null {
  return jobs().get(id) ?? null;
}

export function setJobStatus(id: string, status: string): void {
  const job = jobs().get(id);
  if (!job || job.state !== "running") return;
  job.status = status;
  job.updatedAt = Date.now();
}

/**
 * Move the job to a pipeline stage.
 *
 * Monotonic BY DESIGN: a stage is never allowed to go backwards. The fill passes run concurrently
 * (see the Promise.all in generate-lecture), so without this a slow board pass finishing after a
 * fast callout pass would drag the bar back down and make a healthy build look like it was
 * failing. Going backwards is the one thing a progress bar must never do, so the guard lives here
 * rather than being a rule each call site has to remember.
 */
export function setJobStage(
  id: string,
  stage: LessonDesignStageId,
  options: { fraction?: number; detail?: string; status?: string } = {},
): void {
  const job = jobs().get(id);
  if (!job || job.state !== "running") return;

  const current = stageOrder(job.stage);
  const next = stageOrder(stage);
  if (next < current) return;
  // Within the same stage, fraction may only advance, for the same reason stages may not regress.
  if (next === current && options.fraction !== undefined && options.fraction < job.stageFraction) {
    return;
  }

  job.stage = stage;
  if (options.fraction !== undefined) job.stageFraction = Math.max(0, Math.min(1, options.fraction));
  else if (next > current) job.stageFraction = 0;
  if (options.detail !== undefined) job.detail = options.detail;
  if (options.status !== undefined) job.status = options.status;
  job.updatedAt = Date.now();
}

export function pauseJob(id: string): boolean {
  const job = jobs().get(id);
  if (!job || job.state !== "running") return false;
  job.state = "paused";
  job.pausedAt = Date.now();
  job.status = "Paused after the current operation";
  job.updatedAt = Date.now();
  return true;
}

export function resumeJob(id: string): boolean {
  const job = jobs().get(id);
  if (!job || job.state !== "paused") return false;
  job.state = "running";
  if (job.pausedAt) job.pausedMs += Date.now() - job.pausedAt;
  job.pausedAt = undefined;
  job.status = "Resuming lesson preparation";
  job.updatedAt = Date.now();
  return true;
}

export function cancelJob(id: string): boolean {
  const job = jobs().get(id);
  if (!job || (job.state !== "running" && job.state !== "paused")) return false;
  job.state = "cancelled";
  if (job.pausedAt) job.pausedMs += Date.now() - job.pausedAt;
  job.pausedAt = undefined;
  job.status = "Stopped";
  job.updatedAt = Date.now();
  return true;
}

export class LectureJobCancelledError extends Error {
  constructor() {
    super("Lecture preparation was stopped.");
    this.name = "LectureJobCancelledError";
  }
}

/** Hold the pipeline between expensive stages while paused, and abort before any later work. */
export async function waitForJobRunnable(id: string): Promise<void> {
  for (;;) {
    const job = jobs().get(id);
    if (!job || job.state === "cancelled") throw new LectureJobCancelledError();
    if (job.state !== "paused") return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function stageOrder(stage: LessonDesignStageId): number {
  return STAGE_ORDER.indexOf(stage);
}

const STAGE_ORDER: LessonDesignStageId[] = [
  "analyzing",
  "concepts",
  "structuring",
  "explanations",
  "visuals",
  "activities",
  "finalizing",
];

/**
 * Record a steering note the student gave by voice mid-build.
 *
 * WHY THIS IS NOT POINTLESS. The obvious objection is that by the time someone says "make this
 * easier", the script is already written — and for the script, that is true. But a build is not one
 * call: the board, callout and rescue passes all run afterwards and all read the lesson's mood
 * line, so steering that arrives during structuring still reaches everything downstream of it.
 *
 * Steering that arrives too late to change anything is kept anyway rather than dropped, because the
 * player reads it too — a lesson the student asked to simplify should still be delivered gently
 * even if its text was fixed before they asked.
 */
export function addJobSteering(id: string, note: string): void {
  const job = jobs().get(id);
  const trimmed = note.trim();
  if (!job || (job.state !== "running" && job.state !== "paused") || !trimmed) return;
  // Bounded: a long conversation must not grow the prompt without limit.
  if (job.steering.length >= 8) return;
  if (job.steering.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) return;
  job.steering.push(trimmed.slice(0, 300));
  job.updatedAt = Date.now();
}

/** The steering notes recorded so far, for a pipeline pass that is about to build a prompt. */
export function jobSteering(id: string): string[] {
  return jobs().get(id)?.steering ?? [];
}

export function finishJob(id: string, result: unknown): void {
  const job = jobs().get(id);
  if (!job || job.state === "cancelled") return;
  job.state = "done";
  job.result = result;
  job.updatedAt = Date.now();
}

export function failJob(id: string, error: string): void {
  const job = jobs().get(id);
  if (!job || job.state === "cancelled") return;
  job.state = "error";
  // The real message, deliberately: the generic fallback is what made the original timeout
  // impossible to diagnose from the UI.
  job.error = error;
  job.updatedAt = Date.now();
}
