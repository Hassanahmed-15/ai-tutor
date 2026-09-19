import "server-only";

import { randomUUID } from "node:crypto";
import {
  ensureContainers,
  learnerProfiles,
  progressiveLectureBeats,
  progressiveLectureSessions,
} from "./db/cosmos";
import {
  downloadJsonBlob,
  progressiveLectureInputBlobName,
  uploadJsonBlob,
} from "./blobStorage";
import type {
  LearnerInteraction,
  LearnerProfileSnapshot,
  ProgressiveBeatDoc,
  ProgressiveBeatPlan,
  ProgressiveLectureInput,
  ProgressiveLectureSessionDoc,
  ProgressiveLectureSnapshot,
} from "./progressiveLectureTypes";

type LearnerProfileDoc = LearnerProfileSnapshot & {
  id: string;
  userId: string;
  updatedAt: string;
};

export async function saveLearnerProfile(userId: string, profile: LearnerProfileSnapshot): Promise<void> {
  await ensureContainers();
  const doc: LearnerProfileDoc = {
    ...profile,
    id: userId,
    userId,
    updatedAt: new Date().toISOString(),
  };
  await learnerProfiles().items.upsert(doc);
}

export async function learnerProfileForUser(userId: string): Promise<LearnerProfileSnapshot | null> {
  await ensureContainers();
  const { resource } = await learnerProfiles().item(userId, userId).read<LearnerProfileDoc>();
  if (!resource) return null;
  return {
    expertise: resource.expertise,
    depth: resource.depth,
    goal: resource.goal,
    codeExamples: resource.codeExamples,
    preferredExamples: resource.preferredExamples,
    rationale: resource.rationale,
    confirmedAt: resource.confirmedAt,
  };
}

export async function createProgressiveLectureSession(
  userId: string,
  input: ProgressiveLectureInput,
): Promise<ProgressiveLectureSessionDoc> {
  await ensureContainers();
  const id = randomUUID();
  const now = new Date().toISOString();
  const inputBlobName = progressiveLectureInputBlobName(userId, id);
  await uploadJsonBlob(inputBlobName, input);
  const doc: ProgressiveLectureSessionDoc = {
    id,
    userId,
    topic: input.topic,
    sourceType: input.sourceType,
    mode: input.mode,
    learnerProfile: input.learnerProfile,
    inputBlobName,
    status: "planning",
    plan: [],
    planRevision: 1,
    adaptationNotes: [],
    lastAdaptedAt: null,
    playhead: -1,
    frozenThrough: 1,
    /*
     * TIME TO FIRST PLAY IS TWO BEATS, NOT THREE.
     *
     * This was 3 beats / 90 s of buffer, and since a beat plans for 35-55 s, both conditions
     * effectively demanded three fully enriched beats before a single word could be spoken.
     * Production timings show why that hurts: a react-animation beat's premium render measured
     * 66-206 s, so the student waited for the SLOWEST of three such renders before anything
     * started — while beats 4+ generate perfectly well during playback.
     *
     * Two beats is the smallest number that still protects against a stall: the first beat plays
     * (35-55 s of speech) while the third is generating, so the buffer keeps refilling ahead of the
     * playhead. Starting on one beat would leave no margin if beat 2 ran long.
     *
     * 50 s of buffer is the same idea expressed in time, so a lecture of unusually short beats
     * still waits for enough runway rather than for a count.
     */
    starterBeatCount: 2,
    starterBufferMs: 50_000,
    lectureId: null,
    costUsd: 0,
    createdAt: now,
    updatedAt: now,
    error: null,
  };
  await progressiveLectureSessions().items.create(doc);
  await saveLearnerProfile(userId, input.learnerProfile);
  return doc;
}

export async function progressiveSession(userId: string, sessionId: string): Promise<ProgressiveLectureSessionDoc | null> {
  await ensureContainers();
  const { resource } = await progressiveLectureSessions()
    .item(sessionId, userId)
    .read<ProgressiveLectureSessionDoc>();
  return resource ?? null;
}

