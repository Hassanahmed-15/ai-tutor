import { test } from "node:test";
import assert from "node:assert/strict";
import { freeBodyParts, layoutPanel } from "../canvas/layout";
import type { CanvasBoardSpec, SceneStage } from "../canvas/types";

const item = (id: string, label: string, s = 0) => ({ id, kind: "box" as const, label, cell: "A1", s });

test("forces point the way physics says, whatever the cells", () => {
  const car: SceneStage = { kind: "scene", arrows: [], items: [item("body", "Car"), item("weight", "Weight 12 000 N"), item("normal-force", "Normal reaction"), item("driving-force", "Driving force 3 kN"), item("drag", "Air resistance 1 kN")] };
  const parts = freeBodyParts(car)!;
  assert.deepEqual(parts.forces.map((f) => [f.item.id, f.dir]), [["weight", "down"], ["normal-force", "up"], ["driving-force", "right"], ["drag", "left"]]);
  assert.equal(parts.forces[2].newtons, 3000);
});

test("a falling object feels drag upward", () => {
  const sky: SceneStage = { kind: "scene", arrows: [], items: [item("skydiver", "Skydiver"), item("weight", "Weight 700 N"), item("air-resistance", "Air resistance 300 N")] };
  assert.deepEqual(freeBodyParts(sky)!.forces.map((f) => f.dir), ["down", "up"]);
});

test("a bigger force draws a longer arrow; an ordinary scene is untouched", () => {
  const spec = { heading: "Skydiver", notes: [], cues: [], stage: { kind: "scene", arrows: [], items: [item("skydiver", "Skydiver"), item("weight", "Weight 700 N"), item("air-resistance", "Air resistance 300 N", 1)] } } as unknown as CanvasBoardSpec;
  const fbd = layoutPanel(spec).marks.find((m) => m.type === "free-body") as { forces: Array<{ start: { y: number }; end: { y: number } }> } | undefined;
  assert.ok(fbd);
  const [w, d] = fbd!.forces.map((f) => Math.abs(f.end.y - f.start.y));
  assert.ok(w > d * 1.8);
  assert.equal(freeBodyParts({ kind: "scene", arrows: [], items: [item("sun", "Sun"), item("leaf", "Leaf")] }), null);
});
