import test from "node:test";
import assert from "node:assert/strict";
import { isLadder, ladderBoardBudget, ladderCanvasSection, ladderOutlineInstruction, wantsMap, withPartStatuses } from "../canvas/conceptLadder";
import { canvasBoardCount, canvasPlanRequest } from "../canvas/lessonRequest";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";

/*
 * THE CONCEPT LADDER (lib/canvas/conceptLadder.ts, owner 2026-10-20): what the student marked as
 * new is built from scratch over several boards; shaky parts more briefly; known parts are a recap.
 */
const parts = [
  { title: "What plants need", caption: "light, water and air", status: "known" as const },
  { title: "Chlorophyll", caption: "the green pigment that traps light", status: "new" as const },
  { title: "Gases in and out", caption: "carbon dioxide in, oxygen out", status: "shaky" as const },
  { title: "What plants make", caption: "glucose and what it is for", status: "new" as const },
];
const lecture = (subtopics: Array<{ title: string; caption: string; status?: "new" | "shaky" | "known" }> = parts): ProgressiveLectureInput => ({
  topic: "Photosynthesis",
  mood: "",
  sourceType: "prompt",
  mode: "standard",
  learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" },
  outline: { topic: "Photosynthesis", scope: "lesson", subtopics },
} as ProgressiveLectureInput);

test("boards follow what the student knows: new parts 2 to 4, shaky 1 to 2, known none, plus a map for beginners", () => {
  assert.equal(wantsMap(parts), true);
  assert.deepEqual(ladderBoardBudget(parts), { min: 2 + 1 + 2 + 1, max: 3 + 2 + 3 + 1 });
  assert.deepEqual(ladderBoardBudget([{ title: "x", status: "known" }, { title: "y", status: "shaky" }]), { min: 1, max: 2 }, "nothing new: no map");
  assert.equal(isLadder(parts), true);
  assert.equal(isLadder([{ title: "x", caption: "" }]), false, "an outline without statuses keeps the old one-board-per-part plan");
});

test("the canvas planner gets the ladder instead of 'one board per part', with every part's status", () => {
  const request = canvasPlanRequest(lecture());
  assert.match(request, /THE CONCEPT LADDER/);
  assert.doesNotMatch(request, /exactly \d+ boards?, one per part/);
  assert.match(request, /P1\. What plants need: light, water and air \[KNOWN: one-line recap only, no board\]/);
  assert.match(request, /P2\. Chlorophyll: the green pigment that traps light \[NEW: build it from scratch, 2 to 3 boards\]/);
  assert.match(request, /b1 is THE MAP/);
  assert.match(request, /WHY IT MATTERS[\s\S]*THE NEW WORDS[\s\S]*THE SIMPLEST CASE[\s\S]*NAME IT[\s\S]*HOW IT WORKS[\s\S]*WORKED EXAMPLE[\s\S]*THE COMMON MISTAKE[\s\S]*CONNECT/);
  assert.equal(canvasBoardCount(lecture()), 9);
  // An old outline is untouched.
  const plain = canvasPlanRequest(lecture(parts.map(({ status: _s, ...p }) => p)));
  assert.match(plain, /exactly 4 boards, one per part/);
  assert.equal(canvasBoardCount(lecture(parts.map(({ status: _s, ...p }) => p))), 4);
});

test("the outline planner plans FROM the student's parts, keeping each status", () => {
  const line = ladderOutlineInstruction([{ label: "What plants need", status: "known" }, { label: "Chlorophyll", status: "new" }]);
  assert.match(line, /1\. What plants need: KNOWN[\s\S]*2\. Chlorophyll: NEW/);
  assert.match(line, /Never drop a part/);
  assert.match(line, /"status"/);
  assert.equal(ladderOutlineInstruction([]), "");
  assert.ok(ladderCanvasSection(parts).length > 5);
});

