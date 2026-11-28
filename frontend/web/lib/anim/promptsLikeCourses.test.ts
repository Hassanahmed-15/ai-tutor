import test from "node:test";
import assert from "node:assert/strict";
import { canvasPlanRequest, COURSE_EASY_WORDS, COURSE_PICTURES_WHERE_NEEDED, promptTaughtLikeCourse } from "../canvas/lessonRequest";
import { promptBoardContext } from "../canvas/coursePicturePrompt";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { CanvasPlanBeat } from "../canvas/types";

/*
 * A TYPED PROMPT TAUGHT EXACTLY LIKE A COURSE LESSON (owner, 2026-11-20): every subject but maths and CS,
 * typed prompts only, behind CANVAS_PROMPTS_LIKE_COURSES=on. Off, nothing changes.
 */

const ON = { CANVAS_PROMPTS_LIKE_COURSES: "on" };
const prompt = (over: Partial<ProgressiveLectureInput> = {}): ProgressiveLectureInput => ({
  topic: "Causes of the First World War",
  mood: "",
  sourceType: "prompt",
  mode: "standard",
  learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" },
  ...over,
});

test("only a typed prompt outside maths and CS, and only with the switch on", () => {
  assert.equal(promptTaughtLikeCourse(prompt(), undefined, {}), false, "off by default");
  assert.equal(promptTaughtLikeCourse(prompt(), undefined, ON), true);
  assert.equal(promptTaughtLikeCourse(prompt(), "other", ON), true);
  assert.equal(promptTaughtLikeCourse(prompt({ topic: "Photosynthesis" }), "other", ON), true);
  assert.equal(promptTaughtLikeCourse(prompt({ topic: "Solving quadratic equations" }), "maths", ON), false, "maths keeps its own way");
  assert.equal(promptTaughtLikeCourse(prompt({ topic: "Binary search trees" }), "cs", ON), false, "CS keeps its own way");
  assert.equal(promptTaughtLikeCourse(prompt({ topic: "Solving quadratic equations" }), undefined, ON), false, "maths by its words when undecided");
  assert.equal(promptTaughtLikeCourse(prompt({ subjectDomain: "cs" }), undefined, ON), false, "the asked domain decides");
  assert.equal(promptTaughtLikeCourse(prompt({ sourceType: "pdf" }), "other", ON), false, "PDFs are untouched");
  assert.equal(promptTaughtLikeCourse(prompt({ sourceType: "suprnotes" }), "other", ON), false, "course lessons are courses already");
});

test("the planner gets the course's easy words and picture rules — and nothing else changes", () => {
  const before = process.env.CANVAS_PROMPTS_LIKE_COURSES;
  try {
    delete process.env.CANVAS_PROMPTS_LIKE_COURSES;
    const off = canvasPlanRequest(prompt(), undefined, "other");
    process.env.CANVAS_PROMPTS_LIKE_COURSES = "on";
    const on = canvasPlanRequest(prompt(), undefined, "other");
    assert.doesNotMatch(off, /EASY WORDS/);
    assert.match(on, /EASY WORDS — simple means easy wording/);
    assert.match(on, /PICTURES ONLY WHERE NEEDED/);
    const added = `\n\n${COURSE_EASY_WORDS.join("\n")}\n\n${COURSE_PICTURES_WHERE_NEEDED.join("\n")}`;
    assert.equal(on.replace(added, ""), off, "the two blocks are the only difference");
    const maths = canvasPlanRequest(prompt({ topic: "Solving quadratic equations" }), undefined, "maths");
    assert.doesNotMatch(maths, /EASY WORDS/, "maths prompts are untouched");
  } finally {
    if (before === undefined) delete process.env.CANVAS_PROMPTS_LIKE_COURSES;
    else process.env.CANVAS_PROMPTS_LIKE_COURSES = before;
  }
});

test("a prompt board's picture context: its brief, the student's pitch, the curriculum it names", () => {
  const beat = { id: "b2", title: "The alliance system", brief: "Two armed camps in Europe", script: "Europe split into two camps. Each promised to defend its friends.", objects: ["triple-entente", "triple_alliance"], audience: "a beginner, school level" } as unknown as CanvasPlanBeat;
  const ctx = promptBoardContext("IGCSE History: causes of the First World War", beat);
  assert.deepEqual(ctx.sentences, ["Europe split into two camps.", "Each promised to defend its friends."]);
  assert.deepEqual(ctx.objects, ["triple entente", "triple alliance"]);
  assert.equal(ctx.syllabus, "");
  assert.equal(ctx.family, undefined, "the picture planner picks the discipline");
  assert.match(ctx.hints[0], /^Level: a beginner/);
  assert.equal(ctx.curriculum.name, promptBoardContext("Cambridge IGCSE", beat).curriculum.name);
});
