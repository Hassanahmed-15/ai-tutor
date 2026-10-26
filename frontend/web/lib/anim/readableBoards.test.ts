import test from "node:test";
import assert from "node:assert/strict";
import { layoutPanel, takeLayoutDrops } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { lessonSoFar } from "../canvas/csLessons";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import type { CanvasBoardSpec, CanvasPlanBeat, CanvasStage } from "../canvas/types";

// Owner, 2026-10-25: "I don't wanna see such petty issues again". These faults now send a typed maths or
// CS board back to the writer (lib/canvas/generate.ts) instead of shipping as notes.
const dropsOf = (raw: Record<string, unknown>) => {
  const spec = validateCanvasSpec({ heading: "Board", notes: [], cues: [], ...raw }, 6)!;
  takeLayoutDrops();
  layoutPanel(spec);
  return takeLayoutDrops();
};

test("a drawing that had to be halved to fit is reported (Dijkstra's priority-queue board)", () => {
  const drops = dropsOf({ stage: { kind: "sketch", items: [
    { id: "route-graph", s: 0, at: { x: 0, y: 0, w: 3, h: 1 }, type: "text", text: "Route graph" },
    { id: "distances", s: 0, at: { x: 0, y: 1, w: 4, h: 1 }, type: "text", text: "Distance estimates" },
    { id: "queue", s: 1, at: { x: 0, y: 0, w: 10, h: 7 }, type: "shapes", grid: { w: 12, h: 8 }, shapes: [
      { id: "q", kind: "rect", s: 1, x: 1, y: 1, w: 8, h: 2, label: "Queue Q" },
      { id: "a", kind: "rect", s: 1, x: 1, y: 4, w: 2, h: 1, label: "A: 0" },
    ] },
    { id: "cost", s: 2, at: { x: 9, y: 2, w: 3, h: 3 }, type: "box", text: "Array O(V²) · Heap O((V+E) log V)" },
  ] } });
  assert.ok(drops.some((d) => /shrunk to \d+%|moved away|stacked/.test(d)), drops.join(" | "));
});

test("a clean sketch reports nothing", () => {
  const drops = dropsOf({ stage: { kind: "sketch", items: [
    { id: "graph", s: 0, at: { x: 0, y: 0, w: 12, h: 8 }, type: "shapes", grid: { w: 12, h: 8 }, shapes: [
      { id: "a", kind: "circle", s: 0, x: 3, y: 4, r: 1, label: "A" },
      { id: "b", kind: "circle", s: 0, x: 9, y: 4, r: 1, label: "B" },
      { id: "ab", kind: "arrow", s: 1, points: [[4, 4], [8, 4]], label: "edge" },
    ] },
  ] } });
  assert.deepEqual(drops, []);
});

test("every board after the first is given the lesson's example, program and facts", () => {
  const graph = { kind: "structure", structure: { kind: "graph", nodes: [{ id: "a", value: "A" }, { id: "b", value: "B" }, { id: "c", value: "C" }], edges: [{ from: "a", to: "b", label: "2" }, { from: "b", to: "c", label: "1" }] }, steps: [{ s: 0 }] };
  const code = { kind: "code", language: "python", lines: ["dist = {'A': 0}", "while heap:", "    d, v = heappop(heap)"], steps: [{ s: 0, lines: [1] }] };
  const boards = [
    { v: 1, heading: "Graph", notes: [{ id: "n1", text: "A→B costs 2", s: 0 }], stage: graph, cues: [] },
    { v: 1, heading: "Code", notes: [{ id: "n2", text: "P3 is on disk", s: 0 }], stage: code, cues: [] },
  ] as unknown as CanvasBoardSpec[];
  const lines = lessonSoFar(boards).join("\n");
  assert.match(lines, /A–B \(2\), B–C \(1\)/);
  assert.match(lines, /THE LESSON'S PROGRAM[\s\S]*while heap:/);
  assert.match(lines, /never contradict them[\s\S]*P3 is on disk/);
  assert.deepEqual(lessonSoFar([undefined]), []);
});

function beat(id: string, title: string, stage: CanvasStage, script: string): CanvasPlanBeat {
  return { id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false };
}

test("on a typed CS lesson a sketch of a graph, tree or state machine is drawn as a structure, laid out by code", () => {
  const out = applyLessonVisualPolicy([
    beat("b1", "The map", "flow", "We will meet graphs."),
    beat("b2", "Odd cycles", "sketch", "Colour vertex B and vertex C differently; the edge C–D forces D, and edge B–D clashes."),
    beat("b3", "Complexity", "sketch", "The running time is O(V + E) for the whole search."),
  ], { mode: "prompt", topic: "Bipartite graphs", domain: "cs" });
  assert.equal(out.beats[1].stage, "structure");
  // No free sketches in CS (owner, 2026-10-25): a board that names no structure becomes a flow, laid out by code.
  assert.equal(out.beats[2].stage, "flow", "a board that names no structure becomes a flow, never a sketch");
  const maths = applyLessonVisualPolicy([beat("b1", "Map", "flow", "x"), beat("b2", "Proof", "sketch", "The vertex of the parabola and the edge of the graph.")], { mode: "prompt", topic: "Quadratics", domain: "maths" });
  assert.equal(maths.beats[1].stage, "sketch", "maths lessons are untouched");
});

test("a CS lesson's maths figure of a graph becomes a structure; a graph has no null tags", async () => {
  const out = applyLessonVisualPolicy([beat("b1", "Map", "flow", "x"), { ...beat("b2", "Odd cycle", "figure", "The cycle C–D–E has three edges, so vertex E clashes."), figure: "triangle" }], { mode: "prompt", topic: "Bipartite graphs", domain: "cs" });
  assert.equal(out.beats[1].stage, "structure");
  const { runStructure } = await import("../canvas/structure");
  const { frames } = runStructure({ kind: "graph", nodes: [{ id: "a", value: "A" }], edges: [] }, [{ s: 0, ops: [{ op: "point", name: "set", to: null }] }]);
  assert.deepEqual(frames[frames.length - 1].nulls, []);
});

test("the variables panel is drawn only when a board has one (code boards of DSA lessons keep it; the rest are stripped)", () => {
  const withPanel = validateCanvasSpec({ heading: "Threads", notes: [], cues: [], stage: { kind: "structure", structure: { kind: "graph", nodes: [{ id: "p", value: "P" }, { id: "t", value: "T1" }], edges: [{ from: "p", to: "t" }] }, steps: [{ s: 0, state: { work: "shared memory" } }] } }, 3)!;
  assert.ok(layoutPanel(withPanel).marks.some((m) => m.type === "state"), "a structure with state draws the panel — so it must be stripped before shipping");
  const st = withPanel.stage as { steps: Array<{ state?: unknown }> };
  for (const step of st.steps) delete step.state;
  assert.ok(!layoutPanel(withPanel).marks.some((m) => m.type === "state"), "stripped, no panel is drawn");
});
