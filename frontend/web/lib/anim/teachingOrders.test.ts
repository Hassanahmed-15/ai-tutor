import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LESSON_TYPES, STUDENT_LEVELS, lessonTypeOf, orderBoards, studentLevelFor, TEACHING_EXAMPLES, TEACHING_RULES, MATHS_TEACHING, CS_TEACHING, type LessonType } from "../teaching/lessonTypes";
import { MAX_LESSON_BOARDS, withTeachingOrders } from "../teaching/courseOrders";
import { bannedWordsIn, withoutBannedWords } from "../teaching/styleCheck";
import { completeSpec, lessonDocument, type LessonSpec } from "../curriculum/lessonSpec";

// 40 real catalogue lessons across 20 subjects, labelled by hand (scripts/qa/.probe/lesson-type-sample.mts).
const samples = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib/anim/fixtures-lesson-types.json"), "utf8")) as Array<{ subject: string; title: string; outcomes: string[]; expected: LessonType[] }>;

test("each real catalogue lesson gets the kind of idea a teacher would call it", () => {
  const wrong = samples.filter((s) => !s.expected.includes(lessonTypeOf({ subject: s.subject, title: s.title, outcomes: s.outcomes })));
  assert.deepEqual(wrong.map((s) => `${s.subject}: ${s.title} → ${lessonTypeOf(s)} (expected ${s.expected.join("|")})`), []);
});

test("every lesson type and level has a teaching order whose key points are taught on exactly one board", () => {
  for (const type of LESSON_TYPES) for (const level of STUDENT_LEVELS) {
    const boards = orderBoards(type, level);
    assert.ok(boards.length >= 1 && boards.length <= 3, `${type}/${level}: 1 to 3 boards`);
    assert.equal(boards.filter((b) => b.gets.includes("keyPoints")).length, 1, `${type}/${level}: key points on one board`);
    assert.ok(boards.filter((b) => b.gets.includes("worked")).length <= 1, `${type}/${level}: the worked example on at most one board`);
    assert.ok(boards.every((b) => b.does.length > 0 && b.title("X").includes("X")), `${type}/${level}: every board says what it does and names its idea`);
  }
  // A new concept for a beginner is built up: why, a picture, an example — the rule only on the last board.
  const concept = orderBoards("concept", "beginner");
  assert.deepEqual(concept.map((b) => b.gets), [[], ["keyPoints"], ["worked", "check"]]);
  assert.match(concept[0].does.join(" "), /WHY IT MATTERS/);
  // The theory is taught before any numbers (owner, 2026-11-09), in every order that has both.
  for (const type of ["concept", "procedure", "coding", "problem_solving", "language"] as const) {
    const boards = orderBoards(type, "beginner");
    assert.ok(boards.findIndex((b) => b.gets.includes("keyPoints")) < boards.findIndex((b) => b.gets.includes("worked")), `${type}: the idea before the worked example`);
  }
  assert.match(concept[0].does.join(" "), /Never a comparison that teaches something false/);
});

test("a first course lesson is taught from the ground up unless the student is advanced", () => {
  assert.equal(studentLevelFor("beginner"), "beginner");
  assert.equal(studentLevelFor("intermediate"), "beginner");
  assert.equal(studentLevelFor("intermediate", false), "intermediate");
  assert.equal(studentLevelFor("advanced"), "advanced");
  assert.equal(studentLevelFor(undefined), "beginner");
});

test("the prompts carry every rule of the brief, and overview-versus-teaching pairs for six subjects", () => {
  const rules = TEACHING_RULES.join(" ");
  for (const word of ["basically", "simply", "obviously", "clearly", "just", "as you know"]) assert.ok(rules.includes(`"${word}"`), word);
  assert.match(rules, /misleading analogy/);
  assert.match(rules, /viewpoints fairly/);
  assert.match(rules, /Never invent/);
  const pairs = TEACHING_EXAMPLES.filter((l) => l.startsWith("✅"));
  assert.ok(pairs.length >= 6, "at least six good examples");
  assert.equal(TEACHING_EXAMPLES.filter((l) => l.startsWith("❌")).length, pairs.length, "each good example has its overview beside it");
  // The good examples obey their own rules.
  assert.deepEqual(pairs.flatMap((p) => bannedWordsIn(p)), []);
  assert.match(MATHS_TEACHING, /Never skip a line of algebra/);
  assert.match(CS_TEACHING, /one executed line per sentence/);
});

test("banned fillers are taken out, and the same words used properly are kept", () => {
  assert.equal(withoutBannedWords("Basically, the leaf makes food. Then we just add 3 to both sides."), "The leaf makes food. Then we add 3 to both sides.");
  assert.equal(withoutBannedWords("Obviously this is wrong. As you know, water boils at 100 °C."), "This is wrong. Water boils at 100 °C.");
  assert.equal(withoutBannedWords("It is simply the sum of the parts."), "It is the sum of the parts.");
  for (const kept of ["Label each part clearly.", "The reaction has just finished.", "Just before the bell rings, the pendulum stops.", "Speak simply and slowly."]) {
    assert.equal(withoutBannedWords(kept), kept, kept);
  }
  assert.deepEqual(bannedWordsIn("Label each part clearly."), []);
  assert.ok(bannedWordsIn("Basically, it works.").length > 0);
});

