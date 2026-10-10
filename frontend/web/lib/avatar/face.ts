import type { MouthShape } from "../adhd/mouth";

/**
 * ARIA'S FACE, AS NUMBERS. Pure: what the splat head's 52 ARKit blendshapes should be, given the
 * mouth shape sampled from her voice (lib/adhd/mouth.ts), her state, and the clock. Unit-tested in
 * lib/anim/avatarFace.test.ts; components/avatar/AriaAvatar.tsx feeds the result to the renderer
 * once per frame.
 *
 * WHY HEURISTIC LIP-SYNC AND NOT A NEURAL MODEL. The audio-to-blendshape model that gives the best
 * mouths (wav2arkit, Apache-2.0) carries a 402 MB wav2vec2 encoder — not something a student on a
 * phone in Lahore can download for a lesson. The analyser we already have gets the two things people
 * read as speech: the TIMING (open on a stressed syllable, shut in a pause, dead stop at the end) and
 * a coarse VOWEL (spread "ee" vs rounded "oo" vs open "ah"). A neural upgrade can run server-side
 * later and feed the same 52 numbers.
 */

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

export type FaceFrame = Record<string, number>;

/** The 52 ARKit names, so a frame can be checked against them in tests. */
export const ARKIT_NAMES = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
  "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel", "mouthLeft", "mouthLowerDownLeft",
  "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower",
  "mouthShrugUpper", "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight",
  "noseSneerLeft", "noseSneerRight", "tongueOut",
] as const;

/**
 * The mouth from the voice. `open` is jaw drop; `width` 0 = rounded ("oo"), 1 = spread ("ee").
 * A rounded vowel is funnel + pucker with less jaw; a spread one is smile + stretch with the upper
 * lip lifted; the jaw follows loudness. Nothing here exceeds what a real mouth does mid-word, so a
 * frame never reads as a shout.
 */
export function mouthWeights(mouth: MouthShape): FaceFrame {
  const open = clamp01(mouth.open);
  const spread = clamp01((mouth.width - 0.5) * 2);   // 0..1 when wider than neutral
  const round = clamp01((0.5 - mouth.width) * 2);    // 0..1 when rounder than neutral
  if (open < 0.02) return { jawOpen: 0, mouthClose: 0, mouthFunnel: 0, mouthPucker: 0, mouthSmileLeft: 0, mouthSmileRight: 0, mouthStretchLeft: 0, mouthStretchRight: 0, mouthUpperUpLeft: 0, mouthUpperUpRight: 0, mouthLowerDownLeft: 0, mouthLowerDownRight: 0 };
  const jaw = 0.08 + open * 0.62 * (1 - round * 0.35);
  return {
    jawOpen: jaw,
    mouthClose: 0,
    mouthFunnel: round * 0.55 * Math.min(1, open * 1.5),
    mouthPucker: round * 0.45,
    mouthSmileLeft: spread * 0.35,
    mouthSmileRight: spread * 0.35,
    mouthStretchLeft: spread * 0.3,
    mouthStretchRight: spread * 0.3,
    mouthUpperUpLeft: open * 0.25 + spread * 0.15,
    mouthUpperUpRight: open * 0.25 + spread * 0.15,
    mouthLowerDownLeft: open * 0.3,
    mouthLowerDownRight: open * 0.3,
  };
}

/** A blink: one closing-and-opening curve ~180 ms long, from how long ago it began. */
export function blinkWeight(sinceStartMs: number, durationMs = 180): number {
  if (sinceStartMs < 0 || sinceStartMs > durationMs) return 0;
  const t = sinceStartMs / durationMs;
  // Fast shut (the first 35%), slower open (the rest), as real lids do; fully shut at the join.
  const SHUT = 0.35;
  return t < SHUT ? Math.sin((Math.PI / 2) * (t / SHUT)) : Math.cos((Math.PI / 2) * ((t - SHUT) / (1 - SHUT)));
}

