/**
 * What Aria says, and for how long.
 *
 * The escalation is the point: a teacher equally cross about the first skip and the tenth is noise,
 * and noise gets tuned out. Checking that by skipping ten beats in a real lecture is not something
 * anyone would do twice, so the rule is pure and checked here.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { holdFor, lineFor, HOLD_MS, type Reaction } from "../adhd/reproach";

/** Every line the tier system can produce for a given skip count. */
const linesAt = (reaction: Reaction, skipped: number) =>
  [0, 1, 2, 3, 4, 5].map((seed) => lineFor(reaction, skipped, seed));

test("the reproach escalates with repeated skips", () => {
  const first = new Set(linesAt("skipped", 1));
  const second = new Set(linesAt("skipped", 3));
  const many = new Set(linesAt("skipped", 7));

  // The three tiers must be genuinely different pools, not the same words with a louder adjective.
  for (const line of first) assert.ok(!second.has(line), `tier 0 and 1 share a line: ${line}`);
  for (const line of second) assert.ok(!many.has(line), `tier 1 and 2 share a line: ${line}`);

  // And the top tier is the one that actually says it is angry — that is the requested behaviour.
  assert.ok([...many].some((l) => /angry|cross|disappointed/i.test(l)),
            `the top tier should say so outright: ${[...many].join(" / ")}`);
});

test("the tier boundaries are where they claim to be", () => {
  // 0-1 mild, 2-4 annoyed, 5+ angry. Pinned because an off-by-one here means a learner gets the
  // furious version on their very first skip, which is the failure mode worth guarding.
  assert.deepEqual(new Set(linesAt("skipped", 0)), new Set(linesAt("skipped", 1)));
  assert.deepEqual(new Set(linesAt("skipped", 2)), new Set(linesAt("skipped", 4)));
  assert.notDeepEqual(new Set(linesAt("skipped", 1)), new Set(linesAt("skipped", 2)));
  assert.notDeepEqual(new Set(linesAt("skipped", 4)), new Set(linesAt("skipped", 5)));
});

test("consecutive reactions do not repeat the same sentence", () => {
  // A character that says one fixed string stops being a character the second time you hear it.
  const a = lineFor("skipped", 1, 0);
  const b = lineFor("skipped", 1, 1);
  assert.notEqual(a, b);
});

test("every line names the ACTION, never what the learner is", () => {
  /*
   * The one rule kept from the original anti-shame design after the tone was changed on request.
   * "You skipped that" is about a thing that happened; "you are lazy" is a verdict on a person, and
   * for a learner with rejection sensitive dysphoria that is the difference between a nudge and the
   * end of the session.
   */
  const all: string[] = [];
  for (const r of ["skipped", "unanswered", "correct"] as Reaction[]) {
    for (const n of [0, 2, 7]) all.push(...linesAt(r, n));
  }
  for (const line of all) {
    assert.ok(!/you are\b|you're\b|lazy|stupid|hopeless|useless/i.test(line),
              `line judges the learner rather than the action: ${line}`);
  }
});

test("a wrong-answer reaction is never produced at all", () => {
  // There is deliberately no reaction for getting something wrong. The penalty in this track lands
  // on disengaging, never on struggling — the same rule score.ts enforces.
  const unanswered = linesAt("unanswered", 0);
  /*
   * Matching the bare word "wrong" was too blunt and failed a line that says the opposite of
   * scolding: "I would rather a wrong answer than no answer" is an INVITATION to guess. What must
   * not appear is blame for having been incorrect.
   */
  for (const line of unanswered) {
    assert.ok(!/(got|had) (it|that) wrong|that.s (wrong|incorrect)|you failed/i.test(line),
              `unanswered must not scold for being wrong: ${line}`);
  }
  // And it invites a guess, because a learner who stops answering is the thing being prevented.
  assert.ok(unanswered.some((l) => /guess|wrong costs|rather a wrong/i.test(l)));
});

test("being told off lasts longer than being praised", () => {
  // The original bug: one flat 2200ms for every reaction meant the furious face was gone before it
  // registered. Praise can be brief — the learner already knows they got it right.
  assert.ok(holdFor("skipped") > holdFor("unanswered"));
  assert.ok(holdFor("unanswered") > holdFor("correct"));
  assert.ok(holdFor("skipped") >= 8000, "the requested behaviour is that she STAYS cross");
});

test("every reaction ends", () => {
  // A reaction decays; a verdict does not. An infinite hold would be a face that never resets.
  for (const ms of Object.values(HOLD_MS)) {
    assert.ok(Number.isFinite(ms) && ms > 0 && ms <= 20_000, `implausible hold: ${ms}`);
  }
});

test("no seed can produce an undefined line", () => {
  // `seed` is an ever-incrementing counter, so it must survive large values, and a negative would
  // index off the front of the array.
  for (const seed of [-5, -1, 0, 7, 1e6]) {
    for (const r of ["skipped", "unanswered", "correct"] as Reaction[]) {
      assert.equal(typeof lineFor(r, 3, seed), "string");
      assert.ok(lineFor(r, 3, seed).length > 0);
    }
  }
});
