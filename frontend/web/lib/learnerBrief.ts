import { conceptKey } from "./learnerModel";
import { resolveDepth, type DepthLevel, type LearnerProfile } from "./learnerProfile";

/**
 * How to pitch ONE beat for ONE student — for the script writer, and for the board.
 *
 * WHY THIS EXISTS. The lecture worker was told only "use language for a beginner learner", and the
 * boards were told nothing at all about who was watching. So an expert and a beginner got the same
 * animation, and the only personalisation was a single adjective in the script prompt.
 *
 * THE RESEARCH THIS FOLLOWS: the expertise-reversal effect (Kalyuga, Ayres, Chandler & Sweller, 2003,
 * and the meta-analysis in Learning and Instruction, 2025). The same material helps one learner and
 * hinders another:
 *   - Novices lack the schemas that make sense of new material, so worked examples, defined terms,
 *     and step-by-step, fully-labelled diagrams REDUCE their load.
 *   - Experts already hold those schemas; re-explaining them forces a reconciliation with what they
 *     already know, which ADDS load. They learn more from leaner, problem-focused material:
 *     formal statements, edge cases, trade-offs, comparisons.
 *   - In between, "fading" works: a worked example whose last step the learner completes.
 * So the same beat is briefed in opposite directions depending on the level, rather than with more
 * or less of one thing.
 *
 * The brief is density and presentation guidance only. It never changes WHAT the beat teaches, and
 * for boards it never overrides what the subject must look like — a beginner's heart is still a heart.
 *
 * Pure: no model call. Capped so it adds little to every prompt.
 */

export const BRIEF_MAX_CHARS = 600;

type Band = "novice" | "intermediate" | "expert";

const GUIDANCE_BAND: Record<"worked" | "faded" | "independent", Band> = { worked: "novice", faded: "intermediate", independent: "expert" };

function band(depth: DepthLevel): Band {
  return depth <= 2 ? "novice" : depth === 3 ? "intermediate" : "expert";
}

const SCRIPT_GUIDANCE: Record<Band, string> = {
  novice:
    "Novice: show a concrete worked example BEFORE the general rule; define each technical term the first time it appears; one idea per sentence; no unexplained notation.",
  intermediate:
    "Intermediate: use a faded example — work the first steps, then ask the learner to predict the last; define only new terms; connect to what they know.",
  expert:
    "Expert: do not re-explain basics; state the idea precisely (formal notation is fine), then spend the time on edge cases, trade-offs, and where it breaks.",
};

const VISUAL_GUIDANCE: Record<Band, string> = {
  novice:
    "Audience is a novice: label every part in plain words, build the board up one step per sentence, keep to about five main elements, and change one thing at a time.",
  intermediate:
    "Audience is intermediate: label the key parts, group related elements, and show the one relationship this beat is about.",
  expert:
    "Audience is an expert: a denser board is fine; prefer precise notation and symbols over pictograms, and show a comparison or a variant where it sharpens the point.",
};

/*
 * THE SAME PITCH, FOR A STRICT SOURCE LESSON.
 *
 * The expertise-reversal guidance above changes presentation — but three of its six lines do it by
 * ADDING material: a worked example before the rule, a faded example, a comparison or a variant.
 * In a lesson that may say only what its source says, those are instructions to invent. The strict
 * lines keep what the research is about (how much is unpacked, how it is sequenced, how dense the
 * board is) and draw every example from the source or not at all.
 */
const STRICT_SCRIPT_GUIDANCE: Record<Band, string> = {
  novice:
    "Novice: keep to the source's own words and order; say what each source term means the first time it appears, using the source's own wording; one idea per sentence. Use an example only where the source gives one — never make one up.",
  intermediate:
    "Intermediate: follow the source's order and connect each of its sentences to the last; define only the source's new terms; use only the source's own examples.",
  expert:
    "Expert: state the source's points precisely and briskly, without padding; add nothing the source does not state.",
};

const STRICT_VISUAL_GUIDANCE: Record<Band, string> = {
  novice:
    "Audience is a novice: label every part the source names, in the source's own words, build the board up one step per sentence, and change one thing at a time.",
  intermediate:
    "Audience is intermediate: label the parts the source names and group what the source groups.",
  expert:
    "Audience is an expert: a denser board is fine, but every element and label must come from the source.",
};

/** Profile concepts that this beat touches, so the brief names only what matters here. */
function overlapping(concepts: string[], beatText: string): string[] {
  const words = new Set(conceptKey(beatText).split(" ").filter((w) => w.length > 3));
  return concepts.filter((concept) => conceptKey(concept).split(" ").some((w) => words.has(w)));
}

function cap(text: string): string {
  return text.length <= BRIEF_MAX_CHARS ? text : `${text.slice(0, BRIEF_MAX_CHARS - 1)}…`;
}

export function learnerBrief(
  profile: LearnerProfile,
  beat: { title: string; objective?: string },
  purpose: "script" | "visual",
  depth: DepthLevel = resolveDepth(profile),
  options: { strict?: boolean; guidance?: "worked" | "faded" | "independent" } = {},
): string {
  // The Teaching Policy's guidance (lib/teachingPolicy.ts) when there is one — it weighs the
  // student's chosen challenge and grade as well as this lesson's depth — else the depth alone.
  const level: Band = options.guidance ? GUIDANCE_BAND[options.guidance] : band(depth);
  /*
   * Strict: the pitch only. The profile-concept lines below re-teach prerequisites ("re-establish
   * it briefly"), correct misconceptions ("show why this is wrong") and skip what they know ("do not
   * re-teach it") — each of which changes WHAT is taught, and in a strict lesson the source alone
   * decides that.
   */
  if (options.strict) return cap(purpose === "script" ? STRICT_SCRIPT_GUIDANCE[level] : STRICT_VISUAL_GUIDANCE[level]);
  const beatText = `${beat.title} ${beat.objective ?? ""}`;
  const parts = [purpose === "script" ? SCRIPT_GUIDANCE[level] : VISUAL_GUIDANCE[level]];

  const known = overlapping(profile.masteredConcepts, beatText);
  const shaky = overlapping([...profile.weakConcepts, ...profile.prerequisiteGaps], beatText);
  const wrong = overlapping(profile.misconceptions, beatText);
  if (purpose === "script") {
    if (known.length) parts.push(`They already know ${known.join(", ")}: build on it, do not re-teach it.`);
    if (shaky.length) parts.push(`They are shaky on ${shaky.join(", ")}: re-establish it briefly where it is first needed.`);
    if (wrong.length) parts.push(`Correct this belief explicitly: ${wrong.join("; ")}.`);
  } else {
    if (shaky.length) parts.push(`Give ${shaky.join(", ")} its own clearly labelled step.`);
    if (wrong.length) parts.push(`Make the board show why this is wrong: ${wrong.join("; ")}.`);
  }
  return cap(parts.join(" "));
}

/**
 * Append a beat's audience guidance to a board generator's user prompt.
 *
 * Every board generator (sandbox animation, chalkboard, Manim, structure, chart, equation, and the
 * visual planner) passes its prompt through this, so the board is pitched like the script. Worded
 * as presentation guidance so it cannot override the subject's required form.
 */
export function withAudience(beat: { learnerBrief?: string }, prompt: string): string {
  return beat.learnerBrief
    ? `${prompt}\n\nAUDIENCE — how to pitch this board for the student watching (presentation and density only; never change what the board depicts): ${beat.learnerBrief}`
    : prompt;
}
