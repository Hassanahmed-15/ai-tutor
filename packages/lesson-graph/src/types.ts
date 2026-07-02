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

/**
 * Animated motion templates (the "visuals that demonstrate by moving" layer).
 * A beat carries at most one scene. The reasoning layer (mock or LLM) picks the
 * template that best fits the concept and fills in the steps; the renderer animates it.
 * Modality-agnostic per the schema's hard rule: this says WHAT moves and why, not pixels.
 *
 * - process:   ordered steps advance one-by-one, a token sweeps through them.
 * - shrink:    a set of items, half/some crossed out each tick (search, elimination).
 * - cycle:     a token travels an endless loop around the steps (feedback, water cycle).
 * - build:     parts assemble into a whole, one piece at a time.
 * - compare:   two columns side-by-side, their differences pulsing.
 * - transform: one thing morphs into another across stages.
 */
export type AnimationTemplate = "process" | "shrink" | "cycle" | "build" | "compare" | "transform";

export interface SceneStep {
  id: string;
  label: string;
  /** Optional one-line elaboration shown when this step is active. */
  detail?: string;
  /** Marks a step the teacher wants to call out (highlighted as it animates). */
  emphasis?: boolean;
  /** For `compare`: which side this step belongs to ("a" | "b"). Ignored by other templates. */
  side?: "a" | "b";
}

export interface AnimatedScene {
  template: AnimationTemplate;
  /** Short caption shown above the animation, e.g. "How a request travels". */
  caption?: string;
  steps: SceneStep[];
  /** For `compare`: labels for the two columns. */
  compareLabels?: { a: string; b: string };
}

/**
 * The "live sketch" layer: a timed sequence of primitive drawing commands that the board
 * executes IN ORDER, like a teacher filling a whiteboard while narrating. This is what makes
 * a lesson feel hand-drawn-live (e.g. an org-chem structure drawn bond-by-bond) rather than
 * appearing all at once.
 *
 * Positions are on a normalized 0..100 board grid (x left→right, y top→bottom) so the script
 * stays declarative/modality-agnostic — the renderer maps the grid to pixels. `at` is a 0..1
 * fraction of the whole script's timeline at which this op STARTS drawing.
 */
export type DrawShape = "circle" | "rect" | "hexagon" | "line" | "chain";

interface DrawOpBase {
  /** 0..1 point in the script timeline when this op begins drawing in. */
  at: number;
  /** Optional stroke/ink color (hex). Defaults applied by the renderer. */
  color?: string;
}

export interface DrawShapeOp extends DrawOpBase {
  kind: "shape";
  shape: DrawShape;
  x: number;
  y: number;
  /** Width/height for rect/hexagon/circle (circle uses w as diameter). */
  w?: number;
  h?: number;
  /** For "line"/"chain": polyline points on the 0..100 grid. */
  points?: { x: number; y: number }[];
}

export interface DrawLabelOp extends DrawOpBase {
  kind: "label";
  text: string;
  x: number;
  y: number;
  /** Relative text size hint. */
  size?: "sm" | "md" | "lg";
}

export interface DrawArrowOp extends DrawOpBase {
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Curved arrows read as electron-flow / "this becomes that" gestures. */
  curved?: boolean;
}

export interface DrawNoteOp extends DrawOpBase {
  kind: "note";
  text: string;
  x: number;
  y: number;
}

export interface DrawEmphasisOp extends DrawOpBase {
  kind: "underline" | "circleHighlight";
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export type DrawOp = DrawShapeOp | DrawLabelOp | DrawArrowOp | DrawNoteOp | DrawEmphasisOp;

export interface DrawScript {
  /** Short caption shown above the board. */
  caption?: string;
  /** Total timeline length in ms; ops are scheduled by their `at` fraction of this. */
  durationMs?: number;
  ops: DrawOp[];
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
  /** Present when this beat has an accompanying animated scene (the motion-visual layer). */
  scene?: AnimatedScene;
  /**
   * Opts this beat into a bespoke, hand-built animated renderer keyed by name
   * (e.g. "rag-flow"). Takes precedence over `scene`. Used for showcase visuals that are
   * too specific for the generic template kit. The renderer is chosen client-side.
   */
  customScene?: string;
  /**
   * A live-sketch draw script (the teacher-draws-it-live layer). Highest-priority visual:
   * when present, the board draws these ops in timed sequence. See DrawScript.
   */
  drawScript?: DrawScript;
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
