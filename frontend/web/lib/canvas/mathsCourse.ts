/**
 * MATHS COURSES TAUGHT LIKE EVERY OTHER COURSE (owner, 2026-11-14: "completely change how maths is … make it like
 * every other course: correctly labelled maths diagrams like other courses and the teaching style like other
 * courses; just the equation should have something new, and problems and examples step by step; the diagrams
 * should be easy").
 *
 * With CANVAS_MATHS_LIKE_COURSES=on, a COURSE maths lesson (never a typed prompt or a PDF):
 *   - draws its pictures the way every course does — gpt-image-2 with the maths family's prompt and the same
 *     label checks (lib/canvas/coursePicture.ts) — instead of the pencil engine (owner's pick: "gpt-image-2 for all");
 *   - is taught by the course rules every subject follows (lib/teaching/lessonTypes.ts TEACHING_RULES), plus the
 *     short step-by-step rules below, in place of the separate MATHS_TEACHING block;
 *   - shows its working as the STEP-BY-STEP BUILDER (components/canvas/StepBuilderView.tsx): each line comes when
 *     Aria says it, under the one before, the part that changed lit, the operation written beside it.
 * Off: maths courses are exactly as before.
 */
export function mathsLikeCoursesOn(): boolean {
  return process.env.CANVAS_MATHS_LIKE_COURSES === "on";
}

/** A course lesson taught as maths (its board carries the course's subject, lib/canvas/lessonSubject.ts). */
export function isCourseMaths(beat: { course?: boolean; subject?: string }): boolean {
  return Boolean(beat.course) && beat.subject === "maths";
}

/** Added to the course rules for a maths lesson: only what maths needs on top of them. */
export const MATHS_STEP_BY_STEP = [
  "THIS IS A MATHS LESSON — TAUGHT LIKE EVERY COURSE LESSON (the idea first, built up in plain words, with a picture), AND EVERY EXAMPLE AND PROBLEM WORKED STEP BY STEP:",
  "- Before any working, say what we want to find, in words (\"We want the length of the third side.\").",
  "- One step per sentence: first WHY (\"to get x on its own\"), then WHAT is done (\"we subtract 3 from both sides\"), then the new line (\"2x = 8\"). Never skip a line of algebra, never two operations in one step.",
  "- The working is written line under line, one line per step, each line the equation after that step; the step's operation is named in the same words every time (subtract 3 from both sides, divide both sides by 2, expand the brackets, substitute r = 4).",
  "- Say every symbol the first time it appears and every formula in words as well as symbols; state the conditions a result needs (a right angle for Pythagoras).",
  "- Every answer is said as an equation with its unit (\"so c = 10 cm\"), then checked (put it back in, or ask whether it is sensible).",
  "- After a worked example, the student tries one like it: give it, \"pause and think\", then walk the answer step by step the same way. Then the common mistake and why it is wrong.",
  "- EVERY board about a shape, angle, line, graph, chart, measurement or a word problem's situation SHOWS it in a picture — a ready-made textbook diagram (stage \"illustration\"), never only described in words; a board that works something out about it is working with its picture beside it, and its \"visual\" is \"diagram\" (only working on pure symbols, with nothing to see, is \"math\"). The picture is simple: one figure, labelled with exactly the letters and values the working uses.",
].join("\n");

/** Told to the board writer for a maths course board whose stage is working (an equation). */
export const MATHS_STEP_FIELDS = `THIS BOARD'S WORKING IS SHOWN LINE BY LINE (a new line under the last for each step): every step's "order" is the WHOLE line after that step; its "highlight" lists exactly the tokens that changed from the line before (the new or moved terms); its "caption" (REQUIRED, at most 26 characters) names the operation that gave this line, in plain words: "subtract 3 from both sides", "÷ 2 both sides", "expand the brackets", "substitute r = 4", "square root both sides", "collect like terms". The first line's caption says what it is ("the equation", "the formula", "given").`;
