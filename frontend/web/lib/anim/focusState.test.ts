import test from "node:test";
import assert from "node:assert/strict";

import {
  initialFocus, advanceFocus, mayInterrupt, shouldOfferBreak, hyperfocusMinutes,
  FOCUS_THRESHOLDS, type FocusTracker,
} from "../adhd/focusState";

/** Feed a constant engagement for `ms`, in 1s samples — what a real camera loop produces. */
function hold(t: FocusTracker, engagement: number | null, ms: number): FocusTracker {
  for (let i = 0; i < Math.round(ms / 1000); i++) t = advanceFocus(t, engagement, 1000);
  return t;
}

test("no camera signal is 'unknown', never mistaken for calm", () => {
  // A missing signal is not evidence of engagement. If null landed on "settled" the player would
  // act on knowledge it does not have — the same class of bug as a critic scoring 5/5 while its
  // rasteriser returned null.
  const t = hold(initialFocus(), null, 120_000);
  assert.equal(t.state, "unknown");
  assert.equal(mayInterrupt(t), true, "with no signal, behave exactly like the normal player");
});

test("strong attention needs to be SUSTAINED before it counts as hyperfocus", () => {
  let t = hold(initialFocus(), 0.95, 30_000);
  assert.equal(t.state, "settled", "30s of high engagement is a good minute, not hyperfocus");
  assert.equal(mayInterrupt(t), true);

  t = hold(t, 0.95, 70_000); // now past the 90s dwell
  assert.equal(t.state, "hyperfocus");
});

test("hyperfocus suppresses scheduled interruptions — the whole point", () => {
  const t = hold(initialFocus(), 0.95, 120_000);
  assert.equal(t.state, "hyperfocus");
  // The comprehension check fires on a fixed beat count with no idea what it is walking into.
  // Breaking a hyperfocus run to ask "are you following?" is the worst possible moment to ask.
  assert.equal(mayInterrupt(t), false);
});

test("a real drop out of hyperfocus is a crash, and that is when a break is welcome", () => {
  let t = hold(initialFocus(), 0.95, 120_000);
  assert.equal(t.state, "hyperfocus");

  t = advanceFocus(t, 0.95 - FOCUS_THRESHOLDS.CRASH_DROP - 0.01, 1000);
  assert.equal(t.state, "crashing");
  assert.equal(shouldOfferBreak(t), true, "offer the break here, not on a fixed timer");
});

test("ordinary variation inside a run does not fake a crash", () => {
  let t = hold(initialFocus(), 0.95, 120_000);
  t = advanceFocus(t, 0.90, 1000); // a small dip
  assert.equal(t.state, "hyperfocus", "a 0.05 wobble is not a crash");
  assert.equal(shouldOfferBreak(t), false);
});

test("drifting still resolves, and the drift band matches the monitor's own threshold", () => {
  const t = hold(initialFocus(), 0.3, 10_000);
  assert.equal(t.state, "drifting");
  assert.equal(mayInterrupt(t), true, "the existing drift response owns this state");
  // Two components disagreeing about what "drifting" means is how a system contradicts itself
  // on screen; this pins them together.
  assert.equal(FOCUS_THRESHOLDS.DRIFT_AT, 0.7);
});

test("hyperfocus time is banked however the run ends", () => {
  // Ends by crashing.
  let a = hold(initialFocus(), 0.95, 180_000);
  a = advanceFocus(a, 0.5, 1000);
  assert.ok(hyperfocusMinutes(a) >= 1, "a crash must not discard the run");

  // Ends by falling all the way to a drift-level score in one sample. That still classifies as
  // "crashing", not "drifting", and deliberately so: leaving a hyperfocus run is the informative
  // event, and it is what makes the break offer fire. Reporting it as ordinary drift would send it
  // to the drift response, which pauses and nudges — the wrong reaction to someone who just
  // concentrated hard for three minutes.
  let b = hold(initialFocus(), 0.95, 180_000);
  b = advanceFocus(b, 0.2, 1000);
  assert.equal(b.state, "crashing");
  assert.ok(hyperfocusMinutes(b) >= 1, "falling out must not discard the run either");
});

test("drifting from ordinary attention is still plain drift, not a crash", () => {
  // The crash state only exists relative to a hyperfocus run. Someone who was merely settled and
  // then drifts must reach the existing drift response, untouched by any of this.
  let t = hold(initialFocus(), 0.8, 60_000);
  assert.equal(t.state, "settled");
  t = advanceFocus(t, 0.2, 1000);
  assert.equal(t.state, "drifting");
  assert.equal(shouldOfferBreak(t), false, "no run happened, so there is nothing to recover from");
});

test("a short good stretch never reports as hyperfocus time", () => {
  const t = hold(initialFocus(), 0.95, 40_000);
  assert.equal(hyperfocusMinutes(t), 0, "40s of focus is not 'you were locked in'");
});
