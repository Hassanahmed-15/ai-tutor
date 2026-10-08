/**
 * THE TEACHER'S BRAIN: where Aria stands, where she walks, which way she faces and what her body does,
 * frame by frame, from what the lesson is doing. Pure (no three.js, no DOM), so the rules can be
 * tested without a GPU; components/classroom/ClassroomTeacher.tsx renders whatever this decides.
 *
 * The rules, from the classroom research (docs/research/full-body-teacher-2026-10-09.md):
 *  - She lives in her own lane right of the board and explains from there, half-turned toward it,
 *    pointing at it now and then. Nothing she does there covers the board.
 *  - When the pen writes, she walks to it and writes. She is LEFT-HANDED on purpose: standing to the
 *    right of the pen she covers only board that is not written yet. A right-handed writer stands on
 *    the ink they have just put down. "Ink is sacred."
 *  - A new part, or the moment before the lesson starts, is her stage: she comes to the middle and
 *    faces the student, as a teacher introduces a topic.
 *  - She walks at the speed her walking clip was captured at, so her feet do not slide.
 *
 * Units: stage pixels, x to the right, seconds. Yaw in degrees: 0 faces the student, -90 faces the
 * screen's left, ±180 faces the board.
 */

export type Stage = {
  width: number;
  height: number;
  /** Her height on screen, px. */
  teacherHeight: number;
  /** Where she stands when she is not at the board: the middle of her lane. */
  laneX: number;
  /** The middle of the board, where she presents a new part. */
  centerX: number;
  /** The furthest left her body may go. */
  minX: number;
  /** The floor line: where her feet are, px from the top. */
  floorY: number;
};

/** Her feet stand this fraction of the stage height above its bottom edge. */
export const FLOOR_FRACTION = 0.015;
/**
 * A tip lower than this (in teacher heights above the floor) is below her standing reach, and she
 * crouches to write it; she stands again for anything above STAND_ABOVE_TH. Standing, her hand reaches
 * from about 0.54 to 1.08 of her height; crouched (shoulder at 0.44), from about 0.2 to 0.68.
 */
export const CROUCH_BELOW_TH = 0.53;
export const STAND_ABOVE_TH = 0.6;
/** A change of pose settles for this long before the pen goes on. */
export const POSE_SETTLE_S = 0.6;

/** The stage for a viewport: her height, her lane right of the board, and its limits. */
export function classroomStage(width: number, height: number, rightInset = 0, laneFraction = 0.21): Stage {
  const teacherHeight = Math.round(height * 0.8);
  const laneLeft = width * (1 - laneFraction);
  const laneX = Math.min(width - rightInset - teacherHeight * 0.17, laneLeft + (width * laneFraction) / 2);
  return { width, height, teacherHeight, laneX, centerX: laneLeft * 0.52, minX: teacherHeight * 0.14, floorY: height * (1 - FLOOR_FRACTION) };
}

/** The walking clip covers 1.46 m per 1.2 s cycle; she is 1.74 m tall. In teacher heights per second. */
export const WALK_SPEED_TH = 1.4565 / 1.2 / 1.744;
/**
 * Standing to the pen's right by this much (teacher heights), her left hand reaches it with the elbow
 * bent, as a hand writes. (At 0.24 her arm was dead straight: pointing, not writing.)
 */
export const WRITE_OFFSET_TH = 0.19;
/**
 * After the pen rests, she stays at the board this long before going back to her lane. Long enough to
 * span the pause between two labels: a board writes a label in about a second, then the narration
 * talks about it, then the next label goes up nearby. Shorter, and she shuttled to and fro.
 */
export const HOLD_AT_BOARD_S = 4.5;
/** Writing runs toward her (left to right): she lets it come this close before stepping on... */
export const STEP_AHEAD_TH = 0.05;
/** ...and then steps on past the tip by this much, so a line of writing costs one step, not five. */
export const STEP_LEAD_TH = 0.08;
/** A tip this far to her left (beyond her reach) makes her step back to it. */
export const STEP_BACK_TH = 0.12;

export type Activity = "idle" | "talk" | "point" | "listen" | "walk" | "write";
export type Place = "lane" | "board" | "center";

export type BrainInput = {
  dt: number;
  now: number;
  /** The pen's tip in stage px while it writes, else null. */
  pen: { x: number; y: number } | null;
  /** Her voice is playing. */
  speaking: boolean;
  /** The student has the floor. */
  listening: boolean;
  /** A new part is being introduced (section card up, or the lesson not started yet). */
  presenting: boolean;
  /** The lesson is playing. Paused, or not started, she does not chase the pen. */
  active?: boolean;
  stage: Stage;
};

export type BrainState = {
  x: number;
  /** Signed walking speed, px/s. */
  v: number;
  yaw: number;
  place: Place;
  /** Where she is heading; held still while she writes within reach. */
  goal: number;
  lastPenAt: number;
  tip: { x: number; y: number } | null;
  activity: Activity;
  activitySince: number;
  /** 0..1, how much the writing arm is on the pen. */
  write: number;
  /** The pen should wait for her: there is writing to do and her marker is not on it yet. */
  holdPen: boolean;
  /** Writing low, she crouches. */
  crouch: boolean;
  poseSince: number;
};

