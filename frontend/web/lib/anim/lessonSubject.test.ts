import test from "node:test";
import assert from "node:assert/strict";
import { asCodeLesson, asMaths, courseLessonSubject, courseSubjectKind, plannedSubject } from "../canvas/lessonSubject";
import { canvasPlanRequest, CS_TEACHING, MATHS_CS_TEACHING } from "../canvas/lessonRequest";
import { examinerFor } from "../canvas/mathsCheck";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { predictCardFor } from "../canvas/predictCard";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { SuprnotesLessonInput } from "../suprnotes";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../canvas/types";

/*
 * A COURSE LESSON IS TAUGHT AS ITS COURSE'S SUBJECT (owner, 2026-10-23, after the Chemistry lesson
 * "Formulae" was taught as maths: "a maths and computer science lecture is never treated as something
 * different"). Typed-prompt and PDF lectures are decided exactly as before.
 */

test("a course's subject name is maths, CS or another subject — by the subject word that comes first", () => {
  for (const n of ["Mathematics", "Further Mathematics B (MEI)", "Calculus AB and BC", "Precalculus", "Statistics", "Mathematics: Analysis and approaches (SL and HL)", "Maths"]) assert.equal(courseSubjectKind(n), "maths", n);
  for (const n of ["Computer Science", "Computing (OCR GCSE route)", "Information and Communication Technology", "Digital Technologies", "Computer Studies for Pre-Home Economics", "Cybersecurity"]) assert.equal(courseSubjectKind(n), "cs", n);
  for (const n of ["Chemistry", "Physics 1: Algebra-Based", "Physics C: Mechanics", "Accounting", "Business", "Design and Technology", "Digital Literacy", "Biology, Chemistry, Physics, English, Logical Reasoning"]) assert.equal(courseSubjectKind(n), "other", n);
  assert.equal(courseSubjectKind("English; Mathematics; Reading; Science; Writing"), null, "several kinds of subject: no one subject for the course");
  assert.equal(courseSubjectKind(""), null);
});

const course = (subject: string, title: string, goals: string[] = []): SuprnotesLessonInput => ({
  lesson: { title, subject, learningGoals: goals },
  lessonPlan: { sourceType: "curriculum", beats: [{ title, objective: goals[0] ?? title }] },
  contentBlocks: [{ id: "b1", type: "paragraph", text: goals.join(" ") || title }],
} as unknown as SuprnotesLessonInput);

test("a course lesson takes its course's subject; a mixed course's lesson is read from its title alone", () => {
  assert.equal(courseLessonSubject(course("Chemistry", "Formulae")), "other", "the lesson the manager saw taught as maths");
  assert.equal(courseLessonSubject(course("Mathematics", "Straight lines")), "maths", "no maths word in the title");
  assert.equal(courseLessonSubject(course("Computer Science", "Operating Systems")), "cs");
  assert.equal(courseLessonSubject(course("Reading and Writing; Math", "Solving equations")), "maths");
  assert.equal(courseLessonSubject(course("Reading and Writing; Math", "Story structure")), "other");
  assert.equal(courseLessonSubject(null), null, "not a course lesson: nothing decided here");
});

const lecture = (topic: string, doc?: SuprnotesLessonInput): ProgressiveLectureInput => ({
  topic,
  mood: "",
  sourceType: doc ? "suprnotes" : "prompt",
  mode: "standard",
  ...(doc ? { suprnotes: doc } : {}),
  learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" },
  outline: { topic, scope: "lesson", subtopics: [{ title: topic, caption: "" }] },
} as ProgressiveLectureInput);

test("the planner is told to teach the course's subject: no maths rules for Chemistry, code only for CS code lessons", () => {
  const chem = canvasPlanRequest(lecture("Formulae", course("Chemistry", "Formulae", ["State the formulae of the elements and compounds named in the syllabus."])));
  assert.ok(!chem.includes(MATHS_CS_TEACHING) && !chem.includes(CS_TEACHING), "a Chemistry course lesson gets neither");
  const maths = canvasPlanRequest(lecture("Straight lines", course("Mathematics", "Straight lines", ["Find the gradient of a line."])));
  assert.ok(maths.includes(MATHS_CS_TEACHING) && !maths.includes(CS_TEACHING));
  const networks = canvasPlanRequest(lecture("Networks", course("Computer Science", "Networks", ["Describe LANs and WANs."])));
  assert.ok(networks.includes(MATHS_CS_TEACHING), "taught in the CS structure");
  assert.ok(!networks.includes(CS_TEACHING), "but not through code: it is not a programming lesson");
  const search = canvasPlanRequest(lecture("Searching", course("Computer Science", "Searching", ["Write a linear search and a binary search algorithm in pseudocode."])));
  assert.ok(search.includes(CS_TEACHING), "an algorithm lesson in a CS course is taught through code");
  // A typed prompt is decided exactly as before: the same words still read as maths.
  assert.ok(canvasPlanRequest(lecture("Formulae")).includes(MATHS_CS_TEACHING), "prompt lectures unchanged");
});

