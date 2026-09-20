import OpenAI from "openai";
import { animationModelLabel, type AnimationModel } from "./animationModels";
import { withAudience } from "./learnerBrief";
import { costFor } from "./modelPricing";

/**
 * How heavy is this beat's animation — and so, which model should draw it?
 *
 * WHY THIS EXISTS. The animation model was chosen with no regard to what the beat needed: the
 * opening beats were pinned to the fast model, and every other beat took whatever the rotation
 * (lib/animationModels.ts) or the default handed it. So a recap slide could be drawn by the most
 * expensive model at ~44 s an attempt, and a multi-stage mechanism by the cheapest.
 *
 * A small model reads the beat and answers ONE thing — light, moderate or heavy — and the mapping
 * from that answer to a model is plain code, the same split lib/director.ts makes: the model
 * judges, the code decides. About 0.7 s and a fiftieth of a cent per beat, against an animation
 * that takes 15-45 s and costs cents.
 *
 * Anything malformed is "moderate": a bad answer must never buy the most expensive model, nor
 * starve a beat that needed more than the cheapest.
 */

export type AnimationTier = "light" | "moderate" | "heavy";
export const ANIMATION_TIERS: readonly AnimationTier[] = ["light", "moderate", "heavy"];

export type TierDecision = { tier: AnimationTier; reason: string };

const MODEL = process.env.OPENAI_ANIMATION_TIER_MODEL ?? "gpt-4o-mini";

const DEFAULT_TIER_MODELS: Record<AnimationTier, string> = {
  light: "gpt-5.6-luna",
  moderate: "gpt-5.6-terra",
  heavy: "gpt-5.6-sol",
};

const TIER_ENV: Record<AnimationTier, string> = {
  light: "ANIMATION_MODEL_LIGHT",
  moderate: "ANIMATION_MODEL_MODERATE",
  heavy: "ANIMATION_MODEL_HEAVY",
};

/** On unless switched off; when off, the rotation or the default model applies as before. */
export function animationTierRoutingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ANIMATION_TIER_ROUTING !== "0";
}

/** The model that draws a beat of this tier. Each tier's model can be overridden in the environment. */
export function modelForTier(tier: AnimationTier, env: Record<string, string | undefined> = process.env): AnimationModel {
  const id = env[TIER_ENV[tier]]?.trim() || DEFAULT_TIER_MODELS[tier];
  return { id, label: animationModelLabel(id) ?? id };
}

export const ANIMATION_TIER_SYSTEM_PROMPT = `You judge how demanding ONE teaching beat's animated board is to draw. Output ONLY JSON: {"tier": "light" | "moderate" | "heavy", "reason": "<at most 14 words>"}.

Judge the PICTURE the beat needs, not how hard the idea is to understand.

light — a mostly static, labelled picture: a definition, a recap, a simple comparison or list, one or two elements with a highlight. Little or nothing moves.
moderate — a process of a few steps, a diagram whose parts build up one by one, simple motion of a few elements.
heavy — a multi-stage mechanism with many interacting parts; an algorithm traced step by step over a data structure; data flowing through an architecture; a physical or spatial simulation; anything where many elements move in a coordinated sequence.

When torn between two tiers, choose the lower one.`;

/** A clean decision, whatever came back. Malformed → moderate, never the most expensive. */
export function validateAnimationTier(raw: unknown): TierDecision {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tier = typeof o.tier === "string" ? o.tier.trim().toLowerCase() : "";
  const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 140) : "";
  if ((ANIMATION_TIERS as readonly string[]).includes(tier)) return { tier: tier as AnimationTier, reason };
  return { tier: "moderate", reason: "no clear judgement; defaulted to the middle" };
}

/** Asks the model. Never throws: a failed call is "moderate", so a beat is never left without a board. */
export async function classifyAnimationTier(
  client: OpenAI,
  beat: { title: string; script?: string; learnerBrief?: string },
): Promise<TierDecision & { costUsd: number }> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 60,
      temperature: 0,
      messages: [
        { role: "system", content: ANIMATION_TIER_SYSTEM_PROMPT },
        { role: "user", content: withAudience(beat, `Lecture beat title: ${beat.title}\n\nSpoken script: ${String(beat.script ?? "").slice(0, 1800)}`) },
      ],
      response_format: { type: "json_object" },
    });
    let raw: unknown = null;
    try {
      raw = JSON.parse(completion.choices[0]?.message?.content ?? "");
    } catch {
      raw = null;
    }
    return { ...validateAnimationTier(raw), costUsd: costFor(MODEL, completion.usage) };
  } catch (error) {
    console.error("[animation-tier] classification failed:", error);
    return { tier: "moderate", reason: "classifier unavailable; defaulted to the middle", costUsd: 0 };
  }
}
