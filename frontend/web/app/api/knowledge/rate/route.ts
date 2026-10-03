import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { updateLearnerMemory } from "@/lib/learnerMemoryStore";
import { rateConcept } from "@/lib/knowledge/overlay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The student's own rating of a concept on the knowledge map. POST {key, rating: "know" | "unsure" | null}. */
export async function POST(request: Request) {
  const auth = await currentUser();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const key = typeof body.key === "string" ? body.key.slice(0, 80) : "";
  const rating = body.rating === "know" || body.rating === "unsure" ? body.rating : null;
  if (!key) return NextResponse.json({ error: "key is required." }, { status: 400 });
  await updateLearnerMemory(auth.userId, (memory) => rateConcept(memory, key, rating));
  return NextResponse.json({ ok: true });
}
