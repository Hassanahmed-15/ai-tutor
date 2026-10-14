import test from "node:test";
import assert from "node:assert/strict";
import { createTtsQueue } from "../ttsQueue";

/* The narration queue: the sentence being heard goes first (lib/ttsQueue.ts), 2026-10-14. */

/** A synthesis the test finishes by hand, recording when it started. */
function job(log: string[], name: string) {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  return { fn: async () => { log.push(name); await done; return name; }, finish };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a heard sentence starts before warm-ups that were queued earlier", async () => {
  const q = createTtsQueue(2, 1);
  const log: string[] = [];
  const a = job(log, "heard-a"), b = job(log, "heard-b"), w = job(log, "warm"), c = job(log, "heard-c");
  const running = [q.run(a.fn, { warm: false }), q.run(b.fn, { warm: false })];
  const warm = q.run(w.fn, { warm: true });
  await tick();
  const next = q.run(c.fn, { warm: false });
  await tick();
  assert.deepEqual(log, ["heard-a", "heard-b"], "both slots busy, nothing else starts");
  a.finish();
  await running[0];
  await tick();
  assert.equal(log[2], "heard-c", "the freed slot goes to the heard sentence, not the earlier warm-up");
  b.finish();
  await running[1];
  await tick();
  assert.equal(log[3], "warm");
  c.finish(); w.finish();
  await Promise.all([next, warm]);
  assert.deepEqual(q.stats(), { active: 0, activeWarm: 0, waiting: 0 });
});

test("warm-ups never take every slot", async () => {
  const q = createTtsQueue(4); // 2 for warm-ups
  const log: string[] = [];
  const warms = [1, 2, 3, 4].map((i) => job(log, `warm-${i}`));
  const runs = warms.map((w) => q.run(w.fn, { warm: true }));
  await tick();
  assert.equal(q.stats().activeWarm, 2, "only two warm-ups run");
  const heard = job(log, "heard");
  const run = q.run(heard.fn, { warm: false });
  await tick();
  assert.ok(log.includes("heard"), "a heard sentence starts at once even with warm-ups queued");
  heard.finish();
  warms.forEach((w) => w.finish());
  await Promise.all([run, ...runs]);
  assert.equal(q.stats().active, 0);
});

test("a warm-up the player asks for is promoted and starts ahead of other warm-ups", async () => {
  const q = createTtsQueue(1, 1);
  const log: string[] = [];
  const first = job(log, "heard"), w1 = job(log, "warm-1"), w2 = job(log, "warm-2");
  const r0 = q.run(first.fn, { warm: false });
  const p2 = { warm: true };
  const r1 = q.run(w1.fn, { warm: true });
  const r2 = q.run(w2.fn, p2);
  await tick();
  p2.warm = false; // the student reached warm-2's sentence
  q.wake();
  first.finish();
  await r0;
  await tick();
  assert.equal(log[1], "warm-2", "the promoted sentence went first");
  w2.finish(); await r2; await tick();
  w1.finish(); await r1;
  assert.deepEqual(log, ["heard", "warm-2", "warm-1"]);
});

test("the slot limit holds under a burst", async () => {
  const q = createTtsQueue(3);
  let running = 0, peak = 0;
  const work = () => q.run(async () => { running++; peak = Math.max(peak, running); await tick(); await tick(); running--; }, { warm: Math.random() < 0.5 });
  await Promise.all(Array.from({ length: 40 }, work));
  assert.ok(peak <= 3, `peak ${peak} must not exceed 3`);
  assert.deepEqual(q.stats(), { active: 0, activeWarm: 0, waiting: 0 });
});
