import test from "node:test";
import assert from "node:assert/strict";
import { nextPart, splitIntoLessons } from "../series/split";
import { completeSpec, lessonPartDocument, type LessonSpec } from "../curriculum/lessonSpec";
import { withTeachingOrders, MAX_LESSON_BOARDS } from "../teaching/courseOrders";

const idea = (title: string, ...refs: number[]) => ({ title, outcomeRefs: refs });

test("a lesson of up to three ideas stays one lesson", () => {
  for (const n of [1, 2, 3]) {
    const parts = splitIntoLessons(Array.from({ length: n }, (_, i) => idea(`I${i}`, i + 1)), 3);
    assert.equal(parts.length, 1);
    assert.deepEqual(parts[0].ideas, Array.from({ length: n }, (_, i) => i));
  }
});

test("a bigger lesson is shared out evenly over the fewest lessons, never more than three ideas each", () => {
  const sizes = (n: number) => splitIntoLessons(Array.from({ length: n }, (_, i) => idea(`I${i}`, i + 1)), 3).map((p) => p.ideas.length);
  assert.deepEqual(sizes(4), [2, 2]);
  assert.deepEqual(sizes(5), [3, 2]);
  assert.deepEqual(sizes(6), [3, 3]);
  assert.deepEqual(sizes(7), [3, 2, 2]);
  assert.deepEqual(sizes(8), [3, 3, 2]);
});

test("an outcome taught by two ideas is kept in one lesson when there is another place to cut", () => {
  // Ideas 2 and 3 both teach outcome 2: the even cut (2+2) would split it, so it cuts after idea 3 instead.
  const parts = splitIntoLessons([idea("A", 1), idea("B", 2), idea("C", 2), idea("D", 3)], 3);
  assert.deepEqual(parts.map((p) => p.ideas), [[0, 1, 2], [3]]);
  assert.deepEqual(parts.map((p) => p.outcomeRefs), [[1, 2], [3]]);
  assert.deepEqual(parts.map((p) => p.part), [1, 2]);
});

test("the next lesson is the first unfinished one; a re-split starts again", () => {
  const titles = [["A", "B"], ["C", "D"]];
  assert.equal(nextPart(null, titles), 1);
  assert.equal(nextPart({ parts: 2, titles, completed: [] }, titles), 1);
  assert.equal(nextPart({ parts: 2, titles, completed: [1] }, titles), 2);
  assert.equal(nextPart({ parts: 2, titles, completed: [1, 2] }, titles), 2);
  assert.equal(nextPart({ parts: 2, titles: [["A"], ["B", "C", "D"]], completed: [1] }, titles), 1, "the lessons changed: start again");
});

const request = { courseId: "x", version: "v", grade: "10", unitId: "u", topicId: "t", lessonId: "l" };
const spec = (n: number): LessonSpec => completeSpec({
  courseLabel: "Cambridge IGCSE Biology", level: "IGCSE", lessonTitle: "Respiration",
  outcomes: Array.from({ length: n }, (_, i) => ({ code: `${i + 1}`, text: `Explain idea ${i + 1}.` })),
  prerequisites: ["what a cell is", "what energy is", "a third one"], requiredTerms: ["aerobic"], requiredMethods: [], commandWords: ["explain"], depth: "IGCSE.",
  misconceptions: [], outOfScope: [],
  boards: Array.from({ length: n }, (_, i) => ({ title: `Idea ${i + 1}`, objective: "o", outcomeRefs: [i + 1], keyPoints: [`point ${i + 1}`], workedExample: "", evidencePages: [] })),
  checkpoint: Array.from({ length: n }, (_, i) => ({ question: `Q${i + 1}?`, answer: `A${i + 1}`, outcomeRef: i + 1 })),
  examPractice: Array.from({ length: n }, (_, i) => ({ outcomeRef: i + 1, commandWord: "Explain", question: `Exam ${i + 1}`, marks: 2 + i, markPoints: ["a", "b"], modelAnswer: "", lostMarks: "", levels: [] })),
});

