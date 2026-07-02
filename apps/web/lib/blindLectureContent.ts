import type { SonicCueName } from "./sonicCues";

/**
 * The audio-first companion to lib/lessonContent.ts. Every beat there has a `script`
 * (what the teacher SAYS) but the things sighted students get for free — a diagram's
 * shape, position, color, motion — convey real information that a transcript alone
 * drops. This file adds, per beat, a STRUCTURAL verbal description of what would have
 * been drawn (so a blind student builds the same mental picture through language) and
 * which non-speech sonic cue marks the moment, matching the audio-first design in
 * README 3.2/4.2 ("every visual is auto-described in real time... sonified diagrams").
 *
 * Purely additive — keyed by the same beat `id`s already in lessonContent.ts. Nothing
 * here is read by the sighted LessonPlayer; it has zero effect on that path.
 */

export interface BlindBeatContent {
  /** Spoken right after the beat's normal script — a structural description of the
   *  visual concept, phrased spatially/sequentially so it forms an actual mental image. */
  audioDescription: string;
  /** Which non-speech cue plays, and at what point ("before" the script, or "after" the
   *  audio description) — checkpoints always cue before their prompt, concept beats cue
   *  after their description so the chime doesn't interrupt the picture being built. */
  cue: SonicCueName;
  cueTiming: "before" | "after";
  /** A short yes/no comprehension ping inserted after non-checkpoint beats, so the
   *  student never goes more than ~2 beats without a response point. Omitted on beats
   *  immediately followed by a real checkpoint beat, to avoid stacking two prompts. */
  quickCheck?: string;
}

export const blindBeatContent: Record<string, BlindBeatContent> = {
  hook: {
    audioDescription:
      "Picture a single green leaf, alone against a soft photo of a lab bench, with a glowing question mark hovering over it. That question mark is the whole puzzle: nothing is feeding this leaf, and yet it lives.",
    cue: "new-concept",
    cueTiming: "after",
  },
  "define-photosynthesis": {
    audioDescription:
      "Picture the word split into two glowing halves, side by side. On the left, in warm amber light: PHOTO, meaning light. On the right, in green: SYNTHESIS, meaning building. They sit on either side of a plus sign — light, plus building, equals photosynthesis.",
    cue: "new-concept",
    cueTiming: "after",
    quickCheck: "Quick check — in one phrase, what does the word photosynthesis literally mean?",
  },
  "ingredients-fast": {
    audioDescription:
      "Picture three things arriving from three different directions into a small stove icon in the center. From the upper left, a sun, glowing amber. From the middle left, a blue water droplet. From the lower left, the label CO2 in slate grey. All three arrows point inward, toward the same point: the kitchen.",
    cue: "new-concept",
    cueTiming: "after",
  },
  "checkpoint-1": {
    audioDescription: "",
    cue: "checkpoint",
    cueTiming: "before",
  },
  chloroplast: {
    audioDescription:
      "Picture zooming inside the leaf, into a single cell, where a small amber stove sits labeled chloroplast. The whole leaf around it is green for a reason: that green color is chlorophyll, the kitchen equipment itself, sitting inside every cell.",
    cue: "new-concept",
    cueTiming: "after",
  },
  mechanism: {
    audioDescription:
      "This is the one to picture slowly, step by step. On the left, a blue water droplet sits above a grey CO2 circle. A small sun glows at the top, sending light down between them. Watch the water droplet move toward the center and split into two pieces as the light hits it. At the same time, the CO2 circle drifts in from below to meet those pieces in the middle. They merge into one new shape, which changes color from grey to a warm sugar-brown, and slides to the right while the label changes from a cluster of dots into the word glucose. Nothing vanished — the same pieces rearranged into something new.",
    cue: "new-concept",
    cueTiming: "after",
  },
  "checkpoint-2": {
    audioDescription: "",
    cue: "checkpoint",
    cueTiming: "before",
  },
  outputs: {
    audioDescription:
      "Picture the leaf again, with two labels leaving it in two different directions. Below, in sugar-brown: glucose, staying close to the leaf because the plant keeps it. Above, in blue, curving away and out: O2, oxygen, drifting out into the open air — the same air you're breathing right now.",
    cue: "new-concept",
    cueTiming: "after",
  },
  "compare-respiration": {
    audioDescription:
      "Picture two columns side by side, like mirror images. On the left, labeled PLANT in green: light plus water plus CO2 flows down into sugar plus O2. On the right, labeled YOU in red: sugar plus O2 flows down into energy plus CO2. The two columns run in exactly opposite directions — what flows down on the left flows up on the right.",
    cue: "new-concept",
    cueTiming: "after",
  },
  "checkpoint-3": {
    audioDescription: "",
    cue: "checkpoint",
    cueTiming: "before",
  },
  "why-it-matters": {
    audioDescription:
      "Picture the leaf at the top, small and green, with two arrows fanning out and downward from it like branches. The left arrow ends at the words food chains. The right arrow, in blue, ends at the word oxygen. One small kitchen at the top, feeding two enormous things below it.",
    cue: "new-concept",
    cueTiming: "after",
    quickCheck: "Quick check — name one of the two huge things this tiny kitchen is responsible for.",
  },
  recap: {
    audioDescription:
      "Picture the whole sequence laid out as a single chain, left to right: sunlight, water, and carbon dioxide flow in; they pass through the chloroplast kitchen where light splits water and rearranges the pieces; sugar comes out one side and is kept, oxygen comes out the other side and is released into the air you breathe.",
    cue: "transition",
    cueTiming: "after",
  },
};

/** Fallback used if a beat id has no entry above (keeps the player from breaking on
 *  future beats added to lessonContent.ts without a matching audio description yet). */
export const DEFAULT_BLIND_BEAT: BlindBeatContent = {
  audioDescription: "",
  cue: "transition",
  cueTiming: "after",
};
