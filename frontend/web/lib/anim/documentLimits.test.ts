/**
 * The upload length limit.
 *
 * Small enough to look trivial, and worth asserting precisely because of that: an off-by-one here
 * either refuses a document that fits or accepts one the lecture can only partly carry, and the
 * second failure is silent — the lesson is written, it is just missing pages nobody was told about.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { DOCUMENT_LIMITS, exceedsPageLimit, tooManyPagesMessage } from "../documentLimits";

test("the boundary is inclusive: exactly the limit is allowed", () => {
  assert.equal(exceedsPageLimit(DOCUMENT_LIMITS.MAX_PAGES), false);
  assert.equal(exceedsPageLimit(DOCUMENT_LIMITS.MAX_PAGES + 1), true);
  assert.equal(exceedsPageLimit(1), false);
});

test("a document of unknown length is not refused", () => {
  // A renderer that could not report a page count must not turn into a rejection.
  assert.equal(exceedsPageLimit(Number.NaN), false);
  assert.equal(exceedsPageLimit(Number.POSITIVE_INFINITY), false);
});

test("the message says how long the document actually is", () => {
  // "Too long" without a number leaves the student guessing how much to cut.
  const message = tooManyPagesMessage(37);
  assert.match(message, /37 pages/);
  assert.match(message, new RegExp(`${DOCUMENT_LIMITS.MAX_PAGES}`));
  assert.match(message, /Split it/);
});

test("a deck is described in slides, not pages", () => {
  const message = tooManyPagesMessage(30, "slide");
  assert.match(message, /30 slides/);
  assert.doesNotMatch(message, /pages/);
});
