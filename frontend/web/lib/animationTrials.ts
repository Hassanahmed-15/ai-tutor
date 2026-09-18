import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * One line per finished animation board, for comparing the models that drew them.
 *
 * Written where a board is finished (lib/reactAnimationGen.ts), so every path that generates one —
 * progressive lectures, whole-lecture generation, the head-to-head script — lands in the same log.
 * Read by scripts/compare-animation-models.mjs.
 *
 * `score` is the shared vision judge's final 1-5 for the board, or null when it was not scored
 * (abstract diagrams skip that critic). Null is reported separately, never averaged in as zero.
 * `providerError` is set when the provider never answered: that is an availability fact about the
 * model, not a verdict on its drawing, and the comparison keeps the two apart.
 */
export type AnimationTrial = {
  model: string;
  beatId: string;
  title: string;
  outcome: "shipped" | "sub-floor" | "refused" | "failed";
  providerError: string | null;
  score: number | null;
  attempts: number;
  costUsd: number;
  ms: number;
  abstract: boolean;
};

export const ANIMATION_TRIALS_FILE = path.join(process.cwd(), ".animation-trials", "trials.jsonl");

/** Never throws: a log that cannot be written must not cost a student their board. */
export async function recordAnimationTrial(trial: AnimationTrial): Promise<void> {
  try {
    await mkdir(path.dirname(ANIMATION_TRIALS_FILE), { recursive: true });
    await appendFile(
      ANIMATION_TRIALS_FILE,
      `${JSON.stringify({ at: new Date().toISOString(), run: process.env.ANIMATION_TRIAL_RUN ?? null, ...trial })}\n`,
    );
  } catch {
    // Best effort only.
  }
}