export async function progressiveInput(session: ProgressiveLectureSessionDoc): Promise<ProgressiveLectureInput> {
  return downloadJsonBlob<ProgressiveLectureInput>(session.inputBlobName);
}

export async function replaceProgressiveSession(session: ProgressiveLectureSessionDoc): Promise<void> {
  await progressiveLectureSessions().item(session.id, session.userId).replace({
    ...session,
    updatedAt: new Date().toISOString(),
  });
}

export async function setProgressivePlan(
  session: ProgressiveLectureSessionDoc,
  plan: ProgressiveBeatPlan[],
): Promise<ProgressiveLectureSessionDoc> {
  const next: ProgressiveLectureSessionDoc = {
    ...session,
    plan,
    status: "generating",
    updatedAt: new Date().toISOString(),
    error: null,
  };
  await replaceProgressiveSession(next);
  return next;
}

export function progressiveBeatId(sessionId: string, sequence: number): string {
  return `${sessionId}:${sequence}`;
}

export async function progressiveBeat(sessionId: string, sequence: number): Promise<ProgressiveBeatDoc | null> {
  await ensureContainers();
  const { resource } = await progressiveLectureBeats()
    .item(progressiveBeatId(sessionId, sequence), sessionId)
    .read<ProgressiveBeatDoc>();
  return resource ?? null;
}

export async function upsertProgressiveBeat(doc: ProgressiveBeatDoc): Promise<void> {
  await ensureContainers();
  await progressiveLectureBeats().items.upsert({
    ...doc,
    updatedAt: new Date().toISOString(),
  });
}

export async function progressiveBeats(sessionId: string): Promise<ProgressiveBeatDoc[]> {
  await ensureContainers();
  const { resources } = await progressiveLectureBeats().items
    .query<ProgressiveBeatDoc>({
      query: "SELECT * FROM c WHERE c.sessionId = @sessionId AND IS_NUMBER(c.sequence) ORDER BY c.sequence ASC",
      parameters: [{ name: "@sessionId", value: sessionId }],
    }, { partitionKey: sessionId })
    .fetchAll();
  return resources;
}

export async function progressiveSnapshot(
  userId: string,
  sessionId: string,
): Promise<ProgressiveLectureSnapshot | null> {
  const session = await progressiveSession(userId, sessionId);
  if (!session) return null;
  const docs = await progressiveBeats(sessionId);
  const contiguous: ProgressiveBeatDoc[] = [];
  for (const doc of docs) {
    // A `playable` document still contains the temporary SVG used while premium enrichment runs.
    // Publishing it made a newly generated lecture look fundamentally different from its archived
    // replay. Only expose a beat after its chosen renderer has completed (or has definitively
    // fallen back), so live playback and history always consume the same payload.
    if (doc.sequence !== contiguous.length || !doc.beat || doc.state !== "ready" || doc.enrichmentState !== "ready") break;
    contiguous.push(doc);
  }
  const beats = contiguous.flatMap((doc) => (doc.beat ? [doc.beat] : []));
  const bufferedDurationMs = contiguous.reduce((sum, doc) => {
    const planned = session.plan[doc.sequence]?.estimatedDurationMs ?? 0;
    return sum + Math.max(planned, doc.beat?.draw?.durationMs ?? 0);
  }, 0);
  const starterTarget = Math.min(session.starterBeatCount, session.plan.length || session.starterBeatCount);
  const starterReady = contiguous.length >= starterTarget || bufferedDurationMs >= session.starterBufferMs;
  return {
    sessionId,
    snapshotVersion: [
      session.updatedAt,
      ...docs.map((doc) => `${doc.sequence}:${doc.revision}:${doc.state}:${doc.enrichmentState}:${doc.updatedAt}`),
    ].join("|"),
    topic: session.topic,
    status: session.status,
    planRevision: session.planRevision,
    plannedBeatCount: session.plan.length,
    contiguousReadyCount: contiguous.length,
    bufferedDurationMs,
    starterReady,
    complete: session.status === "complete",
    beats,
    lectureId: session.lectureId,
    costUsd: session.costUsd + docs.reduce((sum, doc) => sum + doc.costUsd, 0),
    error: session.error,
    createdAt: session.createdAt,
    beatStatus: session.plan.map((planned) => {
      const doc = docs.find((d) => d.sequence === planned.sequence);
      return {
        sequence: planned.sequence,
        title: planned.title,
        state: doc?.state ?? "not-started",
        visualKind: doc?.timing?.visualKind ?? planned.visualKind,
        timing: doc?.timing,
      };
    }),
  };
}

