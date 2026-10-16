import test from "node:test";
import assert from "node:assert/strict";
import { boardStructureProblem, describeStructure, edgeCurve, isDataStructureTopic, layoutStructure, parseOps, parseStructure, runStructure, withoutStructure, type DsFrame } from "../canvas/structure";
import { DSA_FIXTURES } from "../canvas/dsaFixtures";
import { canvasSentences } from "../canvas/plan";
import { canvasPlanRequest } from "../canvas/lessonRequest";
import { CANVAS_PLAN_PROMPT, CANVAS_SPEC_PROMPT } from "../canvas/prompts";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import { validateCanvasSpec } from "../canvas/validate";
import { layoutPanel } from "../canvas/layout";
import type { DsOp, DsStart } from "../canvas/types";

/* DSA boards: the structure itself beside the code, changing as it runs (owner's direction, 2026-10-15). */

// The owner's screenshot: delete 2 from the BST 3, 2, 5, 1, 4, 6.
const bst = (): DsStart => parseStructure({
  kind: "tree", variant: "bst",
  nodes: [{ id: "n3", value: 3 }, { id: "n2", value: 2 }, { id: "n5", value: 5 }, { id: "n1", value: 1 }, { id: "n4", value: 4 }, { id: "n6", value: 6 }],
  edges: [{ from: "n3", to: "n2", side: "left" }, { from: "n3", to: "n5", side: "right" }, { from: "n2", to: "n1" }, { from: "n5", to: "n4" }, { from: "n5", to: "n6" }],
  pointers: [{ name: "root", to: "n3" }],
})!;
const child = (f: DsFrame, parent: string, side: "left" | "right") => f.edges.find((e) => e.from === parent && e.side === side)?.to;
const steps = (...ops: DsOp[][]) => ops.map((o, i) => ({ s: i + 1, ops: o }));

test("the starting tree is read, sides found by value in a BST", () => {
  const start = bst();
  const { frames, problem } = runStructure(start, []);
  assert.equal(problem, null);
  assert.equal(child(frames[0], "n2", "left"), "n1");
  assert.equal(child(frames[0], "n5", "left"), "n4");
  assert.equal(child(frames[0], "n5", "right"), "n6");
});

test("BST delete, all three cases, frame by frame", () => {
  // One child: 2's child 1 takes its place under 3.
  const one = runStructure(bst(), steps(
    [{ op: "point", name: "curr", to: "n3" }, { op: "mark", id: "n3", as: "compare" }],
    [{ op: "point", name: "curr", to: "n2" }, { op: "mark", id: "n2", as: "remove" }],
    [{ op: "link", from: "n3", to: "n1", side: "left" }, { op: "remove", id: "n2" }],
  ));
  assert.equal(one.problem, null);
  const last = one.frames.at(-1)!;
  assert.equal(child(last, "n3", "left"), "n1");
  assert.ok(!last.nodes.some((n) => n.id === "n2"));
  assert.ok(!last.pointers.some((p) => p.name === "curr"), "a pointer at a removed node goes with it");
  assert.equal(one.frames[2].marks.n3, undefined, "a comparison lasts one step");
  assert.equal(one.frames[2].marks.n2, "remove");
  // No children: a leaf simply goes.
  assert.equal(runStructure(bst(), steps([{ op: "remove", id: "n6" }])).problem, null);
  // Two children: 5 takes its successor's value (6), then the successor is removed.
  const two = runStructure(bst(), steps([{ op: "set", id: "n5", value: "6" }], [{ op: "remove", id: "n6" }]));
  assert.equal(two.problem, null, "the moment the value is copied up is still in order");
  assert.deepEqual(two.frames[1].changed, ["n5"]);
  assert.equal(two.frames.at(-1)!.nodes.find((n) => n.id === "n5")?.value, "6");
});

