import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createSession, setAuthCookies, signAccessToken, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return NextResponse.json({ error: "Sign-in is unavailable — no database is configured." }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const rows = await db().select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  /**
   * One message for both "no such account" and "wrong password", and the hash is verified even
   * when the user does not exist.
   *
   * Distinguishing them turns the login form into an account-enumeration oracle, and returning
   * early on a missing user leaks the same information through timing — the no-user path would
   * finish in microseconds while a real check spends ~100ms in argon2.
   */
  const ok = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", password);

  if (!user || !ok) {
    return NextResponse.json({ error: "That email and password do not match." }, { status: 401 });
  }

  const refresh = await createSession(user.id);
  await setAuthCookies(await signAccessToken(user.id, user.email), refresh);
  return NextResponse.json({ id: user.id, email: user.email, onboarded: Boolean(user.onboardedAt) });
}
