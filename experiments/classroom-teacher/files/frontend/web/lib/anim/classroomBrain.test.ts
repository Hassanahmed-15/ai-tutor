import test from "node:test";
import assert from "node:assert/strict";
import { HOLD_AT_BOARD_S, STEP_LEAD_TH, WALK_SPEED_TH, WRITE_OFFSET_TH, angleDelta, classroomStage, initialBrain, stepBrain, writingSpot, type BrainInput, type BrainState } from "../classroom/teacherBrain";

const stage = classroomStage(1440, 900);
const base = { dt: 1 / 60, pen: null, speaking: false, listening: false, presenting: false, stage };

/** Run the brain for `seconds` with the same input. */
function run(s: BrainState, seconds: number, input: Partial<BrainInput>, from = 0): { s: BrainState; t: number; maxSpeed: number } {
  let t = from;
  let maxSpeed = 0;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t += 1 / 60;
    s = stepBrain(s, { ...base, ...input, now: t });
    maxSpeed = Math.max(maxSpeed, Math.abs(s.v));
  }
  return { s, t, maxSpeed };
}

test("the stage puts her lane right of the board, her body inside the screen", () => {
  assert.equal(stage.teacherHeight, 720);
  assert.ok(stage.laneX > 1440 * 0.79 && stage.laneX + 0.15 * 720 < 1440, `lane ${stage.laneX}`);
  assert.ok(stage.centerX < 1440 * 0.5);
  // A questions sheet on the right pushes her lane left.
  assert.ok(classroomStage(1440, 900, 380).laneX < stage.laneX - 100);
});

test("she stands in her lane, half-turned to the board, and talks or listens", () => {
  let { s } = run(initialBrain(stage), 1, { speaking: true });
  assert.equal(s.place, "lane");
  assert.equal(s.x, stage.laneX);
  assert.equal(s.activity, "talk");
  assert.ok(s.yaw < 0 && s.yaw > -30, `half-turned (${s.yaw})`);
  ({ s } = run(s, 7, { speaking: true }, 1));
  assert.equal(s.activity, "point", "points at the board a few seconds into explaining");
  ({ s } = run(s, 1, { listening: true }, 8));
  assert.equal(s.activity, "listen");
  ({ s } = run(s, 1, {}, 9));
  assert.equal(s.activity, "idle");
});

test("when the pen writes she walks to its right, at the walking clip's own speed, and writes left-handed", () => {
  const tip = { x: 400, y: 300 };
  let r = run(initialBrain(stage), 0.6, { pen: tip, speaking: true });
  assert.equal(r.s.activity, "walk");
  assert.ok(r.s.v < 0, "walking left");
  assert.ok(r.s.yaw < -60 && r.s.yaw > -120, `faces where she walks (${r.s.yaw})`);
  r = run(r.s, 4, { pen: tip, speaking: true }, r.t);
  assert.ok(r.maxSpeed <= WALK_SPEED_TH * stage.teacherHeight + 1e-6, "never faster than the clip, so no foot sliding");
  assert.ok(Math.abs(r.s.x - (writingSpot(tip.x, stage) + STEP_LEAD_TH * stage.teacherHeight)) < 1, `stands at the spot, with room for the line (${r.s.x})`);
  assert.ok(r.s.x > tip.x, "to the right of the ink, so she never covers what was written");
  assert.equal(writingSpot(tip.x, stage), tip.x + WRITE_OFFSET_TH * stage.teacherHeight);
  assert.equal(r.s.activity, "write");
  assert.ok(Math.abs(angleDelta(r.s.yaw, -130)) < 1, `faces the board (${r.s.yaw})`);
  assert.equal(r.s.write, 1, "the arm is on the pen");
});

