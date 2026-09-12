// Relative imports, not the "@/" alias: this module is compiled into the CommonJS test build,
// where the alias has no runtime resolver and every import through it fails with MODULE_NOT_FOUND.
import type { AccessibilityProfile } from "../db/cosmos";
import { ADHD_TRACK, PLANNED_TRACKS, TRACKS, type TrackMeta } from "../../components/hud/tracks";

/**
 * The one place that decides whether a learner is on the ADHD track.
 *
 * WHY A FUNCTION AND NOT AN INLINE COMPARISON. Everything in the ADHD module hangs off this
 * question — the player choice, the score HUD, cards, the companion, loot, streaks, the leaderboard.
 * A check written out by hand in eight components is a check that eventually gets written slightly
 * differently in the ninth, and the failure mode is an XP counter appearing for someone who never
 * asked for any of it. One predicate, one meaning, one thing to change.
 *
 * IT IS CHECKED BEFORE THE WORK, NOT AFTER. A card written for a Standard learner and then hidden
 * from the UI is still a row in the database and still an RU charge on a shared free-tier account.
 * Nothing in the module should run at all unless this returns true.
 */

/** The shape both `LearnerProfile` (client) and `UserDoc["profile"]` (server) satisfy. */
type ProfileLike = { accessibility?: AccessibilityProfile | null } | null | undefined;

/**
 * True only for a learner who actively selected the ADHD profile.
 *
 * Everything else is false, deliberately including:
 *  - `null` profile — onboarding has not run, so no choice has been made yet
 *  - `"none"` — someone who actively said they need no accommodation, which is a real answer and
 *    NOT the same as "not asked yet"
 */
export function isAdhdLearner(profile: ProfileLike): boolean {
  return profile?.accessibility === "adhd";
}

/**
 * The track a learner should get, derived from their saved profile.
 *
 * Kept beside the gate rather than in the page, so the profile vocabulary (`AccessibilityProfile`)
 * and the track vocabulary (`TrackMeta`) meet in exactly one place. `LearnPage` previously hardcoded
 * `TRACKS[0]`, which is why a profile of `"adhd"` sat in Cosmos doing nothing at all.
 *
 * Deaf and dyslexia profiles route to their generated-lecture-compatible players. Blind and
 * low-vision are handled earlier by VoiceModeSwitch, and all remaining values use Standard.
 */
export function trackForProfile(profile: ProfileLike): TrackMeta {
  if (isAdhdLearner(profile)) return ADHD_TRACK;

  /**
   * Deaf and dyslexia route to their own player variants, for the same reason ADHD routes to its own layer: the
   * profile is the only thing that decides, and there is no picker.
   *
   * Kept in THIS function rather than a second one beside it. Two functions both answering "which
   * track is this learner on" is precisely the drift the note above warns about — the ninth caller
   * picks the wrong one and a learner gets the wrong lesson.
   *
   * `blind` and `low-vision` are absent on purpose: they are handled far earlier by VoiceModeSwitch
   * in app/page.tsx, which replaces the whole router rather than choosing a track.
   */
  if (profile?.accessibility === "dyslexia" || profile?.accessibility === "deaf") {
    return [...TRACKS, ...PLANNED_TRACKS].find((track) => track.id === profile.accessibility) ?? TRACKS[0];
  }

  return TRACKS[0];
}
