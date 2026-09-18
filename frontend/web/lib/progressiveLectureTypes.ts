import type { Beat } from "./lessonContent";
import type { LectureMode, LectureSourceType } from "./db/cosmos";

export type LearnerExpertise = "beginner" | "intermediate" | "advanced";
export type LearnerDepth = "concise" | "balanced" | "deep";
export type LearnerGoal = "school" | "exam" | "curiosity" | "practical" | "professional";

export type LearnerProfileSnapshot = {
  expertise: LearnerExpertise;
  depth: LearnerDepth;
  goal: LearnerGoal;
  codeExamples: boolean;
  preferredExamples: "visual" | "real-world" | "worked" | "mixed";
  rationale: string;
  confirmedAt: string;
};

/** Code is a teaching consequence of the confirmed profile, not a separate preference toggle.
 * The generator still includes it only when code genuinely helps explain the topic. */
export function shouldIncludeCodeExamples(
  profile: Pick<LearnerProfileSnapshot, "expertise" | "goal">,
): boolean {
  return profile.expertise === "advanced" && profile.goal === "professional";
}

export type ProgressiveVisualKind =
  | "live-svg"
  | "react-animation"
  | "blackboard"
  | "manim"
  | "structure"
  | "plot"
  | "equation";

export type ProgressiveBeatPlan = {
  id: string;
  sequence: number;
  title: string;
  objective: string;
  visualKind: ProgressiveVisualKind;
  estimatedDurationMs: number;
  sourceBlockIds?: string[];
};

export type ProgressiveLectureStatus =
  | "planning"
  | "generating"
  | "starter-ready"
  | "finalizing"
  | "complete"
  | "failed";

export type ProgressiveLectureInput = {
  topic: string;
  mood: string;
  sourceType: LectureSourceType;
  mode: LectureMode;
  outline?: {
    topic: string;
    subtopics: Array<{ title: string; caption: string; reason?: string }>;
  };
  context?: string;
  diagramHints?: string;
  slideImages?: Array<{ slide: number; descriptions: string[] }>;
  suprnotes?: unknown;
  transcript?: string;
  focus?: string;
  documentId?: string;
  learnerProfile: LearnerProfileSnapshot;
};

export type ProgressiveLectureSessionDoc = {
  id: string;
  userId: string;
  topic: string;
  sourceType: LectureSourceType;
  mode: LectureMode;
  learnerProfile: LearnerProfileSnapshot;
  inputBlobName: string;
  status: ProgressiveLectureStatus;
  plan: ProgressiveBeatPlan[];
  planRevision: number;
  adaptationNotes: string[];
  lastAdaptedAt: string | null;
  playhead: number;
  frozenThrough: number;
  starterBeatCount: number;
  starterBufferMs: number;
  lectureId: string | null;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};

export type ProgressiveBeatState = "planned" | "generating" | "playable" | "ready" | "failed";

export type ProgressiveBeatDoc = {
  id: string;
  sessionId: string;
  userId: string;
  sequence: number;
  revision: number;
  state: ProgressiveBeatState;
  enrichmentState: "pending" | "running" | "ready";
  beat: Beat | null;
  fallbackUsed: boolean;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};

/**
 * `enqueuedAt` is stamped at dispatch so the worker can log how long a task WAITED, separately
 * from how long it took to run. Optional because tasks already on the queue from an older build
 * will not carry it, and a missing timestamp must not break a task that is otherwise valid.
 */
type TaskBase = { version: 1; sessionId: string; userId: string; enqueuedAt?: number };

export type ProgressiveLectureTask =
  | ({ type: "plan" } & TaskBase)
  | ({ type: "generate-beat"; sequence: number; revision: number } & TaskBase)
  | ({ type: "enrich-beat"; sequence: number; revision: number } & TaskBase);

export type ProgressiveLectureSnapshot = {
  sessionId: string;
  /** Changes whenever a beat is generated, enriched, revised, or the session changes. */
  snapshotVersion: string;
  topic: string;
  status: ProgressiveLectureStatus;
  planRevision: number;
  plannedBeatCount: number;
  contiguousReadyCount: number;
  bufferedDurationMs: number;
  starterReady: boolean;
  complete: boolean;
  beats: Beat[];
  lectureId: string | null;
  costUsd: number;
  error: string | null;
};

export type LearnerInteractionKind = "playhead" | "deeper" | "simpler" | "more-examples" | "code" | "checkpoint" | "question";

/** Signals emitted by the ordinary lesson UI and used to adapt only not-yet-played beats. */
export type LearnerAdaptiveSignal = {
  kind: "question" | "checkpoint";
  detail?: string;
  correct?: boolean;
};

export type LearnerInteraction = {
  kind: LearnerInteractionKind;
  playhead: number;
  detail?: string;
  correct?: boolean;
};

export function isLearnerProfileSnapshot(value: unknown): value is LearnerProfileSnapshot {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return (
    ["beginner", "intermediate", "advanced"].includes(String(profile.expertise)) &&
    ["concise", "balanced", "deep"].includes(String(profile.depth)) &&
    ["school", "exam", "curiosity", "practical", "professional"].includes(String(profile.goal)) &&
    typeof profile.codeExamples === "boolean" &&
    ["visual", "real-world", "worked", "mixed"].includes(String(profile.preferredExamples))
  );
}
