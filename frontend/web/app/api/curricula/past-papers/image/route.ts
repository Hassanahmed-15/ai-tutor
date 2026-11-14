import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { fullPastPaperAccess, pastPaperImage, pastPapersOn } from "@/lib/curriculum/pastPapers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One page image of a real past-paper question — only for accounts in PAST_PAPERS_FULL_USERS. */
export async function GET(req: Request) {
  const caller = await lessonCaller();
  if (!caller || !pastPapersOn() || !fullPastPaperAccess(caller.userId, caller.email)) return NextResponse.json({ error: "Not available." }, { status: 403 });
  const u = new URL(req.url);
  const bytes = await pastPaperImage(u.searchParams.get("ref") ?? "", Number(u.searchParams.get("k")));
  if (!bytes) return NextResponse.json({ error: "No such image." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
