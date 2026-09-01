import type { PlanOutline } from "./planPrompt";

/**
 * How long a lesson should be, decided by how much the subject actually contains.
 *
 * WHY THIS EXISTS. Every typed-topic lecture was built to the same fixed shape — "produce a FULL
 * lecture of 10-12 beats", 1050-1450 words — regardless of what was asked. That is right for
 * "teach me photosynthesis" and wrong for "why are there infinitely many prime numbers?", which has
 * one proof at its centre and is completely taught in four or five boards. Asked for the narrow
 * thing, the model still owed ten beats, so it padded: the same argument restated from a second
 * angle, a history section nobody wanted, an applications board with no applications. Padding does
 * not just waste the student's time, it actively obscures the answer they came for.
 *
 * THE FIX IS NOT "MAKE EVERYTHING SHORTER". A concise lesson that skips the reasoning is worse than
 * a padded one. What changes here is only the LENGTH TARGET; the per-beat depth floor is untouched,
 * so a four-beat lesson still owes the same patient explanation per board as a twelve-beat one. The
 * lesson gets shorter by covering less ground, never by explaining less well.
 *
 * SCOPE COMES FROM THE PLAN, NOT FROM THE WORDING. The tempting approach is to pattern-match the
 * prompt — a question mark, a "why", a short string. That misreads constantly in both directions:
 * "why is the sky blue?" is narrow, "why did the Roman Empire fall?" is not, and both are short
 * questions starting with why. The planner has already decided how many subtopics the subject
 * genuinely needs (see planPrompt.ts), having actually thought about the content, so its subtopic
 * count is the honest signal and this maps it to a beat budget.
 */

export type LessonScope = {
  /** Fewest beats that can still teach this properly. Enforced by the sanitizer. */
  minBeats: number;
  /** The upper end of the range given to the model. Not a hard rejection — see route.ts. */
  maxBeats: number;
  /**
   * Total spoken words expected across the lecture. Derived from the beat budget rather than fixed,
   * because the old flat floor (~1050 words) is precisely what forced a short subject to ramble.
   */
  minTotalWords: number;
  /** Short label for logs and the build screen. */
  label: "focused" | "standard" | "broad";
};

/**
 * Per-beat narration floor, unchanged from the original prompt.
 *
 * Deliberately NOT scaled down for focused lessons. The whole risk of making lessons shorter is
 * that "concise" quietly becomes "thin", and this constant is what prevents it: fewer boards, each
 * taught just as thoroughly.
 */
export const WORDS_PER_TEACHING_BEAT = 100;

/** Absolute floor. Below this there is no lesson, only an answer — intro, teach, check, recap. */
const ABSOLUTE_MIN_BEATS = 4;

/**
 * Beats needed beyond the subtopics themselves: an opening, a closing recap, and a checkpoint.
 *
 * A focused lesson gets ONE checkpoint rather than two — with four teaching boards, a second
 * checkpoint interrupts more than it consolidates.
 */
function scaffoldBeats(subtopicCount: number): number {
  return subtopicCount <= 5 ? 3 : 4;
}

/**
 * Work out the lesson's length budget from its approved outline.
 *
 * `null` outline means the planner was skipped entirely (a demo, a direct build, a document lesson
 * that carries its own plan). That returns the standard shape, so every existing path behaves
 * exactly as it did before this file existed.
 */
export function scopeFromOutline(outline: PlanOutline | null): LessonScope {
  const subtopics = outline?.subtopics?.length ?? 0;
  if (!subtopics) return STANDARD_SCOPE;

  const scaffold = scaffoldBeats(subtopics);
  // One beat per subtopic is the starting point; the prompt may still merge two onto one board, so
  // the minimum sits below the sum rather than exactly on it.
  const target = subtopics + scaffold;
  const minBeats = Math.max(ABSOLUTE_MIN_BEATS, Math.round(target * 0.75));
  const maxBeats = Math.max(minBeats + 1, target + 1);

  return {
    minBeats,
    maxBeats,
    minTotalWords: minBeats * WORDS_PER_TEACHING_BEAT,
    label: subtopics <= 4 ? "focused" : subtopics <= 7 ? "standard" : "broad",
  };
}

/**
 * The shape every lecture used to be built to, kept as the default.
 *
 * Used wherever there is no outline to reason from. Identical to the previous hard-coded numbers,
 * so "no plan" produces exactly the lecture it always did.
 */
export const STANDARD_SCOPE: LessonScope = {
  minBeats: 9,
  maxBeats: 12,
  minTotalWords: 900,
  label: "standard",
};

/**
 * A focused explanation of one question about an uploaded document.
 *
 * The document path already had this instinct — `minUsableBeats` dropped to 4 for a focused
 * question — and this names it instead of leaving it as a bare number in a conditional.
 */
export const FOCUSED_SCOPE: LessonScope = {
  minBeats: ABSOLUTE_MIN_BEATS,
  maxBeats: 8,
  minTotalWords: ABSOLUTE_MIN_BEATS * WORDS_PER_TEACHING_BEAT,
  label: "focused",
};

/**
 * The length instruction handed to the lecture prompt.
 *
 * Phrased as "as many as the subject needs, within this range" rather than a quota. The distinction
 * matters: told to produce exactly N beats, a model that runs out of material pads to reach N,
 * which is the behaviour being fixed. Told a range and given explicit permission to finish early,
 * it stops when the explanation is complete.
 */
export function scopeInstruction(scope: LessonScope): string {
  if (scope.label === "focused") {
    return (
      `\n\nLESSON LENGTH — THIS IS A FOCUSED QUESTION, NOT A SURVEY COURSE.\n` +
      `Produce ${scope.minBeats}-${scope.maxBeats} beats: exactly as many as it takes to answer it completely, and no more. ` +
      `A complete answer in ${scope.minBeats} beats is a SUCCESS, not a lecture that fell short — do not pad to reach the upper number.\n` +
      `- Teach the actual reasoning: the claim, why it is true, a worked concrete example, and the misconception that usually gets in the way.\n` +
      `- Do NOT restate the same explanation from a second angle to fill space.\n` +
      `- Do NOT add history, applications, adjacent topics, or a prerequisite survey unless answering the question genuinely requires them.\n` +
      `- Use ONE checkpoint, not two.\n` +
      `- Every teaching beat still needs its full ${WORDS_PER_TEACHING_BEAT}-140 words. Shorter lesson, same depth per board — cover less ground, never explain less well.\n` +
      `- Visuals still matter: a focused lesson keeps the diagram or worked-example board that makes the idea click.`
    );
  }
  if (scope.label === "broad") {
    return (
      `\n\nLESSON LENGTH: produce ${scope.minBeats}-${scope.maxBeats} beats. This is a broad subject, so use the room ` +
      `to cover it properly, but do not repeat an explanation you have already given.`
    );
  }
  return (
    `\n\nLESSON LENGTH: produce ${scope.minBeats}-${scope.maxBeats} beats — as many as the subject genuinely needs. ` +
    `If it is fully taught in ${scope.minBeats}, stop there rather than padding to the upper number.`
  );
}
