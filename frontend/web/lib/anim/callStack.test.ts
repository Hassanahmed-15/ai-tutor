import test from "node:test";
import assert from "node:assert/strict";
import { stackAt, stackIsConsistent, stackView } from "../canvas/callStack";
import { validateCanvasSpec } from "../canvas/validate";
import { layoutPanel } from "../canvas/layout";

const f = (call: string, value?: string) => ({ call, ...(value ? { value } : {}) });
const factorial = [
  { s: 0, stack: [f("factorial(3)", "n = 3, waits for 3 × ?")] },
  { s: 1, stack: [f("factorial(3)", "n = 3, waits for 3 × ?"), f("factorial(2)", "n = 2, waits for 2 × ?")] },
  { s: 2, stack: [f("factorial(3)", "n = 3, waits for 3 × ?"), f("factorial(2)", "n = 2, waits for 2 × ?"), f("factorial(1)", "returns 1")] },
  { s: 3, stack: [f("factorial(3)", "n = 3, waits for 3 × ?"), f("factorial(2)", "2 × 1 = 2, returns 2")] },
  { s: 4, stack: [f("factorial(3)", "3 × 2 = 6, returns 6")] },
  { s: 5, stack: [] },
];

test("a real call stack passes; a stack that jumps two calls, or swaps a call underneath, does not", () => {
  assert.equal(stackIsConsistent(factorial), true);
  assert.equal(stackIsConsistent([{ s: 0, stack: [f("a(1)")] }, { s: 1, stack: [f("a(1)"), f("a(2)"), f("a(3)")] }]), false);
  assert.equal(stackIsConsistent([{ s: 0, stack: [f("a(2)")] }, { s: 1, stack: [f("a(2)"), f("a(1)")] }, { s: 2, stack: [f("b(9)"), f("a(1)")] }]), false);
  assert.equal(stackIsConsistent([{ s: 0, stack: [f("a(1)")] }]), false, "one snapshot is not a walk-through");
});

test("each call keeps one id; finished calls stay, crossed out, with what they returned", () => {
  const view = stackView(factorial)!;
  assert.deepEqual(view.frames.map((x) => x.call), ["factorial(3)", "factorial(2)", "factorial(1)"]);
  const mid = stackAt(view, 3);
  assert.equal(mid.length, 3);
  assert.deepEqual(mid.map((x) => x.done), [false, false, true]);
  assert.equal(mid[2].value, "returns 1");
  assert.equal(mid.find((x) => x.top)?.call, "factorial(2)");
  const end = stackAt(view, 5);
  assert.ok(end.every((x) => x.done));
  assert.equal(end[0].value, "3 × 2 = 6, returns 6");
});

test("a recursive code board keeps its stack, draws it beside the code, and the Variables panel gives way", () => {
  const spec = validateCanvasSpec({
    heading: "How factorial(3) runs",
    notes: [],
    cues: [{ s: 2, action: "point", target: "frame-3" }],
    stage: {
      kind: "code",
      language: "python",
      lines: ["def factorial(n):", "    if n <= 1:", "        return 1", "    return n * factorial(n - 1)", "", "print(factorial(3))"],
      steps: factorial.map((st, i) => ({ ...st, lines: [i === 2 ? 3 : 4], state: { n: String(3 - Math.min(i, 2)) } })),
    },
  }, 6);
  assert.ok(spec && spec.stage.kind === "code");
  assert.ok(spec.stage.steps.every((st) => st.stack));
  const layout = layoutPanel(spec);
  const stack = layout.marks.find((m) => m.type === "stack");
  assert.ok(stack, "a stack mark");
  assert.ok(!layout.marks.some((m) => m.type === "state"), "no Variables panel beside the stack");
  assert.ok(layout.targets["frame-3"], "each call is a pen target");
  const code = layout.marks.find((m) => m.type === "code")!;
  assert.ok((code as { rect: { x: number; w: number } }).rect.x + (code as { rect: { x: number; w: number } }).rect.w <= (stack as { rect: { x: number } }).rect.x, "code and stack never overlap");
});

