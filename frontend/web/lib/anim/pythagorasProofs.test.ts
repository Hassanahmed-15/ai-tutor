import test from "node:test";
import assert from "node:assert/strict";
import { figureComponent, figureFor } from "../figures/registry";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import type { CanvasPlanBeat, CanvasStage } from "../canvas/types";

// The Pythagoras lecture of 2026-10-25: Garfield's trapezoid and the similar-triangles proof were taught over
// a plain right triangle, and the cancelling board lost the four-triangle square it was cancelling.
const GARFIELD = "Garfield compares one trapezoid. We now add Garfield's proof, which replaces the large square with a trapezoid and compares its area in two ways. Calculate the trapezoid's area from its two parallel sides and its height. The trapezoid is partitioned into three right triangles.";
const ALTITUDE = "An altitude creates similar triangles. We now begin the algebraic proof by splitting one right triangle into smaller copies of its shape. Drop an altitude from the right angle to the hypotenuse, creating two smaller right-angled triangles similar to the original.";
const RATIOS = "Ratios from the similar triangles. If x and y are the hypotenuse segments beside a and b, similarity gives the ratio of a to c as the ratio of x to a. Thus a ÷ c = x ÷ a, and a² = cx.";
const FOUR = "Four triangles form a large square. We now use four identical copies of the right triangle to create one large square, so this proof of Pythagoras compares areas.";
const CANCEL = "Cancelling the triangle areas. We continue the same proof by expanding and cancelling equal areas. Expanding (a + b)² gives a² + 2ab + b² = 2ab + c².";

test("each Pythagoras proof's words call for its own figure, and a plain trapezium area does not", () => {
  assert.equal(figureFor(GARFIELD)?.name, "pythagorasGarfield");
  assert.equal(figureFor(ALTITUDE)?.name, "pythagorasSimilar");
  assert.equal(figureFor(RATIOS)?.name, "pythagorasSimilar");
  assert.equal(figureFor(FOUR)?.name, "pythagorasProof");
  assert.notEqual(figureFor("The area of a trapezium is half the sum of its parallel sides times the height.")?.name, "pythagorasGarfield");
  assert.notEqual(figureFor("Similar triangles have equal angles and proportional sides, so the scale factor is 2.")?.name, "pythagorasSimilar");
});

test("Garfield's figure: the middle triangle has a right angle and legs c; the similar figure's altitude meets the hypotenuse", () => {
  const g = figureComponent("pythagorasGarfield")!.build({ a: 3, b: 4 });
  assert.ok(g.w > 0 && g.h > 0 && g.shapes.length > 8);
  assert.deepEqual(g.parts.map((p) => p.id), ["trapezoid", "triangle-1", "triangle-2", "triangle-c", "height"]);
  const s = figureComponent("pythagorasSimilar")!.build({ a: 3, b: 4 });
  assert.deepEqual(s.parts.map((p) => p.id), ["triangle", "altitude", "small-a", "small-b", "segment-x", "segment-y"]);
  // x beside a is a²/c = 1.8 of 5, y beside b is b²/c = 3.2: x's label sits right of y's.
  const x = s.parts.find((p) => p.id === "segment-x")!.anchor, y = s.parts.find((p) => p.id === "segment-y")!.anchor;
  assert.ok(x.x > y.x);
});

const beat = (id: string, stage: CanvasStage, script: string, figure?: string): CanvasPlanBeat => {
  const [title] = script.split(". ");
  return { id, title, brief: "", script, stage, ...(figure ? { figure } : {}), objects: [], carry: [], inside: null, interaction: null, overview: false } as unknown as CanvasPlanBeat;
};

test("the visual policy draws each proof on its figure, and a continuing board keeps the figure before it", () => {
  const beats = [
    beat("b1", "flow", "The route to three proofs. We will travel from one right triangle to three proofs of Pythagoras."),
    beat("b2", "figure", FOUR, "pythagorasProof"),
    beat("b3", "equation", CANCEL, "triangle"),
    beat("b4", "equation", GARFIELD, "triangle"),
    beat("b5", "figure", ALTITUDE, "triangle"),
    beat("b6", "equation", RATIOS, "triangle"),
  ];
  const { beats: out } = applyLessonVisualPolicy(beats, { mode: "prompt", topic: "Proof of Pythagorean Theorem", domain: "maths" });
  assert.equal(out[1].figure, "pythagorasProof");
  assert.equal(out[2].figure, "pythagorasProof", "the cancelling board keeps the four-triangle square");
  assert.equal(out[3].figure, "pythagorasGarfield");
  assert.equal(out[4].figure, "pythagorasSimilar");
  assert.equal(out[5].figure, "pythagorasSimilar");
});

// The owner, 2026-10-25: "yes plz add it" — the squares on the sides, and an altitude on the triangle figure.
const SQUARES = "Squares built on the sides. We now turn each side into a square, because the theorem compares squared lengths. A square on side a has area a², and a square on side b has area b². A square on the hypotenuse has area c².";

test("the squares on the sides get their own figure, with the unit grid for 3-4-5", () => {
  assert.equal(figureFor(SQUARES)?.name, "pythagorasSquares");
  const d = figureComponent("pythagorasSquares")!.build({ a: 3, b: 4 });
  assert.deepEqual(d.parts.map((p) => p.id), ["triangle", "square-a", "square-b", "square-c"]);
  const labels = d.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text);
  assert.ok(labels.includes("a² = 9") && labels.includes("b² = 16") && labels.includes("c² = 25"), labels.join(" | "));
  const plan = applyLessonVisualPolicy([beat("b1", "flow", "The route. Three proofs of Pythagoras."), beat("b2", "sketch", SQUARES)], { mode: "prompt", topic: "Proof of Pythagorean Theorem", domain: "maths" });
  assert.equal(plan.beats[1].stage, "figure");
  assert.equal(plan.beats[1].figure, "pythagorasSquares");
});

test("the triangle figure draws an altitude with its foot, its right angle and the two pieces of the base", () => {
  const plain = figureComponent("triangle")!.build({ a: 3, b: 4, c: 5 });
  assert.ok(!plain.parts.some((p) => p.id === "altitude"));
  const d = figureComponent("triangle")!.build({ a: 3, b: 4, c: 5, altitude: "true", foot: "D", segments: "x,y", altitudeLabel: "h" });
  assert.ok(d.parts.some((p) => p.id === "altitude"));
  const texts = d.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text);
  for (const t of ["D", "x", "y", "h"]) assert.ok(texts.includes(t), `${t} in ${texts.join(",")}`);
  assert.ok(d.shapes.some((s) => s.t === "path" && (s as { dash?: string }).dash === "7 6"), "a dashed altitude");
});
