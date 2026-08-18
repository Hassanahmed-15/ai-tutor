import { NextResponse } from "next/server";
import { databaseConfigured, ensureContainers, users, type UserDoc } from "@/lib/db/cosmos";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

const VISION = new Set(["blind", "low-vision", "normal"]);

/** true/false/null — null means "not answered", which is NOT the same as "no". */
function tri(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "No database is configured." }, { status: 503 });
  await ensureContainers();

  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const ageRaw = Number(body.age);

  const profile: UserDoc["profile"] = {
    displayName: typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) || null : null,
    // An implausible age is dropped quietly rather than erroring: a typo should not stop someone
    // from starting to learn.
    age: Number.isInteger(ageRaw) && ageRaw >= 5 && ageRaw <= 120 ? ageRaw : null,
    vision: typeof body.vision === "string" && VISION.has(body.vision) ? body.vision : null,
    adhd: tri(body.adhd),
    dyslexia: tri(body.dyslexia),
    hearing: tri(body.hearing),
    reducedMotion: tri(body.reducedMotion),
    captions: tri(body.captions),
    slowerPace: tri(body.slowerPace),
    simplerLanguage: tri(body.simplerLanguage),
    notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) || null : null,
    updatedAt: new Date().toISOString(),
  };

  // Read-then-replace rather than a patch, so revisiting onboarding edits the profile in place and
  // the rest of the user document is preserved verbatim.
  const { resource: user } = await users().item(session.userId, session.userId).read<UserDoc>();
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  await users()
    .item(session.userId, session.userId)
    .replace({ ...user, profile, onboardedAt: user.onboardedAt ?? new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
