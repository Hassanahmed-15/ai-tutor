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
  /** Passed every check. `measured: false` = the rendered-layout check could not run on this server. */
  | { kind: "pass"; code: string; score: number; measured?: boolean }
  /** Runs, but a quality check failed. Still shippable as the best available. */
  | {
      kind: "soft-fail";
      code: string;
      score: number;
      layoutClean: boolean;
      issue: string;
      /** False when the rendered layout could not be measured at all (absent = measured). */
      measured?: boolean;
      /** The board's own code threw when rendered — it would show an error to the student. */
      renderFailed?: boolean;
      /** Strict source mode only: false when the board writes words the source does not contain. */
      grounded?: boolean;
    }
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
 * How trustworthy a runnable candidate's layout is, best first:
 *   0 measured and clean · 1 not measured (this server could not render it) · 2 measured with a
 *   fault · 3 its own code threw when rendered.
 *
 * "Not measured" sits between clean and broken on purpose. It used to be indistinguishable from
 * clean — the render failed on any fragment or hook and reported ok — so an unchecked board could
 * win over one that had been measured and found clean. Knowing beats hoping; but an unmeasured board
 * is still not KNOWN to be broken, so it ranks above one that is.
 */
export function layoutTier(verdict: CandidateVerdict): number {
  if (verdict.kind === "hard-fail") return 4;
  if (verdict.kind === "pass") return verdict.measured === false ? 1 : 0;
  if (verdict.renderFailed) return 3;
  if (!verdict.layoutClean) return 2;
  return verdict.measured === false ? 1 : 0;
}

/**
 * The candidate to ship, or null when none of them can run at all.
 *
 *   1. A candidate that passed every check — measured before unmeasured, then the highest score.
 *   2. Otherwise, among runnable soft-fails:
 *      a. in strict source mode, a board whose words all come from the source, before one that
 *         writes words the source lacks. Invented text is the one failure a strict lesson promises
 *         never to show, so no amount of polish elsewhere outranks it;
 *      b. then by layout tier (see layoutTier) — overlapping or clipped text ruins a board far more
 *         than a slightly thinner drawing;
 *      c. then the highest score. The caller decides what "score" means: drawing richness for a
 *         reference board, source-label coverage for a strict one (lib/reactAnimationGen.ts), so a
 *         busy invented scene cannot outrank a sparse faithful one there.
 * A candidate that cannot run is never chosen: a null here is what triggers a second round.
 */
export function pickCandidate<V extends CandidateVerdict>(verdicts: V[]): Extract<V, { kind: "pass" | "soft-fail" }> | null {
  type Usable = Extract<V, { kind: "pass" | "soft-fail" }>;
  const groundRank = (v: Usable) => (v.kind === "soft-fail" && v.grounded === false ? 1 : 0);
  const rank = (a: Usable, b: Usable) =>
    groundRank(a) - groundRank(b) || layoutTier(a) - layoutTier(b) || b.score - a.score;
  const passed = verdicts.filter((v): v is Usable => v.kind === "pass").sort(rank);
  if (passed.length) return passed[0];
  const soft = verdicts.filter((v): v is Usable => v.kind === "soft-fail").sort(rank);
  return soft[0] ?? null;
}
