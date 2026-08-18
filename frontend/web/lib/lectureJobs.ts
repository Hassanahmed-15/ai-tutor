import { randomUUID } from "node:crypto";

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

export type LectureJobState = "running" | "done" | "error";

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
    if (job.state === "running" ? age > RUNNING_TTL_MS : age > DONE_TTL_MS) jobs().delete(id);
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

export function finishJob(id: string, result: unknown): void {
  const job = jobs().get(id);
  if (!job) return;
  job.state = "done";
  job.result = result;
  job.updatedAt = Date.now();
}

export function failJob(id: string, error: string): void {
  const job = jobs().get(id);
  if (!job) return;
  job.state = "error";
  // The real message, deliberately: the generic fallback is what made the original timeout
  // impossible to diagnose from the UI.
  job.error = error;
  job.updatedAt = Date.now();
}
