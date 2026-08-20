/**
 * Flappy Gates — the question it asks, and the flight that answers it.
 *
 * All of it runs with no canvas, no clock and no browser, which is the point of keeping the rules
 * out of the render loop: "a bump never ends the flight" and "every checkpoint is a different
 * course" are claims about behaviour, and claims you can only check by playing are claims nobody
 * re-checks.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { mcqForCheckpoint, checkpointDueAt, questionSourceFor, CHECKPOINT_EVERY, MCQ_RULES } from "../adhd/games/mcq";
import {
  initialFlappy, applyFlappy, pathsFor, seedFrom, gateAt, FLAPPY_RULES,
  type FlappyState, type TilePath,
} from "../adhd/games/flappyRules";
import { beats, type Beat } from "../lessonContent";

const cpBeat = beats.find((b) => b.checkpoint)!;

/* ── the question ────────────────────────────────────────────────────────── */

test("a real checkpoint yields exactly three distinct options with the answer among them", () => {
  const mcq = mcqForCheckpoint(cpBeat, beats, 7);
  assert.ok(mcq, "the fixture's checkpoint produced no question");
  assert.equal(mcq.options.length, MCQ_RULES.OPTIONS);
  assert.equal(new Set(mcq.options).size, MCQ_RULES.OPTIONS, "a duplicated option is unanswerable");
  assert.ok(mcq.answer >= 0 && mcq.answer < MCQ_RULES.OPTIONS);
  assert.ok(mcq.options[mcq.answer].length > 0);
});

test("AUTHORED options are used and validated, not trusted", () => {
  const authored: Beat = {
    ...cpBeat,
    id: "authored",
    checkpoint: {
      ...cpBeat.checkpoint!,
      options: ["Right one", "Tempting wrong", "Other wrong"],
      correctOption: 0,
    },
  };
  for (let seed = 0; seed < 40; seed++) {
    const mcq = mcqForCheckpoint(authored, beats, seed)!;
    assert.ok(mcq);
    assert.deepEqual([...mcq.options].sort(), ["Other wrong", "Right one", "Tempting wrong"]);
    assert.equal(mcq.options[mcq.answer], "Right one", `seed ${seed} lost the answer in the shuffle`);
  }
});

test("options are SHUFFLED, so the answer is not always where the model put it", () => {
  // Without this the game is "always fly at gate 1", which tests nothing about the content.
  const authored: Beat = {
    ...cpBeat,
    id: "shuffled",
    checkpoint: { ...cpBeat.checkpoint!, options: ["A", "B", "C"], correctOption: 0 },
  };
  const seen = new Set<number>();
  for (let seed = 0; seed < 60; seed++) seen.add(mcqForCheckpoint(authored, beats, seed)!.answer);
  assert.ok(seen.size > 1, `the answer sat at index ${[...seen]} for every seed`);
});

test("a malformed authored set falls back rather than asking an impossible question", () => {
  /*
   * These are generated fields, so every one of these shapes is something a model can emit. A bad
   * index or a duplicate makes the question unanswerable, which is worse than a weaker fallback.
   */
  const bad = (over: Partial<NonNullable<Beat["checkpoint"]>>): Beat => ({
    ...cpBeat, id: "bad", checkpoint: { ...cpBeat.checkpoint!, ...over },
  });
  const cases = [
    { options: ["only", "two"], correctOption: 0 },
    { options: ["a", "a", "b"], correctOption: 0 },
    { options: ["a", "b", "c"], correctOption: 7 },
    { options: ["a", "b", "c"], correctOption: -1 },
    { options: ["a", "b", "c"], correctOption: undefined },
    { options: ["a", "", "c"], correctOption: 0 },
  ];
  for (const over of cases) {
    const mcq = mcqForCheckpoint(bad(over), beats, 3);
    // It must not throw, and must never return the malformed set as-is.
    if (mcq) {
      assert.equal(mcq.options.length, 3, JSON.stringify(over));
      assert.equal(new Set(mcq.options).size, 3, JSON.stringify(over));
      assert.ok(mcq.answer >= 0 && mcq.answer < 3, JSON.stringify(over));
    }
  }
});

