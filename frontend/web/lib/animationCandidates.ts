/**
 * Choosing among board candidates drawn in parallel.
 *
 * WHY THIS EXISTS. A board used to be drawn up to three times ONE AFTER ANOTHER, each retry told what
 * was wrong with the last. Measured on a real lecture, every animated beat drew all three, the first
 * two were rejected every time (68% of all model time thrown away), and the retries never produced a
 * board that passed — all seven shipped as the best of three anyway. The student waited for the sum
 * of three drawings to get a board no better than the best single one.
 *
 * Now the candidates are drawn at the same time (lib/reactAnimationGen.ts), the first to pass every
 * check wins at once, and if none passes the best of them ships. This module is the choosing: pure,
 * so the rules can be tested.
 */

export type CandidateVerdict =
  /** Passed every check. */
  | { kind: "pass"; code: string; score: number }
  /** Runs, but a quality check failed. Still shippable as the best available. */
  | { kind: "soft-fail"; code: string; score: number; layoutClean: boolean; issue: string }
  /** Unusable: nothing returned, does not parse, or the provider failed. */
  | { kind: "hard-fail"; issue: string };

/**
 * Temperatures for one round, so the candidates actually differ. The same 0.55 -> 0.95 spread the
 * sequential retries used, now spent on variety up front instead of after a failure.
 */
export function candidateTemperatures(count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => Math.min(1, Number((0.55 + i * 0.2).toFixed(2))));
}

/**
 * The candidate to ship, or null when none of them can run at all.
 *
 *   1. A candidate that passed every check, the richest first.
 *   2. Otherwise a runnable one whose rendered layout is clean — overlapping or clipped text ruins a
 *      board far more than a slightly thinner drawing, which is the tie-break the best-of-three path
 *      already used.
 *   3. Otherwise the richest runnable one.
 * A candidate that cannot run is never chosen: a null here is what triggers a second round.
 */
export function pickCandidate<V extends CandidateVerdict>(verdicts: V[]): Extract<V, { kind: "pass" | "soft-fail" }> | null {
  type Usable = Extract<V, { kind: "pass" | "soft-fail" }>;
  const byScore = (a: Usable, b: Usable) => b.score - a.score;
  const passed = verdicts.filter((v): v is Usable => v.kind === "pass").sort(byScore);
  if (passed.length) return passed[0];
  const soft = verdicts.filter((v): v is Usable => v.kind === "soft-fail").sort(byScore);
  const clean = soft.filter((v) => v.kind === "soft-fail" && v.layoutClean);
  return clean[0] ?? soft[0] ?? null;
}
