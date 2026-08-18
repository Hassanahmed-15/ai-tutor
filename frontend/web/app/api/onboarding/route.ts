import { NextResponse } from "next/server";
import {
  ACCESSIBILITY_PROFILES,
  databaseConfigured,
  ensureContainers,
  users,
  type AccessibilityProfile,
  type UserDoc,
} from "@/lib/db/cosmos";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

/** true/false/null — null means "not answered", which is NOT the same as "no". */
function tri(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Thrown for a value that is neither a valid profile nor an explicit "unset".
 *
 * This has to be an error rather than a quiet fall back to null. Null means "no accommodation", so
 * silently coercing a typo'd or stale client value into it would switch a blind learner's lecture
 * back to the visual default — the exact failure this feature exists to prevent. Refusing the whole
 * save leaves the stored profile untouched, which is the safe outcome.
 */
export class InvalidProfileValue extends Error {}

function accessibility(value: unknown): AccessibilityProfile | null {
  // Explicitly clearing the profile is legitimate, and distinct from sending nonsense.
  if (value === null) return null;
  if (typeof value === "string" && (ACCESSIBILITY_PROFILES as string[]).includes(value)) {
    return value as AccessibilityProfile;
  }
  throw new InvalidProfileValue("That is not a valid accessibility profile.");
}

/**
 * Build the profile from a request body, using `existing` for anything the body omits.
 *
 * The merge is what lets settings send one changed field instead of the whole profile: an absent
 * key keeps its stored value, so a save cannot wipe fields the screen never showed.
 *
 * Throws InvalidProfileValue if `accessibility` is present but not a real profile — see above for
 * why that is refused rather than coerced.
 */
export function mergeProfile(body: Record<string, unknown>, existing: UserDoc["profile"]): NonNullable<UserDoc["profile"]> {
  const has = (k: string) => Object.hasOwn(body, k);
  const ageRaw = Number(body.age);

  return {
    displayName: has("displayName")
      ? (typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) || null : null)
      : existing?.displayName ?? null,
    // An implausible age is dropped quietly rather than erroring: a typo should not stop someone
    // from starting to learn.
    age: has("age")
      ? (Number.isInteger(ageRaw) && ageRaw >= 5 && ageRaw <= 120 ? ageRaw : null)
      : existing?.age ?? null,
    accessibility: has("accessibility") ? accessibility(body.accessibility) : existing?.accessibility ?? null,
    reducedMotion: has("reducedMotion") ? tri(body.reducedMotion) : existing?.reducedMotion ?? null,
    captions: has("captions") ? tri(body.captions) : existing?.captions ?? null,
    slowerPace: has("slowerPace") ? tri(body.slowerPace) : existing?.slowerPace ?? null,
    simplerLanguage: has("simplerLanguage") ? tri(body.simplerLanguage) : existing?.simplerLanguage ?? null,
    notes: has("notes")
      ? (typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) || null : null)
      : existing?.notes ?? null,
    updatedAt: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "No database is configured." }, { status: 503 });
  await ensureContainers();

  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  // Read-then-replace rather than a patch, so revisiting onboarding edits the profile in place and
  // the rest of the user document is preserved verbatim.
  const { resource: user } = await users().item(session.userId, session.userId).read<UserDoc>();
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  let profile: NonNullable<UserDoc["profile"]>;
  try {
    profile = mergeProfile(body, user.profile);
  } catch (err) {
    if (err instanceof InvalidProfileValue) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  await users()
    .item(session.userId, session.userId)
    .replace({ ...user, profile, onboardedAt: user.onboardedAt ?? new Date().toISOString() });

  return NextResponse.json({ ok: true, profile });
}
