// Heap: the tree view and the array view kept in sync. Insert (sift-up), extract (sift-down) and
// heapify (build-heap) are real operations; every comparison and swap is a step.
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract.ts";
import type { Board } from "../../board3d/board.ts";
import { cells, cellX, heapPos } from "../../board3d/helpers.ts";
import { IntKey } from "../shared.ts";
import { heapify, isHeap, siftDown, siftUp, type HeapKind, type HOp } from "./heapLogic.ts";

const MAX = 15;
const Args = z.object({ values: z.array(IntKey).max(MAX).describe(`Up to ${MAX} keys; they are heapified first.`), kind: z.enum(["min", "max"]).default("min") });
type A = { arr: number[]; kind: HeapKind };

function draw(b: Board, s: A) {
  b.clear();
  const n = s.arr.length;
  s.arr.forEach((v, i) => {
    b.node(`h${i}`, { at: heapPos(i, n), label: String(v), color: i === 0 ? "accent" : "idle" });
    if (i > 0) b.line(`e${i}`, { points: [heapPos((i - 1) >> 1, n), heapPos(i, n)], color: "muted" });
  });
  cells(b, "a", s.arr.map(String), { z: -2.6, w: 0.9, under: (k) => `[${k}]` });
  b.fit([[-4.5, 0, -3.3], [4.5, 0, 3.6]], "front");
  b.state.heap = s;
}

/** Each comparison lights both copies (tree + array); each swap rewrites both. */
function stepsOf(ops: HOp[]): Step[] {
  return ops.map((op) => ({
    caption: op.t === "compare" ? `Compare ${op.arr[op.i]} with ${op.arr[op.j]}` : `Swap ${op.arr[op.j]} and ${op.arr[op.i]}`,
    apply: async (bb, o) => {
      for (const k of [op.i, op.j]) {
        bb.setLabel(`h${k}`, String(op.arr[k]));
        bb.setLabel(`a${k}`, String(op.arr[k]));
      }
      await Promise.all([op.i, op.j].flatMap((k) => [bb.setColor(`h${k}`, op.t === "swap" ? "done" : "active", o), bb.setColor(`a${k}`, op.t === "swap" ? "done" : "active", o)]));
      if (op.t === "swap" && o.animate) await bb.pulse(`h${op.j}`, o);
    },
  }));
}

/** A last step that clears the highlights: every parent now beats its children. */
const settled = (arr: number[], kind: HeapKind): Step => ({
  caption: `Done: every parent is ${kind === "min" ? "smaller" : "bigger"} than its children; the top is ${arr[0] ?? "empty"}`,
  apply: async (bb) => { for (let k = 0; k < arr.length; k++) await Promise.all([bb.setColor(`h${k}`, k ? "idle" : "accent", { animate: false }), bb.setColor(`a${k}`, k ? "idle" : "accent", { animate: false })]); },
});

const facts = (s: A, extra = {}) => ({ kind: s.kind, size: s.arr.length, array: s.arr, top: s.arr[0] ?? null, valid_heap: isHeap(s.arr, s.kind), ...extra });

export const heapTemplate = defineTemplate({
  id: "heap", domain: "cs", family: "data_structures", title: "Binary heap (tree and array)",
  topics: ["heap", "priority queue", "min heap", "max heap", "sift up", "sift down", "heapify"], schema: Args,
  defaults: { values: [9, 4, 7, 1, 8, 2, 6], kind: "min" },
  narrationHints: ["The children of index i are at 2i + 1 and 2i + 2.", "A min-heap keeps the smallest key at the root."],
  run(b, a) {
    const h = heapify(a.values, a.kind);
    draw(b, { arr: [...a.values], kind: a.kind });
    return { facts: facts({ arr: h.arr, kind: a.kind }, { swaps: h.ops.filter((o) => o.t === "swap").length }), steps: [{ caption: `Heapify: fix each parent from the bottom up (${a.kind}-heap)`, apply: () => {} }, ...stepsOf(h.ops), settled(h.arr, a.kind)], summary: `Build a ${a.kind}-heap from ${a.values.join(", ")}: the top is ${h.arr[0]}.` };
  },
  actions: {
    insert: { description: "Insert a key at the end and sift it up.", schema: z.object({ value: IntKey }), run(b, { value }) {
      const s = b.state.heap as A;
      if (s.arr.length >= MAX) throw new VisualError(`The heap is full (${MAX} keys) for this board.`);
      const arr = [...s.arr, value], ops: HOp[] = [];
      draw(b, { arr: [...arr], kind: s.kind });
      siftUp(arr, arr.length - 1, s.kind, ops);
      b.state.heap = { arr, kind: s.kind };
      return { facts: facts({ arr, kind: s.kind }, { inserted: value, swaps: ops.filter((o) => o.t === "swap").length }), steps: [{ caption: `Put ${value} in the next free spot (index ${arr.length - 1})`, apply: async (bb, o) => { await bb.setColor(`h${arr.length - 1}`, "active", o); } }, ...stepsOf(ops), settled(arr, s.kind)], summary: `Insert ${value}: it rises ${ops.filter((o) => o.t === "swap").length} level(s).` };
    } },
    extract: { description: `Remove the top (smallest for a min-heap) and sift down.`, schema: z.object({}), run(b) {
      const s = b.state.heap as A;
      if (!s.arr.length) throw new VisualError("The heap is empty: nothing to extract.");
      const top = s.arr[0], arr = [...s.arr], last = arr.pop()!, ops: HOp[] = [];
      if (arr.length) arr[0] = last;
      draw(b, { arr: [...arr], kind: s.kind });
      siftDown(arr, 0, s.kind, ops);
      b.state.heap = { arr, kind: s.kind };
      return { facts: facts({ arr, kind: s.kind }, { extracted: top }), steps: [{ caption: `Take ${top} off the top; move the last key ${last} to the root`, apply: async (bb, o) => { if (arr.length) await bb.setColor("h0", "warn", o); } }, ...stepsOf(ops), settled(arr, s.kind)], summary: `Extract ${top}; ${arr[0] ?? "nothing"} is the new top.` };
    } },
  },
});
void cellX;
