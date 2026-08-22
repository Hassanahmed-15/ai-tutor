/**
 * The checkpoint maze — generation, movement, and answering.
 *
 * The reachability test here is the important one, and it is a proof rather than a spot check: a
 * maze that walls off an answer would fail a learner who knew it, and no amount of playing
 * demonstrates the absence of that.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  mazeFor, initialMaze, move, blocked, reachable, seedFrom, dirForKey,
  MAZE_RULES, N, E, S, W, type Dir,
} from "../adhd/games/mazeRules";
import { mcqForCheckpoint, checkpointDueAt, questionSourceFor } from "../adhd/games/mcq";
import { beats, type Beat } from "../lessonContent";

const SEEDS = ["a", "b", "photosynthesis", "krebs", "x9", "beat-1", "beat-2"];

/*
 * A wide sweep of seeds, not a handful.
 *
 * "There is no route to the right answer" was reported from a real lecture, and seven hand-picked
 * seeds cannot answer that. These are the numeric seeds the generator actually consumes, so this
 * covers whatever `seedFrom` produces for any beat id.
 */
const MANY = Array.from({ length: 500 }, (_, i) => i + 1);

/* ── generation ──────────────────────────────────────────────────────────── */

test("EVERY answer is reachable, across 500 mazes", () => {
  // The claim the whole game rests on, and the exact thing that was reported broken. Proven by
  // flood fill over the full seed sweep rather than by playing a few rounds.
  for (const seed of MANY) {
    const maze = mazeFor(seed);
    const seen = reachable(maze);
    for (const [i, a] of maze.answers.entries()) {
      assert.ok(seen.has(`${a.x},${a.y}`), `seed ${seed}: answer ${i} at ${a.x},${a.y} is walled off`);
    }
  }
});

test("the maze is PERFECT — every cell reachable, nothing sealed off, across 500 mazes", () => {
  for (const seed of MANY) {
    const maze = mazeFor(seed);
    assert.equal(reachable(maze).size, maze.size * maze.size, `seed ${seed}: some cells are unreachable`);
  }
});

test("the outer boundary is closed, so the player cannot leave the grid", () => {
  const maze = mazeFor(seedFrom("edges"));
  const last = maze.size - 1;
  for (let i = 0; i < maze.size; i++) {
    assert.ok((maze.walls[0][i] & N) !== 0, `top edge open at x=${i}`);
    assert.ok((maze.walls[last][i] & S) !== 0, `bottom edge open at x=${i}`);
    assert.ok((maze.walls[i][0] & W) !== 0, `left edge open at y=${i}`);
    assert.ok((maze.walls[i][last] & E) !== 0, `right edge open at y=${i}`);
  }
});

test("walls agree from both sides — no one-way passages", () => {
  // A passage open from one side and walled from the other reads as a rendering glitch and can
  // strand a player who walks through it.
  for (const id of SEEDS.slice(0, 4)) {
    const maze = mazeFor(seedFrom(id));
    for (let y = 0; y < maze.size; y++) {
      for (let x = 0; x < maze.size - 1; x++) {
        const rightOpen = (maze.walls[y][x] & E) === 0;
        const leftOpen = (maze.walls[y][x + 1] & W) === 0;
        assert.equal(rightOpen, leftOpen, `${id}: cells ${x},${y} and ${x + 1},${y} disagree`);
      }
    }
  }
});

test("each checkpoint draws a DIFFERENT maze, and the same one replays identically", () => {
  const a = mazeFor(seedFrom("beat-1"));
  const b = mazeFor(seedFrom("beat-2"));
  assert.notDeepEqual(a.walls, b.walls, "two checkpoints produced the same maze");
  assert.deepEqual(a.walls, mazeFor(seedFrom("beat-1")).walls, "the same checkpoint changed between plays");
});

