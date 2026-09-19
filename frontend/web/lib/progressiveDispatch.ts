import "server-only";

import { dispatchProgressiveTasks } from "./progressiveLectureQueue";
import { progressiveBeats, upsertProgressiveBeat } from "./progressiveLectureStore";
import type { ProgressiveBeatDoc, ProgressiveLectureSessionDoc } from "./progressiveLectureTypes";
import { dueSequences, lookaheadFromEnv } from "./progressiveWindow";

/**
 * Queue every beat that has come within reach of the student (lib/progressiveWindow.ts).
 *
 * Called whenever the answer can change: when the plan is made, when a beat finishes, when the
 * student moves to a new beat, and after an adaptation resets the unplayed beats. Because "due" is
 * worked out from every beat's state each time, a beat that one caller missed is picked up by the
 * next — there is no lane that has to remember it.
 *
 * Each due beat is RESERVED ("generating", stamped now) before its task is queued, so a second
 * caller arriving a moment later sees it in flight and does not queue it again. Without that, two
 * beats finishing together would each pay for the same next beat.
 *
 * `session` must be current: its playhead and plan revision decide what is due.
 */
export async function dispatchDueBeats(session: ProgressiveLectureSessionDoc): Promise<number[]> {
  if (session.status === "failed" || session.plan.length === 0) return [];
  const docs = await progressiveBeats(session.id);
  const { lookahead, animationLookahead } = lookaheadFromEnv();
  const due = dueSequences({
    planLength: session.plan.length,
    playhead: session.playhead,
    isAnimation: (sequence) => session.plan[sequence]?.visualKind === "react-animation",
    beats: docs.map((doc) => ({ sequence: doc.sequence, state: doc.state, updatedAt: doc.updatedAt })),
    now: Date.now(),
    lookahead,
    animationLookahead,
  });
  if (due.length === 0) return [];

  const now = new Date().toISOString();
  const bySequence = new Map(docs.map((doc) => [doc.sequence, doc]));
  await Promise.all(due.map((sequence) => {
    const existing = bySequence.get(sequence);
    const reserved: ProgressiveBeatDoc = {
      id: existing?.id ?? `${session.id}:${sequence}`,
      sessionId: session.id,
      userId: session.userId,
      sequence,
      revision: session.planRevision,
      state: "generating",
      enrichmentState: "pending",
      beat: existing?.beat ?? null,
      fallbackUsed: false,
      costUsd: existing?.costUsd ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      error: null,
    };
    return upsertProgressiveBeat(reserved);
  }));

  await dispatchProgressiveTasks(due.map((sequence) => ({
    version: 1 as const,
    type: "generate-beat" as const,
    sessionId: session.id,
    userId: session.userId,
    sequence,
    revision: session.planRevision,
  })));
  console.log(`[timing] kind=window session=${session.id} playhead=${session.playhead} dispatched=${due.join(",")}`);
  return due;
}
