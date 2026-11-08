// Weighted-graph algorithms on a circle layout: graph (adjacency list / matrix as facts), dijkstra
// (distance table updates), mst (Prim or Kruskal) and topological_sort (Kahn's algorithm).
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract.ts";
import type { Board } from "../../board3d/board.ts";
import { circleLayout } from "../../board3d/helpers.ts";

const Id = z.string().min(1).max(12);
const WEdge = z.tuple([Id, Id, z.number().min(0).max(999)]);
type E = [string, string, number];
const nodesOf = (edges: E[] | [string, string][]) => [...new Set(edges.flatMap((e) => [e[0], e[1]]))].sort();

function drawGraph(b: Board, edges: E[] | [string, string][], directed: boolean, weighted: boolean) {
  b.clear();
  const nodes = nodesOf(edges);
  if (nodes.length > 12) throw new VisualError("Twelve nodes is the most this board shows.");
  const R = Math.max(2.2, nodes.length * 0.45), pos = circleLayout(nodes, R);
  edges.forEach((e, k) => {
    const a = pos.get(e[0])!, c = pos.get(e[1])!;
    if (directed) b.arrow(`e${k}`, { from: a, to: c, color: "muted", width: 0.02 }); else b.line(`e${k}`, { points: [a, c], color: "muted" });
    if (weighted) b.label(`w${k}`, { at: [(a[0] + c[0]) / 2, 0, (a[2] + c[2]) / 2 + 0.2], text: String((e as E)[2]), color: "accent", small: true });
  });
  for (const n of nodes) b.node(`n${n}`, { at: pos.get(n)!, label: n, color: "idle" });
  b.label("info", { at: [0, 0, -R - 0.9], text: "", color: "active" });
  b.fit([[-R - 1, 0, -R - 1.3], [R + 1, 0, R + 0.8]], "front");
  return nodes;
}

// ── graph ───────────────────────────────────────────────────────────────────────────────────────
const GArgs = z.object({ edges: z.array(z.union([WEdge, z.tuple([Id, Id])])).min(1).max(24), directed: z.boolean().default(false) });
export const graphTemplate = defineTemplate({
  id: "graph", domain: "cs", family: "graphs", title: "Graph: adjacency list and matrix",
  topics: ["graph", "adjacency list", "adjacency matrix", "weighted graph", "directed graph", "vertices and edges"], schema: GArgs,
  defaults: { edges: [["A", "B", 4], ["A", "C", 2], ["B", "C", 1], ["B", "D", 5], ["C", "D", 8]], directed: false },
  narrationHints: ["An adjacency list stores each node's neighbours.", "An adjacency matrix has a row and a column per node."],
  run(b, a): Result {
    const weighted = a.edges.every((e) => e.length === 3), nodes = drawGraph(b, a.edges as E[], a.directed, weighted);
    const adj = Object.fromEntries(nodes.map((n) => [n, [] as string[]]));
    const M = nodes.map(() => nodes.map(() => 0));
    for (const e of a.edges) {
      adj[e[0]].push(e[1]); if (!a.directed) adj[e[1]].push(e[0]);
      const w = weighted ? (e as E)[2] : 1, i = nodes.indexOf(e[0]), j = nodes.indexOf(e[1]);
      M[i][j] = w; if (!a.directed) M[j][i] = w;
    }
    return { facts: { nodes, edges: a.edges.length, directed: a.directed, adjacency_list: Object.fromEntries(Object.entries(adj).map(([k, v]) => [k, v.sort().join(", ")])), adjacency_matrix: M, degrees: Object.fromEntries(nodes.map((n) => [n, adj[n].length])) }, steps: [], summary: `A ${a.directed ? "directed" : "undirected"} graph with ${nodes.length} nodes and ${a.edges.length} edges.` };
  },
  actions: {},
});

