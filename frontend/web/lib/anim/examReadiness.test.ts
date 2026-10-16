import assert from "node:assert/strict";
import test from "node:test";
import { cleanExamPractice, examBoardQuestion, lessonDocument, type LessonSpec } from "../curriculum/lessonSpec";
import { examBoardSpec, commandMeaning } from "../canvas/examBoard";
import { validateCanvasSpec } from "../canvas/validate";
import { layoutPanel } from "../canvas/layout";
import { validatePlan } from "../canvas/plan";
import { teachingCycleIssues } from "../canvas/predict";

const exam = { outcomeRef: 1, commandWord: "explain", question: "Explain how the palisade layer is adapted for photosynthesis.", marks: 9, markPoints: ["many chloroplasts to absorb light", "near the upper surface", "column-shaped and closely packed"], modelAnswer: "…", lostMarks: "Listing features without their effect." };

test("an exam question is worth one mark per marking point, opening with its command word", () => {
  const [q] = cleanExamPractice([exam], 1);
  assert.equal(q.marks, 3);
  assert.equal(q.commandWord, "Explain");
  assert.equal(cleanExamPractice([{ ...exam, markPoints: ["only one"] }], 1).length, 0, "a one-point question is not exam practice");
  assert.equal(examBoardQuestion({ examPractice: [{ ...q, marks: 2, outcomeRef: 1 }, { ...q, outcomeRef: 2 }] })?.outcomeRef, 2);
});

test("the exam board ticks each marking point on the sentence that says it, in order", () => {
  const spec = examBoardSpec({ title: "Exam practice", script: "Explain how the palisade layer is adapted, for three marks. Explain means give reasons. Palisade cells have many chloroplasts to absorb light. They sit near the upper surface. They are column-shaped and closely packed. Candidates lose marks by listing features without their effect." }, { ...exam, marks: 3 });
  assert.equal(spec.stage.kind, "exam");
  if (spec.stage.kind !== "exam") return;
  assert.deepEqual(spec.stage.points.map((p) => p.s), [2, 3, 4]);
  assert.equal(spec.stage.lostMarks?.s, 5);
  assert.match(spec.stage.commandWord, /give reasons/);
  const valid = validateCanvasSpec(spec as never, 6);
  assert.ok(valid && valid.stage.kind === "exam");
  const marks = layoutPanel(valid!).marks.filter((m) => m.type === "item");
  assert.equal(marks.length, 5, "question + three points + loses-marks");
  for (const m of marks) if (m.type === "item") assert.ok(m.rect.y + m.rect.h <= 108 + 424 + 1, `${m.id} fits on the board`);
});

test("an exam board has no prediction card and passes the plan's teaching-cycle check", () => {
  const plan = validatePlan({ beats: [{ title: "Exam practice", stage: "exam", script: "Read the question. It is worth three marks.", objects: [] }] })!;
  assert.equal(plan.beats[0].interaction, null);
  assert.deepEqual(teachingCycleIssues(plan.beats[0]), []);
  assert.ok(commandMeaning("Show that"));
});

test("a course lesson document ends with its exam practice block and board", () => {
  const spec = { courseLabel: "Cambridge O Level Biology 5090", level: "O Level", lessonTitle: "Leaf", outcomes: [{ code: null, text: "Explain leaf adaptations." }], prerequisites: [], requiredTerms: [], requiredMethods: [], commandWords: ["explain"], depth: "", misconceptions: [], outOfScope: [], boards: [{ title: "Leaf", objective: "o", outcomeRefs: [1], keyPoints: ["k"], workedExample: "", evidencePages: [] }], checkpoint: [], examPractice: cleanExamPractice([exam], 1) } as LessonSpec;
  const doc = lessonDocument(spec, { request: { courseId: "c", version: "v", grade: "g", unitId: "u", topicId: "t", lessonId: "l" }, framework: "5090", subject: "Biology" }, []);
  const blocks = doc.contentBlocks ?? [];
  const last = blocks.at(-1)!;
  assert.equal(last.heading, "Exam practice");
  assert.equal(last.exam?.marks, 3);
  assert.equal((doc.lessonPlan as { beats: unknown[] }).beats.length, 2);
  assert.match(blocks[0].teachingHints!.join(" "), /How it is examined/);
});
