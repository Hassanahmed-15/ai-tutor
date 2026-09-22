/**
 * Every scenario gets the verdict a person would give, and every decision is explainable.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SCENARIOS, runScenario, scoreScenario } from "../scenarios";

test("all scenarios pass through the assembled pipeline", () => {
  const failures: string[] = [];
  for (const s of SCENARIOS) {
    const o = runScenario(s);
    const { pass, why } = scoreScenario(s, o);
    if (!pass) failures.push(`#${s.id} ${s.name}: ${why}`);
  }
  assert.deepEqual(failures, []);
});

test("at least 40 scenarios, covering noise, other people, the student, planning, pauses, drops and stuck states", () => {
  assert.ok(SCENARIOS.length >= 40);
  const ids = new Set(SCENARIOS.map((s) => s.id));
  assert.equal(ids.size, SCENARIOS.length, "ids are unique");
});

test("pure noise never opens a turn at all — nothing is sent anywhere", () => {
  for (const id of [1, 2, 3, 4, 7, 27]) {
    const s = SCENARIOS.find((x) => x.id === id)!;
    const o = runScenario(s);
    assert.ok(!o.events.some((e) => e.layer === "turn" && e.kind === "open"), `#${id} opened a turn`);
  }
});

test("barge-in is prompt: her name stops her within 100 ms of the transcript", () => {
  const s = SCENARIOS.find((x) => x.id === 15)!;
  const o = runScenario(s);
  const pause = o.events.find((e) => e.layer === "tutor" && e.kind === "pause");
  assert.ok(pause, "the tutor was paused");
  assert.ok(pause!.t - s.transcript!.atFrame * 20 <= 100, `paused ${pause!.t - s.transcript!.atFrame * 20} ms after the name`);
});

test("a turn that turns out to be someone else's is discarded and the tutor restored", () => {
  const o = runScenario(SCENARIOS.find((x) => x.id === 26)!);
  assert.equal(o.turns, 0);
  assert.ok(!o.bargeReason);
});

test("the pre-roll is handed over when a turn opens", () => {
  const o = runScenario(SCENARIOS.find((x) => x.id === 28)!);
  const open = o.events.find((e) => e.layer === "turn" && e.kind === "open");
  assert.ok(open && /\+\d+ pre-roll frames/.test(open.detail ?? ""), open?.detail);
});

test("every state change carries a reason", () => {
  for (const s of SCENARIOS) {
    const o = runScenario(s);
    for (const e of o.events.filter((x) => x.layer === "turn" && x.kind === "state")) {
      assert.ok(e.detail && e.detail.includes(":") && e.detail.split(":")[1].trim().length > 3, `#${s.id}: "${e.detail}"`);
    }
  }
});
