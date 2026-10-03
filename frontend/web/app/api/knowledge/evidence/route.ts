import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { updateLearnerMemory } from "@/lib/learnerMemoryStore";
import { edgeConfidence } from "@/lib/knowledge/graph";
import { recordAnswer } from "@/lib/knowledge/overlay";
import { edgesTouching, loadLectureKnowledge } from "@/lib/knowledge/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * EVIDENCE OF WHAT THE STUDENT KNOWS: a Predict-it answer, a drawing Aria checked, a review on the
 * knowledge map. Moves mastery on the concepts that board teaches (knowledge tracing), credits their
 * prerequisites on a correct answer, and reschedules their reviews (lib/knowledge/overlay.ts).
 *
 * Its own route, not the lecture's interaction route: that one may refuse an adaptation near the
 * end of a lecture, and an answer is evidence wherever in the lecture it comes.
 *
 * POST {session, sequence, kind: "quiz" | "drawing" | "review", correct, options?}
 *   or {concepts: [{key, label}], kind: "review", correct, topic} for a concept reviewed on its own.
 */
export async function POST(request: Request) {
  const auth = await currentUser();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = body.kind === "quiz" || body.kind === "drawing" || body.kind === "review" ? body.kind : null;
  if (!kind || typeof body.correct !== "boolean") return NextResponse.json({ error: "kind and correct are required." }, { status: 400 });

  let concepts: Array<{ key: string; label: string }> = [];
  let topic = typeof body.topic === "string" ? body.topic.slice(0, 200) : "";
  const session = typeof body.session === "string" && /^[a-f0-9-]{36}$/.test(body.session) ? body.session : null;
  if (session) {
    const doc = await loadLectureKnowledge(session, auth.userId);
    if (!doc) return NextResponse.json({ ok: true, recorded: 0 });
    const board = doc.beats.find((b) => b.sequence === Math.floor(Number(body.sequence)));
    concepts = (board?.concepts ?? []).map((key) => ({ key, label: doc.concepts.find((c) => c.key === key)?.label ?? key }));
    topic = topic || doc.topic;
  } else if (Array.isArray(body.concepts)) {
    concepts = body.concepts
      .filter((c): c is { key: string; label: string } => Boolean(c) && typeof (c as { key?: unknown }).key === "string")
      .slice(0, 6)
      .map((c) => ({ key: c.key.slice(0, 80), label: String(c.label ?? c.key).slice(0, 120) }));
  }
  if (concepts.length === 0) return NextResponse.json({ ok: true, recorded: 0 });

  const options = Math.max(2, Math.min(6, Math.floor(Number(body.options)) || 3));
  const guess = kind === "quiz" ? 1 / options : kind === "drawing" ? 0.1 : 0.35;
  const edges = body.correct ? await edgesTouching(concepts.map((c) => c.key)).catch(() => []) : [];
  const keys = new Set(concepts.map((c) => c.key));
  const prerequisites = edges.filter((e) => e.type === "needs" && keys.has(e.from)).map((e) => ({ key: e.to, confidence: edgeConfidence(e.support) }));
  await updateLearnerMemory(auth.userId, (memory) => recordAnswer(memory, { concepts, correct: body.correct as boolean, guess, topic, source: kind === "quiz" ? "quiz" : kind, prerequisites }));
  return NextResponse.json({ ok: true, recorded: concepts.length });
}