test("a beat with no checkpoint asks nothing", () => {
  const plain = beats.find((b) => !b.checkpoint)!;
  assert.equal(mcqForCheckpoint(plain, beats, 1), null);
});

test("the cadence is every third beat and never beat zero", () => {
  assert.equal(CHECKPOINT_EVERY, 3);
  assert.equal(checkpointDueAt(0), false, "the lecture must not open on a question");
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(checkpointDueAt), [false, false, true, false, false, true]);
});

test("the question is about what was just taught, not the start of the lecture", () => {
  const idx = beats.findIndex((b) => b.checkpoint);
  const source = questionSourceFor(idx + 1, beats);
  assert.ok(source, "no source found near a checkpoint beat");
  assert.ok(source.checkpoint, "the chosen source carries no question");
});

/* ── the flight ──────────────────────────────────────────────────────────── */

const fly = (s: FlappyState, seconds: number, paths: TilePath[] = []) => {
  let out = s;
  for (let t = 0; t < seconds * 60; t++) out = applyFlappy(out, { type: "tick", dt: 1 / 60, paths });
  return out;
};

test("nothing moves until the learner starts", () => {
  const idle = fly(initialFlappy(), 2);
  assert.equal(idle.y, 0.5, "the bird fell before the flight began");
  assert.equal(idle.progress, 0);
});

test("gravity pulls down and a flap lifts", () => {
  const started = applyFlappy(initialFlappy(), { type: "start" });
  const fell = fly(started, 0.5);
  assert.ok(fell.y > 0.5, "gravity did not pull the bird down");

  const flapped = applyFlappy(fell, { type: "flap" });
  assert.ok(flapped.vy < 0, "a flap must impart upward velocity");
  assert.ok(fly(flapped, 0.2).y < fell.y, "the flap did not actually lift the bird");
});

test("the bird cannot leave the field in either direction", () => {
  let s = applyFlappy(initialFlappy(), { type: "start" });
  s = fly(s, 6); // fall for a long time
  assert.ok(s.y <= 0.97 && s.y >= 0, `fell out of the field: ${s.y}`);

  let up = applyFlappy(initialFlappy(), { type: "start" });
  for (let i = 0; i < 200; i++) up = fly(applyFlappy(up, { type: "flap" }), 1 / 30);
  assert.ok(up.y >= 0.03, `flew out of the top: ${up.y}`);
});

test("tiles are GUIDE RAILS — they light, and nothing else", () => {
  /*
   * The rule that matters most here. A learner is being asked what they know; failing the question
   * because their thumb was late measures reflexes instead — so tiles give feedback and never take
   * anything away.
   */
  const paths = pathsFor(seedFrom("guide-rails"));
  // Actually FOLLOW the middle trail — an unflapped bird sinks to the floor and passes nowhere near
  // a tile, which lights nothing and says nothing about whether lighting works.
  let s = applyFlappy(initialFlappy(), { type: "start" });
  for (let t = 0; t < (FLAPPY_RULES.DURATION_S + 1) * 60; t++) {
    if (s.y > 0.5) s = applyFlappy(s, { type: "flap" });
    s = applyFlappy(s, { type: "tick", dt: 1 / 60, paths });
  }
  assert.ok(s.lit[1] > 0, `following the middle trail lit none of its tiles: ${s.lit.join(",")}`);
  // And nothing about lighting may move the bird or end the flight — that is the whole point.
  assert.equal(s.progress, 1, "the flight was cut short");
  /*
   * `chosen !== null` was not enough, and mutation testing proved it: a bump that ENDED the flight
   * by picking a gate on the spot also satisfies it. What must hold is that the bird flew the whole
   * course — the bump cost a moment, not the question.
   */
  assert.notEqual(s.chosen, null, "the flight never resolved");
});