test("insert finds its side by value; a wrong insert is caught and named", () => {
  const ok = runStructure(bst(), steps([{ op: "add", id: "n7", value: "7", parent: "n6" }]));
  assert.equal(ok.problem, null);
  assert.equal(child(ok.frames.at(-1)!, "n6", "right"), "n7");
  const wrong = runStructure(bst(), steps([{ op: "add", id: "n0", value: "0", parent: "n1", side: "right" }]));
  assert.match(wrong.problem ?? "", /step 1 \(sentence 1\): the binary search tree is out of order/);
  assert.match(runStructure(bst(), steps([{ op: "remove", id: "n9" }])).problem ?? "", /"n9" is not on the board/);
  assert.match(runStructure(bst(), steps([{ op: "link", from: "n1", to: "n3", side: "left" }])).problem ?? "", /cycle/);
});

test("an AVL rotation: the child takes its parent's place, and the tree ends balanced", () => {
  const start = parseStructure({ kind: "tree", variant: "avl", nodes: [{ id: "a", value: 30 }, { id: "b", value: 20 }, { id: "c", value: 10 }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] })!;
  const rotated = runStructure(start, steps([{ op: "link", from: "b", to: "a", side: "right" }]));
  assert.equal(rotated.problem, null);
  const f = rotated.frames.at(-1)!;
  assert.equal(child(f, "b", "left"), "c");
  assert.equal(child(f, "b", "right"), "a");
  assert.ok(!f.edges.some((e) => e.to === "b"), "20 is the root now");
  assert.match(runStructure(start, steps([{ op: "mark", id: "a", as: "compare" }])).problem ?? "", /AVL tree is unbalanced at 30/, "an AVL tree left unbalanced at the end is wrong");
});

test("a heap swaps values (sift up); a linked list reverses its links; arrays, stacks and queues reorder", () => {
  const heap = parseStructure({ kind: "tree", variant: "heap", nodes: [{ id: "h1", value: 2 }, { id: "h2", value: 5 }, { id: "h3", value: 1 }], edges: [{ from: "h1", to: "h2" }, { from: "h1", to: "h3" }] })!;
  assert.match(runStructure(heap, steps([{ op: "mark", id: "h3", as: "compare" }])).problem ?? "", /heap is out of order/);
  assert.equal(runStructure(heap, steps([{ op: "swap", a: "h1", b: "h3" }])).problem, null);

  const list = parseStructure({ kind: "list", nodes: ["1", "2", "3"], edges: [{ from: "1", to: "2" }, { from: "2", to: "3" }], pointers: [{ name: "head", to: "1" }] })!;
  const reversed = runStructure(list, steps(
    [{ op: "point", name: "curr", to: "1" }],
    [{ op: "unlink", from: "1", to: "2" }],
    [{ op: "link", from: "2", to: "1" }],
    [{ op: "link", from: "3", to: "2" }, { op: "point", name: "head", to: "3" }],
  ));
  assert.equal(reversed.problem, null);
  assert.deepEqual(reversed.frames.at(-1)!.edges.map((e) => `${e.from}>${e.to}`).sort(), ["2>1", "3>2"]);
  assert.deepEqual(reversed.frames.at(-1)!.nodes.map((n) => n.id), ["1", "2", "3"], "the boxes stay put; only the arrows turn round");

  const array = parseStructure({ kind: "array", nodes: [{ id: "a0", value: 5 }, { id: "a1", value: 2 }] })!;
  assert.deepEqual(runStructure(array, steps([{ op: "swap", a: "a0", b: "a1" }])).frames.at(-1)!.nodes.map((n) => n.value), ["2", "5"]);
  const stack = parseStructure({ kind: "stack", nodes: [{ id: "s1", value: 4 }] })!;
  const pushed = runStructure(stack, steps([{ op: "add", id: "s2", value: "9" }], [{ op: "remove", id: "s2" }]));
  assert.deepEqual(pushed.frames.map((f) => f.nodes.length), [1, 2, 1]);
  assert.match(runStructure(array, steps([{ op: "link", from: "a0", to: "a1" }])).problem ?? "", /no links/);
});

