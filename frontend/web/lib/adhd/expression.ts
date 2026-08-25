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
  /** High engagement: the learner is genuinely with the lesson. */
  | "happy"
  /** A checkpoint went unanswered. Disappointed FOR the learner, not at them. */
  | "sad"
  /** A skipped beat. Requested explicitly; always transient — see the note on `flash`. */
  | "furious";

export type ExpressionInput = {
  focus: FocusTracker;
  /** Current combo streak. */
  streak: number;
  /**
   * Set briefly after something the learner just did, then cleared by the caller.
   *
   * Every flash is TRANSIENT by construction. That matters most for "skipped", which now shows a
   * furious face: a reaction that decays back to the resting expression reads as the character
   * responding, whereas a face that keeps glaring reads as a standing verdict on the learner.
   */
  flash?: "correct" | "skipped" | "unanswered" | null;
};

/**
 * A momentary flash outranks the steady state — reacting to what just happened is what makes a face
 * feel responsive rather than merely configured.
 *
 * ON THE SKIP FACE. This returned "surprised" on the reasoning that a disappointed teacher staring
 * back is the shape that makes someone with rejection sensitive dysphoria close the app. It was
 * changed to "furious" as an explicit product decision, and the reasoning is recorded rather than
 * deleted because it is the thing to re-read if the track ever feels punishing.
 *
 * What preserves most of the original intent is that all three reaction faces are FLASHES: the
 * caller clears `flash` after a beat, so the face returns to whatever the learner's actual state is.
 * A reaction decays; a verdict does not.
 */
export function expressionFor({ focus, streak, flash }: ExpressionInput): Expression {
  if (flash === "correct") return "delighted";
  if (flash === "skipped") return "furious";
  if (flash === "unanswered") return "sad";

  switch (focus.state) {
    // Sustained high engagement is the "she can tell I'm with her" moment, so it gets the warmest
    // resting face rather than only appearing as a reaction to something.
    case "hyperfocus": return "happy";
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
  /**
   * Brow ANGLE in degrees, rotating each brow toward the nose.
   *
   * Height alone cannot express anger: lowered-but-flat brows read as sleepy, not cross. The
   * inward tilt is what the eye actually reads as a scowl, and mirrored outward it reads as
   * worried — which is what separates `sad` from merely `tired`.
   */
  tilt: number;
  /** How far the glasses slide down the nose. Furious peers OVER them; the rest sit normally. */
  glasses: number;
}> = {
  neutral:   { curve: 4,   eye: 1,    brow: 0,    tilt: 0,   glasses: 0 },
  pleased:   { curve: 11,  eye: 1,    brow: -1.5, tilt: -2,  glasses: 0 },
  delighted: { curve: 17,  eye: 1.2,  brow: -3.5, tilt: -4,  glasses: 0 },
  happy:     { curve: 15,  eye: 1.1,  brow: -2.5, tilt: -4,  glasses: 0 },
  bored:     { curve: -6,  eye: 0.4,  brow: 2,    tilt: 3,   glasses: 1.5 },
  tired:     { curve: -4,  eye: 0.5,  brow: 1.5,  tilt: 0,   glasses: 2.5 },
  // Brows tilt OUTWARD (up at the nose) — the classic worried shape.
  sad:       { curve: -11, eye: 0.85, brow: -1,   tilt: -18, glasses: 1 },
  // Brows drive hard DOWN toward the nose, eyes narrowed, peering over the glasses.
  furious:   { curve: -13, eye: 0.6,  brow: 3,    tilt: 24,  glasses: 4.5 },
};
