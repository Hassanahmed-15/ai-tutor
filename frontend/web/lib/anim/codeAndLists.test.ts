import test from "node:test";
import assert from "node:assert/strict";
import { codeScrollTop, layoutPanel, CODE_WINDOW } from "../canvas/layout";
import { chainOrder, runStructure } from "../canvas/structure";
import { claimedLinksProblem } from "../canvas/csLessons";
import { validateCanvasSpec } from "../canvas/validate";
import type { DsStart } from "../canvas/types";

// The linked-list lecture of 2026-10-25 ("Insert Element in Linked List").

test("a long listing scrolls: it stays still until the lit line nears the bottom, then follows it", () => {
  assert.equal(CODE_WINDOW, 10);
  assert.equal(codeScrollTop([4], 15, 10), 0, "line 4 of 15: no need to scroll yet");
  assert.equal(codeScrollTop([11], 15, 10), 3, "line 11: lines 4–13 in view, two below it");
  assert.equal(codeScrollTop([15], 15, 10), 5, "never past the end");
  assert.equal(codeScrollTop([2], 15, 10), 0);
  assert.equal(codeScrollTop([12], 8, 10), 0, "a short listing never scrolls");
});

test("a 15-line code board shows 10 lines at a readable size instead of shrinking all 15", () => {
  const lines = Array.from({ length: 15 }, (_, i) => `x${i} = ${i}`);
  const spec = validateCanvasSpec({ heading: "Long code", notes: [], cues: [], stage: { kind: "code", language: "python", lines, steps: lines.map((_, i) => ({ s: Math.min(i, 5), lines: [i + 1] })) } }, 6)!;
  const code = layoutPanel(spec).marks.find((m) => m.type === "code");
  assert.ok(code && code.type === "code");
  assert.equal(code.window, 10);
  assert.ok(code.size >= 16, `size ${code.size}`);
});

test("a linked list is drawn in link order from its head, so a node inserted at the front is drawn first", () => {
  const nodes = ["H", "A", "B", "M", "N"].map((v) => ({ id: v.toLowerCase(), value: v }));
  const edges = [{ from: "h", to: "a" }, { from: "a", to: "b" }, { from: "m", to: "h" }, { from: "n", to: "m" }];
  assert.deepEqual(chainOrder({ nodes, edges, pointers: [{ name: "head", to: "n" }] }).map((n) => n.value), ["N", "M", "H", "A", "B"]);
  // A node made but not linked yet keeps its place after the chain.
  assert.deepEqual(chainOrder({ nodes, edges: edges.slice(0, 2), pointers: [] }).map((n) => n.value), ["H", "A", "B", "M", "N"]);
});

test("adding a node that is already on the board is a no-op, not a reason to drop the whole list", () => {
  const start: DsStart = { kind: "list", nodes: [{ id: "a", value: "A" }, { id: "t", value: "T" }], edges: [{ from: "a", to: "t" }] } as DsStart;
  const { frames, problem } = runStructure(start, [{ s: 0, ops: [{ op: "add", id: "t", value: "T" }] }]);
  assert.equal(problem, null);
  assert.ok(frames.length > 0);
});

test("Aria's chain 'H → A → B → X' is three links, not two", () => {
  const start: DsStart = { kind: "list", nodes: ["H", "A", "B", "X"].map((v) => ({ id: v, value: v })), edges: [{ from: "H", to: "A" }, { from: "A", to: "B" }, { from: "B", to: "X" }] } as DsStart;
  assert.equal(claimedLinksProblem(start, ["We now use H → A → B → X to insert P."]), null);
});

// The BST deletion lecture (2026-10-25): five code boards shipped with no tree while Aria recited its links.
import { parseOps, takeDroppedOps } from "../canvas/structure";
import { isTypedDsaTopic } from "../canvas/csLessons";

test("a DSA lesson is recognised from all its boards, though the topic and a board's own title name no structure", () => {
  const titles = ["Deleting a Node", "Deleting a Leaf Node", "Deleting a Node With One Child", "In-Order Successor Identification", "Maintaining BST Properties"];
  assert.equal(isTypedDsaTopic("Deleting a Node In-Order Successor Identification"), false, "one board alone names no structure");
  assert.equal(isTypedDsaTopic(titles.join(" ")), true, "the lesson does");
});

test("step operations written another way are understood, and the ones that cannot be are reported", () => {
  takeDroppedOps();
  const ops = parseOps([
    { op: "move", name: "curr", to: "n14" },
    { op: "highlight", id: "n10" },
    { op: "mark", id: "n14", as: "successor" },
    { op: "replace", id: "n10", value: "14" },
    { op: "teleport", id: "n3" },
  ]);
  assert.deepEqual(ops.map((o) => o.op), ["point", "mark", "mark", "set"]);
  assert.deepEqual(ops.filter((o) => o.op === "mark").map((o) => (o as { as: string }).as), ["visit", "found"]);
  const dropped = takeDroppedOps();
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /teleport/);
});