// ── dijkstra ────────────────────────────────────────────────────────────────────────────────────
const DArgs = z.object({ edges: z.array(WEdge).min(1).max(24), start: Id, directed: z.boolean().default(false) });
export function dijkstra(edges: E[], start: string, directed: boolean) {
  const nodes = nodesOf(edges);
  if (!nodes.includes(start)) throw new VisualError(`There is no node "${start}".`);
  const dist = Object.fromEntries(nodes.map((n) => [n, Infinity])), prev: Record<string, string | null> = {}, done = new Set<string>(), log: { visit: string; updates: [string, number][]; dist: Record<string, number> }[] = [];
  dist[start] = 0;
  while (done.size < nodes.length) {
    const u = nodes.filter((n) => !done.has(n)).sort((p, q) => dist[p] - dist[q] || p.localeCompare(q))[0];
    if (dist[u] === Infinity) break;
    done.add(u);
    const updates: [string, number][] = [];
    for (const [a, c, w] of edges) for (const [x, y] of directed ? [[a, c]] : [[a, c], [c, a]]) if (x === u && !done.has(y) && dist[u] + w < dist[y]) (dist[y] = dist[u] + w), (prev[y] = u), updates.push([y, dist[y]]);
    log.push({ visit: u, updates, dist: { ...dist } });
  }
  return { dist, prev, log };
}
export const dijkstraTemplate = defineTemplate({
  id: "dijkstra", domain: "cs", family: "graphs", title: "Dijkstra's shortest paths",
  topics: ["dijkstra", "shortest path", "shortest paths", "distance table"], schema: DArgs,
  defaults: { edges: [["A", "B", 4], ["A", "C", 2], ["B", "C", 1], ["B", "D", 5], ["C", "D", 8], ["C", "E", 10], ["D", "E", 2]], start: "A", directed: false },
  narrationHints: ["Always settle the closest unvisited node next.", "A distance only ever goes down when a shorter route is found."],
  run(b, a) {
    drawGraph(b, a.edges as E[], a.directed, true);
    const r = dijkstra(a.edges as E[], a.start, a.directed);
    const show = (d: Record<string, number>) => Object.entries(d).map(([k, v]) => `${k}:${v === Infinity ? "∞" : v}`).join("  ");
    const steps: Step[] = r.log.map((s) => ({ caption: `Settle ${s.visit} (distance ${s.dist[s.visit]})${s.updates.length ? `; update ${s.updates.map(([n, d]) => `${n} → ${d}`).join(", ")}` : ""}`, apply: async (bb, o) => {
      await bb.setColor(`n${s.visit}`, "done", o);
      bb.setLabel(`n${s.visit}`, `${s.visit} (${s.dist[s.visit]})`);
      for (const [n] of s.updates) await bb.setColor(`n${n}`, "active", { animate: false });
      bb.setLabel("info", show(s.dist));
    } }));
    return { facts: { start: a.start, distances: Object.fromEntries(Object.entries(r.dist).map(([k, v]) => [k, v === Infinity ? "unreachable" : v])), order_settled: r.log.map((s) => s.visit), previous: r.prev }, steps, summary: `Shortest distances from ${a.start}: ${show(r.dist)}.` };
  },
  actions: {},
});

