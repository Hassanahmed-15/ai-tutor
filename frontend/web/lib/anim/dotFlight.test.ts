import test from "node:test";
import assert from "node:assert/strict";
import { arcPoint, beam, covers, distanceTo, GAP, gazeAt, parkingSpot, union } from "../avatar/dotFlight";

const BOARD = { x: 0, y: 0, w: 1200, h: 700 };

test("parks beside the target with a clear gap, right of it first", () => {
  const line = { x: 100, y: 300, w: 400, h: 24 };
  const spot = parkingSpot(line, 96, BOARD, [], { x: 1100, y: 600 })!;
  assert.ok(spot, "a spot");
  assert.ok(spot.x - 48 >= line.x + line.w + GAP - 0.01, "right of the line, past the gap");
  assert.ok(!covers(spot, 96, line), "never on the target");
});

test("avoids covering other writing and stays on the board", () => {
  const line = { x: 900, y: 300, w: 270, h: 24 };   // no room to the right
  const ink = [{ x: 100, y: 330, w: 1000, h: 60 }];  // a paragraph just below
  const spot = parkingSpot(line, 96, BOARD, ink, { x: 1100, y: 600 })!;
  assert.ok(spot);
  assert.ok(spot.x + 48 <= BOARD.w && spot.y - 48 >= 0, "inside the board");
  assert.ok(!covers(spot, 96, line));
  assert.ok(spot.x < line.x || spot.y < line.y, `left of or above the line (${spot.x},${spot.y})`);
});

test("prefers open board over standing on a card", () => {
  const label = { x: 1000, y: 300, w: 150, h: 30 };          // right of it: off the board
  const code = { x: 500, y: 250, w: 480, h: 180 };           // a code listing to its left
  const spot = parkingSpot(label, 96, BOARD, [], { x: 1100, y: 600 }, [code])!;
  const box = { x: spot.x - 48, y: spot.y - 48, w: 96, h: 96 };
  const overlap = Math.max(0, Math.min(box.x + 96, code.x + code.w) - Math.max(box.x, code.x)) * Math.max(0, Math.min(box.y + 96, code.y + code.h) - Math.max(box.y, code.y));
  assert.equal(overlap, 0, `off the listing (${spot.x},${spot.y})`);
});

test("no spot when the target fills the board: she points from her corner", () => {
  assert.equal(parkingSpot({ x: 10, y: 10, w: 1180, h: 680 }, 96, BOARD, [], { x: 0, y: 0 }), null);
});

test("the arc starts and ends where it should and lifts in between", () => {
  const a = { x: 0, y: 500 }, b = { x: 400, y: 500 };
  assert.deepEqual(arcPoint(a, b, 0), a);
  assert.deepEqual(arcPoint(a, b, 1), b);
  assert.ok(arcPoint(a, b, 0.5).y < 500, "lifted");
});

test("the beam runs from her rim to just short of the target; eyes look at it", () => {
  const t = { x: 100, y: 100, w: 200, h: 30 };
  const c = { x: 400, y: 115 };
  const bm = beam(c, 40, t)!;
  assert.ok(bm.from.x < 400 - 40 && bm.to.x >= 300, `${bm.from.x} -> ${bm.to.x}`);
  assert.ok(distanceTo(bm.to, t) <= 10, "stops just short");
  const g = gazeAt(c, t);
  assert.ok(g.x < -0.9, "looks left");
});

test("a part sticking out of its figure: the spot beside both never covers the part (no step-aside loop)", () => {
  const figure = { x: 100, y: 200, w: 300, h: 300 };
  const label = { x: 360, y: 320, w: 80, h: 24 }; // a margin label past the figure's right edge
  const beside = parkingSpot(figure, 102, BOARD, [], { x: 1100, y: 600 })!;
  assert.ok(covers(beside, 102, label), "beside the figure alone covers the label (the old loop)");
  const spot = parkingSpot(union(figure, label), 102, BOARD, [], { x: 1100, y: 600 })!;
  assert.ok(spot && !covers(spot, 102, label), "beside figure + label: clear of the label");
});
