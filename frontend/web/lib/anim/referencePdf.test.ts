import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canvasBoardCount, canvasPlanRequest, compactLadder, REFERENCE_DSA_PLAN, referenceCsLesson, TYPED_DSA_PLAN, withLearnerStatuses } from "../canvas/lessonRequest";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { runStructure } from "../canvas/structure";
import type { CanvasPlanBeat, CanvasStage, DsStart } from "../canvas/types";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { SuprnotesLessonInput } from "../suprnotes";

/*
 * A PDF USED AS A REFERENCE (owner, 2026-10-27): "what the student answers in planning is not propagated into
 * the lec", and the AVL chapter's lectures drew no tree "as in the prompt lec … visuals should be at par with
 * prompt". "How single rotation works" was one code board for a student new to six of its seven parts;
 * "Double rotation in AVL trees" planned a structure board and shipped a free sketch of circles.
 */
const avl = JSON.parse(readFileSync(join(process.cwd(), "lib", "anim", "fixtures", "avlCodePages.json"), "utf8")) as SuprnotesLessonInput;
const parts = [
  { id: "p1", label: "AVL node code", status: "known" as const },
  { id: "p2", label: "Balance factor", status: "new" as const },
  { id: "p3", label: "Single rotation", status: "shaky" as const },
  { id: "p4", label: "Double rotation", status: "new" as const },
];
const subtopics = [
  { title: "Balance Factor of a Node", caption: "how far the two subtrees' heights differ" },
  { title: "Single Rotation", caption: "one rotation fixes an outside case" },
  { title: "Double Rotation Steps", caption: "two rotations fix an inside case" },
];
const lecture = (fidelity: "reference" | "strict", opts: { domain?: "cs" | "maths" | "none"; question?: string; statuses?: boolean } = {}): ProgressiveLectureInput => ({
  topic: "AVL Trees",
  mood: "",
  sourceType: "pdf",
  mode: "standard",
  suprnotes: avl,
  learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" },
  learner: { parts } as unknown as ProgressiveLectureInput["learner"],
  sourceScope: { breadth: opts.question ? { kind: "section", focus: opts.question } : { kind: "whole" }, fidelity, documentLabels: [] },
  outline: { topic: "AVL Trees", scope: opts.question ? "question" : "lesson", subtopics: opts.statuses ? subtopics.map((s, i) => ({ ...s, status: (["new", "shaky", "new"] as const)[i] })) : subtopics },
  ...(opts.domain ? { subjectDomain: opts.domain } : {}),
} as ProgressiveLectureInput);