const request = { courseId: "x", version: "v", grade: "10", unitId: "u", topicId: "t", lessonId: "l" };
const fullSpec = (n: number, subject = "Biology"): { spec: LessonSpec; subject: string } => ({
  subject,
  spec: completeSpec({
    courseLabel: `Cambridge IGCSE ${subject}`, level: "IGCSE", lessonTitle: "Transport in plants",
    outcomes: Array.from({ length: n }, (_, i) => ({ code: `${i + 1}`, text: i === 0 ? "Calculate the rate of transpiration." : `Explain idea ${i + 1}.` })),
    prerequisites: ["cells"], requiredTerms: ["xylem"], requiredMethods: [], commandWords: ["explain"], depth: "IGCSE depth.",
    misconceptions: ["Water is pumped up"], outOfScope: ["Cohesion-tension maths"],
    boards: Array.from({ length: n }, (_, i) => ({ title: `Idea ${i + 1}`, objective: `Understand idea ${i + 1}.`, outcomeRefs: [i + 1], keyPoints: [`point ${i + 1}a`, `point ${i + 1}b`], workedExample: `1. Step one of example ${i + 1}. 2. Step two gives 12.`, evidencePages: [] })),
    checkpoint: Array.from({ length: n }, (_, i) => ({ question: `Question ${i + 1}?`, answer: `Answer ${i + 1}`, outcomeRef: i + 1 })),
    examPractice: [{ outcomeRef: 1, commandWord: "Calculate", question: "Calculate the rate.", marks: 2, markPoints: ["method", "answer"], modelAnswer: "…", lostMarks: "units", levels: [] }],
  }),
});

test("a course lesson in teaching order: each idea becomes its order's boards, nothing dropped or doubled", () => {
  const { spec, subject } = fullSpec(3);
  const doc = lessonDocument(spec, { request, framework: "Test", subject }, []);
  const ordered = withTeachingOrders(doc, "beginner");
  const blocks = ordered.contentBlocks!;
  const plan = ordered.lessonPlan as { beats: Array<{ id: string; sourceBlockIds: string[]; outcomeRefs: number[] }>; targetBeatCount: number; contentBlockIds: string[] };
  // Idea 1 is a procedure (3 boards), ideas 2 and 3 concepts (3 boards each), then the exam board.
  assert.equal(blocks.length, 3 + 3 + 3 + 1);
  assert.equal(plan.beats.length, blocks.length, "one plan board per block");
  assert.equal(plan.targetBeatCount, blocks.length);
  assert.deepEqual(plan.contentBlockIds, blocks.map((b) => b.id));
  assert.deepEqual(plan.beats.map((b) => b.id), blocks.map((_, i) => `b${i + 1}`));
  assert.equal(new Set(blocks.map((b) => b.id)).size, blocks.length, "ids are unique");
  // Every key point is on exactly one board; every worked example on exactly one.
  for (const p of spec.boards.flatMap((b) => b.keyPoints)) assert.equal(blocks.filter((b) => b.keyIdeas?.includes(p)).length, 1, p);
  for (let i = 1; i <= 3; i++) assert.equal(blocks.filter((b) => b.text?.includes(`Step one of example ${i}`)).length, 1, `example ${i}`);
  // The planner sees the lesson's rules in the text (it never sees teachingHints).
  assert.ok(blocks.filter((b) => !b.exam).every((b) => /Watch for: Water is pumped up/.test(b.text ?? "")));
  assert.equal(blocks[blocks.length - 1].type, "exam-practice", "the exam board stays last, as it was");
  assert.match(blocks[0].text ?? "", /TEACHING ORDER — board 1 of 3 for "Idea 1" \(a procedure idea/);
  assert.match(blocks[3].text ?? "", /TEACHING ORDER — board 1 of 3 for "Idea 2" \(a concept idea/);
  // Each idea's outcomes stay on each of its boards, so the closing exam line still falls on its last board.
  assert.deepEqual(plan.beats.slice(0, 3).map((b) => b.outcomeRefs), [[1], [1], [1]]);
  // Done once: a second pass changes nothing.
  assert.deepEqual(withTeachingOrders(ordered, "beginner"), ordered);
  // The input document is not changed.
  assert.equal(doc.contentBlocks!.length, 4);
});

test("an advanced student gets the shorter orders, and a big lesson is fitted to the board limit with every step kept", () => {
  const { spec, subject } = fullSpec(3);
  const doc = lessonDocument(spec, { request, framework: "Test", subject }, []);
  assert.equal(withTeachingOrders(doc, "advanced").contentBlocks!.length, 2 + 2 + 2 + 1);
  const big = fullSpec(8);
  const bigDoc = withTeachingOrders(lessonDocument(big.spec, { request, framework: "Test", subject: big.subject }, []), "beginner");
  assert.ok(bigDoc.contentBlocks!.length <= MAX_LESSON_BOARDS, `${bigDoc.contentBlocks!.length} boards`);
  for (const p of big.spec.boards.flatMap((b) => b.keyPoints)) assert.equal(bigDoc.contentBlocks!.filter((b) => b.keyIdeas?.includes(p)).length, 1, p);
  assert.ok(bigDoc.contentBlocks!.every((b) => b.exam || /TEACHING ORDER/.test(b.text ?? "")));
});

test("an idea headed in Urdu keeps its own heading on every board, numbered, with no English step name", () => {
  const { spec } = fullSpec(1, "Urdu");
  spec.boards[0].title = "ترتیب اور پیراگراف";
  const blocks = withTeachingOrders(lessonDocument(spec, { request, framework: "Test", subject: "Urdu - First Language" }, []), "beginner").contentBlocks!.filter((b) => !b.exam);
  assert.deepEqual(blocks.map((b) => b.heading), ["ترتیب اور پیراگراف (1/3)", "ترتیب اور پیراگراف (2/3)", "ترتیب اور پیراگراف (3/3)"]);
});
