/**
 * Mystery boxes — a variable-ratio reward schedule.
 *
 * REQUESTED, AND RECORDED AS A DECISION. I raised the objection and it was overruled, so this is
 * built properly rather than quietly weakened; a half-implemented mechanic is worse than either
 * choice. The objection, kept here so the next reader knows it was considered: variable-ratio
 * reinforcement is the slot-machine schedule, and ADHD brains are more susceptible to compulsive
 * loops than the general population.
 *
 * Two guards are in the design because they are standard practice and cost nothing, not as a veto:
 *
 *  - A CAP PER SESSION. Without one the schedule has no ceiling, and "one more beat for a box"
 *    stops being a study session.
 *  - NO NEAR-MISS. `roll` returns what you got and nothing else. Showing the reward you ALMOST won
 *    is the specific device that makes gambling compulsive, and it teaches nothing about the
 *    subject — so the data to render one is deliberately not produced.
 *
 * SEEDED, NOT `Math.random()`. A reward schedule sprinkled with real randomness cannot be tested,
 * and an untestable payout table is one nobody ever verifies. The generator is a small deterministic
 * PRNG so a fixed seed replays a fixed sequence.
 */

export type LootReward =
  | { kind: "coins"; amount: number }
  | { kind: "card-upgrade" }
  | { kind: "power-up"; id: "slow-mo" | "hint" | "skip" }
  | { kind: "streak-freeze" };

export type LootState = {
  /** Beats completed since the last box. The box lands on a variable target, not a fixed count. */
  since: number;
  /** Boxes opened this session, against MAX_PER_SESSION. */
  opened: number;
  /** PRNG cursor. Carried in state so the whole thing stays a pure function of (state, event). */
  seed: number;
};

export const LOOT_RULES = {
  /** A box can land no sooner than this many beats after the last one. */
  MIN_GAP: 2,
  /** …and no later than this. Between the two the timing is random — the variable ratio. */
  MAX_GAP: 5,
  /** The ceiling that stops a study session becoming a pull-the-lever session. */
  MAX_PER_SESSION: 3,
} as const;

export function initialLoot(seed = 1): LootState {
  // Seed 0 is a fixed point of the generator below and would return the same value forever, which
  // is a silent way to get an unshuffled sequence.
  return { since: 0, opened: 0, seed: seed || 1 };
}

/** Mulberry32 — small, fast, and good enough for a payout table. Returns [0,1) plus the next seed. */
function next(seed: number): { value: number; seed: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(t ^ (t >>> 15), 1 | t);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return { value, seed: t };
}

/**
 * Advance by one completed beat. Returns the new state and a reward when a box lands.
 *
 * The gap is re-rolled from the state each time rather than stored, so the caller cannot look ahead
 * and render a "next box in 2" counter — which would convert the variable schedule into a fixed one
 * and lose the only property it was chosen for.
 */
export function onBeatForLoot(prev: LootState): { state: LootState; reward: LootReward | null } {
  if (prev.opened >= LOOT_RULES.MAX_PER_SESSION) {
    return { state: { ...prev, since: prev.since + 1 }, reward: null };
  }

  const since = prev.since + 1;
  if (since < LOOT_RULES.MIN_GAP) return { state: { ...prev, since }, reward: null };

  const spread = LOOT_RULES.MAX_GAP - LOOT_RULES.MIN_GAP + 1;
  const gapRoll = next(prev.seed);
  const target = LOOT_RULES.MIN_GAP + Math.floor(gapRoll.value * spread);
  if (since < target) return { state: { ...prev, since, seed: gapRoll.seed }, reward: null };

  const rewardRoll = next(gapRoll.seed);
  return {
    state: { since: 0, opened: prev.opened + 1, seed: rewardRoll.seed },
    reward: rewardFor(rewardRoll.value),
  };
}

/**
 * The payout table. Weighted toward coins because the rarer outcomes should feel rare — but every
 * outcome is a real, useful thing. There is no "better luck next time" slot: a box that can pay
 * nothing is a box that teaches the learner the mechanic is a tax on their attention.
 */
function rewardFor(roll: number): LootReward {
  if (roll < 0.5) return { kind: "coins", amount: 10 + Math.floor(roll * 40) };
  if (roll < 0.75) return { kind: "power-up", id: roll < 0.6 ? "hint" : roll < 0.7 ? "slow-mo" : "skip" };
  if (roll < 0.92) return { kind: "card-upgrade" };
  return { kind: "streak-freeze" };
}
