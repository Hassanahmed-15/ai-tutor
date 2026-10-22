import test from "node:test";
import assert from "node:assert/strict";
import { remainingCollisions, resolveWritings, type Scene } from "../canvas/textDeconflict";

const bounds = { x: 8, y: 8, w: 984, h: 544 };

test("a free label on top of fixed writing moves off it, a short way", () => {
  const scene: Scene = {
    writings: [
      { id: 1, box: { x: 300, y: 300, w: 200, h: 30 }, movable: false, order: 0 },
      { id: 2, box: { x: 350, y: 310, w: 80, h: 22 }, movable: true, order: 1 },
    ],
    ink: [],
    fills: [],
    bounds,
  };
  const moves = resolveWritings(scene);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 2, "the free label gives way, never the fixed writing");
  assert.ok(Math.hypot(moves[0].dx, moves[0].dy) < 60, "it stays close to where it was");
  assert.deepEqual(remainingCollisions(scene, moves), []);
});

test("two free labels: the later one moves; fixed writing on fixed writing is left alone", () => {
  const scene: Scene = {
    writings: [
      { id: 1, box: { x: 100, y: 100, w: 120, h: 24 }, movable: true, order: 0 },
      { id: 2, box: { x: 130, y: 104, w: 120, h: 24 }, movable: true, order: 1 },
      { id: 3, box: { x: 600, y: 100, w: 120, h: 24 }, movable: false, order: 2 },
      { id: 4, box: { x: 620, y: 104, w: 120, h: 24 }, movable: false, order: 3 },
    ],
    ink: [],
    fills: [],
    bounds,
  };
  const moves = resolveWritings(scene);
  assert.deepEqual(moves.map((m) => m.id), [2]);
  assert.deepEqual(remainingCollisions(scene, moves), [[3, 4]]);
});

test("a crowded cluster of labels ends with no writing on writing", () => {
  const writings = Array.from({ length: 7 }, (_, i) => ({ id: i, box: { x: 400 + i * 9, y: 250 + (i % 3) * 6, w: 90, h: 22 }, movable: i > 0, order: i }));
  const scene: Scene = { writings, ink: [], fills: [], bounds };
  const moves = resolveWritings(scene);
  assert.deepEqual(remainingCollisions(scene, moves), []);
  assert.ok(!moves.some((m) => m.id === 0), "the fixed one stays");
});

test("a label off the board comes back on; a line through a label moves it to a clear spot nearby", () => {
  const line = { owner: null, pts: Array.from({ length: 50 }, (_, k) => ({ x: 200 + k * 4, y: 420 })) };
  const scene: Scene = {
    writings: [
      { id: 1, box: { x: 960, y: 40, w: 90, h: 22 }, movable: true, order: 0 },
      { id: 2, box: { x: 260, y: 408, w: 60, h: 24 }, movable: true, order: 1 },
    ],
    ink: [line],
    fills: [],
    bounds,
  };
  const moves = new Map(resolveWritings(scene).map((m) => [m.id, m]));
  const m1 = moves.get(1)!;
  assert.ok(960 + m1.dx + 90 <= 992, "back inside the board");
  const m2 = moves.get(2)!;
  assert.ok(m2 && Math.abs(m2.dy) <= 34, "off the line, still beside it");
  const y = 408 + m2.dy;
  assert.ok(420 < y + 24 * 0.2 || 420 > y + 24 * 0.8, "the line no longer runs through its middle");
});

test("labels stacked inside one shape: one gives way as a last resort", () => {
  const scene: Scene = {
    writings: [
      { id: 1, box: { x: 300, y: 300, w: 90, h: 24 }, movable: false, lastResort: true, order: 0 },
      { id: 2, box: { x: 300, y: 312, w: 90, h: 24 }, movable: false, lastResort: true, order: 1 },
      { id: 3, box: { x: 600, y: 300, w: 90, h: 24 }, movable: false, order: 2 },
      { id: 4, box: { x: 600, y: 312, w: 90, h: 24 }, movable: false, order: 3 },
    ],
    ink: [],
    fills: [],
    bounds,
  };
  const moves = resolveWritings(scene);
  assert.deepEqual(moves.map((m) => m.id), [2]);
  assert.deepEqual(remainingCollisions(scene, moves), [[3, 4]], "structured writing is never moved");
});

test("labels that merely touch are separated too (a point label on an axis number)", () => {
  const scene: Scene = {
    writings: [
      { id: 1, box: { x: 496, y: 274, w: 7, h: 16 }, movable: true, order: 0 },
      { id: 2, box: { x: 476, y: 286, w: 27, h: 16 }, movable: true, order: 1 },
    ],
    ink: [],
    fills: [],
    bounds,
  };
  assert.deepEqual(remainingCollisions(scene, []), [], "under the checker's tolerance…");
  const moves = resolveWritings(scene);
  assert.equal(moves.length, 1, "…but still moved apart");
  assert.equal(moves[0].id, 2);
});
