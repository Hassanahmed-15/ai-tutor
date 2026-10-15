import { test } from "node:test";
import assert from "node:assert/strict";
import { graphPanels, layoutPanel } from "../canvas/layout";
import type { CanvasBoardSpec, GraphStage } from "../canvas/types";

const shm: GraphStage = {
  kind: "graph",
  x: { label: "Time t / s", min: 0, max: 1 },
  y: { label: "Value", min: -6, max: 6 },
  curves: [
    { id: "x", expr: "0.05*sin(2*pi*1.66*x)", label: "x / m", s: 0 },
    { id: "v", expr: "0.52*cos(2*pi*1.66*x)", label: "v / m s⁻¹", s: 1 },
    { id: "a", expr: "-5.5*sin(2*pi*1.66*x)", label: "a / m s⁻²", s: 2 },
  ],
  markers: [{ id: "dot", x: "0.25", curve: "v", s: 1 }],
};

test("curves of very different sizes get one panel each, with their own scale", () => {
  const panels = graphPanels(shm);
  assert.ok(panels);
  assert.equal(panels!.length, 3);
  assert.ok(panels![0].y.max < 0.1 && panels![0].y.min > -0.1, "x panel is scaled to ±0.05");
  assert.equal(panels![0].y.label, "x / m");
  assert.deepEqual(panels![1].markers?.map((m) => m.id), ["dot"]);
});

test("curves of one size stay on one plot", () => {
  assert.equal(graphPanels({ ...shm, curves: shm.curves.slice(0, 1) }), null);
  assert.equal(graphPanels({ ...shm, curves: [shm.curves[0], { ...shm.curves[0], id: "x2", expr: "0.04*cos(2*pi*x)" }] }), null);
});

test("stacked panels lay out top to bottom, x axis on the last only", () => {
  const spec = { heading: "SHM graphs", notes: [], stage: shm, cues: [] } as unknown as CanvasBoardSpec;
  const graphs = layoutPanel(spec).marks.filter((m) => m.type === "graph") as Array<{ plot: { y: number; h: number }; stacked?: { showX: boolean } }>;
  assert.equal(graphs.length, 3);
  assert.ok(graphs[0].plot.y + graphs[0].plot.h < graphs[1].plot.y);
  assert.deepEqual(graphs.map((g) => g.stacked?.showX), [false, false, true]);
});