const beat = (over: Partial<CanvasPlanBeat> = {}): CanvasPlanBeat => ({
  id: "b1", title: "Reading molecular formulae", script: "A subscript counts atoms. H₂O has two hydrogen atoms.", stage: "scene", brief: "count the atoms in H₂O",
  objects: [], inside: null, carry: [], interaction: null, overview: false, ...over,
} as CanvasPlanBeat);

test("every later step reads the stamp: examiner, maths look, structure, prediction", () => {
  const chem = [beat({ subject: "other", title: "Formula masses with brackets" })];
  assert.equal(plannedSubject(chem), "other");
  assert.equal(examinerFor("Formulae", chem), null, "no maths examiner on a Chemistry board");
  assert.equal(examinerFor("Straight lines", [beat({ subject: "maths", title: "Gradient" })]), "maths");
  assert.equal(examinerFor("Networks", [beat({ subject: "cs", title: "LANs" })]), "cs");
  assert.equal(examinerFor("Formulae", [beat({ title: "Rearranging formulae" })]), "maths", "no stamp: the old guess");
  // The maths look turned the Chemistry boards into sketches; a stamped Chemistry lesson keeps its stages.
  const policy = applyLessonVisualPolicy([beat({ subject: "other" })], { mode: "course", topic: "Formulae", aiPictures: false });
  assert.notEqual(policy.beats[0].stage, "sketch");
  assert.equal(asMaths(undefined, () => true), true);
  assert.equal(asCodeLesson("cs", () => false), false);
  const eq = { v: 1, heading: "Charges", notes: [], cues: [], stage: { kind: "equation", tokens: [{ id: "a", text: "x" }, { id: "b", text: "=" }, { id: "c", text: "2" }], steps: [{ s: 0, order: ["a", "b", "c"] }, { s: 1, order: ["a", "b", "c"] }] } } as unknown as CanvasBoardSpec;
  assert.equal(predictCardFor({ ...eq, subject: "other" }, "Solving equations"), null, "a stamped non-maths board never gets a maths prediction");
});

test("a typed, PDF or video lecture's subject is one judged answer; anything else leaves the old guess", async () => {
  const { classifySubject, parseSubject, subjectUserPrompt } = await import("../canvas/subjectClassifier");
  assert.equal(parseSubject({ subject: "cs" }), "cs");
  assert.equal(parseSubject({ subject: "physics" }), null, "only maths, cs or other");
  const said: string[] = [];
  const ok = await classifySubject(async (_s, user) => { said.push(user); return { json: { subject: "other" }, costUsd: 0.0005 }; }, { topic: "Fall of the Roman Empire", parts: ["Internal and External Factors"] });
  assert.deepEqual(ok, { subject: "other", costUsd: 0.0005 });
  assert.match(said[0], /Planned parts: Internal and External Factors/);
  assert.deepEqual(await classifySubject(async () => { throw new Error("timeout"); }, { topic: "AES" }), { subject: null, costUsd: 0 });
  assert.match(subjectUserPrompt({ topic: "Cell Structure", documentTitle: "Biology notes", headings: ["Magnification"], excerpt: "Total magnification = eyepiece × objective" }), /Document: Biology notes\nIts headings: Magnification\nIt begins: Total magnification/);
  // The judged subject drives the planner's rules exactly as a course's does.
  assert.ok(!canvasPlanRequest(lecture("Formulae"), undefined, "other").includes(MATHS_CS_TEACHING), "judged chemistry: no maths rules");
  assert.ok(canvasPlanRequest(lecture("AES encryption rounds"), undefined, "cs").includes(MATHS_CS_TEACHING), "judged CS: the CS structure");
});