export async function recordLearnerInteraction(
  session: ProgressiveLectureSessionDoc,
  interaction: LearnerInteraction,
): Promise<ProgressiveLectureSessionDoc> {
  const note = interactionNote(interaction);
  const adaptive = interaction.kind !== "playhead";
  const next: ProgressiveLectureSessionDoc = {
    ...session,
    // A completed archive can still have unplayed beats. Reopen generation for an adaptive
    // revision; finalization will idempotently replace the same archived lecture package.
    status: adaptive && session.status === "complete" ? "generating" : session.status,
    playhead: Math.max(session.playhead, Math.floor(interaction.playhead)),
    frozenThrough: Math.max(session.frozenThrough, Math.floor(interaction.playhead) + 1),
    adaptationNotes: note ? [...session.adaptationNotes, note].slice(-20) : session.adaptationNotes,
    lastAdaptedAt: adaptive ? new Date().toISOString() : session.lastAdaptedAt,
    planRevision: adaptive ? session.planRevision + 1 : session.planRevision,
    updatedAt: new Date().toISOString(),
  };
  await replaceProgressiveSession(next);
  return next;
}

/**
 * Invalidates only not-yet-frozen beats so older queue messages cannot overwrite an adaptation.
 *
 * Reset beats are marked "planned", not "generating". They used to be marked "generating", which
 * says someone is writing them — so nothing queued them again, and any the route did not re-queue
 * itself were never written: the lecture stopped at the first one. "planned" means "due when in
 * reach", and lib/progressiveDispatch.ts queues them as the student approaches.
 */
export async function prepareAdaptiveRevision(
  session: ProgressiveLectureSessionDoc,
  firstMutable: number,
): Promise<void> {
  const docs = await progressiveBeats(session.id);
  await Promise.all(docs
    .filter((doc) => doc.sequence >= firstMutable && doc.revision < session.planRevision)
    .map((doc) => upsertProgressiveBeat({
      ...doc,
      revision: session.planRevision,
      state: "planned",
      enrichmentState: "pending",
      error: null,
    })));
}

function interactionNote(interaction: LearnerInteraction): string {
  switch (interaction.kind) {
    case "deeper":
      return "The learner asked for deeper technical detail in upcoming beats.";
    case "simpler":
      return "The learner asked for simpler language and smaller conceptual steps in upcoming beats.";
    case "more-examples":
      return "The learner asked for more worked and concrete examples in upcoming beats.";
    case "code":
      return "The learner asked for relevant code examples in upcoming beats.";
    case "checkpoint":
      return interaction.correct
        ? "The learner answered the latest checkpoint correctly; avoid unnecessary repetition."
        : "The learner struggled with the latest checkpoint; add remediation and a concrete example.";
    case "question":
      return interaction.detail
        ? `The learner asked: "${interaction.detail}" Infer what this reveals about their prior knowledge, confusion, desired depth, and interests. Adapt upcoming beats only where the evidence supports it, and do not repeat the immediate answer.`
        : "The learner asked a question. Use it as evidence when choosing the depth and examples of upcoming beats.";
    default:
      return "";
  }
}
