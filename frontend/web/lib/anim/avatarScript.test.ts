import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_SCRIPT, appendToScript, expectedIndex, reconcile } from "../avatar/script";

// "Peter" and "moon", as the English rules would hand them over.
const peter = appendToScript(EMPTY_SCRIPT, ["PP", "I", "DD", "RR"], [1.08, 0.92, 1.05, 0.88]);
const both = appendToScript(peter, ["PP", "U", "nn"], [1.08, 0.95, 0.88]);

test("a script keeps order, merges a repeated shape, and breathes between words", () => {
  assert.deepEqual(peter.visemes, ["PP", "I", "DD", "RR"]);
  assert.equal(peter.starts[0], 0);
  assert.ok(peter.starts[1] > 1 && peter.starts[1] <= 1.1);
  assert.equal(both.visemes.length, 7);
  assert.ok(both.starts[4] > peter.total, "the second word starts after a gap");
  const merged = appendToScript(EMPTY_SCRIPT, ["SS", "SS", "aa"], [1, 1, 1]);
  assert.deepEqual(merged.visemes, ["SS", "aa"]);
  assert.ok(merged.total > 2 && merged.total < 3, "the doubled shape lasts longer, not twice as long");
});

test("progress through the audio picks the viseme due at that moment", () => {
  assert.equal(expectedIndex(both, 0), 0);
  assert.equal(expectedIndex(both, 0.999), 6);
  assert.equal(expectedIndex(both, 1), 6);
  const mid = expectedIndex(both, 0.5);
  assert.ok(mid >= 2 && mid <= 4, `half way is around the word gap (${mid})`);
  assert.equal(expectedIndex(EMPTY_SCRIPT, 0.5), -1);
  assert.equal(expectedIndex(both, Number.NaN), -1);
});

test("the ear wins when it hears a shape due around now; the script wins otherwise", () => {
  // Expected "I" (index 1); the listener hears "DD", which is next: trust it and move on.
  let r = reconcile(both, 0, 1, "DD");
  assert.equal(r.viseme, "DD");
  assert.equal(r.cursor, 2);
  // A sealed lip is the script's call whatever the ear says: "PP" is due at index 4.
  r = reconcile(both, 4, 4, "aa");
  assert.equal(r.viseme, "PP");
  // The ear's "I" two steps away does not pull the cursor: only a neighbour does.
  r = reconcile(both, 3, 3, "I");
  assert.equal(r.viseme, "RR");
  // The listener hears "aa", which the sentence never has: show the script's shape instead.
  r = reconcile(both, 2, 2, "aa");
  assert.equal(r.viseme, "DD");
  assert.equal(r.cursor, 2);
  // Silence from the ear: the script's shape at the cursor, no jump.
  r = reconcile(both, 2, 3, "sil");
  assert.equal(r.viseme, "RR");
  // The cursor never runs off the end; past the end it holds the last shape.
  r = reconcile(both, 6, 6, "nn");
  assert.equal(r.viseme, "nn");
  assert.equal(r.cursor, 6);
  r = reconcile(both, 6, 9, null);
  assert.equal(r.cursor, 6);
  // No script: whatever was heard.
  assert.equal(reconcile(EMPTY_SCRIPT, 0, 0, "O").viseme, "O");
});
