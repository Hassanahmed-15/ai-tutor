import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { dailySpend, databaseConfigured, ensureContainers, type DailySpendDoc } from "@/lib/db/cosmos";
import { MAX_REPORT_USD, dailyLimitUsd, isTracked, spendDay, spendDocId, type SpendStatus } from "@/lib/spendTracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TODAY'S AI SPEND for the accounts lib/spendTracking.ts tracks (Hassan's and Minahil's).
 *
 *   GET  → { tracked: false } for everyone else; for a tracked account, today's total and the limit.
 *   POST { usd } → adds a measured cost to today's total (lib/spendReporter.ts sends these). For an
 *        account that is not tracked it does nothing.
 *
 * Warning only: the limit is reported, never enforced.
 */
export async function GET() {
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!databaseConfigured() || !isTracked(session.email)) return NextResponse.json({ tracked: false } satisfies SpendStatus);
  await ensureContainers();
  const day = spendDay();
  const spentUsd = await readSpent(session.userId, day);
  return NextResponse.json(status(day, spentUsd));
}

export async function POST(req: Request) {
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!databaseConfigured() || !isTracked(session.email)) return new NextResponse(null, { status: 204 });
  const body = (await req.json().catch(() => ({}))) as { usd?: unknown };
  const usd = typeof body.usd === "number" ? body.usd : Number(body.usd);
  if (!Number.isFinite(usd) || usd < 0 || usd > MAX_REPORT_USD) {
    return NextResponse.json({ error: `usd must be a number from 0 to ${MAX_REPORT_USD}` }, { status: 400 });
  }
  await ensureContainers();
  const day = spendDay();
  const spentUsd = usd > 0 ? await addSpent(session.userId, session.email, day, usd) : await readSpent(session.userId, day);
  return NextResponse.json(status(day, spentUsd));
}

function status(day: string, spentUsd: number): SpendStatus {
  const limitUsd = dailyLimitUsd();
  return { tracked: true, day, spentUsd: Math.round(spentUsd * 10_000) / 10_000, limitUsd, over: spentUsd > limitUsd };
}

async function readSpent(userId: string, day: string): Promise<number> {
  const { resource } = await dailySpend().item(spendDocId(userId, day), userId).read<DailySpendDoc>().catch(() => ({ resource: undefined }));
  return resource?.spentUsd ?? 0;
}

/**
 * Adds to today's row atomically (a patch `incr`), so reports from two tabs or two devices never
 * overwrite each other. The first report of the day creates the row.
 */
async function addSpent(userId: string, email: string, day: string, usd: number): Promise<number> {
  const id = spendDocId(userId, day);
  const item = dailySpend().item(id, userId);
  const patch = async () => {
    const { resource } = await item.patch<DailySpendDoc>([
      { op: "incr", path: "/spentUsd", value: usd },
      { op: "set", path: "/updatedAt", value: new Date().toISOString() },
    ]);
    return resource?.spentUsd ?? usd;
  };
  try {
    return await patch();
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
  try {
    const doc: DailySpendDoc = { id, userId, email, day, spentUsd: usd, updatedAt: new Date().toISOString() };
    await dailySpend().items.create(doc);
    return usd;
  } catch (error) {
    // Another report created it a moment ago: add to it instead.
    if ((error as { code?: number }).code === 409) return patch();
    throw error;
  }
}
