import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { databaseConfigured } from "@/lib/db/cosmos";
import { applyMemoryEdit, emptyMemory, isMemoryEdit, personaIsStale } from "@/lib/learnerModel";
import { deleteLearnerMemory, loadLearnerMemory, updateLearnerMemory } from "@/lib/learnerMemoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "What Aria remembers about you": read it, correct it, or clear it.
 *
 * The memory is the student's, so every operation here is theirs to perform — there is no
 * admin-only field and nothing hidden from this response. Signed out is not an error: an anonymous
 * student simply has no memory, exactly as before this existed.
 */
export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ memory: emptyMemory(), persisted: false });
  const session = await currentUser();
  if (!session) return NextResponse.json({ memory: emptyMemory(), persisted: false });
  const memory = await loadLearnerMemory(session.userId);
  // Stale: evidence has arrived since the portrait was written (or there is no portrait yet). The
  // panel refreshes it on sight; nothing here waits on a model.
  return NextResponse.json({ memory, persisted: true, personaStale: personaIsStale(memory) });
}

export async function PATCH(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Memory needs the database." }, { status: 503 });
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in to edit what Aria remembers." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const edits = Array.isArray(body.edits) ? body.edits : [body];
  if (edits.length === 0 || edits.length > 50 || !edits.every(isMemoryEdit)) {
    return NextResponse.json({ error: "Unrecognised edit." }, { status: 400 });
  }
  const memory = await updateLearnerMemory(session.userId, (current) => edits.reduce((m, edit) => applyMemoryEdit(m, edit), current));
  return NextResponse.json({ memory });
}

export async function DELETE() {
  if (!databaseConfigured()) return NextResponse.json({ ok: true });
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in to clear what Aria remembers." }, { status: 401 });
  await deleteLearnerMemory(session.userId);
  return NextResponse.json({ ok: true, memory: emptyMemory() });
}
