// Sorting template: one box per value (height = value), sorted by a real algorithm step by step.
// Compare = both bars light up; swap = they trade places; merge = a run settles into order.
import { z } from "zod/v4";
import { defineTemplate, type Result, type Step } from "../../contract";
import type { Board, Vec3 } from "../../board3d/board";
import { ALGORITHMS, trace, type Op } from "./sortLogic";

const Args = z.object({
  values: z.array(z.number().int().min(1).max(99)).min(2).max(10).describe("2 to 10 whole numbers from 1 to 99."),
  algorithm: z.enum(ALGORITHMS).default("bubble").describe("bubble, insertion, selection, merge, quick or heap."),
});
type A = z.infer<typeof Args>;

const bid = (id: number) => `bar${id}`;
const slot = (k: number, n: number, value: number, top: number): Vec3 => [(k - (n - 1) / 2) * 1.05, 0, (value / top) * 2.5];

function build(b: Board, values: number[]) {
  b.clear();
  const top = Math.max(...values);
  values.forEach((v, id) => {
    const h = Math.max(0.15, (v / top) * 5);
    b.box(bid(id), { at: [(id - (values.length - 1) / 2) * 1.05, 0, h / 2], size: [0.8, 0.8, h], color: "idle", label: String(v) });
  });
  b.state.values = values;
  b.state.top = top;
  b.fit([[-values.length * 0.55, 0, 0], [values.length * 0.55, 0, 5.4]], "front");
}

async function arrange(b: Board, order: number[], animate: boolean) {
  const vals = b.state.values as number[], top = b.state.top as number;
  await Promise.all(order.map((id, k) => {
    const h = Math.max(0.15, (vals[id] / top) * 5);
    const at = slot(k, order.length, vals[id], top);
    return b.move(bid(id), [at[0], 0, h / 2], { animate });
  }));
}

function stepOf(op: Op, vals: number[]): Step {
  const v = (id: number) => vals[id];
  switch (op.t) {
    case "compare":
      return { caption: `Compare ${v(op.a)} and ${v(op.b)}`, apply: async (b, o) => { await Promise.all([b.setColor(bid(op.a), "active", o), b.setColor(bid(op.b), "active", o)]); } };
    case "swap":
      return { caption: `Swap ${v(op.a)} and ${v(op.b)}`, apply: async (b, o) => { await arrange(b, op.order, o.animate); await Promise.all([b.setColor(bid(op.a), "idle", o), b.setColor(bid(op.b), "idle", o)]); } };
    case "place":
      return { caption: `Merge into ${op.ids.map(v).join(", ")}`, apply: async (b, o) => { await arrange(b, op.order, o.animate); for (const id of op.ids) await b.setColor(bid(id), "accent", { animate: false }); } };
    case "pivot":
      return { caption: `Pivot ${v(op.a)}: smaller values go to its left`, apply: async (b, o) => { await b.setColor(bid(op.a), "warn", o); } };
    case "done":
      return { caption: op.ids.length > 1 ? "Sorted" : `${v(op.ids[0])} is in its final place`, apply: async (b, o) => { await Promise.all(op.ids.map((id) => b.setColor(bid(id), "done", o))); } };
  }
}

function plan(b: Board, args: A): Result {
  const t = trace(args.values, args.algorithm);
  const vals = args.values;
  // Bars that were only compared go back to plain before the next step (so one pair is lit at a time).
  const steps: Step[] = t.ops.map((op, k) => {
    const s = stepOf(op, vals);
    const prev = t.ops[k - 1];
    return {
      caption: s.caption,
      apply: async (bb, o) => {
        if (prev?.t === "compare" && op.t !== "swap") for (const id of [prev.a, prev.b]) if (!isDone(t.ops, k, id)) await bb.setColor(bid(id), "idle", { animate: false });
        await s.apply(bb, o);
      },
    };
  });
  b.state.algorithm = args.algorithm;
  return {
    facts: { algorithm: args.algorithm, input: vals, sorted: t.sorted, comparisons: t.comparisons, swaps: t.swaps, ...(args.algorithm === "merge" ? { writes: t.writes } : {}) },
    steps,
    summary: `${args.algorithm} sort on ${vals.join(", ")}: ${t.comparisons} comparisons and ${t.swaps} swaps.`,
  };
}

const isDone = (ops: Op[], before: number, id: number) => ops.slice(0, before).some((o) => o.t === "done" && o.ids.includes(id));

export const sortingTemplate = defineTemplate({
  id: "sorting",
  domain: "cs",
  family: "algorithms",
  title: "Sorting algorithms",
  topics: ["sorting", "sort", "bubble sort", "insertion sort", "selection sort", "merge sort", "quicksort", "quick sort", "heap sort", "heapsort", "comparisons", "swaps"],
  schema: Args,
  defaults: { values: [5, 2, 9, 1, 6, 3], algorithm: "bubble" },
  narrationHints: ["Each comparison looks at two values.", "Bubble sort carries the biggest value to the end each pass.", "Merge sort splits, then merges sorted halves."],
  run(b, args) {
    build(b, args.values);
    return plan(b, args);
  },
  actions: {
    sort_with: {
      description: "Start again on the same values with another algorithm.",
      schema: z.object({ algorithm: z.enum(ALGORITHMS) }),
      run(b, { algorithm }) {
        const values = b.state.values as number[];
        build(b, values);
        return plan(b, { values, algorithm });
      },
    },
    set_values: {
      description: "Start again with new values.",
      schema: z.object({ values: Args.shape.values }),
      run(b, { values }) {
        const algorithm = (b.state.algorithm as A["algorithm"]) ?? "bubble";
        build(b, values);
        return plan(b, { values, algorithm });
      },
    },
  },
});
