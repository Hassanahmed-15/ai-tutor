import { NextResponse } from "next/server";
import { databaseConfigured, ensureContainers } from "@/lib/db/cosmos";
import { createSession, setAuthCookies, signAccessToken, verifyPassword } from "@/lib/auth";
import { findUserByEmail } from "../signup/route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return NextResponse.json({ error: "Sign-in is unavailable — no database is configured." }, { status: 503 });
  }
  await ensureContainers();

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const user = await findUserByEmail(email);

  /**
   * One message for both failures, and the hash is verified even when no such user exists.
   *
   * Distinguishing "no account" from "wrong password" turns this form into an account-enumeration
   * oracle. Returning early on a missing user leaks the same fact through timing — that path would
   * finish in microseconds while a real check spends ~100ms inside argon2.
   */
  const ok = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", password);

  if (!user || !ok) {
    return NextResponse.json({ error: "That email and password do not match." }, { status: 401 });
  }

  await setAuthCookies(await signAccessToken(user.id, user.email), await createSession(user.id));
  return NextResponse.json({ id: user.id, email: user.email, onboarded: Boolean(user.onboardedAt) });
}
