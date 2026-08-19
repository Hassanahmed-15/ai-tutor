/**
 * The beat → game router.
 *
 * Driven against the REAL lesson fixture (`lib/lessonContent.ts`), not hand-written beats. The whole
 * premise of game mode is that the generator's existing output is already game-shaped; a test that
 * invents its own perfectly-formed beats would prove that premise by assuming it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { roundForBeat, playableCount, GAME_RULES } from "../adhd/gameRouting";
import { beats, type Beat } from "../lessonContent";

const firstOfKind = (kind: Beat["slideKind"]) => beats.find((b) => b.slideKind === kind)!;

test("the real lesson fixture actually yields games", () => {
  // The claim game mode rests on. If the shipped lesson produces nothing playable, the feature is
  // built on an assumption about content that does not hold.
  const playable = playableCount(beats);
  assert.ok(playable >= 3, `only ${playable} of ${beats.length} beats are playable`);
});

test("a definition beat becomes a match round with real decoys", () => {
  const beat = firstOfKind("definition");
  const round = roundForBeat(beat, beats, 7);
  assert.ok(round && round.kind === "match");
  if (round.kind !== "match") return;

  assert.equal(round.prompt, beat.definitionTerm);
  assert.equal(round.options[round.answer], beat.definitionMeaning);
  assert.ok(round.options.length >= 1 + GAME_RULES.MIN_DECOYS, "a round with no decoy is a free point");
  assert.ok(round.options.length <= GAME_RULES.MAX_OPTIONS);
  assert.equal(new Set(round.options).size, round.options.length, "a duplicated option is unanswerable");
});

test("a compare beat becomes a sort with both sides populated", () => {
  const beat = firstOfKind("compare");
  const round = roundForBeat(beat, beats, 3);
  assert.ok(round && round.kind === "sort");
  if (round.kind !== "sort") return;

  assert.equal(round.buckets[0], beat.compareLeft!.label);
  assert.equal(round.buckets[1], beat.compareRight!.label);
  // Every item must be answerable from the beat, and both buckets must be reachable.
  assert.ok(round.items.some((i) => i.bucket === 0));
  assert.ok(round.items.some((i) => i.bucket === 1));
  for (const item of round.items) {
    const source = item.bucket === 0 ? beat.compareLeft! : beat.compareRight!;
    assert.ok(source.points.includes(item.text), `"${item.text}" is not on side ${item.bucket}`);
  }
});

test("a checkpoint beat reuses its own question rather than inventing one", () => {
  const beat = firstOfKind("checkpoint");
  const round = roundForBeat(beat, beats, 1);
  assert.ok(round && round.kind === "recall");
  if (round.kind !== "recall") return;
  assert.equal(round.prompt, beat.checkpoint!.prompt);
  assert.deepEqual(round.acceptable, beat.checkpoint!.acceptableKeywords);
});

test("a recap beat becomes an ordering puzzle that is not already solved", () => {
  const beat = firstOfKind("recap");
  const round = roundForBeat(beat, beats, 5);
  assert.ok(round && round.kind === "order");
  if (round.kind !== "order") return;

  assert.ok(round.correct.length >= GAME_RULES.MIN_ORDER_ITEMS);
  assert.deepEqual([...round.shuffled].sort(), [...round.correct].sort(), "shuffling must not lose items");
  assert.notDeepEqual(round.shuffled, round.correct, "a pre-solved puzzle hands out a free point");
});

test("EVERY seed produces a usable round — no seed can hand out a free point", () => {
  // The anti-free-point guard is a rotate-if-solved, and a guard that only works for the one seed
  // the test happened to pick is not a guard.
  const recap = firstOfKind("recap");
  for (let seed = 0; seed < 200; seed++) {
    const round = roundForBeat(recap, beats, seed);
    if (round?.kind === "order") {
      assert.notDeepEqual(round.shuffled, round.correct, `seed ${seed} produced a solved puzzle`);
    }
    const match = roundForBeat(firstOfKind("definition"), beats, seed);
    if (match?.kind === "match") {
      assert.ok(match.answer >= 0 && match.answer < match.options.length, `seed ${seed}: answer out of range`);
      assert.equal(new Set(match.options).size, match.options.length, `seed ${seed}: duplicate option`);
    }
  }
});

test("the same seed replays the same round", () => {
  // Reproducibility is what makes a round reviewable in the lab and assertable in a test.
  const beat = firstOfKind("definition");
  assert.deepEqual(roundForBeat(beat, beats, 42), roundForBeat(beat, beats, 42));
});

test("MISSING CONTENT RETURNS NULL rather than a broken game", () => {
  /*
   * The most important behaviour here. A generated lesson can omit any of these fields, and a
   * half-built round — two options where one is blank, a sort with nothing to sort — is worse than
   * falling back to the narrated slide.
   */
  const strip = (b: Beat, over: Partial<Beat>): Beat => ({ ...b, ...over });

  assert.equal(roundForBeat(strip(firstOfKind("definition"), { definitionMeaning: "" }), beats, 1), null);
  assert.equal(roundForBeat(strip(firstOfKind("definition"), { definitionTerm: undefined }), beats, 1), null);
  assert.equal(
    roundForBeat(strip(firstOfKind("compare"), { compareRight: { label: "x", points: [] } }), beats, 1),
    null,
    "one empty side is a list, not a sort",
  );
  assert.equal(roundForBeat(strip(firstOfKind("compare"), { compareLeft: undefined }), beats, 1), null);
  assert.equal(
    roundForBeat(strip(firstOfKind("checkpoint"), { checkpoint: undefined }), beats, 1),
    null,
  );
  // Whitespace-only content is missing content.
  assert.equal(roundForBeat(strip(firstOfKind("definition"), { definitionMeaning: "   " }), beats, 1), null);
});

