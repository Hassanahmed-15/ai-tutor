import test from "node:test";
import assert from "node:assert/strict";
import { buildStudentCard } from "../studentCard";
import { buildTeachingPolicy, policyForBoards, policyForCanvasPlan, policyForPlanner, policyForQuestions, policyForVoice, policyForWriter, policyNote } from "../teachingPolicy";
import { emptyPreferences, hasPreferences, sanitizePreferences, type LearningPreferences } from "../learningPreferences";
import { mergeLearnerBasics } from "../learnerBasics";
import { emptyProfile } from "../learnerProfile";
import { learnerContextForPrompt, learnerProfileView } from "../learnerProfileView";
import { learnerBrief } from "../learnerBrief";
import { canvasPlanRequest } from "../canvas/lessonRequest";
import type { LearnerBasics } from "../db/cosmos";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";

const basics = (level: string, prefs: Partial<LearningPreferences> | null = null): LearnerBasics => ({
  country: "PK",
  countrySource: "user",
  studyLevel: { id: level.toLowerCase().replace(/\s+/g, "-"), label: level },
  subjects: [{ id: "biology", label: "Biology" }],
  curricula: [],
  completedAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...(prefs ? { preferences: { ...emptyPreferences(), completedAt: "2026-10-05T00:00:00.000Z", ...prefs } } : {}),
});

const policyFor = (level: string, prefs: Partial<LearningPreferences> | null = null, support = {}) =>
  buildTeachingPolicy(buildStudentCard(basics(level, prefs), "How does photosynthesis work?", {}, support)!);

