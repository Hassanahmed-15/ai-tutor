import { randomUUID } from "node:crypto";
import { FIRST_STAGE, type LessonDesignStageId } from "./lessonDesignStages";
import { databaseConfigured, ensureContainers, lectureJobs as lectureJobsContainer, type LectureJobDoc } from "./db/cosmos";

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
 * IN MEMORY FOR THE LIVE JOB, WITH A DURABLE BREADCRUMB BESIDE IT. The running job lives in this
 * process because the pipeline touches it constantly — `setJobStage` is called fifteen-odd times
 * per build, some of it from inside a Promise.all fan-out, and `waitForJobRunnable` polls every
 * 150ms. Routing that through a database would put a network round-trip into the hot path.
 *
 * But the map alone cannot answer the one question that matters when something goes wrong: what
 * happened to a job that is no longer in it. A build whose invocation was reaped mid-flight, or
 * whose replica restarted, simply vanished — and the status route reported the absence as
 * "unknown", which the client rendered as "That lecture job expired". Nothing had expired. The work
 * had been killed, and the message sent people off shortening their PDF for an unrelated reason.
 *
 * So the transitions that matter — created, done, error, plus a periodic heartbeat — are ALSO
 * written to Cosmos, fire-and-forget. `readPersistedJob` then lets a map miss be answered honestly
 * instead of guessed at. Deliberately NOT full durability: the pipeline holds its work in local
 * variables and is not checkpointed, so an interrupted build still cannot be resumed — it can only
 * now be reported accurately. Roughly four extra writes per build, none of them blocking.
 */

export type LectureJobState = "running" | "paused" | "done" | "error" | "cancelled";

export type LectureJob = {
  id: string;
  /** Owner copied from the authenticated request; polling must present the same account. */
  userId: string;
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

/** How long a job breadcrumb outlives its last write. Comfortably past the client's own deadline. */
const PERSIST_TTL_SECONDS = 60 * 60;

/**
 * Mirror a job to Cosmos without ever making the caller wait, or fail, for it.
 *
 * Every call site is inside the generation pipeline or a route that has already answered, so a
 * storage hiccup must degrade to "no breadcrumb" rather than to a broken build. That is the same
 * bargain lib/pageImageStore.ts makes: losing the record must never lose the lesson.
 */
function persistJob(job: LectureJob): void {
  if (!databaseConfigured()) return;
  void (async () => {
    try {
      await ensureContainers();
      const doc: LectureJobDoc = {
        id: job.id,
        userId: job.userId,
        state: job.state,
        stage: job.stage,
        stageFraction: job.stageFraction,
        status: job.status ?? "",
        detail: job.detail ?? null,
        error: job.error ?? null,
        createdAt: new Date(job.createdAt).toISOString(),
        updatedAt: new Date(job.updatedAt).toISOString(),
        ttl: PERSIST_TTL_SECONDS,
      };
      await lectureJobsContainer().items.upsert(doc);
    } catch (error) {
      console.error(`[lecture-job] could not persist ${job.id}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  })();
}

/**
 * What the durable record says about a job this process does not have.
 *
 * Returns null when there is no database, no row, or the read fails — every one of which the
 * caller must treat as "genuinely unknown" rather than as an error worth surfacing.
 */
export async function readPersistedJob(id: string, userId: string): Promise<LectureJobDoc | null> {
  if (!databaseConfigured()) return null;
  try {
    await ensureContainers();
    const { resource } = await lectureJobsContainer().item(id, userId).read<LectureJobDoc>();
    return resource ?? null;
  } catch {
    return null;
  }
}

/**
 * Heartbeat interval. Frequent enough that a killed build's last known stage is roughly current,
 * rare enough that a build adds a handful of writes rather than one per stage transition.
 */
const HEARTBEAT_MS = 15_000;
const lastHeartbeat = new Map<string, number>();

/** Called from the hot path, so it writes at most once per HEARTBEAT_MS per job. */
function heartbeat(job: LectureJob): void {
  const now = Date.now();
  const previous = lastHeartbeat.get(job.id) ?? 0;
  if (now - previous < HEARTBEAT_MS) return;
  lastHeartbeat.set(job.id, now);
  persistJob(job);
}

export function createJob(userId: string, status = "Starting"): LectureJob {
  if (!userId) throw new Error("Lecture jobs require an authenticated owner.");
  sweep();
  const job: LectureJob = {
    id: randomUUID(),
    userId,
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
  persistJob(job);
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
  // Rate-limited inside: this is the hot path, and a write per stage transition is not wanted.
  heartbeat(job);
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
  lastHeartbeat.delete(job.id);
  persistJob(job);
}

export function failJob(id: string, error: string): void {
  const job = jobs().get(id);
  if (!job || job.state === "cancelled") return;
  job.state = "error";
  // The real message, deliberately: the generic fallback is what made the original timeout
  // impossible to diagnose from the UI.
  job.error = error;
  job.updatedAt = Date.now();
  lastHeartbeat.delete(job.id);
  persistJob(job);
}