test("operations are read in either shape the model writes them", () => {
  assert.deepEqual(parseOps([{ op: "link", from: "N3", to: "n1", side: "left" }, { remove: "n2" }, { mark: { id: "n4", as: "visit" } }, { op: "bogus" }]), [
    { op: "link", from: "n3", to: "n1", side: "left" },
    { op: "remove", id: "n2" },
    { op: "mark", id: "n4", as: "visit" },
  ]);
  assert.equal(parseStructure({ kind: "heapish", nodes: [1] }), null);
  assert.equal(parseStructure({ kind: "array", nodes: Array.from({ length: 13 }, (_, i) => i) }), null, "too many to draw");
});

test("every layout keeps nodes inside the area and apart, and never rescales between steps", () => {
  const area = { x: 500, y: 108, w: 440, h: 424 };
  const cases: Array<[DsStart, DsOp[][]]> = [
    [bst(), [[{ op: "add", id: "n7", value: "7", parent: "n6" }], [{ op: "add", id: "n8", value: "8", parent: "n7" }]]],
    [parseStructure({ kind: "list", nodes: ["1", "2", "3", "4", "5", "6"], edges: [{ from: "1", to: "2" }] })!, []],
    [parseStructure({ kind: "array", nodes: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, value: i * 3 })) })!, []],
    [parseStructure({ kind: "stack", nodes: ["1", "2", "3", "4", "5", "6", "7"] })!, []],
    [parseStructure({ kind: "graph", nodes: ["a", "b", "c", "d", "e", "f"], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "e" }, { from: "e", to: "f" }] })!, []],
  ];
  for (const [start, ops] of cases) {
    const { frames, problem } = runStructure(start, steps(...ops));
    assert.equal(problem, null, start.kind);
    const layout = layoutStructure(start, frames, area);
    for (const lf of layout.frames) {
      const pts = Object.values(lf.place);
      for (const p of pts) {
        assert.ok(p.x - layout.w / 2 >= area.x - 1 && p.x + layout.w / 2 <= area.x + area.w + 1, `${start.kind}: x inside`);
        assert.ok(p.y - layout.h / 2 >= area.y - 1 && p.y + layout.h / 2 <= area.y + area.h + 1, `${start.kind}: y inside`);
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const apart = layout.shape === "circle" ? Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= layout.r * 2 : Math.abs(pts[i].x - pts[j].x) >= layout.w - 0.5 || Math.abs(pts[i].y - pts[j].y) >= layout.h - 0.5;
        assert.ok(apart, `${start.kind}: nodes ${i} and ${j} overlap`);
      }
    }
  }
  // A list link to the next box runs between their facing sides; one that skips a box arches over.
  const dims = { shape: "box" as const, r: 20, w: 60, h: 40 };
  assert.equal(edgeCurve(dims, { x: 100, y: 200 }, { x: 190, y: 200 }).c.y, 200);
  assert.ok(edgeCurve(dims, { x: 100, y: 200 }, { x: 370, y: 200 }).c.y < 170);
});

