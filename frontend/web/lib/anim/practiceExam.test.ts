import test from "node:test";
import assert from "node:assert/strict";
import { answersOf, canGrade, choiceOf, gradeFor, kind, markMcq, mixFor, normalizePlan, practiceExamOn, questionProblems, scaleMix, slotsFor, studentExam, studentView, summarizeResults } from "../practice/rules";
import type { ExamPlan, StoredExam, StoredQuestion } from "../practice/types";

/*
 * PRACTICE EXAM (docs/practice-exam.md, owner 2026-11-26): the free, pure parts. The plan is made safe, the mix is
 * exact, the slots put easy first and worked questions last, multiple choice is marked by code, the grade bands
 * match Cambridge's, the student never sees a key or scheme, and only the owner may grade.
 */

const plan = (over: Partial<ExamPlan> = {}): ExamPlan => {
  const r = normalizePlan({ topic: "Motion", level: "IGCSE Physics", count: 8, styles: ["mcq", "short", "worked"], ...over });
  if ("error" in r) throw new Error(r.error);
  return r.plan;
};

const mcq: StoredQuestion = {
  id: "q1", n: 1, difficulty: "easy", style: "mcq", marks: 1, subtopic: "Speed", answerOn: "screen", parts: [],
  stem: "A car travels 100 m in 20 s. What is its average speed?",
  options: { A: "0.2 m/s", B: "5 m/s", C: "80 m/s", D: "2000 m/s" },
  scheme: { id: "q1", answer: "B", points: [{ label: "", text: "B: speed = distance ÷ time = 100 ÷ 20 = 5 m/s.", marks: 1 }], working: ["speed = 100 ÷ 20 = 5 m/s"], commonErrors: ["A: divides time by distance", "C: subtracts 20 from 100", "D: multiplies distance by time"] },
};

const worked: StoredQuestion = {
  id: "q2", n: 2, difficulty: "hard", style: "worked", marks: 6, subtopic: "Acceleration", answerOn: "paper",
  stem: "A cyclist speeds up from 4.0 m/s to 10.0 m/s in 3.0 s, then moves at 10.0 m/s for 5.0 s.",
  parts: [{ label: "(a)", marks: 2, text: "Calculate the acceleration." }, { label: "(b)", marks: 4, text: "Calculate the total distance travelled." }],
  scheme: {
    id: "q2",
    points: [
      { label: "(a)", text: "M1 a = (v − u) ÷ t", marks: 1 }, { label: "(a)", text: "A1 2.0 m/s²", marks: 1 },
      { label: "(b)", text: "M1 average speed × time for the first stage", marks: 1 }, { label: "(b)", text: "A1 21 m", marks: 1 },
      { label: "(b)", text: "B1 50 m at constant speed", marks: 1 }, { label: "(b)", text: "A1 71 m", marks: 1 },
    ],
    working: ["a = (10.0 − 4.0) ÷ 3.0 = 2.0 m/s²", "first stage = (4.0 + 10.0) ÷ 2 × 3.0 = 21 m", "second stage = 10.0 × 5.0 = 50 m", "total = 21 + 50 = 71 m"],
    commonErrors: ["uses the final speed instead of the change in speed"],
  },
};

test("the gate is closed unless PRACTICE_EXAM=on", () => {
  assert.equal(practiceExamOn({}), false);
  assert.equal(practiceExamOn({ PRACTICE_EXAM: "1" }), false);
  assert.equal(practiceExamOn({ PRACTICE_EXAM: "on" }), true);
});

test("plan validation: topic required, count clamped, defaults filled", () => {
  assert.ok("error" in normalizePlan({ topic: " " }));
  assert.ok("error" in normalizePlan(null));
  const p = plan({ count: 99, styles: ["essay"] as never, minutes: 2 });
  assert.equal(p.count, 15);
  assert.deepEqual(p.styles, ["mcq", "short", "worked"]);
  assert.equal(p.minutes, 5);
  assert.equal(plan({ count: 1 }).count, 3);
  assert.equal(plan({ count: undefined as never }).count, 8);
  assert.equal(plan({ minutes: null }).minutes, null);
  assert.equal(normalizePlan({ topic: "Algebra" }).hasOwnProperty("plan"), true);
});

