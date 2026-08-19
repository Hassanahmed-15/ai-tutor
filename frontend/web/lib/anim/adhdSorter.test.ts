/**
 * Sorting Run — the rules, and the specs that feed them.
 *
 * Everything here runs without Phaser, a canvas, or a clock. That is the whole point of splitting
 * the rules out of the render loop: "a combo breaks on a miss" is a claim about behaviour, and a
 * claim you can only check by playing a real round at real speed is a claim nobody re-checks.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  initialSorter, applySorter, applyAllSorter, comboMultiplier, fallSpeed,
  sorterPassed, SORTER_RULES, type SorterEvent,
} from "../adhd/games/sorterRules";
import { specForBeat, playableSpecCount, SPEC_RULES } from "../adhd/games/spec";
import { beats, type Beat } from "../lessonContent";

/* ── rules ───────────────────────────────────────────────────────────────── */

test("a mistake costs a LIFE, never a point already earned", () => {
  /*
   * The rule the whole track is built on: the cost lands on disengaging, never on being bad at the
   * thing you are learning. A game that takes points back for a wrong catch teaches the learner to
   * stop reaching for the hard ones.
   */
  const earned = applyAllSorter(initialSorter(), [
    { type: "catch", right: true }, { type: "catch", right: true }, { type: "catch", right: true },
  ]);
  assert.ok(earned.score > 0);

  for (const bad of [{ type: "catch", right: false }, { type: "miss" }] as SorterEvent[]) {
    const after = applySorter(earned, bad);
    assert.equal(after.score, earned.score, `${bad.type} must not reduce the score`);
    assert.equal(after.lives, earned.lives - 1, `${bad.type} must cost exactly one life`);
    assert.equal(after.combo, 0, `${bad.type} must break the combo`);
  }
});

test("the combo multiplies, caps, and credits only what was earned BEFORE the catch", () => {
  let s = initialSorter();
  // First catch of a run pays 1.0x — it must not retroactively credit the streak it just started.
  s = applySorter(s, { type: "catch", right: true });
  assert.equal(s.score, SORTER_RULES.CATCH_POINTS);

  for (let i = 0; i < 40; i++) s = applySorter(s, { type: "catch", right: true });
  assert.equal(comboMultiplier(s), SORTER_RULES.COMBO_MAX, "the multiplier must cap");
  assert.ok(s.bestCombo >= s.combo);
});

test("best combo survives the break that ends it", () => {
  // The one number a bad run cannot take away — the same reasoning as `best` in streak.ts.
  const s = applyAllSorter(initialSorter(), [
    { type: "catch", right: true }, { type: "catch", right: true }, { type: "catch", right: true },
    { type: "miss" },
  ]);
  assert.equal(s.combo, 0);
  assert.equal(s.bestCombo, 3);
});

test("the run ends when lives run out, and nothing can change it afterwards", () => {
  let s = initialSorter();
  for (let i = 0; i < SORTER_RULES.LIVES; i++) s = applySorter(s, { type: "miss" });
  assert.ok(s.over);
  assert.equal(s.lives, 0);

  // An item already falling when the last life went must not score after the end card is up.
  const after = applySorter(s, { type: "catch", right: true });
  assert.deepEqual(after, s, "a finished run must be frozen");
});

test("speed ramps with progress and then stops", () => {
  let s = initialSorter();
  assert.equal(fallSpeed(s), SORTER_RULES.BASE_SPEED);
  for (let i = 0; i < 200; i++) s = applySorter(s, { type: "catch", right: true });
  assert.equal(fallSpeed(s), SORTER_RULES.MAX_SPEED, "unbounded speed is unplayable, not hard");
});

test("passing is generous, but not free", () => {
  const good = applyAllSorter(initialSorter(), [
    { type: "catch", right: true }, { type: "catch", right: true }, { type: "catch", right: false },
  ]);
  assert.ok(sorterPassed(good), "one mistake should not fail the round");

  const failed = applyAllSorter(initialSorter(), [{ type: "miss" }, { type: "miss" }, { type: "miss" }]);
  assert.ok(!sorterPassed(failed), "running out of lives is not a pass");

  const mostlyWrong = applyAllSorter(initialSorter(), [
    { type: "catch", right: true }, { type: "catch", right: false }, { type: "catch", right: false },
  ]);
  assert.ok(!sorterPassed(mostlyWrong), "more wrong than right is not a pass");
});

/* ── specs ───────────────────────────────────────────────────────────────── */

test("the real lesson fixture yields playable rounds", () => {
  // The premise the mechanic rests on. If real content produces nothing, the format is wrong.
  const n = playableSpecCount(beats);
  assert.ok(n >= 3, `only ${n} of ${beats.length} beats can be played`);
});

test("a compare beat becomes a two-bin sort with both sides reachable", () => {
  const beat = beats.find((b) => b.compareLeft && b.compareRight)!;
  const spec = specForBeat(beat, beats, 7)!;
  assert.ok(spec, "the compare beat produced no spec");
  assert.equal(spec.bins.length, 2);
  assert.ok(spec.items.some((i) => i.bin === 0));
  assert.ok(spec.items.some((i) => i.bin === 1), "a bin nobody can score in is not a sort");
  for (const item of spec.items) assert.ok(item.bin === 0 || item.bin === 1);
});

