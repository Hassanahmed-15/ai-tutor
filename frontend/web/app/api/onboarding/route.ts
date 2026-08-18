import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/lib/db/client";
import { profiles, users } from "@/lib/db/schema";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

const VISION = new Set(["blind", "low-vision", "normal"]);

/** Accepts true/false/null — null means "not answered", which is NOT the same as "no". */
function tri(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return NextResponse.json({ error: "No database is configured." }, { status: 503 });
  }
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : null;
  const ageRaw = Number(body.age);
  // Rejecting an implausible age quietly (null) rather than erroring: a mistyped age should not
  // block someone from starting to learn.
  const age = Number.isInteger(ageRaw) && ageRaw >= 5 && ageRaw <= 120 ? ageRaw : null;
  const vision = typeof body.vision === "string" && VISION.has(body.vision) ? body.vision : null;

  const values = {
    displayName,
    age,
    vision,
    adhd: tri(body.adhd),
    dyslexia: tri(body.dyslexia),
    hearing: tri(body.hearing),
    reducedMotion: tri(body.reducedMotion),
    captions: tri(body.captions),
    slowerPace: tri(body.slowerPace),
    simplerLanguage: tri(body.simplerLanguage),
    notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null,
    updatedAt: new Date(),
  };

  // Upsert so revisiting onboarding edits the profile rather than failing on the primary key.
  await db()
    .insert(profiles)
    .values({ userId: session.userId, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: values });

  await db().update(users).set({ onboardedAt: new Date() }).where(eq(users.id, session.userId));
  return NextResponse.json({ ok: true });
}
