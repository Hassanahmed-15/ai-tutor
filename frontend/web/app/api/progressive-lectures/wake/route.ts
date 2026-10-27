import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { wakeLectureWorker } from "@/lib/progressiveLectureQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The lesson screen opened: the lecture worker starts now, so it is running when the lesson is queued. */
export async function POST() {
  if (await currentUser().catch(() => null)) await wakeLectureWorker().catch(() => undefined);
  return new NextResponse(null, { status: 204 });
}
