import { BENCH_CRITERIA } from "./criteria";

/**
 * THE AUDIT RUBRIC — one wording for every judge (the vision calibration, the lesson judge and the
 * auditing agents), so a score means the same thing everywhere.
 *
 * Visuals are judged against NEED (owner, 2026-10-17): a board whose idea has no visual form is not
 * marked down for having no diagram; a board that needs one and lacks it, shows the wrong one, or
 * repeats an earlier board's picture is.
 */
export const CRITERION_DEFINITIONS: Record<(typeof BENCH_CRITERIA)[number], string> = {
  curriculumAuthenticity: "fits the named syllabus topic and level, in the course's own terms and notation",
  coverage: "every official outcome taught, with all its key points and standard cases",
  teachingDepth: "the topic is explained well enough that nothing is missed: every idea explained with its reason or mechanism where it has one, applied in a worked example, the standard cases covered; never judged by length — padding, repetition or over-explaining lowers it",
  factualAccuracy: "every fact, number and label is correct",
  visualClarity: "every word on every board is readable, nothing overlaps, is cut off or is covered (including by the purple mascot Dot or a quiz card), and each board's layout is clean. A board with little on it because it needs little is not a fault; an empty or wasted board where content was needed is",
  diagramsAndLabels: "judged board by board against NEED. First decide, for each board, whether its idea has a visual form: a physical structure or organism, an apparatus or experiment, a process or cycle, a graph or data, a spatial or geometric relationship, a calculation's working, a timeline or map. A board that does NOT need a visual (a definition, an argument, a short concept) is never marked down for having none — a clean text board there is full marks. A board that DOES need one must show the right visual — accurate, at textbook quality, its labels on the right parts, the parts the narration names labelled — and each board's visual must add something new. 10 = every board that needs a visual has the right one and none repeats; deduct about 2 for each board that needs a visual and has none (or only a generic table of words), about 3 for a wrong or misleading visual, 1–2 for wrong or missing labels on named parts, about 2 when the same picture is repeated on another board without showing anything new, and 1 for a decorative visual that adds nothing",
  narrationBoardSync: "what is on each board matches what is said over it, appearing as it is said",
  interaction: "the \"Check it\" cards at the end of boards and any try/draw tasks: each tests understanding of the board (not recall), not yes/no, plausible distractors from real misconceptions, exactly one defensible answer, answerable from the lesson, Aria's feedback correct. A lesson is not marked down for having no mid-board prediction",
  assessmentFairness: "the cards, the written test and its grading are fair, unambiguous and correctly marked",
  comprehension: "a student at this level would understand it",
  overallUsefulness: "how useful the lesson is to a student preparing for this syllabus",
};

/** The criteria as lines a judge reads ("- coverage: …"). */
export function rubricLines(): string {
  return BENCH_CRITERIA.map((c) => `- ${c}: ${CRITERION_DEFINITIONS[c]}`).join("\n");
}