test("EVERY seed keeps both bins reachable and the round the right length", () => {
  // Items are shuffled then sliced, so a slice can strand every item in one bin. A guard that holds
  // only for the seed the test happened to pick is not a guard.
  for (const beat of beats) {
    for (let seed = 0; seed < 60; seed++) {
      const spec = specForBeat(beat, beats, seed);
      if (!spec) continue;
      assert.ok(spec.items.length >= SPEC_RULES.MIN_ITEMS, `${beat.id}/${seed}: too few items`);
      assert.ok(spec.items.length <= SPEC_RULES.MAX_ITEMS, `${beat.id}/${seed}: too many items`);
      assert.ok(spec.items.some((i) => i.bin === 0), `${beat.id}/${seed}: bin 0 empty`);
      assert.ok(spec.items.some((i) => i.bin === 1), `${beat.id}/${seed}: bin 1 empty`);
      for (const it of spec.items) {
        assert.ok(it.text.length <= SPEC_RULES.MAX_ITEM_CHARS + 1,
                  `${beat.id}/${seed}: "${it.text}" cannot be read while falling`);
      }
      for (const b of spec.bins) assert.ok(b.length <= SPEC_RULES.MAX_BIN_CHARS + 1);
    }
  }
});

test("the same seed replays the same round", () => {
  const beat = beats.find((b) => b.compareLeft)!;
  assert.deepEqual(specForBeat(beat, beats, 42), specForBeat(beat, beats, 42));
});

test("content that cannot make a real game returns NULL rather than a broken one", () => {
  const donor = beats.find((b) => b.points.length >= 2)!;
  const strip = (over: Partial<Beat>): Beat => ({ ...donor, ...over, compareLeft: undefined, compareRight: undefined });

  assert.equal(specForBeat(strip({ points: [] }), beats, 1), null, "no points, no game");
  assert.equal(specForBeat(strip({ points: ["only one"] }), beats, 1), null, "one point is not a sort");
  // Nowhere to borrow decoys from: every item would belong to the same bin.
  const lone = strip({ id: "lone" });
  assert.equal(specForBeat(lone, [lone], 1), null);
  // One empty side of a compare must not produce a single-bin "sort".
  assert.notEqual(
    specForBeat({ ...donor, compareLeft: { label: "A", points: ["x"] }, compareRight: { label: "B", points: [] } }, beats, 1)?.items.some((i) => i.bin === 1),
    false,
  );
});

/*
 * The three tests below exist because mutation testing showed the originals could not see these
 * guards. Erasing `bestCombo`, and dropping the both-bins-reachable check on the compare path, both
 * left the suite green — the first because the assertion stopped at the break that set the record,
 * the second because the fixture's compare beat is small enough that the slice never strands a bin.
 */

test("best combo is the RECORD, not the most recent streak", () => {
  const s = applyAllSorter(initialSorter(), [
    { type: "catch", right: true }, { type: "catch", right: true }, { type: "catch", right: true },
    { type: "miss" },
    { type: "catch", right: true }, // a shorter streak afterwards must not overwrite the record
  ]);
  assert.equal(s.combo, 1);
  assert.equal(s.bestCombo, 3, "a later, shorter streak overwrote the best");
});

test("a lopsided compare beat never yields a sort with one bin unreachable", () => {
  // Twelve items on one side against two: slicing to MAX_ITEMS can strand the small bin entirely,
  // and the learner would win by holding the paddle still. The fixture's own compare beat has six
  // items total, so it never reaches the slice — this is the case that does.
  const donor = beats.find((b) => b.compareLeft && b.compareRight)!;
  const lopsided: Beat = {
    ...donor,
    id: "lopsided",
    compareLeft: { label: "Many", points: Array.from({ length: 12 }, (_, i) => `left point ${i}`) },
    compareRight: { label: "Few", points: ["right point A", "right point B"] },
  };

  let produced = 0;
  for (let seed = 0; seed < 120; seed++) {
    const spec = specForBeat(lopsided, [lopsided, ...beats], seed);
    if (!spec) continue;
    produced++;
    assert.ok(spec.items.some((i) => i.bin === 0), `seed ${seed}: bin 0 unreachable`);
    assert.ok(spec.items.some((i) => i.bin === 1), `seed ${seed}: bin 1 unreachable`);
  }
  assert.ok(produced > 0, "no spec was produced at all, so this asserted nothing");
});

test("a long label is trimmed to something readable while falling", () => {
  const donor = beats.find((b) => b.compareLeft && b.compareRight)!;
  const wordy: Beat = {
    ...donor,
    id: "wordy",
    compareLeft: { label: "A label far longer than any bin could sensibly display on screen", points: ["short one", "short two"] },
    compareRight: { label: "B", points: [
      "an item so long that by the time you finished reading it the tile would already have hit the floor",
      "short three",
    ] },
  };
  const spec = specForBeat(wordy, beats, 3)!;
  assert.ok(spec);
  for (const it of spec.items) assert.ok(it.text.length <= SPEC_RULES.MAX_ITEM_CHARS + 1, it.text);
  for (const b of spec.bins) assert.ok(b.length <= SPEC_RULES.MAX_BIN_CHARS + 1, b);
  // Trimming must leave something, not an ellipsis on its own.
  for (const it of spec.items) assert.ok(it.text.replace(/…/g, "").trim().length > 3);
});
