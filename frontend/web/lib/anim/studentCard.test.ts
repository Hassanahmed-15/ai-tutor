import test from "node:test";
import assert from "node:assert/strict";
import { buildStudentCard, gradeRules, readingGrade, readingGradeFor, studentCardInstruction, studentCardNote, studentCardPlanningLine, studentReadingRule } from "../studentCard";
import { profileLevelForTopic } from "../learnerBasics";
import { canvasPlanRequest } from "../canvas/lessonRequest";
import type { LearnerBasics } from "../db/cosmos";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";

const grade8: LearnerBasics = {
  country: "PK",
  countrySource: "user",
  studyLevel: { id: "grade-8", label: "Grade 8" },
  subjects: [{ id: "biology", label: "Biology" }, { id: "mathematics", label: "Mathematics" }],
  curricula: [{ id: "fbise", label: "Federal Board" }],
  completedAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

test("a grade becomes a reading level, from the label or its band", () => {
  assert.equal(readingGradeFor({ id: "x", label: "Grade 8" }), 8);
  assert.equal(readingGradeFor({ id: "x", label: "Class 10" }), 10);
  assert.equal(readingGradeFor({ id: "x", label: "Year 4" }), 4);
  assert.equal(readingGradeFor({ id: "x", label: "A Levels" }), 11);
  assert.equal(readingGradeFor(null), null);
});

test("the grade applies in every subject; the subject list decides only the syllabus", () => {
  const bio = buildStudentCard(grade8, "How does photosynthesis work?")!;
  assert.equal(bio.level, "Grade 8");
  assert.equal(bio.readingGrade, 8);
  assert.equal(bio.inSubject, "Biology", "one of their subjects");
  assert.match(studentCardInstruction(bio), /This is Biology, one of their school subjects/);
  assert.match(studentCardInstruction(bio), /Federal Board syllabus/);
  const history = buildStudentCard(grade8, "Why did the Mughal Empire decline?")!;
  assert.equal(history.inSubject, null);
  assert.equal(history.topicSubject, "History");
  assert.equal(history.readingGrade, 8, "still Grade 8 outside their subjects");
  assert.match(studentCardInstruction(history), /History is not one of their school subjects, so treat it as new ground — but they are still Grade 8/);
  assert.match(studentCardInstruction(history), /READING LEVEL OF GRADE 8: sentences of at most 16 words/);
  assert.match(studentCardInstruction(history), /set in Pakistan/, "local examples");
  assert.equal(studentCardNote(history), "Pitched for Grade 8 · Pakistan");
  assert.match(studentCardPlanningLine(bio), /WHO THE LESSON IS FOR: Grade 8 in Pakistan \(Federal Board\)\. Biology is one of their school subjects/);
  assert.doesNotMatch(studentReadingRule(bio), /syllabus|Pakistan/, "a strict lesson keeps only the reading level");
  assert.equal(buildStudentCard(null, "anything"), null);
});

test("a subject's own level wins, and asking 'simpler' again and again lowers the pitch", () => {
  const withMaths = { ...grade8, subjectLevels: { mathematics: { id: "o-level", label: "O Level" } } };
  const maths = buildStudentCard(withMaths, "solving a quadratic equation")!;
  assert.equal(maths.subjectLevel, "O Level");
  assert.equal(maths.readingGrade, 9);
  assert.equal(buildStudentCard(grade8, "photosynthesis", { simpler: 3 })!.readingGrade, 7);
  assert.equal(buildStudentCard(grade8, "photosynthesis", { deeper: 2 })!.readingGrade, 9);
  assert.ok(gradeRules(4).sentenceWords < gradeRules(8).sentenceWords && gradeRules(8).sentenceWords < gradeRules(13).sentenceWords);
});

test("the planning screen uses the grade for a topic outside the student's subjects instead of asking", () => {
  const inside = profileLevelForTopic(grade8, "cell division")!;
  assert.equal(inside.subject?.label, "Biology");
  const outside = profileLevelForTopic(grade8, "the French Revolution")!;
  assert.equal(outside.subject, null);
  assert.equal(outside.level.label, "Grade 8");
  assert.equal(profileLevelForTopic({ ...grade8, studyLevel: null }, "the French Revolution"), null, "no grade, so Aria asks");
});

test("reading level is measured, so a script written above the student can be caught", () => {
  const easy = "The sun gives plants light. Plants use it to make food. They make sugar and give off air we breathe.";
  const hard = "Photosynthetic organisms utilise electromagnetic radiation to synthesise carbohydrates through biochemical pathways involving chlorophyll-mediated photophosphorylation.";
  assert.ok(readingGrade(easy) < 6, `easy text reads young (${readingGrade(easy)})`);
  assert.ok(readingGrade(hard) > 14, `hard text reads old (${readingGrade(hard)})`);
});

test("the canvas planner receives the card before the portrait, as rules", () => {
  const card = buildStudentCard(grade8, "Why did the Mughal Empire decline?")!;
  const input = { topic: "Mughal Empire", mood: "", sourceType: "prompt", mode: "standard", studentCard: card, learnerPersona: "PORTRAIT", learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" } } as ProgressiveLectureInput;
  const request = canvasPlanRequest(input);
  assert.ok(request.indexOf("READING LEVEL OF GRADE 8") > 0 && request.indexOf("READING LEVEL OF GRADE 8") < request.indexOf("PORTRAIT"));
});
