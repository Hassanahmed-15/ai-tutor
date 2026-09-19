import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { databaseConfigured } from "@/lib/db/cosmos";
import { loadLearnerMemory, updateLearnerMemory } from "@/lib/learnerMemoryStore";
import { personaIsStale } from "@/lib/learnerModel";
import { generatePersona } from "@/lib/learnerPersona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Write (or rewrite) "what Aria thinks about you" from everything in memory, and save it.
 *
 * Triggered by the student — the panel when it sees a stale portrait, the Refresh button, and the
 * page after a lesson is planned — never by a background job, so nothing depends on server work
 * outliving a request. `{ force: false }` skips the model call when the portrait is current.
 */
export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Memory needs the database." }, { status: 503 });
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in and Aria will get to know you." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is not set." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const force = body.force !== false;

  const current = await loadLearnerMemory(session.userId);
  if (!force && !personaIsStale(current)) return NextResponse.json({ memory: current, personaStale: false, costUsd: 0, refreshed: false });

  try {
    const { memory: written, costUsd, changed } = await generatePersona(current);
    if (!changed) return NextResponse.json({ memory: current, personaStale: personaIsStale(current), costUsd, refreshed: false });
    // Re-read under the etag: evidence that arrived while the model was writing is kept, and the
    // fresh portrait (with its cleaned concepts) is laid over it.
    const memory = await updateLearnerMemory(session.userId, (latest) => ({
      ...latest,
      concepts: written.concepts,
      persona: written.persona,
      updatedAt: written.updatedAt > latest.updatedAt ? written.updatedAt : latest.updatedAt,
    }));
    return NextResponse.json({ memory, personaStale: personaIsStale(memory), costUsd, refreshed: true });
  } catch (error) {
    console.error("[learner-memory] persona generation failed:", error);
    return NextResponse.json({ error: "Aria couldn't write this just now. Try again in a moment." }, { status: 502 });
  }
}