// ── mst ─────────────────────────────────────────────────────────────────────────────────────────
const MArgs = z.object({ edges: z.array(WEdge).min(1).max(24), algorithm: z.enum(["kruskal", "prim"]).default("kruskal"), start: Id.optional() });
export function mst(edges: E[], algorithm: "kruskal" | "prim", start?: string) {
  const nodes = nodesOf(edges), chosen: number[] = [], skipped: number[] = [];
  if (algorithm === "kruskal") {
    const parent = Object.fromEntries(nodes.map((n) => [n, n]));
    const find = (x: string): string => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (const k of edges.map((_, i) => i).sort((i, j) => edges[i][2] - edges[j][2] || i - j)) {
      const [a, c] = edges[k], ra = find(a), rc = find(c);
      if (ra === rc) skipped.push(k); else (parent[ra] = rc), chosen.push(k);
    }
  } else {
    const inTree = new Set([start ?? nodes[0]]);
    while (inTree.size < nodes.length) {
      const k = edges.map((_, i) => i).filter((i) => inTree.has(edges[i][0]) !== inTree.has(edges[i][1])).sort((i, j) => edges[i][2] - edges[j][2] || i - j)[0];
      if (k === undefined) break;
      chosen.push(k);
      inTree.add(edges[k][0]).add(edges[k][1]);
    }
  }
  return { chosen, skipped, total: chosen.reduce((s, k) => s + edges[k][2], 0), spanning: chosen.length === nodes.length - 1 };
}
export const mstTemplate = defineTemplate({
  id: "mst", domain: "cs", family: "graphs", title: "Minimum spanning tree (Kruskal / Prim)",
  topics: ["minimum spanning tree", "spanning tree", "kruskal", "prim"], schema: MArgs,
  defaults: { edges: [["A", "B", 4], ["A", "C", 2], ["B", "C", 1], ["B", "D", 5], ["C", "D", 8], ["C", "E", 10], ["D", "E", 2]], algorithm: "kruskal" },
  narrationHints: ["Kruskal takes the cheapest edge that does not make a loop.", "Prim grows one tree from a start node."],
  run(b, a) {
    drawGraph(b, a.edges as E[], false, true);
    const r = mst(a.edges as E[], a.algorithm, a.start);
    const steps: Step[] = r.chosen.map((k) => ({ caption: `Take ${a.edges[k][0]}–${a.edges[k][1]} (weight ${a.edges[k][2]})`, apply: async (bb, o) => { await bb.setColor(`e${k}`, "done", o); await Promise.all([bb.setColor(`n${a.edges[k][0]}`, "done", o), bb.setColor(`n${a.edges[k][1]}`, "done", o)]); } }));
    if (a.algorithm === "kruskal") for (const k of r.skipped.slice(0, 3)) steps.push({ caption: `Skip ${a.edges[k][0]}–${a.edges[k][1]}: it would make a loop`, apply: async (bb, o) => { await bb.setColor(`e${k}`, "warn", o); } });
    return { facts: { algorithm: a.algorithm, edges_chosen: r.chosen.map((k) => `${a.edges[k][0]}-${a.edges[k][1]}`), total_weight: r.total, connected: r.spanning }, steps, summary: `${a.algorithm === "kruskal" ? "Kruskal" : "Prim"} picks ${r.chosen.length} edges with total weight ${r.total}.` };
  },
  actions: {},
});

// ── topological_sort ────────────────────────────────────────────────────────────────────────────
const TArgs = z.object({ edges: z.array(z.tuple([Id, Id])).min(1).max(24).describe("[before, after] pairs.") });
export function kahn(edges: [string, string][]) {
  const nodes = nodesOf(edges), indeg = Object.fromEntries(nodes.map((n) => [n, 0]));
  for (const [, v] of edges) indeg[v]++;
  const ready = nodes.filter((n) => !indeg[n]), order: string[] = [];
  while (ready.length) {
    ready.sort();
    const u = ready.shift()!;
    order.push(u);
    for (const [a, v] of edges) if (a === u && --indeg[v] === 0) ready.push(v);
  }
  return { order, cycle: order.length < nodes.length };
}
export const topoTemplate = defineTemplate({
  id: "topological_sort", domain: "cs", family: "graphs", title: "Topological sort",
  topics: ["topological sort", "topological order", "dependencies", "prerequisites", "dag"], schema: TArgs,
  defaults: { edges: [["Maths", "Physics"], ["Maths", "CS"], ["CS", "AI"], ["Physics", "AI"], ["CS", "OS"]] },
  narrationHints: ["Always take something with no remaining prerequisites.", "A cycle means no order exists."],
  run(b, a) {
    drawGraph(b, a.edges, true, false);
    const r = kahn(a.edges);
    const steps: Step[] = r.order.map((n, k) => ({ caption: `${k + 1}. ${n}: nothing left before it`, apply: async (bb, o) => { await bb.setColor(`n${n}`, "done", o); bb.setLabel(`n${n}`, `${n} (${k + 1})`); bb.setLabel("info", `order: ${r.order.slice(0, k + 1).join(" → ")}`); } }));
    if (r.cycle) steps.push({ caption: "Some nodes never become free: there is a cycle, so no order exists", apply: () => {} });
    return { facts: { order: r.order, has_cycle: r.cycle }, steps, summary: r.cycle ? "There is a cycle, so no topological order exists." : `A valid order: ${r.order.join(" → ")}.` };
  },
  actions: {},
});
