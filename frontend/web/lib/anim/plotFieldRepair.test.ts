import test from "node:test";
import assert from "node:assert/strict";
import { plotFieldIssue, repairPlotFields, validatePlotSpec } from "../plotSpec";

// The shape of the empty "Why overfitting happens" board: legend and axes, no lines.
const rows = [
  { "Model Complexity": 2, "Accuracy (%)": "70%", "Dataset Type": "Training" },
  { "Model Complexity": 2, "Accuracy (%)": "68%", "Dataset Type": "Test" },
  { "Model Complexity": 6, "Accuracy (%)": "90%", "Dataset Type": "Training" },
  { "Model Complexity": 6, "Accuracy (%)": "80%", "Dataset Type": "Test" },
  { "Model Complexity": 10, "Accuracy (%)": "99%", "Dataset Type": "Training" },
  { "Model Complexity": 10, "Accuracy (%)": "62%", "Dataset Type": "Test" },
];

test("a mis-cased field and percent strings are repaired, so the lines draw", () => {
  const spec = {
    mark: "line",
    data: { values: rows },
    encoding: {
      x: { field: "Model Complexity", type: "quantitative" },
      y: { field: "accuracy", type: "quantitative", title: "Accuracy (%)" },
      color: { field: "Dataset Type", type: "nominal" },
    },
  };
  const valid = validatePlotSpec(spec)!;
  assert.ok(valid);
  assert.equal(plotFieldIssue(valid), null);
  const y = (valid.encoding as Record<string, { field: string }>).y;
  assert.equal(y.field, "Accuracy (%)");
  const first = (valid.data as { values: Array<Record<string, unknown>> }).values[0];
  assert.equal(first["Accuracy (%)"], 70);
});

test("a field that matches nothing is named, so the retry can fix it instead of shipping an empty chart", () => {
  const spec = repairPlotFields({
    mark: "line",
    data: { values: rows },
    encoding: { x: { field: "Model Complexity", type: "quantitative" }, y: { field: "score", type: "quantitative" } },
  });
  assert.match(plotFieldIssue(spec) ?? "", /score/);
});

test("fields created by a transform are not mistaken for typos", () => {
  const spec = {
    mark: "line",
    data: { values: [{ c: 1, train: 70, test: 68 }, { c: 2, train: 90, test: 80 }] },
    transform: [{ fold: ["train", "test"], as: ["set", "accuracy"] }],
    encoding: { x: { field: "c", type: "quantitative" }, y: { field: "accuracy", type: "quantitative" }, color: { field: "set", type: "nominal" } },
  };
  assert.equal(plotFieldIssue(spec), null);
});

test("fractions on a 0-100 percent axis are scaled, so the lines are not hidden under the axis", () => {
  const spec = validatePlotSpec({
    mark: "line",
    data: { values: [{ c: 2, acc: 0.7, set: "Training" }, { c: 2, acc: 0.68, set: "Test" }, { c: 10, acc: 0.99, set: "Training" }, { c: 10, acc: 0.62, set: "Test" }] },
    encoding: {
      x: { field: "c", type: "quantitative", title: "Model Complexity" },
      y: { field: "acc", type: "quantitative", title: "Accuracy (%)", scale: { domain: [0, 100] } },
      color: { field: "set", type: "nominal", title: "Dataset Type" },
    },
  })!;
  const values = (spec.data as { values: Array<{ acc: number }> }).values;
  assert.deepEqual(values.map((v) => v.acc), [70, 68, 99, 62]);
  assert.equal(plotFieldIssue(spec), null);
});

test("data squeezed flat against a fixed domain it cannot fill is named as an issue", () => {
  const spec = {
    mark: "line",
    data: { values: [{ c: 1, v: 0.2 }, { c: 2, v: 0.4 }] },
    encoding: { x: { field: "c", type: "quantitative" }, y: { field: "v", type: "quantitative", scale: { domain: [0, 500] } } },
  };
  assert.match(plotFieldIssue(spec) ?? "", /flat on the axis/);
});