test("the player starts in the centre and each answer sits near its own corner", () => {
  const maze = mazeFor(seedFrom("layout"));
  const mid = (maze.size - 1) / 2;
  assert.deepEqual(maze.start, { x: mid, y: mid });
  assert.equal(maze.answers.length, 3);
  assert.equal(new Set(maze.answers.map((a) => `${a.x},${a.y}`)).size, 3, "two answers share a cell");

  const last = maze.size - 1;
  const corners = [{ x: 0, y: 0 }, { x: last, y: 0 }, { x: last, y: last }];
  maze.answers.forEach((a, i) => {
    const d = Math.abs(a.x - corners[i].x) + Math.abs(a.y - corners[i].y);
    assert.ok(d <= 4, `answer ${i} at ${a.x},${a.y} is ${d} from its corner — not "in the corner"`);
  });
});

test("every answer is a DEAD END across 500 mazes, so no route can pass through one", () => {
  /*
   * Found by testing, and it is the reason answers are not simply the corner cells: in a perfect
   * maze a corner can sit on the through-route to somewhere else, so walking to one answer crossed
   * another and committed the wrong one. A dead end has a single opening and cannot be crossed.
   */
  for (const seed of MANY) {
    const maze = mazeFor(seed);
    for (const [i, a] of maze.answers.entries()) {
      const open = (["up", "down", "left", "right"] as Dir[]).filter((d) => !blocked(maze, a, d));
      assert.equal(open.length, 1, `seed ${seed}: answer ${i} has ${open.length} exits — it can be walked through`);
    }
  }
});

test("the route to any answer never crosses another, across 150 mazes", () => {
  // The property the dead-end rule exists to guarantee, asserted end to end rather than assumed.
  // Fewer seeds than the flood-fill sweeps: this one walks three full paths per maze.
  for (const seed of MANY.slice(0, 150)) {
    const maze = mazeFor(seed);
    for (const [i, target] of maze.answers.entries()) {
      let s = initialMaze(maze);
      for (const dir of pathTo(maze, target)) s = move(maze, s, dir);
      assert.equal(s.chosen, i, `seed ${seed}: walking to answer ${i} committed ${s.chosen} instead`);
    }
  }
});

/* ── movement ────────────────────────────────────────────────────────────── */

test("a wall blocks and an opening passes", () => {
  const maze = mazeFor(seedFrom("move"));
  const s = initialMaze(maze);
  for (const dir of ["up", "down", "left", "right"] as Dir[]) {
    const after = move(maze, s, dir);
    if (blocked(maze, s.at, dir)) {
      assert.deepEqual(after, s, `${dir}: walked through a wall`);
    } else {
      assert.notDeepEqual(after.at, s.at, `${dir}: an open side did not let the player through`);
      assert.equal(after.moves, 1);
    }
  }
});

test("no sequence of moves can leave the grid", () => {
  // Hammer every direction for a long time; the boundary is the only thing stopping it.
  const maze = mazeFor(seedFrom("bounds"));
  let s = initialMaze(maze);
  const dirs: Dir[] = ["up", "left", "down", "right"];
  for (let i = 0; i < 4000; i++) {
    s = move(maze, s, dirs[i % 4]);
    assert.ok(s.at.x >= 0 && s.at.y >= 0 && s.at.x < maze.size && s.at.y < maze.size,
              `escaped the grid at ${s.at.x},${s.at.y}`);
    if (s.chosen !== null) break;
  }
});

test("stepping on an answer commits it and freezes the run", () => {
  const maze = mazeFor(seedFrom("answering"));
  // Walk the real shortest path to answer 0 rather than assuming one exists.
  const path = pathTo(maze, maze.answers[0]);
  assert.ok(path.length > 0, "no route to the answer — the maze is not perfect");

  let s = initialMaze(maze);
  for (const dir of path) s = move(maze, s, dir);
  assert.equal(s.chosen, 0, "arriving at the answer corner did not commit it");

  /*
   * Frozen — tried in the direction that is actually OPEN.
   *
   * The first version pushed "down" from a dead end, which is a no-op whether the run is frozen or
   * not: the assertion passed with the freeze deleted. A test that cannot fail is not a test.
   */
  const wayBack = (["up", "down", "left", "right"] as Dir[]).find((d) => !blocked(maze, s.at, d))!;
  assert.ok(wayBack, "the answer cell has no exit at all");
  assert.deepEqual(move(maze, s, wayBack), s, "the run kept moving after an answer was chosen");
});

