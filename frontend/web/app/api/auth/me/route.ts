import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/lib/db/client";
import { profiles, users } from "@/lib/db/schema";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is signed in, plus their learning profile.
 *
 * Returns 200 with `user: null` rather than 401 when nobody is signed in — this is the question
 * "is anyone here?", and a browser console full of 401s on every anonymous page load makes real
 * errors harder to see.
 */
export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ user: null, databaseConfigured: false });
  const session = await currentUser();
  if (!session) return NextResponse.json({ user: null, databaseConfigured: true });

  const [user] = await db().select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return NextResponse.json({ user: null, databaseConfigured: true });
  const [profile] = await db().select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);

  return NextResponse.json({
    databaseConfigured: true,
    user: { id: user.id, email: user.email, onboarded: Boolean(user.onboardedAt) },
    profile: profile ?? null,
  });
}
