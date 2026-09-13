import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { dispatchProgressiveTasks } from "@/lib/progressiveLectureQueue";
import { prepareAdaptiveRevision, progressiveSession, recordLearnerInteraction } from "@/lib/progressiveLectureStore";
import type { LearnerInteraction, LearnerInteractionKind } from "@/lib/progressiveLectureTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: LearnerInteractionKind[] = ["playhead", "deeper", "simpler", "more-examples", "code", "checkpoint", "question"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await currentUser();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  const session = await progressiveSession(auth.userId, id);
  if (!session) return NextResponse.json({ error: "Progressive lecture not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!KINDS.includes(body.kind as LearnerInteractionKind)) {
    return NextResponse.json({ error: "Invalid interaction kind." }, { status: 400 });
  }
  const adaptive = body.kind !== "playhead";
  const requestedPlayhead = Math.max(-1, Math.min(session.plan.length - 1, Math.floor(Number(body.playhead) || 0)));
  const firstMutable = Math.max(session.frozenThrough + 1, requestedPlayhead + 2);
  if (adaptive && firstMutable >= session.plan.length) {
    return NextResponse.json({ ok: true, adapted: false, reason: "No unplayed beats remain." });
  }
  if (adaptive && session.planRevision >= 8) {
    return NextResponse.json({ error: "This lecture has reached its adaptation limit." }, { status: 429 });
  }
  if (adaptive && session.lastAdaptedAt && Date.now() - Date.parse(session.lastAdaptedAt) < 5_000) {
    return NextResponse.json({ error: "Give Aria a moment to apply the previous change." }, { status: 429 });
  }
  const interaction: LearnerInteraction = {
    kind: body.kind as LearnerInteractionKind,
    playhead: requestedPlayhead,
    detail: typeof body.detail === "string" ? body.detail.slice(0, 500) : undefined,
    correct: typeof body.correct === "boolean" ? body.correct : undefined,
  };
  const next = await recordLearnerInteraction(session, interaction);
  if (adaptive) {
    await prepareAdaptiveRevision(next, firstMutable);
    // Preserve the rolling generation window during adaptation as well. Otherwise every rewritten
    // text beat is queued ahead of its sandbox enrichment.
    await dispatchProgressiveTasks(next.plan.slice(firstMutable, firstMutable + next.starterBeatCount).map((_, sequenceOffset) => ({
      version: 1 as const,
      type: "generate-beat" as const,
      sessionId: id,
      userId: auth.userId,
      sequence: firstMutable + sequenceOffset,
      revision: next.planRevision,
    })));
  }
  return NextResponse.json({ ok: true, adapted: adaptive, planRevision: next.planRevision, frozenThrough: next.frozenThrough });
}
