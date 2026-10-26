import test from "node:test";
import assert from "node:assert/strict";
import { domainIsCs, domainIsLab, domainIsMaths, isSubjectDomain, keywordDomain } from "../canvas/subjectDomain";
import { canvasPlanRequest, CS_TEACHING, MATHS_CS_TEACHING, typedCsLesson } from "../canvas/lessonRequest";
import { examinerFor } from "../canvas/mathsCheck";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import type { CanvasPlanBeat, CanvasStage } from "../canvas/types";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";

/*
 * A TYPED LESSON'S SUBJECT IS ASKED (owner, 2026-10-24): one model call says CS, maths or neither, and
 * the rules follow the answer. Without an answer (older lectures, a failed call) the keywords decide.
 */
const OFF_POLICY = "what is off policy and how importance sampling is done in such algo";

const lecture = (topic: string, subjectDomain?: ProgressiveLectureInput["subjectDomain"]): ProgressiveLectureInput => ({
  topic,
  mood: "",
  sourceType: "prompt",
  mode: "standard",
  learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" },
  outline: { topic, scope: "lesson", subtopics: [{ title: topic, caption: "" }] },
  ...(subjectDomain ? { subjectDomain } : {}),
} as ProgressiveLectureInput);

function beat(id: string, title: string, stage: CanvasStage, script = `${title} is introduced clearly. We trace it step by step.`): CanvasPlanBeat {
  return { id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false };
}

test("the asked subject decides; without one, the keyword checks decide as before", () => {
  assert.equal(isSubjectDomain("maths"), true);
  assert.equal(isSubjectDomain("physics"), false);
  assert.equal(domainIsCs(undefined, OFF_POLICY), false, "the keywords missed it: 'algo' is not 'algorithm'");
  assert.equal(domainIsCs("cs", OFF_POLICY), true);
  assert.equal(domainIsCs("none", "Binary search trees"), false, "the asked answer wins over the keywords");
  assert.equal(domainIsMaths("maths", "Angles in a triangle sum to 180°"), true);
  // Maths runs as on the parent branch (owner, 2026-10-25): only a "cs" answer counts; the keywords decide maths.
  assert.equal(domainIsLab("none", "Quadratic equations"), true);
  assert.equal(domainIsLab("cs", "What is off policy"), true);
  assert.equal(domainIsLab("maths", "Why the base angles of an isosceles triangle are equal"), true);
  assert.equal(keywordDomain("Binary search trees"), "cs");
  assert.equal(keywordDomain("Solving quadratic equations"), "maths");
  assert.equal(keywordDomain("Photosynthesis"), "none");
});

test("the planner gets the CS rules for an asked CS lesson, the maths way for maths, and neither for 'none'", () => {
  const cs = canvasPlanRequest(lecture(OFF_POLICY, "cs"));
  assert.ok(cs.includes(CS_TEACHING) && cs.includes(MATHS_CS_TEACHING));
  assert.equal(typedCsLesson(lecture(OFF_POLICY, "cs")), true);
  assert.equal(typedCsLesson(lecture(OFF_POLICY)), false, "unasked: keywords, as before");

  const proof = canvasPlanRequest(lecture("Prove the base angles of an isosceles triangle are equal", "maths"));
  assert.ok(proof.includes(MATHS_CS_TEACHING) && !proof.includes(CS_TEACHING));

  const none = canvasPlanRequest(lecture("Stacks, arches and stumps in coastal erosion", "none"));
  assert.ok(!none.includes(MATHS_CS_TEACHING) && !none.includes(CS_TEACHING) && !none.includes("THIS LESSON TEACHES A DATA STRUCTURE"));
});

test("a PDF lesson never uses the asked subject", () => {
  const doc = { lesson: { title: "Binary search trees" }, contentBlocks: [{ id: "b1", heading: "BSTs", text: "A binary search tree keeps smaller keys on the left." }] };
  const request = canvasPlanRequest({ ...lecture("Binary search trees", "none"), sourceType: "pdf", suprnotes: doc, sourceScope: { breadth: { kind: "whole" }, fidelity: "reference", documentLabels: [] } } as ProgressiveLectureInput);
  assert.ok(request.includes(CS_TEACHING), "the PDF lesson keeps the keyword rule");
});

test("the examiner follows the asked subject on a typed lesson", () => {
  const plan = [{ title: "Importance sampling", brief: "ratio of policies" }];
  assert.equal(examinerFor(OFF_POLICY, plan, true, "cs"), "cs");
  assert.equal(examinerFor("Isosceles triangle proof", plan, true, "maths"), "maths");
  assert.equal(examinerFor("Solving quadratic equations", plan, true, "none"), "maths", "maths is examined by keywords, as on the parent branch");
  assert.equal(examinerFor("Solving quadratic equations", plan, false, "none"), "maths", "not typed: keywords");
});

test("the visual policy: a maths lesson's code board becomes working; 'none' keeps the CS code rule off", () => {
  const maths = applyLessonVisualPolicy([beat("b1", "Opening", "flow"), beat("b2", "Isosceles proof steps", "code")], { mode: "prompt", topic: "Isosceles triangles", domain: "maths" });
  assert.equal(maths.beats[1].stage, "equation");
  const traced = "We write the function in Python and trace line 2 as it runs.";
  const none = applyLessonVisualPolicy([beat("b1", "Opening", "flow"), beat("b2", "Python function trace", "flow", traced)], { mode: "prompt", topic: "Python functions", domain: "none" });
  assert.notEqual(none.beats[1].stage, "code");
  const cs = applyLessonVisualPolicy([beat("b1", "Opening", "flow"), beat("b2", "The update rule", "flow", traced)], { mode: "prompt", topic: OFF_POLICY, domain: "cs" });
  assert.equal(cs.beats[1].stage, "code");
});
