import { NextResponse } from "next/server";
import { recordSpend, spendForDay, spendForTags } from "@/lib/spend/record";
import { spendScopeNow } from "@/lib/openaiClient";

export const runtime = "nodejs";

/**
 * GET  /api/spend?tags=a,b   → everything spent under these lesson tags (the badge's lesson total).
 *      /api/spend?day=today   → everything spent today across the whole app (development, or with
 *                               SPEND_DASHBOARD=1 set on the server).
 * POST /api/spend { model, usd } → spend measured in the browser (the live voice), filed under the
 *                               request's own lesson tag.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tags = (url.searchParams.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const lesson = tags.length ? await spendForTags(tags).catch(() => null) : null;
  const wantDay = url.searchParams.get("day");
  const dayAllowed = process.env.NODE_ENV !== "production" || process.env.SPEND_DASHBOARD === "1";
  const day = wantDay && dayAllowed ? await spendForDay(wantDay === "today" ? undefined : wantDay.slice(0, 10)).catch(() => null) : null;
  return NextResponse.json({ lesson, day }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { model?: unknown; usd?: unknown };
  const usd = typeof body.usd === "number" && Number.isFinite(body.usd) && body.usd > 0 && body.usd < 5 ? body.usd : null;
  const model = typeof body.model === "string" ? body.model.slice(0, 60) : "unknown";
  if (usd === null) return NextResponse.json({ ok: false }, { status: 400 });
  const scope = await spendScopeNow();
  recordSpend({ tag: scope.tag, kind: "voice", model, endpoint: "client", usd });
  return NextResponse.json({ ok: true });
}
