import type { Beat } from "./lessonContent";
import type { LectureMode, LectureSourceType } from "./db/cosmos";
import type { LearnerProfile } from "./learnerProfile";
import type { BeatSourceGrounding } from "./sourceGrounding";
import type { PdfFidelity, SourceScope } from "./sourceScope";

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
  | "code"
  /** A lesson-canvas board (lib/canvas): one panel of the canvas, written whole by the worker. */
  | "canvas";

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
  /**
   * This board's rung on the lesson ladder (lib/lessonLadder.ts): hook, core, mechanism, example,
   * implication, application, pitfall, contrast or recap. Decides what the board must add and what
   * it must not repeat; a lesson climbs these and never descends.
   */
  role?: import("./lessonLadder").TeachingRole;
  visualKind: ProgressiveVisualKind;
  estimatedDurationMs: number;
  sourceBlockIds?: string[];
  /** A canvas lecture's board, as its plan wrote it: the script is fixed at planning time. */
  canvas?: import("./canvas/types").CanvasPlanBeat;
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
    /** The planner's read of the request: a specific "question" gets only its own boards. */
    scope?: "question" | "lesson";
    subtopics: Array<{ title: string; caption: string; reason?: string }>;
  };
  context?: string;
  diagramHints?: string;
  slideImages?: Array<{ slide: number; descriptions: string[] }>;
  suprnotes?: unknown;
  transcript?: string;
  focus?: string;
  documentId?: string;
  /** The explicit source contract chosen after page selection. */
  sourceScope?: SourceScope;
  /**
   * The part of a page the student DRAGGED a box over ("Get a lecture from this area"). When set,
   * it is the subject of the whole lecture; the rest of the document is background. `transcript`
   * is what was read off that crop, `pages` the pages it sits on.
   */
  selection?: { pages: number[]; transcript: string; description: string };
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
  /** Who the lesson is for — grade, country, curriculum, subjects — as rules (lib/studentCard.ts). */
  studentCard?: import("./studentCard").StudentCard;
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
  /**
   * The student's source contract, copied from the input at creation. The session is what an
   * interaction reads (the input is a blob it never loads), and a strict lesson must turn "give me
   * more examples" into pacing only (lib/progressiveLectureStore.ts). Absent on sessions created
   * before it existed, which then adapt exactly as before.
   */
  sourceFidelity?: PdfFidelity;
  /**
   * "canvas": the lecture is taught on the lesson canvas (lib/canvas) — the plan writes every
   * board's script at once and each board is one spec, so there is no separate enrich step.
   * Absent: the ordinary boards.
   */
  boardEngine?: "canvas";
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
  /**
   * The beat's own source — text, printed figure labels, caption, fidelity — as the script step
   * built it, so the board step hands the SAME source to the board generator without loading the
   * input blob again (a blob read on the critical path of every opening board). Absent for typed
   * topics and for beats planned without source blocks.
   */
  sourceGrounding?: BeatSourceGrounding;
  /**
   * Where the beat's figure sits on its page, so the board step can crop the page image to it.
   * Only the location is stored; the crop itself is made from the in-process page store at board
   * time and never written to the database.
   */
  sourceFigure?: { documentId: string; pageNumber: number; bbox: { x: number; y: number; width: number; height: number } };
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
    /** What the part teaches — lets the chat say "that's coming in part 5" before part 5 exists. */
    objective?: string;
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
