import type { SonicCueName } from "./sonicCues";
import type { Beat } from "./lessonContent";

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

type DrawOp = NonNullable<Beat["draw"]>["ops"][number];

/** Returns curated blind content when it exists, otherwise builds an audio-first
 *  description from the generated lesson's actual DrawScript. This is what makes
 *  "Teach Me Anything" use the blind pathway instead of falling back to silence
 *  for every generated beat id. */
export function getBlindBeatContent(beat: Beat, nextBeat?: Beat): BlindBeatContent {
  const curated = blindBeatContent[beat.id];
  if (curated) return curated;

  if (beat.slideKind === "checkpoint") {
    return {
      audioDescription: "",
      cue: "checkpoint",
      cueTiming: "before",
    };
  }

  const audioDescription = describeGeneratedVisual(beat);
  const followedByCheckpoint = nextBeat?.slideKind === "checkpoint";
  return {
    audioDescription,
    cue: beat.slideKind === "recap" ? "transition" : "new-concept",
    cueTiming: "after",
    quickCheck: followedByCheckpoint
      ? undefined
      : 'Quick check: if that mental picture is clear, say "Nova" or press any key to continue. If not, say "Nova, explain this."',
  };
}

function describeGeneratedVisual(beat: Beat): string {
  const ops = beat.draw?.ops ?? [];
  if (ops.length === 0) {
    const pointSummary = beat.points.length ? ` The key ideas are: ${joinList(beat.points)}.` : "";
    return `There is no separate visual board for this part. Hold onto the spoken idea: ${beat.title}.${pointSummary}`;
  }

  const image = ops.find((op): op is Extract<DrawOp, { kind: "image" }> => op.kind === "image");
  const callouts = ops.filter((op): op is Extract<DrawOp, { kind: "callout" }> => op.kind === "callout");
  const scene = ops.find((op): op is Extract<DrawOp, { kind: "scene" }> => op.kind === "scene");
  const motions = ops.filter((op): op is Extract<DrawOp, { kind: "motion" }> => op.kind === "motion");
  const labels = ops.filter((op): op is Extract<DrawOp, { kind: "label" }> => op.kind === "label");
  const notes = ops.filter((op): op is Extract<DrawOp, { kind: "note" }> => op.kind === "note");
  const arrows = ops.filter((op): op is Extract<DrawOp, { kind: "arrow" }> => op.kind === "arrow");

  if (image && callouts.length > 0) {
    const sceneText = cleanImagePrompt(image.prompt);
    const calloutText = callouts
      .slice()
      .sort(byPosition)
      .slice(0, 5)
      .map((op) => `${positionName(op.x, op.y)}, ${op.text}`)
      .join("; ");
    return `Picture a full-board scene: ${sceneText}. The important regions are: ${calloutText}.`;
  }

  if (scene) {
    const title = scene.title ? ` titled ${scene.title}` : "";
    const items = scene.items?.length ? ` It contains ${joinList(scene.items)}.` : "";
    const movement = motions.length ? ` The motion shows ${motions.slice(0, 3).map(describeMotion).join("; ")}.` : "";
    return `Picture a clean ${scene.scene} diagram${title}.${items}${movement}`;
  }

  if (labels.length > 0 || notes.length > 0) {
    const textItems = [...labels, ...notes]
      .slice()
      .sort(byPosition)
      .map((op) => op.text)
      .filter((text, index, all) => text && all.indexOf(text) === index)
      .slice(0, 8);
    const arrowText = arrows.length ? ` ${arrows.length === 1 ? "One arrow connects the ideas." : `${arrows.length} arrows show the direction of cause and effect.`}` : "";
    return `Picture a written blackboard for ${beat.title}. Reading from top to bottom, it says: ${joinList(textItems)}.${arrowText}`;
  }

  if (image) {
    return `Picture a full-board scene for ${beat.title}: ${cleanImagePrompt(image.prompt)}.`;
  }

  return `Picture the board as a structured map of ${beat.title}, with the spoken explanation as the main guide.`;
}

function byPosition(a: { x?: number; y?: number }, b: { x?: number; y?: number }) {
  return (a.y ?? 50) - (b.y ?? 50) || (a.x ?? 50) - (b.x ?? 50);
}

function positionName(x = 50, y = 50) {
  const vertical = y < 33 ? "top" : y > 67 ? "bottom" : "middle";
  const horizontal = x < 33 ? "left" : x > 67 ? "right" : "center";
  return horizontal === "center" && vertical === "middle" ? "center" : `${vertical} ${horizontal}`;
}

function describeMotion(op: Extract<DrawOp, { kind: "motion" }>) {
  const label = op.text ? `${op.text} ` : "";
  if (op.motion === "pulse") return `${label}pulsing at ${positionName(op.cx, op.cy)}`.trim();
  if (op.motion === "orbit") return `${label}circling around ${positionName(op.cx, op.cy)}`.trim();
  if (op.motion === "beam") return `${label}beaming ${directionName(op.x1, op.y1, op.x2, op.y2)}`.trim();
  if (op.motion === "collapse") return `${label}collapsing toward ${positionName(op.x2, op.y2)}`.trim();
  return `${label}flowing ${directionName(op.x1, op.y1, op.x2, op.y2)}`.trim();
}

function directionName(x1 = 50, y1 = 50, x2 = 50, y2 = 50) {
  const horizontal = Math.abs(x2 - x1) < 8 ? "" : x2 > x1 ? "left to right" : "right to left";
  const vertical = Math.abs(y2 - y1) < 8 ? "" : y2 > y1 ? "downward" : "upward";
  return [horizontal, vertical].filter(Boolean).join(" and ") || "in place";
}

function cleanImagePrompt(prompt: string) {
  return prompt
    .replace(/\b(cinematic|documentary|photo(realistic)?|photograph|wide|full-board|no text|text-free)\b/gi, "")
    .replace(/\b(no signs|no labels|no printed text of any kind|no signage)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[,. ]+$/g, "")
    .trim()
    .slice(0, 260);
}

function joinList(items: string[]) {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}
