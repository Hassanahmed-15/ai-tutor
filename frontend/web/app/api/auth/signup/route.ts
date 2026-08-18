import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { databaseConfigured, ensureContainers, users, type UserDoc } from "@/lib/db/cosmos";
import { createSession, hashPassword, setAuthCookies, signAccessToken } from "@/lib/auth";

export const runtime = "nodejs";

/** Length beats composition rules, which mostly produce P@ssw0rd1. */
const MIN_PASSWORD = 10;

/**
 * Look a user up by email.
 *
 * This is a cross-partition query — users partition by `id`, not email — which is unavoidable when
 * the only thing a person types at sign-in is their address. It is bounded to one result and runs
 * once per auth attempt, so the RU cost is small; the alternative (a second container mapping
 * email to id) would add a write to every signup to save a few RU on login.
 */
export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  const { resources } = await users().items
    .query<UserDoc>({
      query: "SELECT TOP 1 * FROM c WHERE c.email = @e",
      parameters: [{ name: "@e", value: email }],
    })
    .fetchAll();
  return resources[0] ?? null;
}

/** Same cross-partition shape as the email lookup, and unavoidable for the same reason. */
export async function findUserByUsername(username: string): Promise<UserDoc | null> {
  const { resources } = await users().items
    .query<UserDoc>({
      query: "SELECT TOP 1 * FROM c WHERE c.username = @u",
      parameters: [{ name: "@u", value: username }],
    })
    .fetchAll();
  return resources[0] ?? null;
}

/**
 * Usernames are lowercased and restricted to letters, digits, underscore and hyphen.
 *
 * Case-folding matters for more than tidiness: without it "Hassan" and "hassan" are different
 * rows, so the uniqueness check passes and two people end up with names that look identical
 * everywhere they are displayed.
 */
const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;

export function normaliseUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function usernameError(username: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return "Usernames are 3–24 characters, using letters, numbers, hyphen or underscore.";
  }
  return null;
}

export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return NextResponse.json({ error: "Accounts are unavailable — no database is configured." }, { status: 503 });
  }
  await ensureContainers();

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const username = normaliseUsername(body.username);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const usernameProblem = usernameError(username);
  if (usernameProblem) {
    return NextResponse.json({ error: usernameProblem }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Use at least ${MIN_PASSWORD} characters — length matters more than symbols.` },
      { status: 400 },
    );
  }

  // Cosmos enforces unique keys only WITHIN a partition, and users partition by id, so the
  // container's unique-key policy cannot guarantee a unique email on its own. This check is the
  // real guard.
  if (await findUserByEmail(email)) {
    // Signup must say why it failed; the login route deliberately does not distinguish, so it
    // cannot be used to enumerate accounts.
    return NextResponse.json({ error: "That email is already registered. Try signing in." }, { status: 409 });
  }
  if (await findUserByUsername(username)) {
    return NextResponse.json({ error: "That username is taken. Try another." }, { status: 409 });
  }

  const doc: UserDoc = {
    id: randomUUID(),
    email,
    username,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
    onboardedAt: null,
    profile: null,
  };
  await users().items.create(doc);

  await setAuthCookies(await signAccessToken(doc.id, doc.email), await createSession(doc.id));
  return NextResponse.json({ id: doc.id, email: doc.email, onboarded: false }, { status: 201 });
}
