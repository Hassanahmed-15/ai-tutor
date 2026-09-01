import { NextResponse } from "next/server";
import { addJobSteering, getJob } from "@/lib/lectureJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record something the student said by voice that should change the lesson still being built.
 *
 * Called by the live tutor's `adapt_lesson` tool during lesson design. Separate from the status
 * poll on purpose: status is a GET the client makes every three seconds and must stay cheap and
 * side-effect free, while this is a rare, deliberate write. Folding a write into the poll would
 * mean every heartbeat carried a payload that is almost always empty.
 *
 * Honest about its limits. A note only reaches the parts of the pipeline that have not run yet —
 * see `moodWithSteering` in the generate route — so this returns what actually happened rather
 * than a bare ok, and the tutor uses that sentence to tell the student the truth about whether
 * their request landed.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.jobId === "string" ? body.jobId : "";
  const note = typeof body.note === "string" ? body.note : "";
  if (!id || !note.trim()) {
    return NextResponse.json({ error: "jobId and note are required" }, { status: 400 });
  }

  const job = getJob(id);
  if (!job) return NextResponse.json({ applied: false, reason: "expired" }, { status: 200 });
  if (job.state !== "running" && job.state !== "paused") {
    return NextResponse.json({ applied: false, reason: "finished" }, { status: 200 });
  }

  addJobSteering(id, note);
  return NextResponse.json({ applied: true, stage: job.stage });
}