// The max-heap lecture (2026-10-25): build and extract boards left the heap out of order and shipped as words.
import { heapRepairHint } from "../canvas/structure";

const heapTree = (values: number[]): DsStart => ({
  kind: "tree", variant: "heap",
  nodes: values.map((v, i) => ({ id: `p${i}`, value: String(v) })),
  edges: values.flatMap((_, i) => [2 * i + 1, 2 * i + 2].filter((c) => c < values.length).map((c, k) => ({ from: `p${i}`, to: `p${c}`, side: k === 0 ? "left" : "right" }))),
} as DsStart);

test("the heap repair computes the exact build: [4, 10, 3, 5, 1] needs two sift-down swaps to become [10, 5, 3, 4, 1]", () => {
  const hint = heapRepairHint(heapTree([4, 10, 3, 5, 1]), "build the max-heap")!;
  assert.match(hint, /BUILD OF THE MAX-HEAP/);
  const swaps = [...hint.matchAll(/"a": "(p\d)", "b": "(p\d)"/g)].map((m) => `${m[1]}-${m[2]}`);
  assert.deepEqual(swaps, ["p0-p1", "p1-p3"]);
  assert.match(hint, /\[10, 5, 3, 4, 1\]/);
});

test("on a heap already built, the repair gives heap sort's extractions, ending sorted", () => {
  const hint = heapRepairHint(heapTree([10, 5, 3, 4, 1]), "heap sort extracts the maximum")!;
  assert.match(hint, /CORRECT HEAP SORT/);
  assert.match(hint, /sorted: 1, 3, 4, 5, 10\]|\[1 \| sorted: 3, 4, 5, 10\]/);
  assert.equal(heapRepairHint(heapTree([10, 5, 3]), "x")?.includes("HEAP SORT"), true);
  assert.equal(heapRepairHint({ kind: "list", nodes: [], edges: [] } as unknown as DsStart, "x"), null);
});

// The list reversal lecture (2026-10-25): A.next = None was said but A's link to B stayed — a loop on the board.
test("a singly linked list that ends in a loop is refused, with the unlink it needs", () => {
  const start: DsStart = { kind: "list", nodes: ["A", "B", "C"].map((v) => ({ id: v.toLowerCase(), value: v })), edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] } as DsStart;
  const flipped = runStructure(start, [{ s: 0, ops: [{ op: "link", from: "c", to: "b" }] }, { s: 1, ops: [{ op: "link", from: "b", to: "a" }] }]);
  assert.match(flipped.problem ?? "", /ends in a loop/);
  const right = runStructure(start, [{ s: 0, ops: [{ op: "unlink", from: "a", to: "b" }] }, { s: 1, ops: [{ op: "link", from: "c", to: "b" }] }, { s: 2, ops: [{ op: "link", from: "b", to: "a" }] }]);
  assert.equal(right.problem, null);
});

// The max-heap re-run (2026-10-25): a board laying [4, 10, 3, 5, 1] out as a tree ("not yet a max-heap") was
// refused for heap order, and the cut-node repair then deleted 3, 5 and 1.
import { removeCutNodes } from "../canvas/csLessons";

test("an unsorted array laid out as a tree is not held to heap order, and the cut-node repair leaves its nodes", () => {
  const start = { kind: "tree", variant: "heap", nodes: [4, 10, 3, 5, 1].map((v, i) => ({ id: `p${i}`, value: String(v) })), edges: [] } as unknown as DsStart;
  const steps = [
    { s: 0, ops: [{ op: "link", from: "p0", to: "p1", side: "left" }] },
    { s: 1, ops: [{ op: "link", from: "p0", to: "p2", side: "right" }] },
    { s: 2, ops: [{ op: "link", from: "p1", to: "p3", side: "left" }] },
    { s: 3, ops: [{ op: "link", from: "p1", to: "p4", side: "right" }] },
  ] as Array<{ s: number; ops: never[] }>;
  const run = runStructure(start, steps);
  assert.equal(run.problem, null);
  assert.equal(run.frames.at(-1)!.nodes.length, 5);
  assert.equal(removeCutNodes(start, steps), null, "nothing removed");
  // A heapify that leaves the heap out of order is still refused.
  const bad = runStructure(heapTree([4, 10, 3, 5, 1]), [{ s: 0, ops: [{ op: "swap", a: "p0", b: "p1" }] }]);
  assert.match(bad.problem ?? "", /heap is out of order/);
});