test("the flight ends by choosing a gate, and the choice is then frozen", () => {
  let s = applyFlappy(initialFlappy(), { type: "start" });
  s = fly(s, FLAPPY_RULES.DURATION_S + 1);
  assert.notEqual(s.chosen, null, "the course never finished");
  assert.equal(s.progress, 1);

  const after = applyFlappy(s, { type: "flap" });
  assert.deepEqual(after, s, "the answer changed after the bird had already passed the gates");
});

test("height picks the gate, top to bottom", () => {
  assert.equal(gateAt(0.1), 0);
  assert.equal(gateAt(0.5), 1);
  assert.equal(gateAt(0.9), 2);
});

test("EVERY gate is reachable — none of the three is a trap", () => {
  // A course that makes one answer unreachable would fail a learner who knew it.
  for (const target of [0, 1, 2] as const) {
    let s = applyFlappy(initialFlappy(), { type: "start" });
    const want = [0.15, 0.5, 0.85][target];
    for (let t = 0; t < FLAPPY_RULES.DURATION_S * 60 + 60; t++) {
      if (s.y > want) s = applyFlappy(s, { type: "flap" });
      s = applyFlappy(s, { type: "tick", dt: 1 / 60, paths: [] });
    }
    assert.equal(s.chosen, target, `gate ${target} could not be reached by steering toward it`);
  }
});

/* ── the course ──────────────────────────────────────────────────────────── */

test("each checkpoint lays a DIFFERENT route, and the same one replays identically", () => {
  const a = pathsFor(seedFrom("beat-1"));
  const b = pathsFor(seedFrom("beat-2"));
  assert.notDeepEqual(a, b, "two different checkpoints produced the same route");
  assert.deepEqual(a, pathsFor(seedFrom("beat-1")), "the same checkpoint changed between plays");
});

test("there are exactly three trails and each ENDS at its own gate", () => {
  // A trail that ends in the wrong third would send a learner who followed it to the wrong answer.
  for (const id of ["a", "photosynthesis", "x9", "krebs"]) {
    const paths = pathsFor(seedFrom(id));
    assert.equal(paths.length, 3, `${id}: wrong number of trails`);
    assert.deepEqual(paths.map((p) => p.gate), [0, 1, 2], `${id}: trails are not one per gate`);
    for (const p of paths) {
      const last = p.tiles[p.tiles.length - 1];
      assert.equal(gateAt(last.y), p.gate, `${id}: trail ${p.gate} ends over gate ${gateAt(last.y)}`);
    }
  }
});

test("trails start together and separate before the gates", () => {
  // Together at the start so the choice is visibly open; apart by the end so the last stretch is a
  // clear run at one answer rather than a scramble between two.
  const paths = pathsFor(seedFrom("fan"));
  const firstYs = paths.map((p) => p.tiles[0].y);
  const lastYs = paths.map((p) => p.tiles[p.tiles.length - 1].y);
  const spreadOf = (ys: number[]) => Math.max(...ys) - Math.min(...ys);
  assert.ok(spreadOf(firstYs) < 0.2, `trails start too far apart: ${spreadOf(firstYs)}`);
  assert.ok(spreadOf(lastYs) > 0.4, `trails never separate: ${spreadOf(lastYs)}`);
});

test("no tile sits off-field or on the final approach", () => {
  for (const id of ["a", "b", "c", "photosynthesis"]) {
    for (const p of pathsFor(seedFrom(id))) {
      for (const t of p.tiles) {
        assert.ok(t.y >= 0.05 && t.y <= 0.95, `${id}: tile at ${t.y} is off-field`);
        assert.ok(t.at > 0.05 && t.at < 0.9, `${id}: tile at ${t.at} crowds the start or the gates`);
      }
    }
  }
});
