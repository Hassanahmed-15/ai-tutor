/**
 * ONE SUBTOPIC, TAUGHT OVER SEVERAL BOARDS.
 *
 * The lecture had no way to say "this idea takes three boards". A plan entry was a beat was a
 * slide, and `conceptId` was derived as `concept-${sequence}-${slug(title)}` — so the sequence
 * number alone guaranteed that no two beats ever shared a concept. `decideBoardMove` could
 * therefore never return "continue", and the roller-belt in BoardStage, which exists precisely to
 * keep one concept on one surface, was unreachable code.
 *
 * The visible symptom is the reported one: a subtopic explained in depth produced a NEW TITLED
 * SLIDE per explanation, so three passes over one idea read as three unrelated topics, each
 * announcing itself with a title card.
 *
 * This module expands one planned subtopic into the passes it actually needs. The passes share a
 * `conceptId`, so the board continues rather than restarting, and each carries its position in the
 * concept (`conceptPass` of `conceptPasses`) so the player can tell the first pass — which earns
 * the title card and the entrance — from the ones that roll underneath it, and can tell when the
 * concept is FINISHED, which is the only moment advancing to the next subtopic is correct.
 *
 * Pure and deterministic: no model call, no randomness. A plan is a plan, and the same outline
 * must produce the same lecture.
 */

import type { DepthLevelName } from "../lectureDepth";
import { LADDER, type TeachingRole } from "../lessonLadder";

export interface PlannedSubtopic {
  title: string;
  objective: string;
}

export interface ConceptPass extends PlannedSubtopic {
  /** Shared by every pass over this subtopic — this is what makes the board continue. */
  conceptKey: string;
  /** 1-based position within the concept. Pass 1 gets the title card. */
  pass: number;
  /** Total passes for this concept. `pass === passes` means the concept ends here. */
  passes: number;
  /** What this particular pass is for, appended to the objective so passes do not repeat. */
  passRole: PassRole;
}

/**
 * What each successive board over one idea is FOR.
 *
 * Without distinct roles, "explain this twice" means "say it again", which is the repetition
 * problem this codebase already fought once. A second board earns its place by doing something the
 * first did not: make it concrete, then probe where it breaks.
 */
export type PassRole = "establish" | "example" | "deepen";

const ROLE_INSTRUCTION: Record<PassRole, string> = {
  establish: "Establish the idea itself: what it is and why it is true.",
  example: "Make it concrete: work through an actual example of the idea just established, on the same board, underneath the work already there.",
  deepen: "Go deeper: the subtle case, the common misconception, or the edge where the simple version breaks down. Build on what is already on this board.",
};

/**
 * Ideas that genuinely take more than one board.
 *
 * Depth is earned by the CONTENT, not bought with a slider — a definition is one board however
 * deep the lesson is set, and a mechanism with a worked example is not one board however shallow.
 * These are the markers of an idea with internal structure: something that happens in steps,
 * something with a worked form, something with a failure mode worth showing.
 */
const MULTI_BOARD = /\b(how|why|mechanism|process|step|work(s|ing)?|deriv|proof|prove|solve|calculat|example|apply|application|appli|cycle|stage|phase|pathway|reaction|algorithm|model|method|technique|behaviou?r|interact|transform|convert|regulat|control)\b/i;

/** Ideas that are definitionally one board: naming a thing, or closing the lesson. */
const SINGLE_BOARD = /\b(recap|summary|summar|overview|introduc|what is|definition|defin|terminology|vocabulary|glossary|history|background|context)\b/i;

/**
 * How many boards this subtopic deserves.
 *
 * Capped at three by MAX_BOARDS_PER_CONCEPT in teachingState.ts: past three screens a student can
 * no longer scroll back to the start of the idea without losing their place, and a concept needing
 * four boards is really two concepts.
 */
export function passesFor(
  subtopic: PlannedSubtopic,
  depth: DepthLevelName,
  options: { isFirst?: boolean; isLast?: boolean } = {},
): number {
  // The opener and the recap frame the lesson; neither is an idea to be taught in depth.
  if (options.isFirst || options.isLast) return 1;

  const text = `${subtopic.title} ${subtopic.objective}`;
  if (SINGLE_BOARD.test(text)) return 1;

  /*
   * A second board over one idea is a second chance to repeat it. "Concise" therefore gets ONE
   * board per subtopic — the example lives inside it — and only "balanced" and "deep" earn the
   * continuation boards, each of which has its own distinct job (see ROLE_INSTRUCTION) and is
   * audited against everything before it (lib/lessonRepetition.ts).
   */
  if (!MULTI_BOARD.test(text)) return 1;
  if (depth === "concise") return 1;
  if (depth === "deep") return 3;
  return 2;
}

/**
 * Expand planned subtopics into the beats that teach them.
 *
 * Titles are NOT uniquified here and must not be: every pass over one concept keeps the subtopic's
 * own title, because the header is meant to say what is being taught, and it is still that
 * subtopic on the third board. `polishBeatPlan` renames duplicates, so it must run on the
 * SUBTOPICS — before this expansion — never on its output.
 */
export function expandConceptPasses(
  subtopics: Array<PlannedSubtopic & { role?: TeachingRole }>,
  depth: DepthLevelName,
  slugify: (value: string) => string,
): ConceptPass[] {
  const out: ConceptPass[] = [];
  subtopics.forEach((subtopic, index) => {
    /*
     * Each pass climbs one rung above the last (lib/progressivePlan.ts roleForPass), so a subtopic
     * can only have as many passes as there are rungs left above its own: a "contrast" board has
     * nowhere to climb and gets one pass, a "pitfall" board two. Without this cap the extra passes
     * clamped onto the same top rung and became the same board twice.
     */
    const passes = Math.min(
      passesFor(subtopic, depth, { isFirst: index === 0, isLast: index === subtopics.length - 1 }),
      rungsAbove(subtopic.role),
    );
    const conceptKey = `concept-${index + 1}-${slugify(subtopic.title)}`;
    for (let pass = 1; pass <= passes; pass++) {
      out.push({
        title: subtopic.title,
        /*
         * The FIRST pass carries the subtopic's objective; a LATER pass leads with its own job and
         * mentions the original only as what is already on the board. When both passes carried the
         * same objective verbatim, the model wrote the same board twice.
         */
        objective: pass === 1
          ? subtopic.objective
          : `${ROLE_INSTRUCTION[roleFor(pass, passes)]} The idea itself is already on the board above this one (that board's job was: ${subtopic.objective}) — do not re-establish it.`,
        conceptKey,
        pass,
        passes,
        passRole: roleFor(pass, passes),
      });
    }
  });
  return out;
}

/** How many boards a subtopic on this rung can occupy while climbing: its own rung plus those above it. */
function rungsAbove(role: TeachingRole | undefined): number {
  // No rung known (a caller that has not run the ladder): nothing to cap against.
  if (!role) return Number.POSITIVE_INFINITY;
  const climb: TeachingRole[] = LADDER.filter((r) => r !== "hook" && r !== "recap");
  const index = climb.indexOf(role);
  // The hook and the recap never continue.
  if (index < 0) return 1;
  return climb.length - index;
}

function roleFor(pass: number, passes: number): PassRole {
  if (pass === 1) return "establish";
  // With three passes the middle one is the worked example and the last goes deeper; with two,
  // the second is the example, because a concrete case is worth more than a caveat.
  if (pass === 2 && passes >= 3) return "example";
  return pass === passes && passes >= 3 ? "deepen" : "example";
}
