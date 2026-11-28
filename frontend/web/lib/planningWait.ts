/**
 * HOW LONG THE PLAN TAKES, SAID HONESTLY (QA brief, 2026-11-28: a maths lesson sat on "Analyzing your
 * material" for ~2.5 minutes with nothing moving). Planning is one long model call, sometimes sent back
 * once (a wrong calculation, a missing key point) and then polished — measured at 2–3.5 minutes on
 * 2026-11-28 (plan call 45–55 s, a second attempt 44 s, polish 30 s, the first three boards ~60–80 s
 * more). There is no step-by-step progress inside that call to show, so the screen shows the real clock
 * and the usual range, and says plainly when a plan is taking longer than usual. Pure; unit-tested.
 */

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The usual range, in minutes, from asking for the lesson to its first board. */
export const USUAL_PLAN_MINUTES = "2–4";
/** Past this the screen says the plan is taking longer than usual. */
export const LONG_PLAN_MS = 5 * 60_000;

export function planningWaitLine(elapsedMs: number, boardsReady = 0, boardsNeeded = 0): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
  if (elapsedMs >= LONG_PLAN_MS) return `${clock(elapsedMs)} · taking longer than usual, still working on it`;
  if (boardsNeeded > 0) return `${clock(elapsedMs)} · first boards ${Math.min(boardsReady, boardsNeeded)} of ${boardsNeeded} ready · usually ${USUAL_PLAN_MINUTES} min in all`;
  return `${clock(elapsedMs)} · planning usually takes ${USUAL_PLAN_MINUTES} min`;
}
