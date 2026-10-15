import test from "node:test";
import assert from "node:assert/strict";
import { boardBudget, completeSpec, lessonDocument, lessonSpecText, specGaps, type LessonSpec } from "../curriculum/lessonSpec";
import { curriculumBoardEvidence } from "../curriculum/visualEvidence";
import type { Beat } from "../lessonContent";

const spec = (boards: LessonSpec["boards"]): LessonSpec => ({
  courseLabel: "MDCAT Biology", level: "MDCAT", lessonTitle: "Carbohydrates",
  outcomes: [{ code: "3.1", text: "Define carbohydrates." }, { code: "3.2", text: "Classify sugars." }, { code: null, text: "Explain starch storage." }],
  prerequisites: [], requiredTerms: ["monosaccharide"], requiredMethods: [], commandWords: ["define"], depth: "MDCAT depth.",
  misconceptions: ["Sugar always tastes sweet"], outOfScope: ["Glycolysis"], boards,
  checkpoint: [{ question: "What is a carbohydrate?", answer: "…", outcomeRef: 1 }, { question: "?", answer: "?", outcomeRef: 9 }],
});
const board = (refs: number[], title = "B"): LessonSpec["boards"][number] => ({ title, objective: "o", outcomeRefs: refs, keyPoints: ["k"], workedExample: "", evidencePages: [5] });

test("code finds outcomes no board teaches, and references to outcomes that do not exist", () => {
  assert.deepEqual(specGaps(spec([board([1]), board([1, 7])])), { untaught: [2, 3], badRefs: 1 });
  assert.deepEqual(specGaps(spec([board([1, 2]), board([3])])), { untaught: [], badRefs: 0 });
});

test("a completed spec teaches every outcome whatever the model planned, and drops bad references", () => {
  const done = completeSpec(spec([board([1, 9], "Defining"), board([], "Empty")]));
  assert.deepEqual(specGaps(done), { untaught: [], badRefs: 0 });
  assert.deepEqual(done.boards.map((b) => b.outcomeRefs), [[1], [2], [3]], "the empty board is gone; 2 and 3 get boards of their own");
  assert.equal(done.checkpoint.length, 1, "a checkpoint question about a non-existent outcome is dropped");
  assert.equal(done.outcomeContracts?.length, 3, "Phase 2 creates one teaching contract per official outcome");
  assert.equal(done.boardBudget?.recommended, 3, "simple outcomes receive one compact board target per outcome");
});

test("Phase 2 budgets complex outcomes and carries teach-check-transfer requirements into the document", () => {
  const budget = boardBudget([
    { code: "1", text: "Calculate the force using the formula." },
    { code: "2", text: "Draw and label a force diagram." },
    { code: "3", text: "Define force." },
  ]);
  assert.ok(budget.recommended > 2, "method and diagram outcomes receive room for depth");
  const s = completeSpec(spec([board([1, 2, 3], "Forces")]));
  const doc = lessonDocument(s, { request: { courseId: "x", version: "v", grade: "10", unitId: "u", topicId: "t", lessonId: "l" }, framework: "Test syllabus", subject: "Physics" }, []);
  const block = doc.contentBlocks![0];
  assert.ok(block.teachingHints?.some((h) => h.startsWith("Required understanding check:")));
  assert.ok(block.teachingHints?.some((h) => h.startsWith("Transfer task:")));
  assert.deepEqual((doc.lessonPlan as { boardBudget: typeof budget }).boardBudget, s.boardBudget);
});

test("the lesson document is a structured, source-grounded plan with every outcome attributed", () => {
  const s = completeSpec(spec([board([1, 2], "Sugars"), board([3], "Starch")]));
  const doc = lessonDocument(s, { request: { courseId: "pk-mdcat-pmdc-2025", version: "v1", grade: "all", unitId: "u", topicId: "t", lessonId: "l" }, framework: "PMDC MDCAT 2025", subject: "Biology" }, [{ page: 5, code: "3.1", text: "3.1 Define carbohydrates…" }]);
  const plan = doc.lessonPlan as { requireCompleteCoverage: boolean; beats: Array<{ sourceBlockIds: string[] }> };
  assert.equal(plan.requireCompleteCoverage, true);
  assert.equal(plan.beats.length, 2);
  assert.deepEqual(plan.beats.map((b) => b.sourceBlockIds), [["c1"], ["c2"]]);
  assert.deepEqual(doc.lesson?.learningGoals, ["Define carbohydrates.", "Classify sugars.", "Explain starch storage."]);
  const block = doc.contentBlocks![0];
  assert.match(block.text!, /Official syllabus \(PMDC MDCAT 2025\)/);
  assert.equal(block.pageNumber, 5);
  assert.deepEqual(block.facts!.map((f) => f.source), ["PMDC MDCAT 2025 3.1", "PMDC MDCAT 2025 3.2"]);
  assert.ok(block.teachingHints!.some((h) => /Do not teach .*Glycolysis/.test(h)), "out-of-scope reaches the writer");
});

