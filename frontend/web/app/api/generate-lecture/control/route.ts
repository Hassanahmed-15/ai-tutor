import { NextResponse } from "next/server";
import { cancelJob, getJob, pauseJob, resumeJob } from "@/lib/lectureJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.jobId === "string" ? body.jobId : "";
  const action = body.action === "pause" || body.action === "resume" || body.action === "cancel"
    ? body.action
    : null;
  if (!id || !action) {
    return NextResponse.json({ error: "jobId and action are required" }, { status: 400 });
  }

  const job = getJob(id);
  if (!job) return NextResponse.json({ applied: false, reason: "expired" });

  const applied = action === "pause"
    ? pauseJob(id)
    : action === "resume"
      ? resumeJob(id)
      : cancelJob(id);
  return NextResponse.json({ applied, state: getJob(id)?.state ?? "unknown" });
}
