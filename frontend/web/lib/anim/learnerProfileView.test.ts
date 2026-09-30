/** The learner profile: basics from onboarding + what Aria learned since, subject by subject. */
import test from "node:test";
import assert from "node:assert/strict";
import type { LearnerBasics } from "../db/cosmos";
import type { LearnerMemory } from "../learnerModel";
import { learnerContextForPrompt, learnerProfileView, typicalLessonDuration } from "../learnerProfileView";
import { mergeLearnerBasics, LearnerBasicsError } from "../learnerBasics";

const NOW = Date.parse("2026-09-29T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const basics: LearnerBasics = {
  country: "GB", countrySource: "ip",
  studyLevel: { id: "gb-alevel", label: "A-Level / Sixth form (Years 12–13)" },
  subjects: [{ id: "physics", label: "Physics" }, { id: "mathematics", label: "Mathematics" }],
  curricula: [{ id: "cambridge-a-level", label: "Cambridge International AS & A Level" }],
  subjectLevels: { mathematics: { id: "gb-gcse", label: "GCSE / O-Level (Years 10–11)" } },
  completedAt: day(30), updatedAt: day(30),
};
const concept = (label: string, mastery: number, topics: string[], seen = 2) => ({ key: label.toLowerCase(), label, mastery, evidence: [], lastSeen: day(seen), topics });
const memory = {
  version: 1,
  concepts: {
    newton: concept("Newton's laws", 0.95, ["Forces and motion"]),
    vectors: concept("Vectors", 0.55, ["Mechanics"]),
    algebra: concept("Algebra", 0.75, ["Quadratic equations"]),
    probability: concept("Probability", 0.2, ["Probability basics"]),
    momentum: concept("Momentum", 0.9, ["Mechanics"], 60),
  },
  misconceptions: [{ id: "m1", text: "heavier objects fall faster", topic: "Gravity and motion", firstSeen: day(5), lastSeen: day(5), resolved: false }],
  preferences: { style: null, background: null },
  goals: [], lastLevel: null,
  lessons: [{ topic: "Mechanics", at: day(3), beatsWatched: 16 }, { topic: "Probability basics", at: day(8), beatsWatched: 14 }, { topic: "Old topic", at: day(40), beatsWatched: 12 }],
  signals: { "more-examples": 3, question: 5 },
  excerpts: [], persona: null, updatedAt: day(1),
} as unknown as LearnerMemory;

test("the profile sorts what Aria knows into the student's subjects", () => {
  const view = learnerProfileView(basics, memory, NOW);
  const physics = view.subjects.find((s) => s.subject?.id === "physics")!;
  const maths = view.subjects.find((s) => s.subject?.id === "mathematics")!;
  assert.deepEqual(physics.mastered.map((c) => c.label), ["Newton's laws"]);
  assert.deepEqual(physics.needsReview.map((c) => c.label).sort(), ["Momentum", "Vectors"], "stale mastery comes back for review");
  assert.deepEqual(physics.weak, ["heavier objects fall faster"]);
  assert.deepEqual(maths.strong.map((c) => c.label), ["Algebra"]);
  assert.deepEqual(maths.weakConcepts.map((c) => c.label), ["Probability"]);
  assert.equal(maths.studyLevel?.label, "GCSE / O-Level (Years 10–11)", "a subject's own level overrides the general one");
  assert.equal(physics.studyLevel?.label, basics.studyLevel!.label);
  assert.deepEqual(view.currentTopics, ["Mechanics", "Probability basics"]);
  assert.equal(view.typicalLessonDuration, "10–15 minutes");
  assert.equal(view.preferredExplanation, "Visual boards + worked examples");
});

test("the lesson writers get the profile as background lines", () => {
  const text = learnerContextForPrompt(learnerProfileView(basics, memory, NOW));
  assert.match(text, /Studies in: United Kingdom/);
  assert.match(text, /Cambridge International AS & A Level — use its terminology/);
  assert.match(text, /Physics: .*mastered Newton's laws/);
  assert.match(text, /Mathematics: level GCSE.*strong on Algebra.*weak on Probability/);
  assert.equal(learnerContextForPrompt(learnerProfileView(null, null, NOW)), "");
});

test("durations and an empty profile", () => {
  assert.equal(typicalLessonDuration(null), null);
  const view = learnerProfileView(null, null, NOW);
  assert.deepEqual(view.subjects, []);
  assert.equal(view.preferredExplanation, null);
});

test("screen 1's basics are sanitised, merged, and completed only with the required fields", () => {
  const merged = mergeLearnerBasics({ country: "gb", studyLevel: { id: "gb-alevel", label: "A-Level" }, subjects: [{ label: "Physics" }, { label: "physics" }], complete: true }, null, "Sara", "t");
  assert.equal(merged.country, "GB");
  assert.equal(merged.countrySource, "user");
  assert.equal(merged.subjects.length, 1);
  assert.equal(merged.completedAt, "t");
  assert.throws(() => mergeLearnerBasics({ subjects: [], complete: true }, null, "Sara"), LearnerBasicsError);
  assert.throws(() => mergeLearnerBasics({ studyLevel: { label: "A-Level" }, subjects: [{ label: "X" }], complete: true }, null, null), /your name/);
  const kept = mergeLearnerBasics({ curricula: [{ label: "SAT" }] }, merged, "Sara", "t2");
  assert.equal(kept.country, "GB", "fields not sent are kept");
  assert.equal(kept.completedAt, "t", "completion is not reset by a later edit");
  assert.equal(mergeLearnerBasics({ country: "Narnia" }, null, "x").country, null);
});