test("an impossible stack is dropped and the board stays plain code", () => {
  const spec = validateCanvasSpec({
    heading: "Bad",
    notes: [],
    cues: [],
    stage: { kind: "code", language: "python", lines: ["def f(n):", "    return f(n - 1)"], steps: [{ s: 0, lines: [1], stack: [f("f(3)")] }, { s: 1, lines: [2], stack: [f("g(1)"), f("f(2)"), f("f(1)")] }] },
  }, 3);
  assert.ok(spec && spec.stage.kind === "code");
  assert.ok(spec.stage.steps.every((st) => !st.stack));
  assert.ok(!layoutPanel(spec).marks.some((m) => m.type === "stack"));
});

test("a call-stack board of a recursive function without a stack is sent back; other code boards are not", async () => {
  const { missingStackProblem, recursiveFunctions } = await import("../canvas/callStack");
  const lines = ["function factorial(n)", "  if n == 1:", "    return 1", "  return n × factorial(n - 1)"];
  assert.deepEqual(recursiveFunctions(lines), ["factorial"]);
  assert.match(missingStackProblem({ lines, steps: [{}, {}] }, "Call stack: factorial(4)", "Each call waits.") ?? "", /draw its call stack/);
  assert.equal(missingStackProblem({ lines, steps: [{ stack: [] }] }, "Call stack: factorial(4)", "Each call waits."), null);
  assert.equal(missingStackProblem({ lines: ["total = 0", "for i in range(3):", "    total += i"], steps: [{}] }, "Loops and the call stack", "x"), null);
});

test("a sort drawn against its narration is caught; positional ids are rewritten to the cells' own ids", async () => {
  const { narratedStructureMismatch, repairPositionalIds } = await import("../canvas/structure");
  const start = { kind: "array" as const, nodes: [{ id: "n0", value: "5" }, { id: "n1", value: "1" }, { id: "n2", value: "4" }, { id: "n3", value: "2" }], edges: [], pointers: [] };
  const sentences = ["Bubble sort compares neighbours.", "Swap 5 and 1 to get [1, 5, 4, 2].", "Then swap 5 and 4 to get [1, 4, 5, 2], and 5 and 2 to get [1, 4, 2, 5]."];
  // The writer meant positions: swap cells 0,1 then 1,2 then 2,3.
  const steps = [{ s: 1, ops: [{ op: "swap" as const, a: "n0", b: "n1" }] }, { s: 2, ops: [{ op: "swap" as const, a: "n1", b: "n2" }, { op: "swap" as const, a: "n2", b: "n3" }] }];
  assert.match(narratedStructureMismatch(start, steps, sentences) ?? "", /sentence 2 says the array is \[1, 4, 2, 5\]/);
  assert.equal(repairPositionalIds(start, steps, sentences), true);
  assert.equal(narratedStructureMismatch(start, steps, sentences), null);
  // Ids that are values and a drawing that matches: nothing to say.
  const ok = { kind: "array" as const, nodes: [{ id: "n5", value: "5" }, { id: "n1", value: "1" }], edges: [], pointers: [] };
  assert.equal(narratedStructureMismatch(ok, [{ s: 0, ops: [{ op: "swap" as const, a: "n5", b: "n1" }] }], ["Swap them: now [1, 5], so the list is sorted."]), null);
  const mixed = { kind: "array" as const, nodes: [{ id: "n5", value: "5" }, { id: "n1", value: "1" }, { id: "n4", value: "4" }], edges: [], pointers: [] };
  assert.match(narratedStructureMismatch(mixed, [], ["So the list is sorted."]) ?? "", /says it is sorted/);
});

test("a binary search crosses out the half it rules out instead of deleting it", async () => {
  const { keepSearchedCells } = await import("../canvas/structure");
  const start = { kind: "array" as const, nodes: ["3", "8", "12", "17"].map((v) => ({ id: `n${v}`, value: v })), edges: [], pointers: [{ name: "mid", to: "n8" }] };
  const steps = [{ s: 1, ops: [{ op: "remove" as const, id: "n3" }, { op: "point" as const, name: "mid", to: "n12" }] }];
  assert.equal(keepSearchedCells(start, steps), 1);
  assert.deepEqual(steps[0].ops[0], { op: "mark", id: "n3", as: "remove" });
  // A stack pop is a real removal.
  const stack = { kind: "array" as const, nodes: [{ id: "a", value: "1" }], edges: [], pointers: [{ name: "top", to: "a" }] };
  assert.equal(keepSearchedCells(stack, [{ s: 0, ops: [{ op: "remove" as const, id: "a" }] }]), 0);
});
