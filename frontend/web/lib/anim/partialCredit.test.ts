import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeGradeResults } from "../testSanitize";

test("assessment preserves correct, partial and misconception as different judgments", () => {
  const results = sanitizeGradeResults({ results: [
    { id: "q1", status: "correct", feedback: "Complete." },
    { id: "q2", status: "partial", feedback: "Core is right; one requested comparison is missing." },
    { id: "q3", status: "misconception", feedback: "Matter is not converted into energy." },
  ] }, ["q1", "q2", "q3"]);
  assert.deepEqual(results.map((result) => [result.status, result.correct]), [["correct", true], ["partial", false], ["misconception", false]]);
});

test("legacy boolean grading remains readable while new grading is adopted", () => {
  assert.equal(sanitizeGradeResults({ results: [{ id: "q1", correct: true, feedback: "Good." }] }, ["q1"])[0].status, "correct");
});

test("fair marking awards points only for requested key points and names what is missing", () => {
  const [partial, wrong, right] = sanitizeGradeResults({ results: [
    { id: "q1", status: "partial", pointsEarned: 2, missingKeyPoints: ["state the limiting factor"], feedback: "The core explanation is accurate." },
    { id: "q2", status: "misconception", misconception: "Treats energy as a reactant", feedback: "That model is incorrect." },
    { id: "q3", status: "correct", pointsEarned: 1, feedback: "Complete." },
  ] }, ["q1", "q2", "q3"], [
    { id: "q1", rubric: { keyPoints: ["cause", "effect", "limiting factor"], modelAnswer: "" } },
    { id: "q2", rubric: { keyPoints: ["matter", "energy"], modelAnswer: "" } },
    { id: "q3", rubric: { keyPoints: ["definition"], modelAnswer: "" } },
  ]);
  assert.deepEqual([partial.pointsEarned, partial.pointsAvailable, partial.missingKeyPoints], [2, 3, ["state the limiting factor"]]);
  assert.deepEqual([wrong.pointsEarned, wrong.pointsAvailable, wrong.misconception], [0, 2, "Treats energy as a reactant"]);
  assert.deepEqual([right.pointsEarned, right.pointsAvailable], [1, 1]);
});

test("a 'correct' verdict that still names a missing requested point becomes partial", async () => {
  const { sanitizeGradeResults } = await import("../testSanitize");
  const [r] = sanitizeGradeResults(
    { results: [{ id: "q1", status: "correct", pointsEarned: 3, missingKeyPoints: ["explains why the inside stays unchanged"], feedback: "ok" }] },
    ["q1"],
    [{ id: "q1", rubric: { keyPoints: ["a", "b", "c"], modelAnswer: "", commonMistake: "" } as never }],
  );
  assert.equal(r.status, "partial");
  assert.equal(r.correct, false);
  assert.ok(r.pointsEarned < 3);
});

test("mark scheme: marks are the points ticked, added up by code", () => {
  const rubric = (id: string) => ({ id, rubric: { keyPoints: ["substitutes a = −ω²x", "ω = 2πf", "a = −37.9 m s⁻²"], modelAnswer: "" } });
  const [method, lenient, full] = sanitizeGradeResults({ results: [
    // Right method, wrong final value: method marks kept, not zero.
    { id: "q1", status: "misconception", awarded: [true, true, false], misconception: "Final value wrong", feedback: "x" },
    // "Correct" with a point the model itself did not tick is a partial.
    { id: "q2", status: "correct", pointsEarned: 3, awarded: [true, false, true], feedback: "x" },
    { id: "q3", status: "correct", awarded: [true, true, true], feedback: "x" },
  ] }, ["q1", "q2", "q3"], [rubric("q1"), rubric("q2"), rubric("q3")]);
  assert.deepEqual([method.status, method.pointsEarned], ["misconception", 2]);
  assert.deepEqual([lenient.status, lenient.pointsEarned, lenient.missingKeyPoints], ["partial", 2, ["ω = 2πf"]]);
  assert.deepEqual([full.status, full.pointsEarned], ["correct", 3]);
});

test("a student's wrong arithmetic is never full marks", () => {
  const [r] = sanitizeGradeResults(
    { results: [{ id: "q1", status: "correct", awarded: [true, true], feedback: "x" }] },
    ["q1"],
    [{ id: "q1", rubric: { keyPoints: ["F = ma", "value"], modelAnswer: "" } }],
    { q1: "F = ma so F = 2.0 × 9.8 = 21 N" },
  );
  assert.equal(r.status, "partial");
  assert.equal(r.pointsEarned, 1);
  assert.match(r.missingKeyPoints.join(" "), /19\.6/);
});
