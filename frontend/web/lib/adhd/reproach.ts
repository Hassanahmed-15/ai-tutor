/**
 * What Aria says when she reacts, and how long she holds the face.
 *
 * A pure function of `(reaction, skippedSoFar, seed)`, for the same reason `score.ts` and
 * `focusState.ts` are pure: escalation is a rule, and a rule you cannot check without sitting
 * through a lecture and skipping five beats is a rule nobody ever checks.
 *
 * ON THE TONE. The skip reaction in this track was deliberately mild — for a learner with rejection
 * sensitive dysphoria a visibly disappointed teacher is the thing that ends sessions, not a nudge
 * that restarts them. A cross teacher was asked for explicitly, so that is what this writes, and the
 * reasoning is recorded rather than deleted because it is what to re-read if the track ever starts
 * feeling punishing.
 *
 * Two properties are kept deliberately, and they are what separate a reaction from a verdict:
 *
 *  - IT ENDS. `HOLD_MS` is finite for every reaction. Twelve seconds is being told off; a face that
 *    never resets is a standing judgement.
 *  - IT IS ABOUT THE SKIP, NOT THE LEARNER. Every line names the thing that happened ("that part",
 *    "the question"). None of them says what the learner *is*.
 */

export type Reaction = "correct" | "skipped" | "unanswered";

/**
 * How long the face and the line stay up, per reaction.
 *
 * This was one flat 2200ms for everything, which meant the furious face was gone before it
 * registered. Praise can be brief — the learner already knows they got it right. Being told off
 * needs long enough to actually land.
 */
export const HOLD_MS: Record<Reaction, number> = {
  correct: 2200,
  unanswered: 7000,
  /**
   * Long, deliberately. The brief is that she STAYS cross rather than flickering, and at 9s a
   * screenshot taken a second late already caught her recovered — if a test can barely observe it,
   * a learner glancing away has no chance.
   */
  skipped: 12_000,
};

/**
 * Lines by reaction, escalating with how many beats have been skipped this session.
 *
 * Tier 0 is a first offence and stays light. Tier 2 is the fifth-plus and is genuinely cross. The
 * escalation exists so the reaction means something: a teacher equally furious about the first skip
 * and the tenth is just noise, and noise gets tuned out — which for this track is the failure mode
 * that matters, not the tone.
 */
const LINES: Record<Reaction, string[][]> = {
  skipped: [
    [
      "Hey — I was still explaining that.",
      "You skipped that one. I had a good bit coming up, you know.",
      "Skipping already? That part mattered.",
    ],
    [
      "That is twice now. I am genuinely disappointed — we were getting somewhere.",
      "Again? I am not thrilled about this. That part was doing real work.",
      "You skipped another one. This is starting to annoy me, I will be honest.",
    ],
    [
      "Right, I am angry now. You have skipped half of what I prepared.",
      "I am properly cross. I cannot teach you a thing you keep skipping past.",
      "No. I am disappointed, and I am saying so. Sit with this one.",
    ],
  ],
  unanswered: [
    [
      "You left that question. I would rather a wrong answer than no answer.",
      "No answer? Have a guess next time — wrong costs you nothing here.",
      "You skipped past the question. Guessing is allowed, you know.",
    ],
  ],
  correct: [
    [
      "There it is. Well done.",
      "Yes! Exactly that.",
      "Good. You have got it.",
    ],
  ],
};

/** Which escalation tier a skip count falls in. Non-skip reactions have a single tier. */
function tierFor(reaction: Reaction, skipped: number): number {
  if (reaction !== "skipped") return 0;
  if (skipped >= 5) return 2;
  if (skipped >= 2) return 1;
  return 0;
}

/**
 * Pick a line. `seed` rotates within a tier so the same sentence does not repeat verbatim — a
 * character that says one fixed string stops being a character the second time you hear it.
 *
 * Seeded rather than random so a test can assert on an exact line, and so the escalation is
 * checkable independently of which variant came up.
 */
export function lineFor(reaction: Reaction, skipped: number, seed: number): string {
  const tiers = LINES[reaction];
  const tier = tiers[Math.min(tierFor(reaction, skipped), tiers.length - 1)];
  // `Math.abs` because a negative seed would index off the front of the array and yield undefined.
  return tier[Math.abs(Math.trunc(seed)) % tier.length];
}

/** How long this reaction should stay on screen. */
export function holdFor(reaction: Reaction): number {
  return HOLD_MS[reaction];
}
