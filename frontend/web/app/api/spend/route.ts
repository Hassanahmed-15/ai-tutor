import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { databaseConfigured } from "@/lib/db/cosmos";
import { spendScopeNow } from "@/lib/openaiClient";
import { recordSpend, spendBetween, spendForDay, spendForTags } from "@/lib/spend/record";
import { MAX_REPORT_USD, dailyLimitUsd, isTracked, spendDay, spendDayRange, type SpendStatus } from "@/lib/spendTracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI SPEND, read from the one spend log every paid call is written to (lib/spend, lib/openaiClient.ts).
 *
 *   GET                      → today's spend for a TRACKED account (lib/spendTracking.ts: Hassan's and
 *                              Minahil's) — total, by part and by model — with the daily limit and the
 *                              whole app's total; `{ tracked: false }` for everyone else. Feeds
 *                              components/SpendPill.tsx. The day turns at midnight Pakistan time.
 *   GET ?tags=a,b            → everything spent under these lesson tags.
 *   GET ?day=today           → the whole app's spend today, for tracked accounts (and in development,
 *                              or everywhere with SPEND_DASHBOARD=1). Never shown to students.
 *   POST { model, usd }      → spend measured in the browser (the live voice talks to Google directly),
 *                              logged for this account and lesson.
 *   POST { usd } (old reporter) → nothing new is added (the server log already holds those calls);
 *                              answers the account's status.
 *
 * Warning only: the daily limit is reported, never enforced.
 */
export async function GET(request: Request) {
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const tags = (url.searchParams.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const wantDay = url.searchParams.get("day");
  if (tags.length || wantDay) {
    const lesson = tags.length ? await spendForTags(tags).catch(() => null) : null;
    const dayAllowed = process.env.NODE_ENV !== "production" || process.env.SPEND_DASHBOARD === "1" || isTracked(session.email);
    const day = wantDay && dayAllowed ? await spendForDay(wantDay === "today" ? undefined : wantDay.slice(0, 10)).catch(() => null) : null;
    return NextResponse.json({ lesson, day }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(await accountStatus(session.userId, session.email), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { model?: unknown; usd?: unknown };
  const usd = typeof body.usd === "number" ? body.usd : Number(body.usd);
  if (!Number.isFinite(usd) || usd < 0 || usd > MAX_REPORT_USD) {
    return NextResponse.json({ error: `usd must be a number from 0 to ${MAX_REPORT_USD}` }, { status: 400 });
  }
  if (typeof body.model === "string" && usd > 0) {
    const scope = await spendScopeNow();
    recordSpend({ tag: scope.tag, userId: session.userId, kind: "voice", model: body.model.slice(0, 60), endpoint: "client", usd });
  }
  if (!isTracked(session.email)) return new NextResponse(null, { status: 204 });
  return NextResponse.json(await accountStatus(session.userId, session.email));
}

async function accountStatus(userId: string, email: string): Promise<SpendStatus> {
  if (!databaseConfigured() || !isTracked(email)) return { tracked: false };
  const day = spendDay();
  const { from, to } = spendDayRange(day);
  const [mine, app] = await Promise.all([spendBetween(from, to, userId).catch(() => null), spendBetween(from, to).catch(() => null)]);
  const spentUsd = mine?.totalUsd ?? 0;
  const limitUsd = dailyLimitUsd();
  return {
    tracked: true,
    day,
    spentUsd: Math.round(spentUsd * 10_000) / 10_000,
    limitUsd,
    over: spentUsd > limitUsd,
    breakdown: mine ? { calls: mine.calls, unpriced: mine.unpriced, byKind: mine.byKind, byModel: mine.byModel } : undefined,
    appUsd: app ? Math.round(app.totalUsd * 10_000) / 10_000 : undefined,
    appCalls: app?.calls,
  };
}