test("each lesson of a series opens on its plan and ends on its quiz, with its own outcomes only", () => {
  const s = spec(5);
  const parts = splitIntoLessons(s.boards.map((b) => ({ title: b.title, outcomeRefs: b.outcomeRefs })), 3);
  assert.equal(parts.length, 2);
  const meta = { request, framework: "Test", subject: "Biology" };
  const one = lessonPartDocument(s, meta, [], parts, 0);
  const two = lessonPartDocument(s, meta, [], parts, 1);
  const types = (d: typeof one) => d.contentBlocks!.map((b) => b.type);
  assert.deepEqual(types(one), ["lesson-plan", "concept", "concept", "concept", "exam-practice", "lesson-recap"]);
  assert.deepEqual(types(two), ["lesson-plan", "concept", "concept", "exam-practice", "lesson-recap"]);
  assert.equal(one.lesson?.title, "Respiration — Lesson 1 of 2");
  assert.deepEqual(one.lesson?.learningGoals, ["Explain idea 1.", "Explain idea 2.", "Explain idea 3."]);
  assert.deepEqual(two.lesson?.learningGoals, ["Explain idea 4.", "Explain idea 5."]);
  // The plan board: today in order; lesson 1 reminds the prerequisites and says what's next; lesson 2 recaps lesson 1.
  const plan1 = one.contentBlocks![0].text ?? "";
  assert.match(plan1, /BEFORE WE START[\s\S]*what a cell is[\s\S]*what energy is/);
  assert.doesNotMatch(plan1, /a third one/, "at most two prerequisites");
  assert.match(plan1, /TODAY[\s\S]*1\. Idea 1\n2\. Idea 2\n3\. Idea 3/);
  assert.match(plan1, /NEXT TIME \(Lesson 2\): Idea 4; Idea 5/);
  const plan2 = two.contentBlocks![0].text ?? "";
  assert.match(plan2, /LAST TIME \(Lesson 1\)[\s\S]*Idea 1: point 1/);
  assert.doesNotMatch(plan2, /BEFORE WE START/);
  assert.match(plan2, /last lesson of this topic/);
  // The quiz asks today's checks only, 2 to 5 of them, and the coverage check holds the board to them.
  const quiz2 = two.contentBlocks![two.contentBlocks!.length - 1];
  assert.deepEqual(quiz2.keyIdeas, ["Q4?", "Q5?"]);
  assert.doesNotMatch(quiz2.text ?? "", /Q1\?/);
  // The exam board asks about this lesson's outcomes, numbered as this lesson numbers them.
  const exam2 = two.contentBlocks!.find((b) => b.exam)!;
  assert.match(exam2.text ?? "", /Exam 5/, "the highest-mark question of outcomes 4 and 5");
  const beats2 = (two.lessonPlan as { beats: Array<{ id: string; outcomeRefs: number[]; objective: string }> }).beats;
  assert.deepEqual(beats2.map((b) => b.id), ["b1", "b2", "b3", "b4", "b5"]);
  assert.deepEqual(beats2.map((b) => b.outcomeRefs), [[], [1], [2], [2], []]);
  assert.match(beats2[3].objective, /outcome 2\b/);
  // The first block still carries the lesson's required terms (the coverage check reads them from there).
  assert.ok(one.contentBlocks![0].teachingHints?.some((h) => h.startsWith("Use these terms: aerobic")));
});

test("a series lesson taught in teaching order keeps its plan and quiz boards whole, within the board limit", () => {
  const s = spec(5);
  const parts = splitIntoLessons(s.boards.map((b) => ({ title: b.title, outcomeRefs: b.outcomeRefs })), 3);
  const doc = withTeachingOrders(lessonPartDocument(s, { request, framework: "Test", subject: "Biology" }, [], parts, 0), "beginner");
  const types = doc.contentBlocks!.map((b) => b.type);
  assert.equal(types[0], "lesson-plan");
  assert.equal(types[types.length - 1], "lesson-recap");
  assert.equal(doc.contentBlocks!.length, 1 + 3 * 3 + 1 + 1);
  assert.ok(doc.contentBlocks!.length <= MAX_LESSON_BOARDS);
});
