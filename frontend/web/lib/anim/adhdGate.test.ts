import test from "node:test";
import assert from "node:assert/strict";

import { isAdhdLearner, trackForProfile } from "../adhd/gate";

/**
 * The gate decides whether a learner sees ANY of the ADHD module — the player, the score HUD, cards,
 * the companion, loot, streaks, the leaderboard. The interesting failure is not "an ADHD learner got
 * nothing"; it is "everyone else got ADHD UI they never asked for". So both directions are asserted.
 */

test("only an explicit adhd profile opens the gate", () => {
  assert.equal(isAdhdLearner({ accessibility: "adhd" }), true);
});

test("every other profile value is closed, including the ones that look empty", () => {
  // `null` is "onboarding has not run", and "none" is someone who actively said they need no
  // accommodation. Both are real answers and neither is a request for the ADHD track.
  for (const profile of [
    null,
    undefined,
    {},
    { accessibility: null },
    { accessibility: "none" as const },
    { accessibility: "blind" as const },
    { accessibility: "low-vision" as const },
    { accessibility: "dyslexia" as const },
    { accessibility: "deaf" as const },
  ]) {
    assert.equal(isAdhdLearner(profile), false, `${JSON.stringify(profile)} must not open the gate`);
  }
});

test("the resolver sends adhd to the ADHD track and everyone else to Standard", () => {
  assert.equal(trackForProfile({ accessibility: "adhd" }).page, "adhd-demo");

  for (const profile of [null, { accessibility: null }, { accessibility: "none" as const }, { accessibility: "deaf" as const }]) {
    const track = trackForProfile(profile);
    assert.notEqual(track.page, "adhd-demo", `${JSON.stringify(profile)} must not reach the ADHD player`);
    assert.equal(track.page, "demo", "and must land on the standard lecture");
  }
});

test("the ADHD track is reachable by profile but absent from the picker list", async () => {
  // TRACKS is what every mode-picker surface maps over. The ADHD track must NOT be in it: the
  // requirement is that it appears only for a saved adhd profile, never as something anyone can
  // select. If a future change "helpfully" adds it back, this fails.
  const { TRACKS, ADHD_TRACK } = await import("../../components/hud/tracks");
  assert.equal(ADHD_TRACK.page, "adhd-demo", "still reachable for the resolver");
  assert.ok(!TRACKS.some((t) => t.page === "adhd-demo"), "must not be offered in any picker");
});
