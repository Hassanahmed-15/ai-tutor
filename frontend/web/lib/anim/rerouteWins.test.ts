import test from "node:test";
import assert from "node:assert/strict";
import { selectAnimationRenderer } from "../animationRouting";

/**
 * The board director rewrites a beat's visual form when it judges a different one fits better,
 * and it APPENDS the replacement op without deleting the original. Renderer selection therefore
 * has to answer "which decision was most recent", not "which kind do I prefer".
 *
 * Measured symptom before the fix: a lecture logged `[director] beat=7 plot -> plotBoard (was
 * structureScene)` and `[spec-board] beat=7 plotBoard ready`, and the student still saw the ELK
 * diagram. The chart was generated, validated and paid for, then never shown.
 */

test("a beat re-routed from diagram to chart renders the chart", () => {
  const script = {
    ops: [
      { kind: "structureScene", spec: { nodes: [], edges: [] } },
      { kind: "plotBoard", spec: { mark: "line", data: { values: [] } } },
    ],
  };
  assert.equal(selectAnimationRenderer(script).renderer, "plot");
});

test("a beat re-routed from chart to diagram renders the diagram", () => {
  // The rule is "last wins", not "plot always wins" — the reverse direction must work too.
  const script = {
    ops: [
      { kind: "plotBoard", spec: { mark: "line", data: { values: [] } } },
      { kind: "structureScene", spec: { nodes: [], edges: [] } },
    ],
  };
  assert.equal(selectAnimationRenderer(script).renderer, "structure");
});

test("a re-route to an equation board is honoured", () => {
  const script = {
    ops: [
      { kind: "structureScene", spec: { nodes: [], edges: [] } },
      { kind: "equationBoard", spec: { steps: [] } },
    ],
  };
  assert.equal(selectAnimationRenderer(script).renderer, "equation");
});

test("an unfilled replacement does not steal the beat from a filled board", () => {
  // A spec-less op is a placeholder the fill pass never completed. Honouring it would blank the
  // board, which is worse than showing the older but real diagram.
  const script = {
    ops: [
      { kind: "structureScene", spec: { nodes: [], edges: [] } },
      { kind: "plotBoard" },
    ],
  };
  assert.equal(selectAnimationRenderer(script).renderer, "structure");
});

test("a single spec board still selects itself", () => {
  assert.equal(
    selectAnimationRenderer({ ops: [{ kind: "plotBoard", spec: { mark: "bar" } }] }).renderer,
    "plot",
  );
});

test("spec boards still outrank a generated-code board on the same beat", () => {
  // Unchanged behaviour: computed geometry cannot overlap or clip, so it should not lose to a
  // generated component that merely happens to also be present.
  const script = {
    ops: [
      { kind: "reactAnimation", code: "export default function A(){return null}" },
      { kind: "plotBoard", spec: { mark: "line" } },
    ],
  };
  assert.equal(selectAnimationRenderer(script).renderer, "plot");
});
