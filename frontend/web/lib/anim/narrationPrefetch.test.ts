/**
 * What gets warmed first decides whether the student hears a pause when the slide changes.
 * Measured before this: beat two was never warmed during beat one, and its transition sentence was a
 * 2.8 s cold fetch the moment the slide changed.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { warmOrder } from "../useNarrationPrefetch";

const scripts = [
  "Beat one opens. It keeps going. It has a third sentence. And a fourth.",
  "The bridge into beat two. Beat two explains. Beat two ends.",
  "The bridge into beat three. Beat three explains.",
  "Beat four is further away.",
];

test("the next beat's transition sentence is warmed before the rest of the current beat", () => {
  const order = warmOrder(scripts, 0, 2);
  // The current beat's opening (what Start or a resume waits on), then the next beat, bridge first.
  assert.deepEqual(order.slice(0, 3), ["Beat one opens.", "It keeps going.", "The bridge into beat two."]);
  // The rest of the current beat is left to the player, which fetches it itself.
  assert.ok(!order.includes("And a fourth."));
  // The beat after is warmed too, but after the next one.
  assert.ok(order.indexOf("The bridge into beat three.") > order.indexOf("Beat two ends."));
  // Nothing beyond the lookahead.
  assert.ok(!order.includes("Beat four is further away."));
});

test("the order follows the student through the lecture and stops at the end", () => {
  assert.deepEqual(warmOrder(scripts, 2, 2), ["The bridge into beat three.", "Beat three explains.", "Beat four is further away."]);
  assert.deepEqual(warmOrder(scripts, 3, 2), ["Beat four is further away."]);
  assert.deepEqual(warmOrder([], 0, 2), []);
});

test("a sentence that recurs is warmed once", () => {
  const order = warmOrder(["Same line. Same line.", "Same line. New line."], 0, 1);
  assert.deepEqual(order, ["Same line.", "New line."]);
});
