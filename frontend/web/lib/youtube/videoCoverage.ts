import { contentStems, sourceVocabulary, splitSentences } from "../sourceGrounding";

/**
 * DID THE BOARD TEACH EVERY KEY POINT IT WAS GIVEN?
 *
 * A video lecture's promise is that it is shorter than the video without leaving anything out. The
 * key points of each chapter are the contract (lib/youtube/videoNotes.ts), and the strict path is
 * told to teach every block completely — but a prompt is a request. The strict grounding gate checks
 * one direction only: that the script says nothing the source does not. Nothing checked the other
 * direction, that the source's points all made it into the script, and a script can pass grounding
 * perfectly by teaching four of seven points well.
 *
 * So this is the inverse of the grounding gate, built from the same parts (lib/sourceGrounding.ts):
 * a key point counts as taught when most of its content words appear in the script. Paraphrase
 * passes — "stores a number between 0 and 1" covers "holds a value from 0 to 1" on the words that
 * carry it — and a point the script never touched fails, because none of its terms are there.
 *
 * Deterministic and free on purpose: it runs on every board, including the opening ones that hold
 * up playback. The measured, model-judged version of the same question lives in
 * scripts/audit-video-coverage.mjs.
 */

/** A point is taught when at least this share of its content words is in the script. */
export const COVERAGE_MIN_SHARE = 0.6;

/** The key points of a beat: every sentence of its own blocks, in order. */
export function videoKeyPoints(blocks: Array<{ id: string; text?: string }>, sourceBlockIds: string[] | undefined): string[] {
  const wanted = new Set(sourceBlockIds ?? []);
  return blocks
    .filter((block) => wanted.has(block.id))
    .flatMap((block) => splitSentences(block.text ?? ""));
}

/** The key points the script does not teach. Empty means the board covers its source. */
export function uncoveredKeyPoints(script: string, points: string[]): string[] {
  const said = sourceVocabulary(script);
  return points.filter((point) => {
    const terms = [...new Set(contentStems(point))];
    // A point with no content words ("So that is it.") asserts nothing to cover.
    if (terms.length === 0) return false;
    const present = terms.filter((term) => said.has(term)).length;
    return present / terms.length < COVERAGE_MIN_SHARE;
  });
}

/** Share of the key points a script teaches, 0..1. For logging and the audit, not for gating. */
export function coverageRatio(script: string, points: string[]): number {
  if (points.length === 0) return 1;
  return 1 - uncoveredKeyPoints(script, points).length / points.length;
}
