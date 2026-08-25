import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  ADHD_BOARD,
  databaseConfigured,
  ensureContainers,
  leaderboard,
  users,
  migrateUserDoc,
  type LeaderboardDoc,
  type UserDoc,
} from "@/lib/db/cosmos";
import { isAdhdLearner } from "@/lib/adhd/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ADHD leaderboard.
 *
 * GATED SERVER-SIDE, NOT JUST IN THE UI. The page only renders the board for an ADHD learner, but a
 * check that exists only in the client is not a check — anyone can POST to this route directly. So
 * the profile is re-read from Cosmos here and `isAdhdLearner` decides, using the same predicate the
 * UI uses so the two can never drift apart.
 *
 * The board is a single Cosmos partition (`/board`, always ADHD_BOARD) precisely because it is read
 * on every visit to the prompt page. A query that cannot name its partition fans out across all of
 * them, which is how a leaderboard quietly becomes the most expensive thing in the product.
 */

const TOP_N = 20;

/** The signed-in learner's user document, or null. */
async function signedInUser(): Promise<UserDoc | null> {
  const session = await currentUser();
  if (!session) return null;
  const { resource } = await users().item(session.userId, session.userId).read<UserDoc>();
  if (!resource) return null;
  return migrateUserDoc(resource).doc;
}

export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ entries: [], reason: "no-database" });
  await ensureContainers();

  const user = await signedInUser();
  // A learner who is not on the ADHD track is not shown a board they can never appear on.
  if (!isAdhdLearner(user?.profile)) return NextResponse.json({ entries: [], reason: "not-adhd" });

  const { resources } = await leaderboard().items
    .query<LeaderboardDoc>({
      // ORDER BY in the query, not in JS: sorting after fetching would only sort the page that came
      // back, which silently gives the wrong top-N the moment there are more rows than TOP_N.
      query: "SELECT * FROM c WHERE c.board = @b ORDER BY c.xp DESC OFFSET 0 LIMIT @n",
      parameters: [{ name: "@b", value: ADHD_BOARD }, { name: "@n", value: TOP_N }],
    })
    .fetchAll();

  return NextResponse.json({
    entries: resources.map((r, i) => ({
      rank: i + 1,
      userId: r.id,
      username: r.username,
      displayName: r.displayName,
      xp: r.xp,
      sessions: r.sessions,
      isYou: r.id === user!.id,
    })),
  });
}

/** Add one session's score to the signed-in ADHD learner's running total. */
export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  await ensureContainers();

  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAdhdLearner(user.profile)) {
    return NextResponse.json({ error: "The leaderboard is for the ADHD track." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const gained = Number(body.xp);
  // Clamped, and negatives rejected outright: this value arrives from the browser, and a leaderboard
  // that accepts whatever a client claims is a leaderboard of whoever edited the request.
  if (!Number.isFinite(gained) || gained < 0) {
    return NextResponse.json({ error: "xp must be a non-negative number." }, { status: 400 });
  }
  const award = Math.min(Math.round(gained), 10_000);

  const existing = await leaderboard()
    .item(user.id, ADHD_BOARD)
    .read<LeaderboardDoc>()
    .then((r) => r.resource ?? null)
    .catch(() => null);

  const doc: LeaderboardDoc = {
    id: user.id,
    board: ADHD_BOARD,
    username: user.username,
    displayName: user.profile?.displayName ?? null,
    xp: (existing?.xp ?? 0) + award,
    sessions: (existing?.sessions ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  await leaderboard().items.upsert(doc);

  return NextResponse.json({ xp: doc.xp, sessions: doc.sessions });
}
