// binary_search_array (low / mid / high on a sorted array) and graph_traversal (BFS with a queue,
// DFS with a stack; neighbours in alphabetical order so the order is predictable).
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract.ts";
import type { Board } from "../../board3d/board.ts";
import { cells, cellX, circleLayout } from "../../board3d/helpers.ts";
import { IntKey } from "../shared.ts";

// ── binary_search_array ─────────────────────────────────────────────────────────────────────────
const BSArgs = z.object({ values: z.array(IntKey).min(1).max(16).describe("Up to 16 numbers (sorted first if they are not)."), target: IntKey });
export function binarySearch(values: number[], target: number) {
  const trace: { low: number; mid: number; high: number; cmp: "found" | "go_right" | "go_left" }[] = [];
  let low = 0, high = values.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cmp = values[mid] === target ? "found" : values[mid] < target ? "go_right" : "go_left";
    trace.push({ low, mid, high, cmp });
    if (cmp === "found") break;
    if (cmp === "go_right") low = mid + 1;
    else high = mid - 1;
  }
  const last = trace[trace.length - 1];
  return { trace, found: last?.cmp === "found", index: last?.cmp === "found" ? last.mid : -1 };
}
function bsScene(b: Board, a: z.infer<typeof BSArgs>): Result {
  b.clear();
  const values = [...a.values].sort((x, y) => x - y), n = values.length;
  const r = binarySearch(values, a.target);
  cells(b, "c", values.map(String), { w: 0.95, under: (k) => `[${k}]`, over: () => "" });
  b.fit([[cellX(0, n, 0.95) - 1, 0, -1], [cellX(n - 1, n, 0.95) + 1, 0, 1.4]], "front");
  b.state.bs = { ...a, values };
  const steps: Step[] = r.trace.map((t, k) => ({
    caption: t.cmp === "found" ? `mid = ${t.mid}: ${values[t.mid]} = ${a.target}, found it` : `low ${t.low}, high ${t.high}, mid ${t.mid}: ${values[t.mid]} ${t.cmp === "go_right" ? "<" : ">"} ${a.target}, so search the ${t.cmp === "go_right" ? "right" : "left"} half`,
    apply: async (bb, o) => {
      for (let i = 0; i < n; i++) bb.setLabel(`co${i}`, [i === t.low ? "low" : "", i === t.mid ? "mid" : "", i === t.high ? "high" : ""].filter(Boolean).join("/"));
      for (let i = 0; i < n; i++) if (i < t.low || i > t.high) await bb.setColor(`c${i}`, "muted", { animate: false });
      await bb.setColor(`c${t.mid}`, t.cmp === "found" ? "done" : "active", o);
      if (k === r.trace.length - 1 && !r.found) bb.caption(`low passed high: ${a.target} is not in the array`);
    },
  }));
  if (!r.found) steps.push({ caption: `low passed high: ${a.target} is not in the array`, apply: () => {} });
  return { facts: { values, target: a.target, found: r.found, index: r.index, comparisons: r.trace.length, sorted_first: values.join() !== a.values.join() }, steps, summary: r.found ? `${a.target} found at index ${r.index} after ${r.trace.length} comparisons.` : `${a.target} is not in the array (${r.trace.length} comparisons).` };
}
export const binarySearchTemplate = defineTemplate({
  id: "binary_search_array", domain: "cs", family: "algorithms", title: "Binary search on a sorted array",
  topics: ["binary search", "sorted array", "low mid high", "halving"], schema: BSArgs,
  defaults: { values: [2, 5, 8, 12, 16, 23, 38, 56, 72, 91], target: 23 },
  narrationHints: ["Each comparison throws away half of what is left.", "About log₂ n comparisons."],
  run: (b, a) => bsScene(b, a),
  actions: { search: { description: "Search for another target.", schema: z.object({ target: IntKey }), run: (b, { target }) => bsScene(b, { ...(b.state.bs as z.infer<typeof BSArgs>), target }) } },
});

