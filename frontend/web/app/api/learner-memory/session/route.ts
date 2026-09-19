import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { databaseConfigured } from "@/lib/db/cosmos";
import { addExcerpts, applyCheckpoint, mergeSessionProfile } from "@/lib/learnerModel";
import { updateLearnerMemory } from "@/lib/learnerMemoryStore";
import { sanitizeLearnerProfile } from "@/lib/learnerProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Evidence about the student, folded into long-term memory.
 *
 *   { profile, conversation? }        — a finished planning conversation (lib/learnerProfile.ts),
 *                                       plus the student's own answers, kept for their portrait
 *   { checkpoint: { concept, correct, topic } } — one checkpoint answer during a lecture
 *
 * Best effort by design: recording must never cost the student the lecture, so a signed-out student
 * or a missing database answers ok:false instead of failing.
 */
export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ ok: false, reason: "no-database" });
  const session = await currentUser();
  if (!session) return NextResponse.json({ ok: false, reason: "signed-out" });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const checkpoint = body.checkpoint as Record<string, unknown> | undefined;
  if (checkpoint && typeof checkpoint.concept === "string" && typeof checkpoint.correct === "boolean") {
    const topic = typeof checkpoint.topic === "string" ? checkpoint.topic.slice(0, 200) : "";
    await updateLearnerMemory(session.userId, (m) => applyCheckpoint(m, checkpoint.concept as string, checkpoint.correct as boolean, topic));
    return NextResponse.json({ ok: true });
  }

  const raw = body.profile as Record<string, unknown> | undefined;
  const topic = typeof raw?.topic === "string" ? raw.topic.trim().slice(0, 200) : "";
  if (!raw || !topic) return NextResponse.json({ error: "profile with a topic is required" }, { status: 400 });
  const profile = sanitizeLearnerProfile(raw, topic);
  const conversation = Array.isArray(body.conversation)
    ? body.conversation.filter((line): line is string => typeof line === "string").slice(-30).map((text) => ({ source: "planning" as const, topic, text }))
    : [];
  await updateLearnerMemory(session.userId, (m) => addExcerpts(mergeSessionProfile(m, profile), conversation));
  return NextResponse.json({ ok: true });
}
