import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { blobStorageConfigured } from "@/lib/blobStorage";
import { databaseConfigured } from "@/lib/db/cosmos";
import { countLecturesForUser, listLecturesForUser } from "@/lib/lectureArchive";

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
    // The total is counted rather than measured from the page: the list is capped, so its length is
    // a page size and reporting it as "N saved" undercounts anyone past the cap.
    const [lectures, total] = await Promise.all([
      listLecturesForUser(session.userId),
      countLecturesForUser(session.userId),
    ]);
    return NextResponse.json({ lectures, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load lecture history.";
    console.error(`[lectures] list failed: ${message}`);
    return NextResponse.json({ error: "Could not load lecture history." }, { status: 502 });
  }
}