test("the trail records where the player has been", () => {
  const maze = mazeFor(seedFrom("trail"));
  let s = initialMaze(maze);
  assert.deepEqual(s.trail, [maze.start]);
  const open = (["up", "down", "left", "right"] as Dir[]).find((d) => !blocked(maze, s.at, d))!;
  s = move(maze, s, open);
  assert.equal(s.trail.length, 2);
  assert.deepEqual(s.trail[1], s.at);
});

test("arrow keys and WASD both steer, and nothing else does", () => {
  assert.equal(dirForKey("ArrowUp"), "up");
  assert.equal(dirForKey("ArrowDown"), "down");
  assert.equal(dirForKey("ArrowLeft"), "left");
  assert.equal(dirForKey("ArrowRight"), "right");
  assert.equal(dirForKey("KeyW"), "up");
  assert.equal(dirForKey("KeyD"), "right");
  assert.equal(dirForKey("Space"), null);
  assert.equal(dirForKey("Enter"), null);
});

test("the grid is odd-sized, so a true centre exists", () => {
  assert.equal(MAZE_RULES.SIZE % 2, 1);
  assert.ok((N | E | S | W) === 15, "wall bits overlap");
});

/* ── the question the maze asks ──────────────────────────────────────────── */

test("a cadence point can ALWAYS build a question from the real lesson", () => {
  /*
   * "A checkpoint every 3 beats" is only true if a question can always be made. The first version
   * needed a beat carrying a `checkpoint` spec inside the lookback, and produced nothing when the
   * model had placed its checkpoints elsewhere — so the cadence silently passed.
   */
  const dueIndices = beats.map((_, i) => i).filter(checkpointDueAt);
  assert.ok(dueIndices.length >= 2, "the fixture is too short to have a cadence");
  for (const i of dueIndices) {
    const source = questionSourceFor(i, beats);
    assert.ok(source, `beat ${i}: no source for a question`);
    assert.ok(mcqForCheckpoint(source, beats, i + 1), `beat ${i}: source produced no question`);
  }
});

test("a lesson with NO checkpoint specs at all still asks", () => {
  const stripped: Beat[] = beats.map((b) => ({ ...b, checkpoint: undefined }));
  const i = stripped.map((_, n) => n).filter(checkpointDueAt)[0];
  const source = questionSourceFor(i, stripped);
  assert.ok(source, "no source when the lesson carries no checkpoint specs");
  const mcq = mcqForCheckpoint(source, stripped, i + 1);
  assert.ok(mcq, "no question when the lesson carries no checkpoint specs");
  assert.equal(mcq.options.length, 3);
  assert.equal(new Set(mcq.options).size, 3);
});

/** Breadth-first shortest path, as a list of directions. Test-only. */
function pathTo(maze: ReturnType<typeof mazeFor>, target: { x: number; y: number }): Dir[] {
  const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
  const prev = new Map<string, { from: string; dir: Dir }>();
  const queue = [maze.start];
  const seen = new Set([key(maze.start)]);

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.x === target.x && cur.y === target.y) break;
    for (const dir of ["up", "down", "left", "right"] as Dir[]) {
      if (blocked(maze, cur, dir)) continue;
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
      const nxt = { x: cur.x + d[0], y: cur.y + d[1] };
      if (seen.has(key(nxt))) continue;
      seen.add(key(nxt));
      prev.set(key(nxt), { from: key(cur), dir });
      queue.push(nxt);
    }
  }

  const out: Dir[] = [];
  let at = key(target);
  while (at !== key(maze.start)) {
    const step = prev.get(at);
    if (!step) return [];
    out.unshift(step.dir);
    at = step.from;
  }
  return out;
}
