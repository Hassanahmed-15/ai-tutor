import test from "node:test";
import assert from "node:assert/strict";

import { initialLoot, onBeatForLoot, LOOT_RULES } from "../adhd/loot";
import { initialStreak, recordDay, STREAK_RULES } from "../adhd/streak";

/* ── Loot: a variable schedule that is still bounded and reproducible ─────── */

test("the same seed replays the same sequence", () => {
  // A payout table built on Math.random() cannot be verified, and an unverifiable payout table is
  // one nobody ever checks. Determinism is what makes the rest of these assertions possible.
  const run = (seed: number) => {
    let s = initialLoot(seed);
    const out: string[] = [];
    for (let i = 0; i < 30; i++) {
      const { state, reward } = onBeatForLoot(s);
      s = state;
      if (reward) out.push(JSON.stringify(reward));
    }
    return out;
  };
  assert.deepEqual(run(42), run(42));
  assert.notDeepEqual(run(42), run(43), "and different seeds genuinely differ");
});

test("the per-session cap holds no matter how long the session runs", () => {
  // The guard that stops a study session becoming a pull-the-lever session.
  for (const seed of [1, 7, 42, 1234, 99999]) {
    let s = initialLoot(seed);
    let boxes = 0;
    for (let i = 0; i < 500; i++) {
      const { state, reward } = onBeatForLoot(s);
      s = state;
      if (reward) boxes++;
    }
    assert.ok(boxes <= LOOT_RULES.MAX_PER_SESSION, `seed ${seed} produced ${boxes} boxes`);
  }
});

test("a box never lands sooner than the minimum gap", () => {
  for (const seed of [1, 7, 42, 1234]) {
    let s = initialLoot(seed);
    let sinceLast = 0;
    for (let i = 0; i < 200; i++) {
      sinceLast++;
      const { state, reward } = onBeatForLoot(s);
      s = state;
      if (reward) {
        assert.ok(sinceLast >= LOOT_RULES.MIN_GAP, `seed ${seed}: box after only ${sinceLast} beats`);
        sinceLast = 0;
      }
    }
  }
});

test("every box pays something real — there is no empty outcome", () => {
  // A box that can pay nothing teaches the learner the mechanic is a tax on their attention, and it
  // is also the shape that makes near-miss animations tempting to add later.
  for (const seed of [1, 3, 9, 42, 777, 31337]) {
    let s = initialLoot(seed);
    for (let i = 0; i < 60; i++) {
      const { state, reward } = onBeatForLoot(s);
      s = state;
      if (reward) {
        assert.ok(["coins", "card-upgrade", "power-up", "streak-freeze"].includes(reward.kind));
        if (reward.kind === "coins") assert.ok(reward.amount > 0, "a coin reward of zero is an empty box");
      }
    }
  }
});

/* ── Streak: real stakes, survivable ──────────────────────────────────────── */

test("consecutive days build, and a second session the same day changes nothing", () => {
  let s = initialStreak();
  ({ state: s } = recordDay(s, "2026-03-01"));
  ({ state: s } = recordDay(s, "2026-03-02"));
  assert.equal(s.days, 2);

  const twice = recordDay(s, "2026-03-02");
  assert.equal(twice.outcome, "same-day");
  assert.deepEqual(twice.state, s, "a second lecture today must not count twice");
});

test("a missed day breaks the streak when no freeze is banked", () => {
  let s = initialStreak();
  ({ state: s } = recordDay(s, "2026-03-01"));
  ({ state: s } = recordDay(s, "2026-03-02"));

  const gap = recordDay(s, "2026-03-04"); // skipped the 3rd
  assert.equal(gap.outcome, "broken");
  assert.equal(gap.state.days, 1, "restarts, rather than continuing");
});

test("a banked freeze covers a missed day and the streak survives", () => {
  // The whole reason freezes exist: losing a long streak is the moment an ADHD learner with RSD
  // stops opening the app. This converts "I ruined it" into "that cost me one of my three".
  let s = initialStreak();
  for (let d = 1; d <= STREAK_RULES.FREEZE_EVERY; d++) {
    ({ state: s } = recordDay(s, `2026-03-0${d}`));
  }
  assert.equal(s.freezes, 1, "a freeze is earned before the streak is long enough to hurt");

  const skipped = recordDay(s, "2026-03-07"); // missed the 6th
  assert.equal(skipped.outcome, "frozen");
  assert.equal(skipped.state.days, STREAK_RULES.FREEZE_EVERY + 1, "the run continues");
  assert.equal(skipped.state.freezes, 0, "and it cost the freeze");
});

test("a long absence still breaks it, and never erases the personal best", () => {
  let s = initialStreak();
  for (let d = 1; d <= 9; d++) ({ state: s } = recordDay(s, `2026-03-0${d}`));
  const best = s.best;
  assert.ok(best >= 9);

  const returned = recordDay(s, "2026-04-20"); // gone for weeks
  assert.equal(returned.outcome, "broken");
  assert.equal(returned.state.days, 1);
  // The record of what they achieved survives the bad month. It is the thing worth pointing at
  // when the new streak is one day old.
  assert.equal(returned.state.best, best);
});

test("freezes are capped so they cannot be hoarded into immunity", () => {
  let s = initialStreak();
  for (let d = 1; d <= 28; d++) {
    const day = `2026-03-${String(d).padStart(2, "0")}`;
    ({ state: s } = recordDay(s, day));
  }
  assert.ok(s.freezes <= STREAK_RULES.MAX_FREEZES, `banked ${s.freezes}`);
});
