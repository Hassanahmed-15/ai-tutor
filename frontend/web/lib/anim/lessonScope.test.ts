import test from "node:test";
import assert from "node:assert/strict";
import {
  FOCUSED_SCOPE,
  STANDARD_SCOPE,
  WORDS_PER_TEACHING_BEAT,
  scopeFromOutline,
  scopeInstruction,
} from "../lessonScope";
import type { PlanOutline } from "../planPrompt";

/**
 * What decides how long a lesson is.
 *
 * The rule being pinned: CONTENT sets the length, never a preset count. A narrow question gets a
 * short lesson, a broad one gets a long lesson, and in both cases each individual board is taught
 * to the same depth. The failure this guards against is the one that prompted the change — a
 * four-idea question padded out to a ten-beat survey course because ten was the number.
 */

const outline = (count: number): PlanOutline =>
  ({
    topic: "t",
    subtopics: Array.from({ length: count }, (_, i) => ({
      title: `s${i}`,
      caption: "c",
      reason: "r",
    })),
  }) as PlanOutline;

test("a narrow question produces a short lesson", () => {
  // "Why are there infinitely many primes?" — one proof, a worked example, a check.
  const scope = scopeFromOutline(outline(3));
  assert.equal(scope.label, "focused");
  assert.equal(scope.minBeats, 5);
});

test("a broad topic still produces a full lesson", () => {
  const scope = scopeFromOutline(outline(10));
  assert.equal(scope.label, "broad");
  assert.ok(scope.minBeats >= 9, `broad lessons must not be truncated, got min ${scope.minBeats}`);
});

test("lesson length rises with the amount of material", () => {
  let previous = 0;
  for (const count of [3, 5, 8, 11]) {
    const scope = scopeFromOutline(outline(count));
    assert.ok(scope.minBeats >= previous, "more subtopics must never produce a shorter floor");
    previous = scope.minBeats;
  }
});

test("no lesson is ever shorter than a real lesson", () => {
  // Even a single-subtopic plan owes an opening, the teaching, a check and a close.
  const scope = scopeFromOutline(outline(1));
  assert.ok(scope.minBeats >= 4, `got ${scope.minBeats}`);
});

test("depth per beat is identical whatever the length", () => {
  // The whole risk of shorter lessons is that "concise" becomes "thin". Total words must scale
  // with beat count, and the per-beat expectation must not move.
  const short = scopeFromOutline(outline(3));
  const long = scopeFromOutline(outline(11));
  assert.equal(short.minTotalWords / short.minBeats, WORDS_PER_TEACHING_BEAT);
  assert.equal(long.minTotalWords / long.minBeats, WORDS_PER_TEACHING_BEAT);
});

test("no outline means the lecture keeps its original shape", () => {
  // Demo, direct build and document paths never planned an outline; they must be unaffected.
  assert.deepEqual(scopeFromOutline(null), STANDARD_SCOPE);
  assert.deepEqual(scopeFromOutline({ topic: "t", subtopics: [] } as unknown as PlanOutline), STANDARD_SCOPE);
});

test("a focused lesson is told to stop early rather than pad", () => {
  const text = scopeInstruction(FOCUSED_SCOPE);
  assert.match(text, /do not pad/i);
  assert.match(text, /SUCCESS/);
  // The instruction must not let "shorter" become "shallower".
  assert.match(text, /same depth per board|never explain less well/i);
});

test("every scope has a minimum but never imposes a maximum", () => {
  for (const count of [2, 4, 6, 9, 12]) {
    const scope = scopeFromOutline(outline(count));
    assert.match(scopeInstruction(scope), new RegExp(`at least ${scope.minBeats}`));
    assert.match(scopeInstruction(scope), /NO maximum beat count/);
    assert.equal("maxBeats" in scope, false);
  }
});
