import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createSession, hashPassword, setAuthCookies, signAccessToken } from "@/lib/auth";

export const runtime = "nodejs";

/** Deliberately modest: length beats composition rules, which mostly produce P@ssw0rd1. */
const MIN_PASSWORD = 10;

export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return NextResponse.json({ error: "Accounts are unavailable — no database is configured." }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Use at least ${MIN_PASSWORD} characters — length matters more than symbols.` },
      { status: 400 },
    );
  }

  const existing = await db().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    // Says the address is taken, which is unavoidable for a signup form: the user must be told why
    // it failed. The login route deliberately does NOT distinguish, so an attacker cannot use it to
    // enumerate accounts.
    return NextResponse.json({ error: "That email is already registered. Try signing in." }, { status: 409 });
  }

  const [user] = await db()
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password) })
    .returning();

  const refresh = await createSession(user.id);
  await setAuthCookies(await signAccessToken(user.id, user.email), refresh);
  return NextResponse.json({ id: user.id, email: user.email, onboarded: false }, { status: 201 });
}
