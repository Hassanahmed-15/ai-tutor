import type { FocusTracker } from "./focusState";

/**
 * Which face the teacher wears, as a pure function of state that already exists.
 *
 * Kept out of the component so it is testable without rendering anything, and so the header avatar
 * and any other surface cannot disagree about what the learner is currently doing.
 *
 * Nothing here is invented: every input is a value the ADHD track already computes.
 */

export type Expression =
  /** Nothing notable — the resting face. */
  | "neutral"
  /** Doing well: a run of beats, or sustained focus. */
  | "pleased"
  /** Hyperfocus, or a just-answered-correctly flash. */
  | "delighted"
  /** Attention has gone. */
  | "bored"
  /** Fell out of a long focused run. */
  | "tired"
  /** A skip. Surprise, not disapproval — see below. */
  | "surprised";

export type ExpressionInput = {
  focus: FocusTracker;
  /** Current combo streak. */
  streak: number;
  /** Set briefly after a correct answer or a skip, then cleared by the caller. */
  flash?: "correct" | "skipped" | null;
};

/**
 * A momentary flash outranks the steady state — reacting to what just happened is what makes a face
 * feel responsive rather than merely configured.
 *
 * The skip face is SURPRISED, never disapproving. The whole track is built so that negative signals
 * never read as judgement of the learner; a disappointed teacher staring back after a skip is
 * exactly the shape that makes someone with rejection sensitive dysphoria close the app.
 */
export function expressionFor({ focus, streak, flash }: ExpressionInput): Expression {
  if (flash === "correct") return "delighted";
  if (flash === "skipped") return "surprised";

  switch (focus.state) {
    case "hyperfocus": return "delighted";
    case "drifting": return "bored";
    case "crashing": return "tired";
    default:
      // With no camera, focus stays "unknown" forever — so the streak alone still moves the face,
      // and a learner who declined the camera does not get a permanently blank teacher.
      return streak >= 3 ? "pleased" : "neutral";
  }
}

/** Geometry per expression, in the avatar's 120x120 viewBox. Data, so the SVG stays declarative. */
export const FACE_SHAPES: Record<Expression, {
  /** Mouth curve control offset: positive smiles, negative frowns. */
  curve: number;
  /** Eye openness, 1 = normal. */
  eye: number;
  /** Brow vertical offset; negative is raised. */
  brow: number;
}> = {
  neutral:   { curve: 3,  eye: 1,    brow: 0 },
  pleased:   { curve: 7,  eye: 1,    brow: -1 },
  delighted: { curve: 10, eye: 1.15, brow: -2.5 },
  bored:     { curve: -3, eye: 0.45, brow: 1.5 },
  tired:     { curve: -1, eye: 0.55, brow: 1 },
  surprised: { curve: 1,  eye: 1.35, brow: -3.5 },
};
