import { NextResponse } from "next/server";
import { databaseConfigured, ensureContainers, migrateUserDoc, users, type UserDoc } from "@/lib/db/cosmos";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is signed in, plus their learning profile.
 *
 * 200 with `user: null` rather than 401 when nobody is signed in — this asks "is anyone here?",
 * and a console full of 401s on every anonymous page load buries the errors that matter.
 *
 * The profile is embedded in the user document, so this is one point read rather than the join
 * the Postgres version needed.
 */
export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ user: null, databaseConfigured: false });
  await ensureContainers();

  const session = await currentUser();
  if (!session) return NextResponse.json({ user: null, databaseConfigured: true });

  const { resource: raw } = await users().item(session.userId, session.userId).read<UserDoc>();
  if (!raw) return NextResponse.json({ user: null, databaseConfigured: true });

  // Accounts created before usernames and the single-profile model are upgraded the first time
  // they are read, so every later route can assume the current shape. Persisting the result is
  // best-effort: a failed write must not stop someone signing in, and the next read retries.
  const { doc: user, changed } = migrateUserDoc(raw);
  if (changed) {
    await users().item(session.userId, session.userId).replace(user).catch(() => {});
  }

  return NextResponse.json({
    databaseConfigured: true,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      onboarded: Boolean(user.onboardedAt),
      createdAt: user.createdAt,
    },
    profile: user.profile,
  });
}
