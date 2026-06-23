/**
 * Lesson Graph — the modality-agnostic, subject-agnostic representation of a lesson.
 * See README.md Section 4.2 (Living Lecture Engine) and Section 5.3 (Modality Lens).
 *
 * Hard rule: nothing in this file may describe HOW to render something
 * (no colors, fonts, voices, pixel positions). It only describes WHAT is being taught.
 * Modality Lenses (packages/modality-lenses) decide how each node becomes
 * whiteboard strokes, spoken audio, captions, etc.
 */

/** A visual relationship between two referenced elements in a diagram (e.g. an arrow, a containment). */
export interface VisualRelation {
  from: string;
  to: string;
  kind: "points-to" | "contains" | "transforms-into" | "compares-to";
  label?: string;
}

/** A single labeled element inside a structured visual (a box, a value, a node). */
export interface VisualElement {
  id: string;
  label: string;
  /** Optional numeric/positional value, meaningful to the subject (e.g. an array value, a coordinate). */
  value?: string | number;
  /** Highlights this element as currently "active" / under discussion. */
  emphasis?: boolean;
}

/**
 * A structured visual primitive — never a raster image or video.
 * This is what gets rendered progressively by the Visual Generation Layer (README 7.4).
 */
export interface StructuredVisual {
  primitive: "array" | "tree" | "graph" | "timeline" | "comparison-table" | "diagram";
  elements: VisualElement[];
  relations?: VisualRelation[];
}

/** A claim grounded in source material, per the Content Grounding layer (README 7.2). */
export interface Citation {
  sourceId: string;
  sourceTitle: string;
  locator?: string; // e.g. page number, section heading
}

export type ExplanationStrategy = "definition" | "analogy" | "worked-example" | "visual-first";

export type LessonNodeType =
  | "hook"
  | "definition"
  | "example"
  | "diagram"
  | "analogy"
  | "checkpoint"
  | "recap";

/**
 * One "teaching beat." The Tutor Reasoning layer emits a sequence (and, after
 * interrupts, a tree) of these. Each node is self-contained enough that any
 * Modality Lens can render it without seeing the rest of the graph.
 */
export interface LessonNode {
  id: string;
  type: LessonNodeType;
  concept: string;
  /** What the teacher says/communicates for this beat. Plain text — lenses decide TTS/caption/etc. */
  narration: string;
  /** Present when this beat has an accompanying structured visual. */
  visual?: StructuredVisual;
  /** Which explanation strategy this beat uses — lets the reasoning layer swap strategy on confusion (README 4.3). */
  strategy?: ExplanationStrategy;
  /** For checkpoint nodes: the question posed and how to evaluate the response. */
  checkpoint?: {
    prompt: string;
    expectedAnswerKind: "free-response" | "prediction" | "yes-no";
  };
  citations?: Citation[];
  /** Confidence the grounding layer has in this beat's factual claims, 0-1. Low values should be hedged when rendered. */
  groundingConfidence?: number;
}

/**
 * A branch created by a student interrupt mid-lecture (README 4.2, steps 1-4).
 * Branches are NOT a replacement for the node they interrupt — they sit beside it.
 * The lens renders a branch as an annotation over the current visual, then "clears"
 * it and resumes the parent node when the branch closes.
 */
export interface InterruptBranch {
  id: string;
  /** The LessonNode id this branch interrupted. */
  parentNodeId: string;
  /** The student's question/utterance that triggered this branch. */
  triggerUtterance: string;
  /** The teaching beat(s) used to answer the interrupt. Usually one node, sometimes a short sequence. */
  resolutionNodes: LessonNode[];
  /** How the existing visual should be marked while this branch is active (README 4.2 step 3). */
  annotation?: {
    targetElementIds: string[];
    note?: string;
  };
  status: "open" | "resolved";
}

/**
 * The full Lesson Graph for one session. Append-only per README 5.1 (Session Orchestrator
 * holds this; nodes/branches are pushed, never rewritten, so the lesson can always be replayed).
 */
export interface LessonGraph {
  id: string;
  subject: string;
  topic: string;
  createdAt: string;
  nodes: LessonNode[];
  branches: InterruptBranch[];
  /** id of the node currently being taught/rendered. */
  currentNodeId: string | null;
}
