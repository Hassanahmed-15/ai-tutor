import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { currentUser } from "@/lib/auth";
import {
  databaseConfigured,
  ensureContainers,
  thoughts,
  users,
  migrateUserDoc,
  type ThoughtDoc,
  type UserDoc,
} from "@/lib/db/cosmos";
import { isAdhdLearner } from "@/lib/adhd/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Parked thoughts, per learner.
 *
 * "Park a thought" existed for a while as `useState` in the overlay and nothing else — every thought
 * a learner set aside was gone the moment they reloaded, which is the feature quietly not existing.
 * This is where they live now.
 *
 * SCOPED TO THE OWNER, NOT JUST GATED. Every read and delete is keyed by the signed-in user's id,
 * which is also the partition key, so there is no query shape here that could return or remove
 * someone else's thought even if the id were guessed. The ADHD check is separate and additional.
 */

/** Long enough for a real interruption, short enough that the field cannot be used as storage. */
const MAX_LENGTH = 400;
const MAX_THOUGHTS = 200;

/** Session gives the id; the ADHD flag lives on the profile document, so both are needed. */
async function learner(): Promise<UserDoc | null> {
  const session = await currentUser();
  if (!session) return null;
  const { resource } = await users().item(session.userId, session.userId).read<UserDoc>();
  if (!resource) return null;
  return migrateUserDoc(resource).doc;
}

export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ thoughts: [], reason: "no-database" });
  await ensureContainers();

  const user = await learner();
  if (!isAdhdLearner(user?.profile)) return NextResponse.json({ thoughts: [], reason: "not-adhd" });

  const { resources } = await thoughts().items
    .query<ThoughtDoc>({
      // Newest first, ordered in the query rather than in JS: sorting after fetching only sorts the
      // page that came back, which is the wrong list the moment there is more than one page.
      query: "SELECT * FROM c WHERE c.userId = @u ORDER BY c.createdAt DESC",
      parameters: [{ name: "@u", value: user!.id }],
    })
    .fetchAll();

  return NextResponse.json({
    thoughts: resources.map((t) => ({ id: t.id, text: t.text, topic: t.topic, createdAt: t.createdAt })),
  });
}

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "no-database" }, { status: 503 });
  await ensureContainers();

  const user = await learner();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  // Checked on the server, not only in the UI: a check that exists only in the client is not a check.
  if (!isAdhdLearner(user.profile)) return NextResponse.json({ error: "not-adhd" }, { status: 403 });

  let body: { text?: unknown; topic?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad-body" }, { status: 400 });
  }

  const text = String(body.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });

  // A ceiling, so a stuck client cannot turn a scratchpad into an unbounded write loop.
  const { resources: existing } = await thoughts().items
    .query<{ id: string }>({
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.userId = @u",
      parameters: [{ name: "@u", value: user.id }],
    })
    .fetchAll();
  if (Number(existing[0] ?? 0) >= MAX_THOUGHTS) {
    return NextResponse.json({ error: "too-many" }, { status: 429 });
  }

  const doc: ThoughtDoc = {
    id: randomUUID(),
    userId: user.id,
    text,
    topic: typeof body.topic === "string" ? body.topic.slice(0, 120) : null,
    createdAt: new Date().toISOString(),
  };
  await thoughts().items.create(doc);
  return NextResponse.json({ id: doc.id, text: doc.text, topic: doc.topic, createdAt: doc.createdAt });
}

export async function DELETE(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "no-database" }, { status: 503 });
  await ensureContainers();

  const user = await learner();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  if (!isAdhdLearner(user.profile)) return NextResponse.json({ error: "not-adhd" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "no-id" }, { status: 400 });

  try {
    // The partition key is the OWNER's id, so this can only ever reach the caller's own thought —
    // another learner's id in the query string addresses a document that does not exist here.
    await thoughts().item(id, user.id).delete();
  } catch {
    // Already gone is the outcome the caller wanted. Deleting twice is not an error.
  }
  return NextResponse.json({ ok: true });
}