test("mix always sums to the count", () => {
  for (let n = 3; n <= 15; n++) {
    for (const preset of ["easy", "balanced", "hard"] as const) {
      const m = mixFor(n, preset);
      assert.equal(m.easy + m.medium + m.hard, n, `${preset} ${n}`);
    }
    const p = plan({ count: n, mix: { easy: 1, medium: 1, hard: 100 } });
    assert.equal(p.mix.easy + p.mix.medium + p.mix.hard, n);
  }
  assert.deepEqual(plan({ count: 6, mix: { easy: 2, medium: 2, hard: 2 } }).mix, { easy: 2, medium: 2, hard: 2 });
  assert.deepEqual(scaleMix(5, { easy: 0, medium: 0, hard: 0 }), mixFor(5));
  const hard = mixFor(10, "hard"), easy = mixFor(10, "easy");
  assert.ok(hard.hard > easy.hard && easy.easy > hard.easy);
});

test("slots follow the mix exactly, easy first, worked on the hardest, each allowed style used", () => {
  for (let n = 3; n <= 15; n++) {
    const p = plan({ count: n });
    const s = slotsFor(p);
    assert.equal(s.length, n);
    assert.equal(s.filter((x) => x.difficulty === "easy").length, p.mix.easy);
    assert.equal(s.filter((x) => x.difficulty === "hard").length, p.mix.hard);
    for (const st of p.styles) assert.ok(s.some((x) => x.style === st), `n=${n} has ${st}`);
    const rank = { easy: 0, medium: 1, hard: 2 } as const;
    assert.ok(s.every((x, i) => i === 0 || rank[s[i - 1].difficulty] <= rank[x.difficulty]));
    assert.notEqual(s[0].style, "worked");
  }
  const onlyMcq = slotsFor(plan({ count: 5, styles: ["mcq"] }));
  assert.ok(onlyMcq.every((x) => x.style === "mcq" && x.marks[0] === 1));
  const subs = slotsFor(plan({ count: 4, subtopics: ["Speed", "Acceleration"] }));
  assert.deepEqual(subs.map((x) => x.subtopic), ["Speed", "Acceleration", "Speed", "Acceleration"]);
});

test("written-question checks: sound questions pass, broken ones are named", () => {
  assert.deepEqual(questionProblems(mcq, { n: 1, difficulty: "easy", style: "mcq", subtopic: "", marks: [1, 1] }), []);
  assert.deepEqual(questionProblems(worked, { n: 2, difficulty: "hard", style: "worked", subtopic: "", marks: [5, 9] }), []);
  const badSum = { ...worked, scheme: { ...worked.scheme, points: worked.scheme.points.slice(1) } };
  assert.ok(questionProblems(badSum, { n: 2, difficulty: "hard", style: "worked", subtopic: "", marks: [5, 9] }).some((p) => p.includes("(a)")));
  const wrongSum = { ...worked, scheme: { ...worked.scheme, working: [...worked.scheme.working.slice(0, 3), "total = 21 + 50 = 81 m"] } };
  assert.ok(questionProblems(wrongSum, { n: 2, difficulty: "hard", style: "worked", subtopic: "", marks: [5, 9] }).some((p) => p.includes("71")));
  const noKey = { ...mcq, scheme: { ...mcq.scheme, answer: "E" } };
  assert.ok(questionProblems(noKey, { n: 1, difficulty: "easy", style: "mcq", subtopic: "", marks: [1, 1] }).length > 0);
  const diagram = { ...mcq, stem: "Use the graph below to find the speed." };
  assert.ok(questionProblems(diagram, { n: 1, difficulty: "easy", style: "mcq", subtopic: "", marks: [1, 1] }).some((p) => p.includes("diagram")));
  const fine = { ...mcq, stem: "Which statement about a distance-time graph for a car at rest is correct?" };
  assert.deepEqual(questionProblems(fine, { n: 1, difficulty: "easy", style: "mcq", subtopic: "", marks: [1, 1] }), []);
});

test("multiple choice is marked by code, with the misconception behind a wrong choice", () => {
  assert.equal(choiceOf(" b "), "B");
  assert.equal(choiceOf("C) 80 m/s"), "C");
  assert.equal(choiceOf("E"), null);
  const right = markMcq(mcq, "B");
  assert.equal(right.awarded, 1);
  assert.equal(right.correct, true);
  const wrong = markMcq(mcq, "a");
  assert.equal(wrong.awarded, 0);
  assert.equal(wrong.studentAnswer, "A");
  assert.match(wrong.firstError!.why, /divides time by distance/);
  assert.match(wrong.feedback, /answer is B/);
  const blank = markMcq(mcq, undefined);
  assert.equal(blank.awarded, 0);
  assert.equal(blank.firstError, undefined);
});

