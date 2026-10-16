import { test } from "node:test";
import assert from "node:assert/strict";
import { graphIssues, snapEquilibrium } from "../canvas/graphCheck";
import { validateCanvasSpec } from "../canvas/validate";
import type { GraphStage } from "../canvas/types";

// AP Macro audit 2026-10-15, board 4, as generated.
const supply: GraphStage = {
  kind: "graph",
  x: { label: "Quantity of loanable funds ($ billions)", min: 0, max: 800 },
  y: { label: "Real interest rate (%)", min: 0, max: 6 },
  curves: [{ id: "supply-curve", expr: "2 + 0.004 * x", label: "Supply of loanable funds", s: 0 }],
  markers: [{ id: "r3", x: "250", curve: "supply-curve", label: "3%", s: 0 }, { id: "q700", x: "700", curve: "supply-curve", label: "$700 billion", s: 4 }],
  guides: [{ id: "g", x: 500, label: "$500 billion at 3%", s: 3 }],
};

test("labels that contradict the curve are caught; true ones pass", () => {
  const issues = graphIssues(supply);
  assert.equal(issues.length, 1, issues.join(" | "));
  assert.match(issues[0], /\$500 billion at 3%.*4/);
  const fixed = { ...supply, curves: [{ ...supply.curves[0], expr: "-2 + 0.01 * x" }], markers: [{ id: "a", x: "500", curve: "supply-curve", label: "3%, $500 billion", s: 0 }, { id: "b", x: "700", curve: "supply-curve", label: "5%, $700 billion", s: 1 }] };
  assert.deepEqual(graphIssues(fixed), []);
});

test("an equilibrium marker is placed where the curves cross", () => {
  const market: GraphStage = { kind: "graph", x: { label: "Q", min: 0, max: 100 }, y: { label: "r", min: 0, max: 100 }, curves: [{ id: "d", expr: "90 - x", s: 0 }, { id: "s", expr: "10 + x", s: 0 }], markers: [{ id: "m", x: "30", curve: "d", label: "Market relationship", s: 1 }] };
  const snapped = snapEquilibrium(market);
  assert.equal(Number(snapped.markers![0].x), 40);
  assert.equal(snapped.markers![0].label, "Equilibrium");
});

test("long labels end at a natural break, never mid-word and never with \"…\"", () => {
  const spec = validateCanvasSpec({ heading: "Supply", notes: [], cues: [], stage: { kind: "graph", x: { label: "Quantity of loanable funds supplied by savers in the economy ($ billions)", min: 0, max: 800 }, y: { label: "Real interest rate (%)", min: 0, max: 6 }, curves: [{ id: "s", expr: "x/200", s: 0 }] } }, 3);
  assert.ok(spec && spec.stage.kind === "graph");
  if (spec?.stage.kind === "graph") { assert.doesNotMatch(spec.stage.x.label, /…$/); assert.ok(spec.stage.x.label.length <= 48); assert.doesNotMatch(spec.stage.x.label, /\b(of|by|in|the)$/); }
});
