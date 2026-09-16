import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { blobStorageConfigured } from "@/lib/blobStorage";
import { databaseConfigured } from "@/lib/db/cosmos";
import { listLecturesForUser } from "@/lib/lectureArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists only the signed-in learner's Blob-backed lecture packages. */
export async function GET() {
  if (!databaseConfigured() || !blobStorageConfigured()) {
    return NextResponse.json({ error: "Lecture history storage is not configured." }, { status: 503 });
  }

  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const lectures = await listLecturesForUser(session.userId);
    return NextResponse.json({ lectures });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load lecture history.";
    console.error(`[lectures] list failed: ${message}`);
    return NextResponse.json({ error: "Could not load lecture history." }, { status: 502 });
  }
}
