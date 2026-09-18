/**
 * Which model draws each beat's animation, when models are being compared.
 *
 * WHY THIS EXISTS. The animation is the most expensive and most visible part of a lecture, and the
 * question "which model draws the best boards, and at what price?" can only be answered by letting
 * several models draw real beats and comparing them under the same judge. With
 * `ANIMATION_MODEL_ROTATION=1`, beat 0 goes to the first model below, beat 1 to the second, beat 2
 * to the third, beat 3 back to the first — so every lecture is a small side-by-side, and the board's
 * corner chip names who drew it and what it cost.
 *
 * The three GPT-5.6 tiers, cheapest to most capable, so the comparison answers the practical
 * question: how much quality does each step up in price buy?
 *
 * With the switch off, `animationModelForBeat` returns null and generation uses the configured
 * `OPENAI_ANIMATION_MODEL` exactly as before. The comparison never changes a lecture unless asked to.
 *
 * Only GENERATION rotates. The critics that score and gate boards stay on one model for every beat
 * (lib/reactAnimationVisionCritic.ts), because a comparison where each contestant is also judged by
 * a different referee compares nothing.
 *
 * Pure: no clients, no network.
 */

export type AnimationModel = {
  /** The id sent to OpenAI. */
  id: string;
  /** What the board's corner chip says. */
  label: string;
};

export const ANIMATION_ROTATION: readonly AnimationModel[] = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
];

/** True when beats should rotate across models. Read per call so tests and scripts can set it. */
export function animationRotationEnabled(): boolean {
  return process.env.ANIMATION_MODEL_ROTATION === "1";
}

/** The model for this beat, or null to use the configured default. */
export function animationModelForBeat(beatIndex: number, enabled = animationRotationEnabled()): AnimationModel | null {
  if (!enabled || !Number.isFinite(beatIndex)) return null;
  const n = ANIMATION_ROTATION.length;
  return ANIMATION_ROTATION[((Math.floor(beatIndex) % n) + n) % n];
}

/**
 * The chip label for a model id: the rotation's own name, or the id itself for any other model.
 * Dated snapshots ("gpt-5.6-sol-2026-08-01") still resolve to their family's name.
 */
export function animationModelLabel(id: string | undefined | null): string | null {
  if (!id) return null;
  const known = ANIMATION_ROTATION.find((model) => id === model.id || id.startsWith(`${model.id}-`));
  return known ? known.label : id;
}

/**
 * What the corner chip says after "React · sandbox": who drew the board and what drawing it cost.
 *
 * The cost is everything spent producing THIS board — every generation attempt, the refinement
 * rounds, and the judge's looks at it — because that is the price of the model's board, not just of
 * its first draft. Null when the board records no model (generated before models were recorded).
 */
export function animationChipDetail(id: string | undefined | null, costUsd: number | undefined | null): string | null {
  const label = animationModelLabel(id);
  if (!label) return null;
  return typeof costUsd === "number" && Number.isFinite(costUsd) ? `${label} · $${costUsd.toFixed(3)}` : label;
}
