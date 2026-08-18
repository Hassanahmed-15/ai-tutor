import { NextResponse } from "next/server";
import { databaseConfigured, ensureContainers, migrateUserDoc, users, type UserDoc } from "@/lib/db/cosmos";
import { currentUser } from "@/lib/auth";
import { InvalidProfileValue, mergeProfile } from "@/app/api/onboarding/route";
import { findUserByUsername, normaliseUsername, usernameError } from "@/app/api/auth/signup/route";

export const runtime = "nodejs";

/**
 * Settings saves.
 *
 * Separate from /api/onboarding even though both write the same document, because they answer
 * different questions. Onboarding is a one-time gate that stamps `onboardedAt` and expects a full
 * set of answers; this is a partial edit that must never re-open that gate, and it additionally
 * owns the username, which onboarding does not touch.
 *
 * PATCH rather than POST because it is exactly that: fields absent from the body keep their
 * current values (see mergeProfile).
 */
export async function PATCH(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "No database is configured." }, { status: 503 });
  await ensureContainers();

  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const { resource: raw } = await users().item(session.userId, session.userId).read<UserDoc>();
  if (!raw) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  // Normalise first, so a legacy document is edited in its current shape rather than having the
  // dead vision/adhd keys written straight back alongside the new ones.
  const { doc: user } = migrateUserDoc(raw);

  let username = user.username;
  if (Object.hasOwn(body, "username")) {
    const next = normaliseUsername(body.username);
    // Only validate and check uniqueness when it actually changed. Otherwise saving any unrelated
    // setting would cost a cross-partition query, and would fail for anyone whose existing
    // username predates the current rules.
    if (next !== user.username) {
      const problem = usernameError(next);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      if (await findUserByUsername(next)) {
        return NextResponse.json({ error: "That username is taken. Try another." }, { status: 409 });
      }
      username = next;
    }
  }

  let profile: NonNullable<UserDoc["profile"]>;
  try {
    profile = mergeProfile(body, user.profile);
  } catch (err) {
    if (err instanceof InvalidProfileValue) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  await users().item(session.userId, session.userId).replace({ ...user, username, profile });

  return NextResponse.json({ ok: true, username, profile });
}