test("a code board with a structure: validated, split code | structure, nodes are pen targets", () => {
  const spec = validateCanvasSpec({
    heading: "Delete a node with one child",
    notes: [{ text: "child replaces node", s: 1 }],
    stage: {
      kind: "code", language: "pseudocode",
      lines: ["function delete(root, key)", "  if key < root.value", "    root.left ← delete(root.left, key)", "  else if root has one child", "    return that child"],
      structure: bst(),
      steps: [
        { s: 0, lines: [1], ops: [{ op: "point", name: "curr", to: "n3" }] },
        { s: 1, lines: [2, 3], ops: [{ op: "mark", id: "n3", as: "compare" }, { op: "point", name: "curr", to: "n2" }] },
        { s: 2, lines: [4, 5], ops: [{ op: "mark", id: "n2", as: "remove" }] },
        { s: 3, lines: [3], ops: [{ op: "link", from: "n3", to: "n1", side: "left" }, { op: "remove", id: "n2" }] },
      ],
    },
    cues: [{ s: 2, action: "circle", target: "ds-n2" }, { s: 1, action: "point", target: "line-2" }],
  }, 4);
  assert.ok(spec && spec.stage.kind === "code" && spec.stage.structure);
  assert.equal(spec.stage.steps[3].ops?.length, 2);
  assert.ok(spec.cues.some((c) => c.target === "ds-n2"), "a node is a target the pen can circle");
  const layout = layoutPanel(spec);
  const code = layout.marks.find((m) => m.type === "code");
  const structure = layout.marks.find((m) => m.type === "structure");
  assert.ok(code && structure && code.type === "code" && structure.type === "structure");
  assert.ok(code.rect.x + code.rect.w <= structure.rect.x, "code on the left, the tree on the right");
  assert.ok(!layout.marks.some((m) => m.type === "note"), "the split board gives the notes column to the tree");
  assert.ok(layout.targets["ds-n2"] && layout.targets["line-5"]);
  for (let i = 1; i <= 5; i++) assert.ok(layout.targets[`line-${i}`].x + layout.targets[`line-${i}`].w <= code.rect.x + code.rect.w + 1);
  assert.equal(structure.frames.length, 5, "the start, then one frame per step");
  assert.match(describeStructure(spec.stage.structure!, spec.stage.steps), /binary search tree.*3 \(left 2, right 5\).*after the steps: 3 \(left 1, right 5\)/);
});

test("a structure board alone: its notes become captions under the structure", () => {
  const spec = validateCanvasSpec({
    heading: "In-order traversal",
    notes: [],
    stage: { kind: "structure", structure: bst(), steps: [{ s: 0, note: "start at the root" }, { s: 1, ops: [{ op: "mark", id: "n1", as: "visit" }], note: "leftmost first: 1" }] },
    cues: [],
  }, 3);
  assert.ok(spec && spec.stage.kind === "structure");
  const layout = layoutPanel(spec);
  const mark = layout.marks.find((m) => m.type === "structure");
  assert.ok(mark && mark.type === "structure" && mark.captions.length === 2);
  assert.equal(validateCanvasSpec({ heading: "x", stage: { kind: "structure", structure: { kind: "nope" } } }, 2), null);
});

test("which topics are data structures: trees, lists, sorting, BFS — not a graph of a function", () => {
  for (const t of ["Delete a node in a BST", "AVL tree rotations", "reverse a linked list", "stack push and pop", "BFS on a graph", "merge sort", "binary search", "heap sort", "inorder traversal"]) assert.ok(isDataStructureTopic(t), t);
  for (const t of ["graphs of quadratic functions", "photosynthesis", "while loops in Python", "volcano eruptions"]) assert.ok(!isDataStructureTopic(t), t);
});

test("a board whose structure goes wrong is sent back with the reason, and kept as plain code at worst", () => {
  const raw = DSA_FIXTURES[0].raw;
  const spec = validateCanvasSpec(raw, 5)!;
  assert.equal(boardStructureProblem(spec, true), null);
  const broken = validateCanvasSpec({ ...raw, stage: { ...(raw.stage as object), steps: [{ s: 1, lines: [3], ops: [{ op: "add", id: "n0", value: "0", parent: "n1", side: "right" }] }] } }, 5)!;
  assert.match(boardStructureProblem(broken, true) ?? "", /goes wrong at step 1 .*out of order/);
  const plain = withoutStructure(broken)!;
  assert.ok(plain.stage.kind === "code" && !plain.stage.structure && plain.stage.steps.every((st) => !st.ops));
  const codeOnly = validateCanvasSpec({ heading: "Insert", stage: { kind: "code", lines: ["insert(root, key)"], steps: [{ s: 0, lines: [1] }] } }, 1)!;
  assert.match(boardStructureProblem(codeOnly, true) ?? "", /"structure" .* is REQUIRED/);
  assert.equal(boardStructureProblem(codeOnly, false), null, "an ordinary code board needs none");
});