// ── graph_traversal ─────────────────────────────────────────────────────────────────────────────
const Id = z.string().min(1).max(4);
const GArgs = z.object({ edges: z.array(z.tuple([Id, Id])).min(1).max(24), nodes: z.array(Id).max(12).optional(), directed: z.boolean().default(false), start: Id.optional(), algorithm: z.enum(["bfs", "dfs"]).default("bfs") });
type GA = z.infer<typeof GArgs>;
export function traverse(a: GA) {
  const nodes = [...new Set([...(a.nodes ?? []), ...a.edges.flat()])].sort();
  if (nodes.length > 12) throw new VisualError("Twelve nodes is the most this board shows.");
  const adj = new Map(nodes.map((n) => [n, [] as string[]]));
  for (const [u, v] of a.edges) { adj.get(u)!.push(v); if (!a.directed) adj.get(v)!.push(u); }
  for (const l of adj.values()) l.sort();
  const start = a.start ?? nodes[0];
  if (!adj.has(start)) throw new VisualError(`There is no node "${start}" in the graph.`);
  const seen = new Set([start]), order: string[] = [], tree: [string, string][] = [], frontier = [start], snaps: string[][] = [];
  if (a.algorithm === "bfs") while (frontier.length) {
    const u = frontier.shift()!;
    order.push(u);
    for (const v of adj.get(u)!) if (!seen.has(v)) (seen.add(v), frontier.push(v), tree.push([u, v]));
    snaps.push([...frontier]);
  }
  else {
    const stack: [string, string | null][] = [[start, null]], done = new Set<string>();
    while (stack.length) {
      const [u, p] = stack.pop()!;
      if (done.has(u)) continue;
      done.add(u);
      order.push(u);
      if (p) tree.push([p, u]);
      for (const v of [...adj.get(u)!].reverse()) if (!done.has(v)) stack.push([v, u]);
      snaps.push(stack.map((s) => s[0]).filter((v) => !done.has(v)));
    }
  }
  return { nodes, start, order, tree, snaps };
}
function gScene(b: Board, a: GA): Result {
  b.clear();
  const r = traverse(a), pos = circleLayout(r.nodes, Math.max(2.2, r.nodes.length * 0.42));
  a.edges.forEach(([u, v], k) => (a.directed ? b.arrow(`e${k}`, { from: pos.get(u)!, to: pos.get(v)!, color: "muted", width: 0.02 }) : b.line(`e${k}`, { points: [pos.get(u)!, pos.get(v)!], color: "muted" })));
  for (const n of r.nodes) b.node(`n${n}`, { at: pos.get(n)!, label: n, color: n === r.start ? "accent" : "idle" });
  const R = Math.max(2.2, r.nodes.length * 0.42);
  b.label("frontier", { at: [0, 0, -R - 0.9], text: "", color: "active" });
  b.fit([[-R - 1, 0, -R - 1.2], [R + 1, 0, R + 0.8]], "front");
  b.state.graph = a;
  const word = a.algorithm === "bfs" ? "queue" : "stack";
  const steps: Step[] = r.order.map((u, k) => ({
    caption: `Visit ${u} (${k + 1} of ${r.order.length})`,
    apply: async (bb, o) => {
      const te = r.tree.find(([, v]) => v === u);
      if (te) { const idx = a.edges.findIndex(([x, y]) => (x === te[0] && y === te[1]) || (!a.directed && x === te[1] && y === te[0])); if (idx >= 0) await bb.setColor(`e${idx}`, "done", { animate: false }); }
      await bb.setColor(`n${u}`, "done", o);
      bb.setLabel(`n${u}`, `${u} (${k + 1})`);
      bb.setLabel("frontier", `${word}: [${r.snaps[k].join(", ")}]`);
    },
  }));
  return { facts: { algorithm: a.algorithm, start: r.start, visit_order: r.order, nodes: r.nodes.length, edges: a.edges.length, reached_all: r.order.length === r.nodes.length }, steps, summary: `${a.algorithm.toUpperCase()} from ${r.start} visits ${r.order.join(", ")}.` };
}
export const graphTraversalTemplate = defineTemplate({
  id: "graph_traversal", domain: "cs", family: "algorithms", title: "Graph traversal: BFS and DFS",
  topics: ["bfs", "dfs", "breadth-first search", "depth-first search", "graph traversal", "visit order"], schema: GArgs,
  defaults: { edges: [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["C", "E"], ["D", "F"], ["E", "F"]], start: "A", algorithm: "bfs" },
  narrationHints: ["BFS visits level by level using a queue.", "DFS goes as deep as it can using a stack."],
  run: (b, a) => gScene(b, a),
  actions: { run: { description: "Run BFS or DFS, optionally from another start.", schema: z.object({ algorithm: z.enum(["bfs", "dfs"]), start: Id.optional() }), run: (b, x) => gScene(b, { ...(b.state.graph as GA), algorithm: x.algorithm, start: x.start ?? (b.state.graph as GA).start }) } },
});
