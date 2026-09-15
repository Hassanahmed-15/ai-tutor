import { NextResponse } from "next/server";
import {
  LEARNED_TOPIC_LIMIT,
  databaseConfigured,
  ensureContainers,
  migrateUserDoc,
  users,
  type UserDoc,
} from "@/lib/db/cosmos";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What this learner has been taught before.
 *
 * WHY IT EXISTS. The learner model is otherwise per-topic and dies with the planning session, so a
 * student who proved they understand gradient descent on Monday was asked about it again on
 * Tuesday. This is the cross-session half: enough to open the next conversation from what is known
 * rather than from nothing.
 *
 * DELIBERATELY NARROW. Only the topic, the depth it was taught at, the concepts demonstrated, and
 * the goal. Not diagnostics, not misconceptions — those are about one topic at one moment, and
 * carrying a months-old misconception forward would correct something the learner has since fixed.
 *
 * SIGNED OUT IS NOT AN ERROR. The whole feature is an enhancement; an anonymous student simply gets
 * the conversation starting from scratch, which is exactly what happened before this existed.
 */
export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ topics: [] });
  const session = await currentUser();
  if (!session) return NextResponse.json({ topics: [] });

  await ensureContainers();
  const { resource: raw } = await users().item(session.userId, session.userId).read<UserDoc>();
  if (!raw) return NextResponse.json({ topics: [] });
  const { doc } = migrateUserDoc(raw);
  return NextResponse.json({ topics: doc.learnedTopics ?? [] });
}

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ ok: false, reason: "no-database" });
  const session = await currentUser();
  // Recording history is best-effort: an anonymous lesson is still a lesson.
  if (!session) return NextResponse.json({ ok: false, reason: "signed-out" });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });

  const depth = typeof body.depth === "number" ? Math.max(1, Math.min(5, Math.round(body.depth))) : 2;
  const mastered = Array.isArray(body.mastered)
    ? body.mastered.filter((m): m is string => typeof m === "string" && m.trim().length > 0).map((m) => m.trim().slice(0, 120)).slice(0, 8)
    : [];
  const objective = typeof body.objective === "string" ? body.objective.slice(0, 40) : "unknown";

  await ensureContainers();
  const { resource: raw } = await users().item(session.userId, session.userId).read<UserDoc>();
  if (!raw) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  const { doc: user } = migrateUserDoc(raw);

  /*
   * Re-learning a topic REPLACES its old entry rather than adding a second.
   *
   * Otherwise a student who revisits a subject accumulates rows saying they know it at three
   * different depths, and the most recent — the only one that reflects where they actually are —
   * is indistinguishable from the stalest.
   */
  const previous = (user.learnedTopics ?? []).filter((t) => t.topic.toLowerCase() !== topic.toLowerCase());
  const learnedTopics = [{ topic, depth, mastered, objective, at: new Date().toISOString() }, ...previous].slice(
    0,
    LEARNED_TOPIC_LIMIT,
  );

  await users().item(session.userId, session.userId).replace({ ...user, learnedTopics });
  return NextResponse.json({ ok: true, count: learnedTopics.length });
}
