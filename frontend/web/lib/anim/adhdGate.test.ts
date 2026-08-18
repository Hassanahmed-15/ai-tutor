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
  // Asserted on `id`, not `page`. Both tracks now render the SAME player — ADHD deliberately uses
  // the standard lesson UI and layers its behaviour on top — so `page` no longer distinguishes them
  // and a test keyed on it would be checking an implementation detail that is expected to move.
  assert.equal(trackForProfile({ accessibility: "adhd" }).id, "adhd");

  for (const profile of [null, { accessibility: null }, { accessibility: "none" as const }, { accessibility: "deaf" as const }]) {
    assert.notEqual(trackForProfile(profile).id, "adhd", `${JSON.stringify(profile)} must not get the ADHD track`);
    assert.equal(trackForProfile(profile).id, "none", "and must land on the standard lecture");
  }
});

test("the ADHD track is reachable by profile but absent from the picker list", async () => {
  // TRACKS is what every mode-picker surface maps over. The ADHD track must NOT be in it: the
  // requirement is that it appears only for a saved adhd profile, never as something anyone can
  // select. If a future change "helpfully" adds it back, this fails.
  const { TRACKS, ADHD_TRACK } = await import("../../components/hud/tracks");
  assert.equal(ADHD_TRACK.id, "adhd", "still reachable for the resolver");
  assert.ok(!TRACKS.some((t) => t.id === "adhd"), "must not be offered in any picker");
  // And it renders the ordinary lesson: ADHD changes what happens AROUND the lecture, not how the
  // lecture itself looks. This also means the ADHD learner gets the Gemini Live tutor, which only
  // LessonPlayer wires up.
  assert.equal(ADHD_TRACK.page, "demo", "ADHD renders the standard player");
});