test("she follows a line of writing in steps, not a slide, and goes back once the pen rests", () => {
  const th = stage.teacherHeight;
  const at = (tipX: number) => writingSpot(tipX, stage) + STEP_LEAD_TH * th;
  let r = run(initialBrain(stage), 5, { pen: { x: 400, y: 300 } });
  assert.ok(Math.abs(r.s.x - at(400)) < 1, `arrives with room for the line (${r.s.x})`);
  const arrived = r.s.x;
  // The line runs on toward her: within reach, she stays put.
  r = run(r.s, 0.5, { pen: { x: 460, y: 300 } }, r.t);
  assert.equal(r.s.x, arrived, "a run of writing within reach");
  // It runs up to her: one step on, with room again.
  r = run(r.s, 3, { pen: { x: 560, y: 300 } }, r.t);
  assert.ok(Math.abs(r.s.x - at(560)) < 1, `stepped on (${r.s.x})`);
  // A new line starting back on the left, out of reach: she steps back to it.
  r = run(r.s, 3, { pen: { x: 300, y: 380 } }, r.t);
  assert.ok(Math.abs(r.s.x - at(300)) < 1, `back to the new line (${r.s.x})`);
  // The pen rests: she holds a moment, then returns to her lane facing the student.
  r = run(r.s, HOLD_AT_BOARD_S - 0.3, {}, r.t);
  assert.equal(r.s.place, "board", "she waits at the board for the next label");
  r = run(r.s, 6, { speaking: true }, r.t);
  assert.equal(r.s.place, "lane");
  assert.equal(r.s.x, stage.laneX);
  assert.equal(r.s.write, 0);
  assert.ok(r.s.yaw > -30 && r.s.yaw < 30, `back facing the student (${r.s.yaw})`);
});

test("a new part brings her to the middle, facing the student; the pen takes precedence", () => {
  let r = run(initialBrain(stage), 6, { presenting: true, speaking: true });
  assert.equal(r.s.place, "center");
  assert.equal(r.s.x, stage.centerX);
  assert.equal(r.s.yaw, 0);
  assert.equal(r.s.activity, "talk", "no pointing from the middle: she is introducing");
  r = run(r.s, 3, { presenting: true, pen: { x: 900, y: 200 } }, r.t);
  assert.equal(r.s.place, "board");
});

test("low writing: she crouches, the pen waiting until she is down; she stands for the next high line", () => {
  const low = { x: 300, y: stage.floorY - 0.4 * stage.teacherHeight };
  const high = { x: 300, y: stage.floorY - 0.8 * stage.teacherHeight };
  let r = run(initialBrain(stage), 4, { pen: low });
  assert.equal(r.s.crouch, true);
  assert.equal(r.s.activity, "write");
  assert.equal(r.s.holdPen, false, "down and writing");
  const settled = r.s;
  r = run(settled, 0.3, { pen: high }, r.t);
  assert.equal(r.s.crouch, false, "stands for a high line");
  assert.equal(r.s.holdPen, true, "and the pen waits while she rises");
  r = run(r.s, 1, { pen: high }, r.t);
  assert.equal(r.s.holdPen, false);
  // A line just above the crouch threshold does not make her bob up and down.
  r = run(settled, 1, { pen: { x: 300, y: stage.floorY - 0.56 * stage.teacherHeight } }, 10);
  assert.equal(r.s.crouch, true, "hysteresis: stays down");
});

test("turning takes the short way round", () => {
  assert.equal(angleDelta(90, -150), 120);
  assert.equal(angleDelta(-90, -150), -60);
  assert.equal(angleDelta(170, -170), 20);
});

test("paused or not started, she leaves the pen alone", () => {
  const r = run(initialBrain(stage), 3, { pen: { x: 300, y: 300 }, active: false, presenting: true });
  assert.equal(r.s.place, "center");
  assert.equal(r.s.write, 0);
});

test("the pen waits for her: held while she walks and turns, let go once her marker is on it", () => {
  let r = run(initialBrain(stage), 0.5, { pen: { x: 400, y: 300 } });
  assert.equal(r.s.holdPen, true, "walking over: the writing waits");
  r = run(r.s, 5, { pen: { x: 400, y: 300 } }, r.t);
  assert.equal(r.s.activity, "write");
  assert.equal(r.s.holdPen, false, "marker on the tip: write");
  // Between labels she lowers the marker and turns to the student, and holds nothing.
  r = run(r.s, 1, { speaking: true }, r.t);
  assert.equal(r.s.place, "board");
  assert.equal(r.s.activity, "talk");
  assert.equal(r.s.holdPen, false);
  assert.equal(r.s.write, 0);
  assert.ok(r.s.yaw > -60 && r.s.yaw < -30, `open to the student (${r.s.yaw})`);
});