/** When the next blink should start after the last one: 2-5 s at rest, a little faster while talking. */
export function nextBlinkDelayMs(state: AvatarState, random = Math.random()): number {
  const [lo, hi] = state === "speaking" ? [1400, 3400] : state === "thinking" ? [900, 2200] : [2000, 5000];
  return lo + random * (hi - lo);
}

/**
 * The expression that is not the mouth: brows and eyes by state. Listening lifts the brows a touch
 * (attentive), thinking narrows the eyes and lifts one brow, speaking is neutral so the mouth reads.
 * Eased by the caller; these are targets.
 */
export function expressionTarget(state: AvatarState): FaceFrame {
  switch (state) {
    case "listening":
      return { browInnerUp: 0.22, browOuterUpLeft: 0.12, browOuterUpRight: 0.12, eyeWideLeft: 0.08, eyeWideRight: 0.08, mouthSmileLeft: 0.08, mouthSmileRight: 0.08 };
    case "thinking":
      return { browInnerUp: 0.1, browDownLeft: 0.18, browOuterUpRight: 0.2, eyeSquintLeft: 0.18, eyeSquintRight: 0.12, eyeLookUpLeft: 0.25, eyeLookUpRight: 0.25, mouthPressLeft: 0.15, mouthPressRight: 0.15 };
    case "speaking":
      return { browInnerUp: 0.06, mouthSmileLeft: 0.05, mouthSmileRight: 0.05 };
    default:
      return { mouthSmileLeft: 0.1, mouthSmileRight: 0.1, mouthClose: 0.05 };
  }
}

/**
 * A small, slow head sway so she is never a still image: three incommensurate sines, in radians,
 * plus a nod that follows the voice while speaking. [pitch, yaw, roll], Euler YXZ, for the neck bone.
 */
export function headSway(tSeconds: number, state: AvatarState, mouthOpen: number, phase: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const deg = Math.PI / 180;
  const live = state === "speaking" ? 1 : state === "listening" ? 0.7 : 0.5;
  const yaw = Math.sin(tSeconds * 0.31 + phase[0]) * 1.6 * deg * live;
  const pitch = Math.sin(tSeconds * 0.47 + phase[1]) * 1.0 * deg * live + (state === "speaking" ? mouthOpen * 0.9 * deg : 0);
  const roll = Math.sin(tSeconds * 0.23 + phase[2]) * 0.7 * deg * live;
  return [pitch, yaw, roll];
}

/** Move `current` toward `target` by a fraction, for every key in either; keys absent in target go to 0. */
export function easeFrame(current: FaceFrame, target: FaceFrame, fraction: number): FaceFrame {
  const next: FaceFrame = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(target)]);
  for (const k of keys) {
    const a = current[k] ?? 0;
    const b = target[k] ?? 0;
    const v = a + (b - a) * fraction;
    if (Math.abs(v) > 0.001) next[k] = v;
  }
  return next;
}

/**
 * One frame for the renderer: the eased expression, the live mouth on top, and the blink over all.
 * EVERY one of the 52 shapes is present, at 0 when nothing moves it: the renderer keeps the last
 * value for a shape it is not told about, so a blink that stopped being sent would leave the lids
 * half shut (seen on the first build).
 */
export function composeFrame(expression: FaceFrame, mouth: FaceFrame, blink: number): FaceFrame {
  const frame: FaceFrame = {};
  for (const name of ARKIT_NAMES) frame[name] = 0;
  for (const [k, v] of Object.entries(expression)) frame[k] = v;
  for (const [k, v] of Object.entries(mouth)) frame[k] = Math.min(1, Math.max(frame[k] ?? 0, v));
  if (blink > 0) {
    frame.eyeBlinkLeft = Math.max(frame.eyeBlinkLeft ?? 0, blink);
    frame.eyeBlinkRight = Math.max(frame.eyeBlinkRight ?? 0, blink);
  }
  return frame;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
