import { NextResponse } from "next/server";
import { getJob, replicaHint } from "@/lib/lectureJobs";

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
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const job = getJob(id);
  if (!job) {
    /**
     * An unknown id is reported as its own state rather than a 404 error.
     *
     * It means one of three things — the job expired, the replica restarted, or the poll landed on
     * a different replica than the one generating — and none of them are the student's fault or
     * worth showing as a raw error. The client treats it as "start again", and `replica` makes the
     * multi-replica case identifiable instead of looking like random flakiness.
     */
    return NextResponse.json({ state: "unknown", replica: replicaHint() }, { status: 200 });
  }

  if (job.state === "done") {
    return NextResponse.json({ state: "done", ...(job.result as Record<string, unknown>) });
  }
  if (job.state === "error") {
    return NextResponse.json({ state: "error", error: job.error ?? "Lecture generation failed" });
  }
  return NextResponse.json({
    state: "running",
    status: job.status ?? "Working",
    elapsedMs: Date.now() - job.createdAt,
  });
}