test("the student's marks reach a reference lecture whose outline arrived without them", () => {
  const input = withLearnerStatuses(lecture("reference"));
  assert.deepEqual(input.outline!.subtopics.map((s) => s.status), ["new", "shaky", "new"]);
  const request = canvasPlanRequest(input);
  assert.match(request, /THE CONCEPT LADDER/);
  assert.match(request, /THE STUDENT'S MARKS COME FIRST/);
  // An outline that already carries them, and a strict PDF, are left alone.
  const marked = lecture("reference", { statuses: true });
  assert.equal(withLearnerStatuses(marked), marked);
  const strict = lecture("strict");
  assert.equal(withLearnerStatuses(strict), strict);
});

test("a question asked of a reference PDF is built on the compact ladder, and stays on the question", () => {
  const input = withLearnerStatuses(lecture("reference", { question: "how does double rotation work" }));
  assert.equal(compactLadder(input), true);
  // Two new parts and a shaky one on the compact ladder: at most 2 + 1 + 2 boards, plus the map.
  assert.equal(canvasBoardCount(input), 6);
  const request = canvasPlanRequest(input);
  assert.match(request, /stay on the question/);
  assert.match(request, /built on the ladder above/);
});

test("a computer-science reference PDF gets the typed DSA plan with the document's own example and code", () => {
  const cs = lecture("reference", { domain: "cs" });
  assert.equal(referenceCsLesson(cs), true);
  const request = canvasPlanRequest(cs);
  assert.ok(request.includes(REFERENCE_DSA_PLAN));
  assert.ok(!request.includes(TYPED_DSA_PLAN));
  assert.match(request, /"code" board in REAL code — the document's own listing, in its own language/);
  // Not a CS answer, or no answer: exactly as before.
  assert.equal(referenceCsLesson(lecture("reference", { domain: "maths" })), false);
  assert.ok(!canvasPlanRequest(lecture("reference")).includes(REFERENCE_DSA_PLAN));
});

test("strict mode is untouched: a 'cs' answer changes nothing in its request", () => {
  assert.equal(referenceCsLesson(lecture("strict", { domain: "cs" })), false);
  assert.equal(canvasPlanRequest(lecture("strict", { domain: "cs" })), canvasPlanRequest(lecture("strict")));
});

test("the rotation recipe the writer is given really rebalances the document's tree: 3 → 1 → 2 becomes 2 over 1 and 3", () => {
  const start: DsStart = {
    kind: "tree", variant: "avl",
    nodes: [{ id: "n3", value: "3" }, { id: "n1", value: "1" }, { id: "n2", value: "2" }],
    edges: [{ from: "n3", to: "n1", side: "left" }, { from: "n1", to: "n2", side: "right" }],
  } as DsStart;
  const run = runStructure(start, [
    // Rotate 1 with its right child 2: 2 takes 1's place under 3.
    { s: 0, ops: [{ op: "link", from: "n2", to: "n1", side: "left" }] },
    // Rotate 3 with its new left child 2: 2 becomes the root.
    { s: 1, ops: [{ op: "link", from: "n2", to: "n3", side: "right" }] },
  ] as Array<{ s: number; ops: never[] }>);
  assert.equal(run.problem, null);
  const last = run.frames.at(-1)!;
  const edges = last.edges.map((e) => `${e.from}-${e.side}-${e.to}`).sort();
  assert.deepEqual(edges, ["n2-left-n1", "n2-right-n3"]);
});

import { rotationRepairHint } from "../canvas/structure";

// The hint's own ops, replayed by the engine: what the writer is told is exactly what the board will draw.
function replayHint(start: DsStart, text: string) {
  const hint = rotationRepairHint(start, text);
  assert.ok(hint, "a hint for an unbalanced tree");
  const steps = [...hint!.matchAll(/"ops": (\[.*\])$/gm)].map((m, i) => ({ s: i, ops: JSON.parse(m[1]) }));
  const run = runStructure(start, steps as Array<{ s: number; ops: never[] }>);
  assert.equal(run.problem, null);
  return { hint: hint!, edges: run.frames.at(-1)!.edges.map((e) => `${e.from}-${e.side}-${e.to}`).sort() };
}
const tree = (edges: Array<[string, string, "left" | "right"]>): DsStart => ({
  kind: "tree", variant: "avl",
  nodes: [...new Set(edges.flatMap(([a, b]) => [a, b]))].map((id) => ({ id, value: id.slice(1) })),
  edges: edges.map(([from, to, side]) => ({ from, to, side })),
} as DsStart);

test("the AVL rebalance is computed: the PDF's right-left case 7 → 16 → 15 is two rotations ending with 15 on top", () => {
  const { hint, edges } = replayHint(tree([["n7", "n16", "right"], ["n16", "n15", "left"]]), "The double rotation fixes 7");
  assert.match(hint, /right-left case, so TWO rotations/);
  assert.deepEqual(edges, ["n15-left-n7", "n15-right-n16"]);
});

test("a left-left case with subtrees moves the inner subtree across in the same step", () => {
  // 30 over 20 over 10, with 25 as 20's right child: rotating 20 up hands 25 to 30.
  const { hint, edges } = replayHint(tree([["n30", "n20", "left"], ["n30", "n40", "right"], ["n20", "n10", "left"], ["n20", "n25", "right"], ["n10", "n5", "left"]]), "AVL rotation");
  assert.match(hint, /left-left case, so ONE rotation/);
  assert.deepEqual(edges, ["n10-left-n5", "n20-left-n10", "n20-right-n30", "n30-left-n25", "n30-right-n40"]);
  assert.equal(rotationRepairHint(tree([["n2", "n1", "left"], ["n2", "n3", "right"]]), "AVL rotation"), null, "balanced: no hint");
});

function beat(id: string, title: string, stage: CanvasStage, script = `${title}: we trace it on the tree step by step.`): CanvasPlanBeat {
  return { id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false };
}

test("a CS reference PDF's boards are routed as a typed CS lesson's: no free sketch", () => {
  const beats = () => [beat("b1", "AVL tree balance", "flow"), beat("b2", "Double rotation on the tree", "sketch", "The node 3 has left child 1, whose right child is 2; we rotate 1 left, then 3 right.")];
  const cs = applyLessonVisualPolicy(beats(), { mode: "reference", topic: "AVL Trees", domain: "cs" });
  assert.notEqual(cs.beats[1].stage, "sketch");
  // Without the CS answer the reference policy is exactly as before.
  const before = applyLessonVisualPolicy(beats(), { mode: "reference", topic: "AVL Trees" });
  const strict = applyLessonVisualPolicy(beats(), { mode: "strict", topic: "AVL Trees", domain: "cs" });
  const strictBefore = applyLessonVisualPolicy(beats(), { mode: "strict", topic: "AVL Trees" });
  assert.deepEqual(strict.beats.map((b) => b.stage), strictBefore.beats.map((b) => b.stage), "strict ignores the domain");
  assert.ok(before.beats.length === 2);
});
