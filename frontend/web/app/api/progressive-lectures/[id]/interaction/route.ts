import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { dispatchDueBeats } from "@/lib/progressiveDispatch";
import { prepareAdaptiveRevision, progressiveBeat, progressiveBeats, progressiveSession, recordLearnerInteraction } from "@/lib/progressiveLectureStore";
import type { LearnerInteraction, LearnerInteractionKind } from "@/lib/progressiveLectureTypes";
import { addExcerpts, applyCheckpoint, applyLectureProgress, LEARNER_SIGNALS, recordSignal, type LearnerSignal } from "@/lib/learnerModel";
import { updateLearnerMemory } from "@/lib/learnerMemoryStore";

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
  const previousPlayhead = session.playhead;
  const next = await recordLearnerInteraction(session, interaction);

  /*
   * WHAT THE LECTURE TEACHES ARIA ABOUT THE STUDENT, recorded here on the server as it happens.
   *
   * Memory used to learn only from the planning conversation, so a student who watched half a
   * lecture came back to "Nothing yet". Now every beat the student moves past is a concept they have
   * been taught, and every checkpoint answer is evidence about that beat's concept — recorded as it
   * happens, so leaving early loses nothing. Best effort: memory must never fail an interaction.
   */
  const ended = body.ended === true;
  const watchedUpTo = ended ? requestedPlayhead + 1 : requestedPlayhead;
  const watchedSequences = interaction.kind === "playhead" && watchedUpTo > Math.max(previousPlayhead, 0)
    ? next.plan.slice(Math.max(previousPlayhead, 0), watchedUpTo).map((planned) => planned.sequence)
    : [];
  const checkpointSequence = interaction.kind === "checkpoint" && typeof interaction.correct === "boolean"
    ? Math.max(0, requestedPlayhead)
    : null;
  // The concept a beat taught: its key term when the beat named one ("Antigen"), else its title.
  // Titles are shortened for display and read poorly as concepts ("Vaccines Train the Immune: Try").
  const docs = watchedSequences.length || checkpointSequence !== null ? await progressiveBeats(id).catch(() => []) : [];
  const conceptOf = (sequence: number) =>
    docs.find((doc) => doc.sequence === sequence)?.beat?.definitionTerm?.trim() || next.plan[sequence]?.title || "";
  const watched = watchedSequences.map((sequence) => ({ concept: conceptOf(sequence) })).filter((w) => w.concept);
  const checkpointConcept = checkpointSequence !== null ? conceptOf(checkpointSequence) || undefined : undefined;
  // A question asked mid-lecture is the student in their own words: it goes into the portrait.
  const asked = interaction.kind === "question" && interaction.detail?.trim() ? interaction.detail.trim() : null;
  // And what they DID — asked for code, to go deeper, for simpler — tallied: it is who they are.
  const signal = (LEARNER_SIGNALS as string[]).includes(interaction.kind) ? (interaction.kind as LearnerSignal) : null;
  if (watched.length > 0 || checkpointConcept || asked || signal) {
    await updateLearnerMemory(auth.userId, (memory) => {
      let updated = applyLectureProgress(memory, next.topic, watched);
      if (checkpointConcept) updated = applyCheckpoint(updated, checkpointConcept, interaction.correct === true, next.topic);
      if (asked) updated = addExcerpts(updated, [{ source: "question", topic: next.topic, text: asked }]);
      if (signal) updated = recordSignal(updated, signal);
      return updated;
    }).catch((error) => console.error("[learner-memory] could not record lecture progress:", error));
  }
  if (adaptive) await prepareAdaptiveRevision(next, firstMutable);
  /*
   * Every interaction can move the generation window: a playhead post because the student moved
   * on, an adaptive one because it reset the unplayed beats. Queue whatever is now due
   * (lib/progressiveWindow.ts) — including every reset beat in reach, which the old two-beat
   * re-queue left behind.
   */
  await dispatchDueBeats(next);
  if (!adaptive && requestedPlayhead >= 0 && requestedPlayhead + 1 < next.plan.length) {
    // The player only moves onto finished beats, so the beat being played is always ready. The
    // signal worth logging is the NEXT one: if it is not ready as the student starts this beat,
    // they will wait unless it finishes within this beat's running time. Logged so the lookahead
    // can be tuned from real data rather than guessed.
    const upcoming = await progressiveBeat(id, requestedPlayhead + 1);
    if (!upcoming || upcoming.state !== "ready") {
      console.log(`[timing] kind=stall-risk session=${id} playhead=${requestedPlayhead} next=${upcoming?.state ?? "missing"}`);
    }
  }
  return NextResponse.json({ ok: true, adapted: adaptive, planRevision: next.planRevision, frozenThrough: next.frozenThrough });
}