test("a definition with no sibling definitions cannot make a match", () => {
  // Decoys come from other beats. A one-definition lesson has nowhere to get them, and the round
  // would be a single option — guaranteed correct, worth nothing.
  const lone = firstOfKind("definition");
  assert.equal(roundForBeat(lone, [lone], 1), null);
});

test("an intro beat falls back to the slide", () => {
  // Deliberate: a hook has no content to test yet, and inventing decoy topics would mean generating
  // content, which is the thing this router exists to avoid.
  assert.equal(roundForBeat(firstOfKind("intro"), beats, 1), null);
});

/*
 * The two tests below exist because mutation testing proved the originals could not see these
 * guards: deleting the duplicate-decoy filter, and deleting the pre-solved-shuffle guard, both left
 * the suite fully green. The real fixture simply never triggers either case — no two beats happen to
 * share a definition, and a six-item shuffle almost never lands in order. A guard that only holds
 * for the content you happened to test is not a guard.
 */

test("a decoy that duplicates the answer is rejected, even from another beat", () => {
  const target = firstOfKind("definition");
  const twin: Beat = {
    ...target,
    id: `${target.id}-twin`,
    // A different beat that happens to word its meaning identically — entirely possible in generated
    // content, and it makes the round unanswerable: two options are both "correct".
    definitionTerm: "Something else",
    definitionMeaning: target.definitionMeaning,
  };
  const lesson = [...beats, twin];

  for (let seed = 0; seed < 60; seed++) {
    const round = roundForBeat(target, lesson, seed);
    if (round?.kind !== "match") continue;
    assert.equal(
      new Set(round.options).size,
      round.options.length,
      `seed ${seed}: the answer appears twice, so both are right`,
    );
    assert.equal(round.options[round.answer], target.definitionMeaning);
  }
});

test("the pre-solved guard fires on a lesson small enough to trigger it", () => {
  // Three items shuffle into their original order roughly one time in six, so this reaches the
  // branch within a handful of seeds. The real recap orders six titles, where identity is a 1-in-720
  // event the original loop never happened to hit.
  const short: Beat[] = [
    { ...firstOfKind("definition"), id: "s1", title: "Step one" },
    { ...firstOfKind("definition"), id: "s2", title: "Step two" },
    { ...firstOfKind("definition"), id: "s3", title: "Step three" },
    { ...firstOfKind("recap"), id: "s-recap" },
  ];
  const recap = short[3];

  let seen = 0;
  for (let seed = 0; seed < 400; seed++) {
    const round = roundForBeat(recap, short, seed);
    assert.ok(round && round.kind === "order", `seed ${seed} produced no order round`);
    if (round.kind !== "order") continue;
    seen++;
    assert.deepEqual([...round.shuffled].sort(), [...round.correct].sort(), `seed ${seed} lost an item`);
    assert.notDeepEqual(round.shuffled, round.correct, `seed ${seed} handed out a solved puzzle`);
  }
  assert.ok(seen > 0, "the loop never produced a round, so it asserted nothing");
});

test("the slideKinds the GENERATOR actually emits are playable, not just the typed five", () => {
  /*
   * The SlideKind union lists intro|definition|checkpoint|compare|recap, but the generator prompt
   * asks the model for "definition, mechanism, example, compare, application, misconception, or
   * recap" (app/api/generate-lecture/route.ts:282). So a real lecture is mostly kinds the typed
   * cases never match — and without the points-based fallback, game mode would look correct on this
   * fixture and quietly serve slides for most of a generated lesson.
   */
  const generated = ["mechanism", "example", "application", "misconception"];
  const donor = beats.find((b) => b.points.length >= 2)!;

  for (const kind of generated) {
    const beat = { ...donor, id: `gen-${kind}`, slideKind: kind as Beat["slideKind"], title: `A ${kind} beat` };
    const round = roundForBeat(beat, [beat, ...beats], 11);
    assert.ok(round, `slideKind "${kind}" produced no round`);
    if (round?.kind !== "match") return assert.fail(`expected a match round for "${kind}"`);

    // The odd one out must be the borrowed point, and it must not also appear among this beat's own.
    const decoy = round.options[round.answer];
    assert.ok(!beat.points.includes(decoy), `the "wrong" option is actually one of this beat's points`);
    assert.equal(new Set(round.options).size, round.options.length);
    assert.match(round.ask ?? "", /does NOT belong/);
  }
});

test("a beat with too few points falls back rather than asking a one-option question", () => {
  const donor = beats.find((b) => b.points.length >= 2)!;
  const bare = { ...donor, id: "bare", slideKind: "mechanism" as Beat["slideKind"], points: ["only one"] };
  assert.equal(roundForBeat(bare, [bare, ...beats], 1), null);
});