test("a Grade 4 student, a Grade 10 student and a university student are taught differently", () => {
  const g4 = policyFor("Grade 4");
  const g10 = policyFor("Grade 10");
  const uni = buildTeachingPolicy(buildStudentCard(basics("Undergraduate"), "photosynthesis")!, { depth: 4 });
  assert.deepEqual([g4.band, g10.band, uni.band], ["primary", "secondary", "university"]);
  assert.ok(g4.language.sentenceWords < g10.language.sentenceWords && g10.language.sentenceWords < uni.language.sentenceWords);
  assert.deepEqual([g4.abstraction, g10.abstraction, uni.abstraction], ["concrete", "balanced", "formal"]);
  assert.deepEqual([g4.guidance, g10.guidance, uni.guidance], ["worked", "faded", "independent"]);
  assert.equal(g4.pacing.ideasPerBoard, 1);
  assert.equal(g4.visuals.lead, "pictures", "the young are taught picture-first");
  assert.ok(g4.visuals.labelWords < uni.visuals.labelWords);
  assert.match(policyForWriter(g4), /Sound like this: "Plants make their own food\./, "a sample at the young band's level");
  assert.doesNotMatch(policyForWriter(uni), /Sound like this/);
  assert.match(policyForWriter(g4), /what do you think happens if/);
  assert.match(policyForWriter(uni), /formal notation is fine/);
});

test("what this lesson showed beats the grade: a university novice starts from a worked example", () => {
  const novice = buildTeachingPolicy(buildStudentCard(basics("Undergraduate"), "photosynthesis")!, { depth: 1 });
  assert.equal(novice.guidance, "worked");
  assert.equal(novice.abstraction, "concrete-first");
  const strong8 = buildTeachingPolicy(buildStudentCard(basics("Grade 8"), "photosynthesis")!, { depth: 4 });
  assert.equal(strong8.guidance, "independent", "harder ideas…");
  assert.equal(strong8.readingGrade, 8, "…not harder prose");
});

test("the challenge a student chose moves the guidance one step, and never past what they asked for", () => {
  assert.equal(policyFor("Grade 10", { challenge: "gentle" }).guidance, "worked");
  assert.equal(policyFor("Grade 10", { challenge: "stretch" }).guidance, "independent");
  assert.equal(policyFor("Grade 10", { challenge: "stretch", helps: ["worked-examples"] }).guidance, "faded", "asked for worked examples: never left without one");
  assert.equal(policyFor("Grade 10", { challenge: "gentle" }).pacing.ideasPerBoard, 1);
});

test("English comfort is kept apart from grade: plainer sentences, the same ideas", () => {
  const p = policyFor("Grade 11", { english: "learning" });
  assert.equal(p.conceptGrade, 11);
  assert.equal(p.readingGrade, 9);
  assert.ok(p.language.sentenceWords <= 14, "short sentences");
  assert.match(p.language.assume, /secondary-school maths/, "assumes Grade 11 maths, not Grade 9 prose");
  const w = policyForWriter(p);
  assert.match(w, /no idioms or phrasal verbs/);
  assert.match(w, /Only the sentences are simpler — the ideas stay at their level \(Grade 11\)/);
  assert.match(policyForQuestions(p), /plain English/);
  // Simpler language chosen on the accessibility screen stacks with it.
  assert.equal(policyFor("Grade 11", { english: "learning" }, { simplerLanguage: true }).readingGrade, 8);
});

test("preferences change what a lesson leans on, never take the board or the voice away", () => {
  const p = policyFor("Grade 9", { helps: ["pictures", "try-it", "real-life"], interests: ["sports", "space"], goal: "exams" });
  const plan = policyForCanvasPlan(p);
  assert.match(plan, /Lean on pictures/);
  assert.match(plan, /carries a quiz/);
  assert.match(plan, /cricket, football/, "examples from their interests");
  assert.match(plan, /space, planets/);
  assert.match(plan, /Tie each idea to where they meet it in real life/);
  assert.match(plan, /THEIR GOAL IS EXAMS/);
  assert.match(policyForPlanner(p), /preparing for exams/);
  assert.equal(p.practice, "often");
  // A student who likes notes still gets a drawn board; nothing ever says "no pictures".
  const notes = policyFor("Grade 9", { helps: ["short-notes"] });
  assert.equal(notes.visuals.lead, "balanced");
  assert.match(policyForBoards(notes), /key point as one short note/);
  for (const text of [policyForCanvasPlan(notes), policyForBoards(notes), policyForVoice(notes)]) {
    assert.doesNotMatch(text, /no (pictures|diagrams|drawings)|visual learner|learning style/i);
  }
});

test("this lesson's own aim beats the profile's goal", () => {
  const card = buildStudentCard(basics("Grade 9", { goal: "curious" }), "photosynthesis")!;
  assert.equal(buildTeachingPolicy(card).goal, "curious");
  const learner = { ...emptyProfile("photosynthesis"), objective: "exam" as const };
  assert.equal(buildTeachingPolicy(card, { learner, depth: 2 }).goal, "exams");
});

test("support the student chose is always honoured", () => {
  const adhd = policyFor("Grade 10", null, { accessibility: "adhd" });
  assert.equal(adhd.pacing.ideasPerBoard, 1);
  assert.equal(adhd.pacing.checkIns, "often");
  const dys = policyFor("Grade 10", null, { accessibility: "dyslexia" });
  assert.ok(dys.visuals.labelWords < policyFor("Grade 10").visuals.labelWords);
  assert.equal(policyFor("Grade 10", null, { slowerPace: true }).pacing.recap, true);
});

test("a strict lesson keeps only the words: no interests, no country, no goal", () => {
  const p = policyFor("Grade 6", { interests: ["games"], goal: "exams" });
  const strict = policyForWriter(p, { strict: true });
  assert.match(strict, /READING LEVEL OF GRADE 6/);
  assert.doesNotMatch(strict, /video games|Pakistan|EXAMS|syllabus/);
});

test("the planning screen's line says what Aria assumed and what she is leaning on", () => {
  assert.equal(policyNote(policyFor("Grade 8", { helps: ["pictures", "real-life"] })), "Pitched for Grade 8 · Pakistan · pictures, real-life examples");
  assert.equal(policyNote(null), "");
});

test("the policy's guidance pitches the beat brief, so the two never disagree", () => {
  const learner = emptyProfile("photosynthesis");
  const brief = learnerBrief(learner, { title: "Light reactions" }, "script", 5, { guidance: "worked" });
  assert.match(brief, /^Novice: show a concrete worked example/);
});

test("preferences are cleaned: unknown values dropped, lists capped, and finishing (or skipping) is remembered", () => {
  const p = sanitizePreferences({ goal: "fame", helps: ["pictures", "videos", "pictures", "try-it", "real-life", "short-notes"], interests: ["space", "nope"], english: "learning", complete: true }, null, "2026-10-05T00:00:00.000Z");
  assert.equal(p.goal, null);
  assert.deepEqual(p.helps, ["pictures", "try-it", "real-life"], "no 'videos', no duplicates, at most three");
  assert.deepEqual(p.interests, ["space"]);
  assert.equal(p.completedAt, "2026-10-05T00:00:00.000Z");
  const skipped = sanitizePreferences({ complete: true }, null, "2026-10-05T00:00:00.000Z");
  assert.equal(skipped.completedAt, "2026-10-05T00:00:00.000Z", "skipping still counts as seen");
  assert.equal(hasPreferences(skipped), false);
  const changed = sanitizePreferences({ challenge: "stretch" }, p);
  assert.equal(changed.challenge, "stretch");
  assert.deepEqual(changed.helps, p.helps, "settings can change one answer");
});

test("the learner profile keeps preferences across a save that does not send them", () => {
  const saved = mergeLearnerBasics({ preferences: { goal: "homework", complete: true } }, basics("Grade 7"), "Sana");
  assert.equal(saved.preferences?.goal, "homework");
  assert.ok(saved.preferences?.completedAt);
  const later = mergeLearnerBasics({ country: "GB" }, saved, "Sana");
  assert.equal(later.preferences?.goal, "homework");
  assert.equal(mergeLearnerBasics({ country: "GB" }, basics("Grade 7"), "Sana").preferences, undefined, "nothing invented for a profile without them");
});

test("with the policy in the requests, the profile lines stop repeating pace and language", () => {
  const view = learnerProfileView(basics("Grade 7"), null);
  assert.match(learnerContextForPrompt(view, { slowerPace: true, simplerLanguage: true }), /slower pace/);
  assert.doesNotMatch(learnerContextForPrompt(view, { slowerPace: true, simplerLanguage: true, teachingPolicy: true }), /slower pace|simpler language/i);
});

test("the canvas planner is given the policy instead of the one-line summary", () => {
  const card = buildStudentCard(basics("Grade 5", { helps: ["pictures"] }), "the water cycle")!;
  const input = { topic: "The water cycle", mood: "", sourceType: "prompt", mode: "standard", studentCard: card, learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "mixed", rationale: "", confirmedAt: "" } } as ProgressiveLectureInput;
  const request = canvasPlanRequest(input);
  assert.match(request, /HOW TO TEACH THEM/);
  assert.match(request, /Lean on pictures/);
  assert.doesNotMatch(request, /learns best from a mix of/);
});
