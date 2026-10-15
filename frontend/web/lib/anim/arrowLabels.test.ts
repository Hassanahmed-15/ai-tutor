import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { layoutPanel, textObstacles, type Mark } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";

// Sociology audit 2026-10-15, board 1: "values route" printed over "Sociologist's values".
const raw = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures-e1-flow.json"), "utf8"));

test("arrow labels never print over a node, a name or another label", () => {
  const spec = validateCanvasSpec(raw, 6)!;
  const marks = layoutPanel(spec).marks;
  const obstacles = textObstacles(marks);
  const labels = marks.filter((m): m is Extract<Mark, { type: "arrow" }> => m.type === "arrow" && Boolean(m.label));
  for (const a of labels) {
    const w = a.label!.length * 7.6 + 16;
    const box = { x: a.labelAt.x - w / 2, y: a.labelAt.y - 15, w, h: 22 };
    for (const r of obstacles) {
      const hit = box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y;
      assert.ok(!hit, `"${a.label}" overlaps a node or its name`);
    }
  }
});

test("an icon must mean what its label says, or it is dropped", () => {
  const spec = validateCanvasSpec(raw, 6)!;
  assert.equal(spec.stage.kind, "flow");
  if (spec.stage.kind !== "flow") return;
  const funding = spec.stage.nodes.find((n) => n.id === "funding-choice")!;
  assert.equal(funding.icon, undefined, "no battery for funding");
  assert.equal(spec.stage.nodes.find((n) => n.id === "sociologist-values")!.icon, "person");
});
