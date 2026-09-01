/**
 * How long parsed page images live, and what gets dropped when too many pile up.
 *
 * Both rules fail quietly if they are wrong. Too eager an expiry means a student who spent two
 * minutes on the planning screen gets a text-only lecture and no indication why; an off-by-one in
 * eviction means the store grows past its bound, holding megabytes per document.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { RETENTION_RULES, evictionCount, isExpired } from "../pageImageRetention";

test("an entry survives right up to the TTL and not past it", () => {
  const created = 1_000_000;
  assert.equal(isExpired(created, created), false);
  assert.equal(isExpired(created, created + RETENTION_RULES.TTL_MS), false, "exactly at the TTL still counts");
  assert.equal(isExpired(created, created + RETENTION_RULES.TTL_MS + 1), true);
});

test("the TTL outlasts a slow parse plus a slow generation", () => {
  // Parsing can take ~25s, planning is open-ended because a person is reading it, and generation
  // runs for minutes. A window measured in single-digit minutes would expire mid-flow.
  assert.ok(RETENTION_RULES.TTL_MS >= 30 * 60 * 1000);
});

test("nothing is evicted while there is room for one more", () => {
  assert.equal(evictionCount(0), 0);
  assert.equal(evictionCount(RETENTION_RULES.MAX_DOCUMENTS - 1), 0);
});

test("adding to a full store drops exactly one", () => {
  // At capacity, one out for one in — not a full clear, which would throw away seven documents
  // that other tabs may still be about to generate from.
  assert.equal(evictionCount(RETENTION_RULES.MAX_DOCUMENTS), 1);
});

test("an oversized store is trimmed back to leave room", () => {
  const over = RETENTION_RULES.MAX_DOCUMENTS + 3;
  assert.equal(evictionCount(over), 4);
  // After dropping that many, the new entry lands exactly at capacity.
  assert.equal(over - evictionCount(over) + 1, RETENTION_RULES.MAX_DOCUMENTS);
});