test("PDFs: a reference outline with statuses climbs the ladder; a strict PDF gets the parts with only-the-pages rungs", () => {
  const doc = { lesson: { title: "Photosynthesis" }, contentBlocks: [
    { id: "p1-b1", pageNumber: 1, heading: "What plants need", text: "Plants need light, water and carbon dioxide." },
    { id: "p2-b1", pageNumber: 2, heading: "Chlorophyll", text: "Chlorophyll is the green pigment that absorbs light." },
  ] };
  const reference = canvasPlanRequest({ ...lecture(), sourceType: "pdf", suprnotes: doc, sourceScope: { breadth: { kind: "whole" }, fidelity: "reference", documentLabels: [] } } as ProgressiveLectureInput);
  assert.match(reference, /THE CONCEPT LADDER/);
  const strict = canvasPlanRequest({
    ...lecture(),
    outline: undefined,
    sourceType: "pdf",
    suprnotes: doc,
    sourceScope: { breadth: { kind: "whole" }, fidelity: "strict", documentLabels: [] },
    learner: { parts: [{ label: "What plants need", status: "known" }, { label: "Chlorophyll", status: "new" }] },
  } as unknown as ProgressiveLectureInput);
  assert.match(strict, /THE STUDENT'S PARTS OF THESE PAGES[\s\S]*P1\. What plants need: KNOWN[\s\S]*P2\. Chlorophyll: NEW/);
  assert.match(strict, /pages' OWN words, examples and figures, never outside facts/);
  assert.match(strict, /Never skipped: every page is taught/);
  assert.doesNotMatch(strict, /b1 is THE MAP/, "no map board in a strict lesson");
});

test("statuses are attached by code when the planner leaves them out, and the outline stays on the parts (A/B bench, 2026-10-20)", () => {
  const readings = [{ label: "Machine learning models", status: "known" as const }, { label: "Training and test data", status: "shaky" as const }, { label: "Overfitting", status: "new" as const }];
  const outline: Array<{ title: string; caption: string; status?: "new" | "shaky" | "known" }> = [
    { title: "Training and Testing Data", caption: "how test data checks a model" },
    { title: "Definition of Overfitting", caption: "memorising noise" },
    { title: "Bias-Variance Tradeoff", caption: "two kinds of error" },
    { title: "Cross-Validation", caption: "folds" },
    { title: "Pruning", caption: "smaller trees" },
    { title: "Data Augmentation", caption: "more data" },
  ];
  const marked = withPartStatuses(outline, readings);
  assert.deepEqual(marked.map((s) => s.title), ["Training and Testing Data", "Definition of Overfitting", "Bias-Variance Tradeoff", "Cross-Validation"], "the parts, and at most two others");
  assert.deepEqual(marked.map((s) => s.status), ["shaky", "new", "new", "new"], "matched by words; unmatched is new");
  assert.equal(withPartStatuses(outline, readings, { keepAll: true }).length, 6, "a syllabus or a document keeps every subtopic");
  assert.equal(withPartStatuses([{ title: "X", caption: "", status: "known" as const }], readings)[0].status, "known", "the planner's own status is kept");
});

test("a part named by the topic's own word claims one subtopic, not every one that mentions it (A/B bench, 2026-10-20)", () => {
  const readings = [{ label: "Generalization", status: "known" as const }, { label: "Overfitting", status: "new" as const }, { label: "Reducing overfitting", status: "new" as const }];
  const outline: Array<{ title: string; caption: string; status?: "new" | "shaky" | "known" }> = [
    { title: "Overfitting Definition", caption: "overfitting memorises noise" },
    { title: "Cross-Validation", caption: "folds detect overfitting", status: "new" },
    { title: "Regularization", caption: "penalties reduce overfitting", status: "new" },
    { title: "Generalization Error", caption: "how overfitting shows on new data" },
    { title: "Reducing Overfitting", caption: "simpler models and more data" },
    { title: "Pruning", caption: "smaller trees avoid overfitting", status: "new" },
    { title: "Overfitting in Regression", caption: "curves through noise", status: "new" },
  ];
  const kept = withPartStatuses(outline, readings);
  assert.ok(kept.length <= readings.length + 2, `kept ${kept.length}`);
  assert.equal(kept.find((s) => s.title === "Generalization Error")?.status, "known");
  assert.equal(kept.find((s) => s.title === "Reducing Overfitting")?.status, "new");
  assert.ok(!kept.some((s) => s.title === "Cross-Validation" && s.status === "known"), "an extra never borrows a known status");
});
