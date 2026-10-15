import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutPanel } from "../canvas/layout";
import { layoutIssues } from "../canvas/layoutQa";
import type { CanvasBoardSpec } from "../canvas/types";

const scene = (items: unknown[]) => ({ v: 1, heading: "Scene", notes: [], cues: [], stage: { kind: "scene", arrows: [], items } }) as unknown as CanvasBoardSpec;

test("a clean scene passes", () => {
  assert.deepEqual(layoutIssues(layoutPanel(scene([
    { id: "sun", kind: "box", label: "Sun", cell: "A1", s: 0 },
    { id: "leaf", kind: "box", label: "Leaf", cell: "C1", s: 1 },
  ]))), []);
});

test("overlapping cells and overrunning labels are named", () => {
  const issues = layoutIssues(layoutPanel(scene([
    { id: "a", kind: "box", label: "A", cell: "A1", span: "2x2", s: 0 },
    { id: "b", kind: "box", label: "B", cell: "B2", s: 0 },
    { id: "c", kind: "box", label: "Hydrogen ions migrating to the cathode", cell: "E4", s: 0 },
  ])));
  assert.ok(issues.some((i) => /"a" and "b" overlap/.test(i)));
  assert.ok(issues.some((i) => /"c" is too long/.test(i)));
});

test("an arrow through an item it does not join is named (sociology board 3)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { validateCanvasSpec } = await import("../canvas/validate");
  const raw = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures-e3-scene.json"), "utf8"));
  const spec = validateCanvasSpec(raw, 7)!;
  const issues = layoutIssues(layoutPanel(spec), spec);
  assert.ok(issues.some((i) => /runs through "validity"/.test(i)), issues.join(" | "));
});
