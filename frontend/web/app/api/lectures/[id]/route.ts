import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { packageForUser } from "@/lib/lectureArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Downloads a private replay package only after checking its Cosmos ownership record. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Invalid lecture id." }, { status: 400 });
  }

  try {
    const lecture = await packageForUser(session.userId, id);
    if (!lecture) return NextResponse.json({ error: "Lecture not found." }, { status: 404 });
    return NextResponse.json(lecture, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load lecture.";
    console.error(`[lectures] package ${id} failed: ${message}`);
    return NextResponse.json({ error: "Could not load lecture." }, { status: 502 });
  }
}