export function initialBrain(stage: Stage, now = 0): BrainState {
  return { x: stage.laneX, v: 0, yaw: 0, place: "lane", goal: stage.laneX, lastPenAt: -Infinity, tip: null, activity: "idle", activitySince: now, write: 0, holdPen: false, crouch: false, poseSince: now };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The shortest signed turn from `a` to `b`, degrees. */
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Where she should stand to write at the pen's tip. */
export function writingSpot(tipX: number, stage: Stage): number {
  return clamp(tipX + WRITE_OFFSET_TH * stage.teacherHeight, stage.minX, stage.laneX);
}

export function stepBrain(s: BrainState, input: BrainInput): BrainState {
  const { dt, now, stage } = input;
  const pen = input.active === false ? null : input.pen;
  const th = stage.teacherHeight;
  let { x, v, yaw, place, goal, lastPenAt, tip, activity, activitySince, write, crouch, poseSince } = s;

  // Where she belongs.
  if (pen) {
    lastPenAt = now;
    tip = { x: pen.x, y: pen.y };
    place = "board";
  } else if (place === "board" && now - lastPenAt > HOLD_AT_BOARD_S) {
    place = input.presenting ? "center" : "lane";
    tip = null;
  } else if (place !== "board") {
    place = input.presenting ? "center" : "lane";
  }

  // Where she heads. At the board she shuffles along only when the pen has run away from her hand.
  if (place === "board" && tip) {
    // One place to write from: the spot, plus room for the line still to come. She moves there on
    // arriving, when the line has run up to her, or when a new line starts out of reach to her left.
    const spot = writingSpot(tip.x, stage);
    const target = Math.min(stage.laneX, spot + STEP_LEAD_TH * th);
    if (s.place !== "board" || x < spot - STEP_AHEAD_TH * th || x > target + STEP_BACK_TH * th) goal = target;
  } else {
    goal = place === "center" ? stage.centerX : stage.laneX;
  }

  // Walk there: up to the clip's own speed, accelerating and braking so she arrives, not overshoots.
  const vmax = WALK_SPEED_TH * th;
  const accel = 2.2 * th;
  const dist = goal - x;
  if (Math.abs(dist) < 0.01 * th && Math.abs(v) < 0.25 * vmax) {
    x = goal;
    v = 0;
  } else {
    const want = Math.sign(dist) * Math.min(vmax, Math.sqrt(2 * accel * Math.abs(dist)));
    const dv = clamp(want - v, -accel * dt, accel * dt);
    v += dv;
    x += v * dt;
  }
  const moving = Math.abs(v) > 0.08 * vmax;

  // Which way she faces.
  let yawGoal: number;
  if (moving) yawGoal = v < 0 ? -90 : 90;
  else if (place === "board") yawGoal = pen ? -130 : -45; // writing: to the board, her profile showing; between labels: open to the student
  else if (place === "center") yawGoal = 0;
  else yawGoal = input.speaking ? -14 : -6; // half-turned toward the board she is explaining
  const turn = angleDelta(yaw, yawGoal);
  const rate = 320 * dt;
  yaw = Math.abs(turn) <= rate ? yawGoal : yaw + Math.sign(turn) * rate;
  if (yaw > 180) yaw -= 360;
  if (yaw <= -180) yaw += 360;

  // What her body does.
  let next: Activity;
  if (moving) next = "walk";
  else if (place === "board" && pen) next = "write";
  else if (place === "board") next = input.speaking ? "talk" : "idle";
  else if (input.listening) next = "listen";
  else if (input.speaking) {
    // From her lane she points at the board for a few seconds in every twelve.
    const phase = (now - activitySince) % 12;
    next = place === "lane" && activity !== "walk" && phase > 6 && phase < 9.5 ? "point" : "talk";
  } else next = "idle";
  if (next !== activity && !((next === "point" && activity === "talk") || (next === "talk" && activity === "point"))) activitySince = now;
  activity = next;

  // Writing low, she crouches; she stands for anything else, and to walk.
  const tipHeight = tip ? (stage.floorY - tip.y) / th : 1;
  const wantCrouch = activity === "write" && pen !== null && (crouch ? tipHeight < STAND_ABOVE_TH : tipHeight < CROUCH_BELOW_TH);
  if (wantCrouch !== crouch) {
    crouch = wantCrouch;
    poseSince = now;
  }

  // The writing arm comes onto the pen once she has turned to the board and settled into her pose.
  const armOn = activity === "write" && Math.abs(angleDelta(yaw, yawGoal)) < 30 && now - poseSince >= POSE_SETTLE_S;
  write = clamp(write + (armOn ? 4 : -5) * dt, 0, 1);

  // The pen waits while she walks to it or turns to it, and goes on once the marker is on the tip.
  const holdPen = !!pen && !(activity === "write" && write > 0.85);

  return { x, v, yaw, place, goal, lastPenAt, tip, activity, activitySince, write, holdPen, crouch, poseSince };
}
