import type { Beat } from "./lessonContent";
import type { LectureMode, LectureSourceType } from "./db/cosmos";
import type { LearnerProfile } from "./learnerProfile";

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
  | "equation"
  | "code";

export type ProgressiveBeatPlan = {
  id: string;
  sequence: number;
  title: string;
  objective: string;
  /** Stable teaching concept. Repeated ids extend one physical board instead of making slides. */
  conceptId?: string;
  prerequisiteConceptIds?: string[];
  /**
   * Which pass over this concept the beat is, 1-based, and how many there are in total.
   *
   * A subtopic taught in depth is several beats sharing one `conceptId`. The board needs to tell
   * the first pass from a later one — the first earns the title card and the entrance, the rest
   * roll underneath on the same surface — and needs to know when the concept is FINISHED, because
   * that is the only moment a move to the next subtopic is correct.
   */
  conceptPass?: number;
  conceptPasses?: number;
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
  /**
   * The full profile from the planning conversation: what they know, what they are shaky on, their
   * misconceptions and gaps. The five-field `learnerProfile` above is derived from it.
   *
   * This replaces the old channel, which was prose squeezed into `mood`, cut to 500 characters, and
   * never read by the lecture worker — so none of the conversation reached the lecture.
   */
  learner?: LearnerProfile;
  /**
   * "What Aria thinks about this student" from earlier lessons (lib/learnerModel.ts
   * personaForPrompt): interests, strengths, what is still settling, how to teach them. The
   * planning profile above is about THIS topic; this is about the person across every topic.
   */
  learnerPersona?: string;
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

/**
 * Where one beat's time went, measured by the worker. Shown on the build screen and used for the
 * latency analysis: without it "the lecture is slow" could not be attributed to anything.
 */
export type BeatTiming = {
  /** Waiting in the queue before the script step started. */
  queuedMs?: number;
  textStartedAt?: string;
  /** The whole script step. */
  textMs?: number;
  /** Of which: the script model call. */
  scriptMs?: number;
  /** Of which: everything else — database and storage reads and writes. */
  textOverheadMs?: number;
  /** Waiting in the queue between the script step and the visual step. */
  enrichQueuedMs?: number;
  /** Choosing which kind of board to draw (a classifier call). */
  visualChoiceMs?: number;
  visualKind?: string;
  /** Generating the board itself. */
  premiumMs?: number;
  /** The whole visual step. */
  enrichMs?: number;
  readyAt?: string;
  /** For animated boards: model, checks, critic, refine and every attempt. */
  animation?: import("./reactAnimationGen").AnimationTiming;
  /** How demanding the animation was judged to be, which decides the model (lib/animationTier.ts). */
  animationTier?: "light" | "moderate" | "heavy";
  animationTierReason?: string;
};

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
  timing?: BeatTiming;
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
  /** When the session was created, so time-to-first-beat can be read off the snapshot. */
  createdAt?: string;
  /** Every planned beat, ready or not, with where its time has gone so far. */
  beatStatus?: Array<{
    sequence: number;
    title: string;
    state: ProgressiveBeatState | "not-started";
    visualKind: string;
    timing?: BeatTiming;
  }>;
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
