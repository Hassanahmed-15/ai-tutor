import test from "node:test";
import assert from "node:assert/strict";
import { applyCheckpoint, checkpointItems, checkpointKey, emptyProgress, lessonKey, markStarted, progressOf } from "../curriculum/mastery";
import type { GradeBlock } from "../curriculum/types";

const lesson = (id: string, n = 2) => ({ id, title: id, outcomes: Array.from({ length: n }, (_, i) => ({ code: null, text: `${id} goal ${i}` })) });
const block: GradeBlock = {
  grade: "9",
  units: [
    { id: "u1", title: "Forces", topics: [{ id: "t1", title: "Speed", subtopics: [lesson("a"), lesson("b"), lesson("c")] }] },
    { id: "u2", title: "Waves", topics: [{ id: "t2", title: "Sound", subtopics: Array.from({ length: 12 }, (_, i) => lesson(`w${i}`)) }] },
  ],
};

test("a unit checkpoint asks about each lesson; a long unit or a class assessment is spread evenly", () => {
  assert.deepEqual(checkpointItems(block, "u1").map((i) => i.lessonTitle), ["a", "b", "c"]);
  const waves = checkpointItems(block, "u2");
  assert.equal(waves.length, 8);
  assert.equal(waves[0].lessonTitle, "w0");
  assert.equal(new Set(waves.map((w) => w.lessonKey)).size, 8, "no lesson asked twice");
  const all = checkpointItems(block, null);
  assert.equal(all.length, 12);
  assert.ok(all.some((i) => i.unitTitle === "Forces") && all.some((i) => i.unitTitle === "Waves"), "every unit represented");
});

test("all-correct lessons become mastered; the best checkpoint score is kept; mastery is never lost", () => {
  const a = lessonKey("9", "u1", "t1", "a");
  const b = lessonKey("9", "u1", "t1", "b");
  let p = markStarted(emptyProgress(), a, "t0");
  p = markStarted(p, b, "t0");
  const key = checkpointKey("9", "u1");
  p = applyCheckpoint(p, key, [{ lessonKey: a, correct: true }, { lessonKey: b, correct: false }], "t1");
  assert.equal(p.lessons[a].state, "mastered");
  assert.equal(p.lessons[b].state, "started");
  assert.deepEqual(p.checkpoints[key], { score: 1, total: 2, at: "t1" });
  p = applyCheckpoint(p, key, [{ lessonKey: a, correct: false }, { lessonKey: b, correct: false }], "t2");
  assert.equal(p.lessons[a].state, "mastered", "a later wrong answer does not un-master");
  assert.equal(p.checkpoints[key].score, 1, "the best attempt is kept");
  assert.equal(markStarted(p, a).lessons[a].state, "mastered", "re-opening a mastered lesson keeps it mastered");
  assert.deepEqual(progressOf(p, block, "u1"), { mastered: 1, started: 1, total: 3 });
});