test("grade bands", () => {
  const cases: Array<[number, string]> = [[100, "A*"], [90, "A*"], [89.9, "A"], [80, "A"], [70, "B"], [60, "C"], [50, "D"], [40, "E"], [39.9, "U"], [0, "U"]];
  for (const [p, g] of cases) assert.equal(gradeFor(p), g, String(p));
  const s = summarizeResults("x", [markMcq(mcq, "B"), { ...markMcq(mcq, "A"), id: "q2", max: 3 }], 0.0123456);
  assert.equal(s.total, 1);
  assert.equal(s.max, 4);
  assert.equal(s.percent, 25);
  assert.equal(s.grade, "U");
  assert.deepEqual(s.mistakes.map((m) => m.id), ["q2"]);
  assert.equal(s.costUsd, 0.01235);
});

test("the student view never carries a key, scheme or working", () => {
  const exam: StoredExam = { id: "a".repeat(32), userId: "u1", plan: plan(), questions: [mcq, worked], minutes: 30, createdAt: "", costUsd: 0.01 };
  const view = studentExam(exam);
  const text = JSON.stringify(view);
  for (const secret of ["scheme", "commonErrors", "working", "divides time by distance", "M1", "71 m", "\"answer\"", "userId", "costUsd"]) assert.ok(!text.includes(secret), `leaks ${secret}`);
  assert.equal(view.examId, exam.id);
  assert.equal(view.minutes, 30);
  assert.deepEqual(Object.keys(studentView(mcq)).sort(), ["answerOn", "difficulty", "id", "marks", "n", "options", "parts", "stem", "style", "subtopic"]);
  assert.equal(studentView(worked).answerOn, "paper");
  assert.equal("options" in studentView(worked), false);
});

test("only the owner may grade", () => {
  assert.equal(canGrade({ userId: "u1" }, "u1"), true);
  assert.equal(canGrade({ userId: "u1" }, "u2"), false);
  assert.equal(canGrade({ userId: "u1" }, ""), false);
  assert.equal(canGrade(null, "u1"), false);
});

test("answers from the browser are kept to known ids and strings", () => {
  const a = answersOf({ q1: { choice: "B" }, q2: { text: "a = 2", choice: 5 }, hack: { text: "x" }, q3: "B" });
  assert.deepEqual(a, { q1: { choice: "B" }, q2: { text: "a = 2" } });
  assert.deepEqual(answersOf(null), {});
});

test("feedback words stay kind", () => {
  assert.equal(kind("This is bad work.  Fix (b)."), "This is not yet right. Fix (b).");
  assert.equal(kind("You used the wrong unit."), "You used the wrong unit.");
});

test("model JSON keeps its maths: lost LaTeX backslashes and raw control bytes are repaired", async () => {
  const { parseMathsJson } = await import("../practice/jsonRepair");
  // single backslashes the model forgot to double (\f, \t, \b, \r would be eaten by JSON.parse)
  const a = parseMathsJson<{ s: string; w: string[] }>(String.raw`{"s":"What is $\frac{1}{4}$ of $36$? Use $3\times 4$ and $\theta$, $\beta$, $\right)$.","w":["line one\nline two","tab\there"]}`);
  assert.equal(a.s, String.raw`What is $\frac{1}{4}$ of $36$? Use $3\times 4$ and $\theta$, $\beta$, $\right)$.`);
  assert.deepEqual(a.w, ["line one\nline two", "tab\there"]); // real escapes before ordinary words stay escapes
  // correctly doubled backslashes are left alone
  assert.equal(parseMathsJson<{ s: string }>(String.raw`{"s":"$\\frac{2}{5}$ and \\\\ row"}`).s, String.raw`$\frac{2}{5}$ and \\ row`);
  // the raw bytes seen in the 2026-11-26 live run
  const b = parseMathsJson<{ q: { stem: string; working: string[] } }>(JSON.stringify({ q: { stem: "What is $\x03frac{1}{4}$ of $36$?", working: ["36 \x12 4 = 9", "15 \x13 2 = 30"] } }));
  assert.equal(b.q.stem, String.raw`What is $\frac{1}{4}$ of $36$?`);
  assert.deepEqual(b.q.working, ["36 ÷ 4 = 9", "15 × 2 = 30"]);
  assert.throws(() => parseMathsJson("not json"));
});

