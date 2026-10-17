import { BENCH_CRITERIA } from "./criteria";

/**
 * THE AUDIT RUBRIC — one wording for every judge (the vision calibration, the lesson judge and the
 * auditing agents), so a score means the same thing everywhere.
 *
 * Visuals are judged against NEED (owner, 2026-10-17): a board whose idea has no visual form is not
 * marked down for having no diagram; a board that needs one and lacks it, shows the wrong one, or
 * repeats an earlier board's picture is.
 *
 * Re-evaluated as too strict (owner, 2026-10-17): diagrams and labels are not needed everywhere, and
 * the board need not match everything Aria says — about 70% is fine. So most boards need no diagram,
 * labels count only on diagrams, sync is judged as a summary of the speech, and small blemishes cost
 * little. Scores describe what a student experiences.
 */
export const CRITERION_DEFINITIONS: Record<(typeof BENCH_CRITERIA)[number], string> = {
  curriculumAuthenticity: "fits the named syllabus topic and level, in the course's own terms and notation",
  coverage: "every official outcome taught, with all its key points and standard cases",
  teachingDepth: "the topic is explained well enough that nothing is missed: every idea explained with its reason or mechanism where it has one, applied in a worked example, the standard cases covered; never judged by length — padding, repetition or over-explaining lowers it",
  factualAccuracy: "every fact, number and label is correct",
  visualClarity: "the boards are readable and tidy: text can be read, nothing important is cut off, overlapped or covered (including by the purple mascot Dot or a quiz card). Judge what a student would notice — one small blemish on one board costs at most 1; only problems that stop a student reading something cost more. A board with little on it because it needs little is not a fault",
  diagramsAndLabels: "judged against NEED, generously. Most boards do NOT need a diagram: definitions, arguments, explanations, comparisons and short concepts are fully served by clear notes, a table, a flow or a worked equation, and score full marks that way. Only a board whose idea is genuinely hard to understand without a picture (a physical structure the student must identify, an apparatus, a map, a graph of data, a spatial relationship) needs a diagram. Labels matter only on diagrams, and only for the parts the board is about — not every part must be labelled. 10 = every board that truly needs a diagram has a correct one; 9 = one such board is weaker than ideal; deduct about 2 for a board that clearly needed a diagram and has none, about 3 for a diagram that is WRONG or misleading (a label on the wrong part, a wrong arrow), and 1 for the same picture repeated with nothing new. Never deduct because a board has no diagram or no labels when its idea did not need one",
  narrationBoardSync: "the board supports what Aria says: its key points, terms and numbers appear while she says them. The board is a summary, not a transcript — about 70% of what she says being reflected on the board is full marks, and a note appearing a sentence early or late is fine. Deduct only when the board is about something different from the speech, contradicts it, or runs clearly out of step (content appearing long before or after it is spoken)",
  interaction: "the \"Check it\" cards at the end of boards and any try/draw tasks: each tests understanding of the board (not recall), not yes/no, plausible distractors, exactly one defensible answer, answerable from the lesson, Aria's feedback correct. Not every board needs a card; a lesson is not marked down for having no mid-board prediction",
  assessmentFairness: "the cards, the written test and its grading are fair, unambiguous and correctly marked",
  comprehension: "a student at this level would understand it",
  overallUsefulness: "how useful the lesson is to a student preparing for this syllabus",
};

/** The criteria as lines a judge reads ("- coverage: …"). */
export function rubricLines(): string {
  return BENCH_CRITERIA.map((c) => `- ${c}: ${CRITERION_DEFINITIONS[c]}`).join("\n");
}
