import test from "node:test";
import assert from "node:assert/strict";
import { PLAYBACK_RATES, parseRate, rateLabel } from "../playbackPrefs";

/**
 * The remembered lecture speed.
 *
 * A stored value that is not one of the offered speeds — an old build's 0.85, a hand-edited 7, a
 * corrupted string — must come back as normal speed, never as something the control cannot show.
 */

test("the five offered speeds, slowest first", () => {
  assert.deepEqual([...PLAYBACK_RATES], [0.25, 0.5, 1, 1.5, 2]);
});

test("every offered speed survives the round trip through storage (which holds strings)", () => {
  for (const rate of PLAYBACK_RATES) assert.equal(parseRate(String(rate)), rate);
});

test("anything else is normal speed, never a speed the control cannot show", () => {
  for (const raw of [null, undefined, "", "fast", "0.85", "1.25", "7", "-1", "NaN", 3, {}, "2x"]) {
    assert.equal(parseRate(raw), 1, String(raw));
  }
});

test("labels read as speeds", () => {
  assert.equal(rateLabel(1), "1×");
  assert.equal(rateLabel(1.5), "1.5×");
  assert.equal(rateLabel(0.25), "0.25×");
});