test("a practice sheet is written from what the lecture taught: boards → source → a ready balanced plan of 6", async () => {
  const { lectureSource, courseSource, sheetPlan, boardTitles, boardsDigest } = await import("../practice/source");
  const beats = [
    { title: "What a mole is", keyClaims: ["A mole is 6.02 × 10^23 particles"], points: ["Avogadro's constant"], script: "long talk" },
    { title: "Molar mass", points: ["Mass of one mole in g/mol", "n = m / M"] },
    { title: "Molar mass", points: ["Worked example: 18 g of water is 1 mol"] },
  ];
  const src = lectureSource("The mole", beats)!;
  assert.equal(src.kind, "lecture");
  assert.match(src.text, /## What a mole is\n- A mole is 6\.02/);
  assert.match(src.text, /n = m \/ M/);
  assert.deepEqual(boardTitles(beats), ["What a mole is", "Molar mass"]);
  const plan = sheetPlan(src, "IGCSE");
  assert.equal(plan.count, 6);
  assert.deepEqual(plan.mix, { easy: 2, medium: 2, hard: 2 });
  assert.equal(plan.level, "IGCSE");
  assert.equal(plan.source, src);
  // a long lecture is cut at a board's end, never past the limit
  const many = Array.from({ length: 200 }, (_, i) => ({ title: `Board ${i}`, points: ["x".repeat(120)] }));
  assert.ok(boardsDigest(many).length <= 8000);
  assert.equal(lectureSource("Empty", [{ title: "" }]), null);
  // a course lesson names its exam and keeps its own exam-style questions for the style
  const c = courseSource({ courseLabel: "Cambridge IGCSE Chemistry 0620", level: "Core", lessonTitle: "The mole", outcomes: [{ code: "3.3.1", text: "State that the mole is the unit of amount of substance" }], examPractice: [{ commandWord: "Calculate", question: "Calculate the number of moles in 9.0 g of water.", marks: 2 }] }, beats)!;
  assert.equal(c.exam, "Cambridge IGCSE Chemistry 0620 · Core");
  assert.match(c.text, /3\.3\.1 State that the mole/);
  assert.deepEqual(c.examples, ["[Calculate] Calculate the number of moles in 9.0 g of water. [2 marks]"]);
  assert.equal(sheetPlan(c).board, "Cambridge IGCSE Chemistry 0620 · Core");
});

test("the server keeps a sheet's source but caps it, strips control bytes, and drops one that says nothing", () => {
  const ok = normalizePlan({ ...plan(), source: { kind: "course", title: "The mole", text: `## A\n- ${"y".repeat(9000)}\u0007`, exam: "IGCSE Chemistry", examples: ["Calculate the moles in 9 g of water.", "", 5] } });
  assert.ok("plan" in ok);
  const s = (ok as { plan: ExamPlan }).plan.source!;
  assert.equal(s.kind, "course");
  assert.ok(s.text.length <= 8000 && !s.text.includes("\u0007") && s.text.startsWith("## A\n- "));
  assert.deepEqual(s.examples, ["Calculate the moles in 9 g of water."]);
  const none = normalizePlan({ ...plan(), source: { kind: "lecture", title: "x", text: "too short" } });
  assert.equal((none as { plan: ExamPlan }).plan.source, undefined);
});

test("level names keep Latin letters only: the stray '旧' the model added is removed", async () => {
  const { cleanLabel } = await import("../practice/rules");
  assert.equal(cleanLabel("Cambridge International A Level Chemistry (旧 9701)", 60), "Cambridge International A Level Chemistry (9701)");
  assert.equal(cleanLabel("Cambridge IGCSE Chemistry (0620)", 60), "Cambridge IGCSE Chemistry (0620)");
  assert.equal(cleanLabel("AS & A Level — Physics: 9702", 60), "AS & A Level — Physics: 9702");
});

test("a wrong multiple choice is told a likely slip, never what they did", () => {
  const q: StoredQuestion = { id: "q2", n: 2, difficulty: "easy", style: "mcq", marks: 1, subtopic: "formulae", stem: "Empirical formula of glucose?", options: { A: "C6H12O6", B: "CH2O", C: "C2H4O2", D: "CHO" }, parts: [], answerOn: "screen", scheme: { id: "q2", answer: "B", points: [{ label: "", text: "B: divide by 6", marks: 1 }], working: ["C6H12O6 ÷ 6 = CH2O"], commonErrors: ["D: Changes the hydrogen subscript 12 to 1", "A: C6H12O6 is the molecular formula"] } };
  const d = markMcq(q, "D");
  assert.match(d.firstError!.why, /^A common way to end up with D: changes the hydrogen subscript 12 to 1\. If that isn't what you did/);
  assert.match(markMcq(q, "A").firstError!.why, /end up with A: C6H12O6 is the molecular formula\./);
});
