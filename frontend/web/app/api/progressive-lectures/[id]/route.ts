import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { progressiveSnapshot } from "@/lib/progressiveLectureStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await currentUser();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  const snapshot = await progressiveSnapshot(auth.userId, id).catch(() => null);
  if (!snapshot) return NextResponse.json({ error: "Progressive lecture not found." }, { status: 404 });
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
}