test("every hand-written DSA board validates and runs (the canvas lab's ?fixture=dsa)", () => {
  for (const f of DSA_FIXTURES) {
    const spec = validateCanvasSpec(f.raw, canvasSentences(f.script).length);
    assert.ok(spec, f.id);
    assert.equal(boardStructureProblem(spec, true), null, f.id);
    assert.ok(layoutPanel(spec).marks.some((m) => m.type === "structure"), f.id);
  }
});

test("the planner of a DSA lesson is told to draw the structure, in pseudocode", () => {
  const input = (topic: string) => ({ topic, mood: "", sourceType: "prompt", mode: "standard", learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" } }) as unknown as ProgressiveLectureInput;
  assert.match(canvasPlanRequest(input("Delete a node in a BST")), /DATA STRUCTURES \/ ALGORITHMS LESSON: .*pseudocode.*"structure" board/);
  assert.doesNotMatch(canvasPlanRequest(input("Photosynthesis")), /DATA STRUCTURES/);
  assert.match(CANVAS_PLAN_PROMPT, /"structure"/);
  assert.match(CANVAS_SPEC_PROMPT, /THE DATA STRUCTURE/);
});

test("a tree link named backwards still unlinks; a code board whose structure never changes is sent back", () => {
  const f = runStructure(bst(), steps([{ op: "unlink", from: "n2", to: "n3" }]));
  assert.equal(f.problem, null);
  assert.ok(!f.frames.at(-1)!.edges.some((e) => e.from === "n3" && e.to === "n2"));
  assert.equal(runStructure(bst(), steps([{ op: "unlink", from: "n1", to: "n6" }])).problem, null, "unlinking nothing changes nothing");
  const raw = DSA_FIXTURES[0].raw;
  const still = validateCanvasSpec({ ...raw, stage: { ...(raw.stage as object), steps: [{ s: 0, lines: [1] }, { s: 1, lines: [3] }, { s: 2, lines: [7] }] } }, 5)!;
  assert.match(boardStructureProblem(still, true) ?? "", /never changes/);
});

test("a list's link leaves from its next box and reaches the next node; a reversed one arches over the row", () => {
  // The bug (2026-10-16): the start was pushed past the box twice, so 500 → 1000 was a bare arrowhead.
  const list = parseStructure({ kind: "list", nodes: [{ id: "a", value: 100 }, { id: "b", value: 500 }, { id: "c", value: 1000 }], edges: [{ from: "b", to: "c" }, { from: "b", to: "a" }].slice(0, 1) })!;
  const { frames } = runStructure(list, []);
  const layout = layoutStructure(list, frames, { x: 500, y: 108, w: 440, h: 424 });
  const [a, b, c] = ["a", "b", "c"].map((id) => layout.frames[0].place[id]);
  const forward = edgeCurve(layout, b, c);
  assert.ok(forward.p0.x > b.x && forward.p0.x < b.x + layout.w / 2, "starts inside 500's next box");
  assert.ok(forward.p1.x < c.x - layout.w / 2, "ends at 1000's left side");
  assert.ok(forward.p1.x - forward.p0.x >= (c.x - b.x) - layout.w, "a real line across the gap, not a stub");
  const back = edgeCurve(layout, b, a);
  assert.ok(back.c.y < b.y - layout.h / 2, "a reversed link arches over the row (the pointer tags are below)");
  assert.ok(layout.size * 0.62 * 4 <= layout.w * 0.62 - 8 + 0.5, "\"1000\" fits the value part of its box");
});