test("course chat context identifies the syllabus and never presents it as student notes", () => {
  const context = lessonSpecText(spec([board([1, 2, 3])])).split("\n")[0];
  assert.match(context, /official curriculum course lesson/);
  assert.match(context, /never "your notes"/);
});

test("curriculum verification receives literal visible board evidence, including labels", () => {
  const beat = {
    id: "b1", title: "Plant cell", teacherMove: "teach", stepLabel: "1", slideKind: "definition", points: [], script: "Identify the structures.",
    draw: { caption: "cell", ops: [{ kind: "canvasBoard", at: 0, endAt: 1, spec: { v: 1, heading: "Plant cell", notes: [], cues: [], stage: { kind: "illustration", subject: "plant cell", parts: [{ id: "nucleus", name: "Nucleus", s: 0 }, { id: "wall", name: "Cell wall", s: 0 }], labels: ["nucleus"] } } }] },
  } as unknown as Beat;
  const evidence = curriculumBoardEvidence(beat);
  assert.match(evidence.visual, /Visible parts: Nucleus, Cell wall/);
  assert.match(evidence.visual, /Written labels: nucleus/);
  assert.doesNotMatch(evidence.visual, /Written labels:.*wall/);
});

test("a plan that misses outcomes is asked for once more, and the better plan is kept", async () => {
  const { planLessonSpec } = await import("../curriculum/planSpec");
  const plan = (refs: number[][]) => JSON.stringify({
    prerequisites: [], requiredTerms: [], requiredMethods: [], commandWords: [], depth: "d", misconceptions: [], outOfScope: [],
    boards: refs.map((r, i) => ({ title: `Board ${i + 1}`, objective: "o", outcomeRefs: r, keyPoints: ["rich point"], workedExample: "", evidencePages: [] })),
    checkpoint: [],
  });
  const replies = [plan([[61], [62]]), plan([[1], [2]])];
  const asked: string[] = [];
  const client = { chat: { completions: { create: async (req: { messages: Array<{ content: string }> }) => {
    asked.push(req.messages[1].content);
    return { choices: [{ message: { content: replies.shift() } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
  } } } } as unknown as Parameters<typeof planLessonSpec>[0];
  const out = await planLessonSpec(client, "m", { courseLabel: "MDCAT Physics", level: "MDCAT", title: "Waves", outcomes: [{ code: "6.1", text: "Define a node." }, { code: "6.2", text: "Describe modes." }], evidence: [] });
  assert.equal(out.attempts, 2);
  assert.match(asked[1], /outcome NUMBERS 1-2/);
  assert.deepEqual(out.modelGaps, []);
  assert.deepEqual(out.spec.boards.map((b) => b.keyPoints), [["rich point"], ["rich point"]], "the model's boards are kept, not replaced by bare ones");
  assert.deepEqual(out.usage, { input: 20, output: 10 });
});

test("a course lesson is taught on the canvas, one board per planned board, with its outcomes", async () => {
  const { canvasEngineFor, canvasBoardCount, canvasPlanRequest, curriculumDocumentOf } = await import("../canvas/lessonRequest");
  const s = completeSpec(spec([board([1, 2], "Sugars"), board([3], "Starch")]));
  const doc = lessonDocument(s, { request: { courseId: "pk-mdcat-pmdc-2025", version: "v1", grade: "all", unitId: "u", topicId: "t", lessonId: "l" }, framework: "PMDC MDCAT 2025", subject: "Biology" }, [{ page: 5, code: "3.1", text: "3.1 Define carbohydrates…" }]);
  const input = { topic: "Carbohydrates", mood: "", sourceType: "suprnotes", mode: "standard", suprnotes: doc, learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" } } as unknown as Parameters<typeof canvasEngineFor>[0];
  assert.ok(curriculumDocumentOf(input));
  assert.equal(canvasEngineFor(input, {}), true);
  assert.equal(canvasBoardCount(input), 2);
  const req = canvasPlanRequest(input);
  assert.match(req, /exactly 2 boards/);
  assert.match(req, /b1\. Sugars/);
  assert.match(req, /OFFICIAL COURSE/);
  assert.match(req, /Do not teach/);
  const ordinary = { ...input, suprnotes: { ...doc, lessonPlan: { ...(doc.lessonPlan as object), sourceType: "notes" } } } as typeof input;
  assert.equal(canvasEngineFor(ordinary, {}), false, "other structured documents keep the ordinary boards");
});
