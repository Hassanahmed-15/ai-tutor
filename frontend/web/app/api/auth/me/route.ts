import { NextResponse } from "next/server";
import { databaseConfigured, ensureContainers, users, type UserDoc } from "@/lib/db/cosmos";
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

  const { resource: user } = await users().item(session.userId, session.userId).read<UserDoc>();
  if (!user) return NextResponse.json({ user: null, databaseConfigured: true });

  return NextResponse.json({
    databaseConfigured: true,
    user: { id: user.id, email: user.email, onboarded: Boolean(user.onboardedAt) },
    profile: user.profile,
  });
}
