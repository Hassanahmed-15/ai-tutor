import { NextResponse } from "next/server";
import { getJob, readPersistedJob, replicaHint } from "@/lib/lectureJobs";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Poll a background lecture job.
 *
 * Exists because Azure Container Apps cuts any request at ~240s (see lib/lectureJobs.ts), so the
 * lecture cannot be delivered on the connection that asked for it. Each poll is a short request
 * that returns well within the cap, however long generation takes.
 *
 * A completed job returns the same body the synchronous route used to, so the client's success path
 * is unchanged — it just arrives via a different door.
 */
export async function GET(request: Request) {
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const job = getJob(id);
  if (!job) {
    /**
     * Not in this process — so ask the durable record what became of it.
     *
     * This used to answer "unknown" immediately, which the client showed as "That lecture job
     * expired". That was a guess, and usually the wrong one: the common cause is the invocation
     * being reaped or the replica restarting mid-build, not anything expiring. lectureJobs.ts now
     * mirrors the transitions that matter to Cosmos, so a job that finished or failed elsewhere can
     * be reported as what it actually was.
     */
    const persisted = await readPersistedJob(id, session.userId);
    if (persisted?.state === "error") {
      return NextResponse.json({ state: "error", error: persisted.error ?? "Lecture generation failed" });
    }
    if (persisted?.state === "cancelled") {
      return NextResponse.json({ state: "cancelled" });
    }
    /**
     * A row still marked "running" that this process does not hold means the build was killed
     * partway — the heartbeat stopped without a terminal transition ever being written. Reported as
     * an error naming the stage it died in, because "interrupted at Preparing the board content" is
     * something a person can act on, and silence is not.
     *
     * `done` lands here too: the result package is deliberately not stored on the job row (it is
     * already durable in blob storage), so there is nothing to hand back and restarting is right.
     */
    if (persisted?.state === "running" || persisted?.state === "paused") {
      return NextResponse.json({
        state: "error",
        error: `The build stopped unexpectedly while ${persisted.status || "preparing your lesson"}. The server may have restarted — press build to try again.`,
      });
    }
    return NextResponse.json({ state: "unknown", replica: replicaHint() }, { status: 200 });
  }

  // A UUID is not authorization. Never reveal another learner's progress or finished package.
  if (job.userId !== session.userId) {
    return NextResponse.json({ error: "Lecture job not found." }, { status: 404 });
  }

  if (job.state === "done") {
    return NextResponse.json({ state: "done", ...(job.result as Record<string, unknown>) });
  }
  if (job.state === "error") {
    return NextResponse.json({ state: "error", error: job.error ?? "Lecture generation failed" });
  }
  if (job.state === "cancelled") {
    return NextResponse.json({ state: "cancelled" });
  }
  /**
   * Stage fields are ADDITIVE. `status` and `elapsedMs` are still returned exactly as before, so a
   * client that knows nothing about stages (and the existing tests) keeps working unchanged; the
   * design screen reads the new fields on top.
   */
  return NextResponse.json({
    state: "running",
    status: job.status ?? "Working",
    elapsedMs: Date.now() - job.createdAt - job.pausedMs - (job.pausedAt ? Date.now() - job.pausedAt : 0),
    stage: job.stage,
    stageFraction: job.stageFraction,
    detail: job.detail ?? null,
    paused: job.state === "paused",
  });
}
