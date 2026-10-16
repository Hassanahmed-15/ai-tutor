import assert from "node:assert/strict";
import test from "node:test";
import { groundedFeedback, sanitizeGradeResults, testArithmeticIssues } from "../testSanitize";
import { quizIssues } from "../canvas/quizLint";
import { depthIssues } from "../canvas/courseCoverage";

const q4 = { id: "q4", beatId: "b5", prompt: "Flexible budget profit is $42,000. Variances: sales price $2,500 F, materials $1,800 A, labour $900 F, variable overhead $600 A, fixed overhead $1,200 A. Calculate the actual profit.", oralPhrasing: "", rubric: { keyPoints: ["adds favourable variances", "deducts adverse variances", "actual profit $41,800"], modelAnswer: "42,000 + 2,500 − 1,800 + 900 − 600 − 1,200 = $41,800" } };

test("feedback never tells the student a figure the grader invented", () => {
  const fb = "Your calculation adds every variance and produces $49,000. The adverse cost variances reduce profit, so the correct actual profit is $40,800.";
  const grounded = groundedFeedback(fb, [q4.prompt, q4.rubric.modelAnswer, "42000 + 2500 + 1800 + 900 + 600 + 1200 = 49000"]);
  assert.doesNotMatch(grounded, /40,800/);
  assert.match(grounded, /49,000/);
  const [r] = sanitizeGradeResults({ results: [{ id: "q4", status: "misconception", feedback: "The correct actual profit is $40,800.", awarded: [false, false, false] }] }, ["q4"], [q4], { q4: "$49,000" });
  assert.match(r.feedback, /41,800/, "the model answer replaces an ungrounded correction");
});

test("a test whose model answer does not add up is caught before a student sits it", () => {
  assert.equal(testArithmeticIssues([q4]).length, 0);
  assert.equal(testArithmeticIssues([{ ...q4, rubric: { ...q4.rubric, modelAnswer: "42,000 + 2,500 − 1,800 + 900 − 600 − 1,200 = $40,800" } }]).length, 1);
});

test("a card whose right answer is a wrong one plus a qualifier is sent back; a fair either/or stays", () => {
  const hedge = quizIssues({ kind: "quiz", question: "What should determine a 10,000-unit bonus: output alone or output plus acceptable quality?", options: [{ text: "Depend on output plus acceptable quality.", correct: true, feedback: "x" }, { text: "Depend on output alone.", correct: false, feedback: "x" }, { text: "Depend on acceptable quality alone.", correct: false, feedback: "x" }] } as never, "bonus targets quality output");
  assert.ok(hedge.some((i) => /qualifier/.test(i)));
  const fair = quizIssues({ kind: "quiz", question: "Is loud music from a nightclub an external cost or an external benefit?", options: [{ text: "An external cost", correct: true, feedback: "x" }, { text: "An external benefit", correct: false, feedback: "x" }, { text: "A private cost", correct: false, feedback: "x" }] } as never, "externalities nightclub music neighbours");
  assert.ok(!fair.some((i) => /qualifier/.test(i)));
});

test("sentences of more than one idea are sent back to be split", () => {
  const long = Array(40).fill("word").join(" ") + ". " + Array(38).fill("idea").join(" ") + ".";
  assert.ok(depthIssues(long, { keyIdeas: [] }).some((i) => /over 35 words/.test(i)));
});
