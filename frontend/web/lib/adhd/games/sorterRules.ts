/**
 * Sorting Run — every rule the game plays by, with no Phaser anywhere in this file.
 *
 * WHY THE RULES LIVE OUTSIDE THE ENGINE. A canvas game keeps its state inside a render loop, which
 * makes it exactly the kind of code nobody can test: to check that a combo breaks on a miss you
 * would have to drive a real Phaser scene, at real speed, and read a number out of a canvas. So the
 * loop owns pixels and this owns rules, and the whole scoring model is a pure `(state, event)`
 * reducer — the same split `score.ts` and `focusState.ts` already use.
 *
 * THE PENALTY IS A LIFE, NEVER XP. A missed item costs a life; a wrong bin breaks the combo. Neither
 * subtracts points already earned, because the rule the rest of this track enforces is that the cost
 * lands on DISENGAGING (skipping, quitting), never on being bad at the thing you are learning. A
 * game that takes points away for a wrong catch teaches the learner to stop reaching for the hard
 * ones, which is the opposite of what a practice loop is for.
 */

export type SorterState = {
  /** Points this run. Never decreases. */
  score: number;
  /** Correct catches in a row. Drives the multiplier and resets on any mistake. */
  combo: number;
  /** Best combo this run — what the end card brags about. */
  bestCombo: number;
  lives: number;
  /** Items resolved (caught or missed), which drives the speed ramp. */
  resolved: number;
  correct: number;
  wrong: number;
  missed: number;
  over: boolean;
};

export type SorterEvent =
  /** An item landed in a bin. `right` is whether it was the correct one. */
  | { type: "catch"; right: boolean }
  /** An item fell past the paddle. */
  | { type: "miss" }
  /** No items left to drop — the run ended by completion rather than by failure. */
  | { type: "cleared" };

export const SORTER_RULES = {
  LIVES: 3,
  /** Base points for a correct catch, before the combo multiplier. */
  CATCH_POINTS: 10,
  /** Each unbroken catch adds this to the multiplier: 3 in a row is 1.6x. */
  COMBO_STEP: 0.2,
  COMBO_MAX: 3,
  /** Pixels/second the items start falling at. */
  BASE_SPEED: 90,
  /** Added per item resolved, so the run tightens as it goes. */
  SPEED_RAMP: 5,
  /** …and never past this, or the game stops being playable rather than becoming hard. */
  MAX_SPEED: 260,
} as const;

export function initialSorter(): SorterState {
  return {
    score: 0, combo: 0, bestCombo: 0, lives: SORTER_RULES.LIVES,
    resolved: 0, correct: 0, wrong: 0, missed: 0, over: false,
  };
}

/** The live multiplier. 1.0 with no combo, capped so a long run cannot run away with the score. */
export function comboMultiplier(s: SorterState): number {
  return Math.min(SORTER_RULES.COMBO_MAX, 1 + s.combo * SORTER_RULES.COMBO_STEP);
}

/** How fast items should fall right now. Ramps with progress, then flattens. */
export function fallSpeed(s: SorterState): number {
  return Math.min(SORTER_RULES.MAX_SPEED, SORTER_RULES.BASE_SPEED + s.resolved * SORTER_RULES.SPEED_RAMP);
}

export function applySorter(prev: SorterState, event: SorterEvent): SorterState {
  // Once the run is over nothing can change it. Without this, an item already in flight when the
  // last life went could still land and score after the end card was showing.
  if (prev.over) return prev;

  switch (event.type) {
    case "catch": {
      if (!event.right) {
        // A wrong bin breaks the combo and costs a life — but never a point.
        const lives = prev.lives - 1;
        return {
          ...prev, combo: 0, lives, wrong: prev.wrong + 1,
          resolved: prev.resolved + 1, over: lives <= 0,
        };
      }
      // The multiplier in force is the one earned BEFORE this catch, so the first catch of a run
      // pays 1.0x rather than retroactively crediting the streak it just started.
      const gained = Math.round(SORTER_RULES.CATCH_POINTS * comboMultiplier(prev));
      const combo = prev.combo + 1;
      return {
        ...prev,
        score: prev.score + gained,
        combo,
        bestCombo: Math.max(prev.bestCombo, combo),
        correct: prev.correct + 1,
        resolved: prev.resolved + 1,
      };
    }

    case "miss": {
      const lives = prev.lives - 1;
      return {
        ...prev, combo: 0, lives, missed: prev.missed + 1,
        resolved: prev.resolved + 1, over: lives <= 0,
      };
    }

    case "cleared":
      return { ...prev, over: true };
  }
}

/** Convenience for reducing a whole run — used heavily by the tests. */
export function applyAllSorter(prev: SorterState, events: SorterEvent[]): SorterState {
  return events.reduce(applySorter, prev);
}

/**
 * Did the learner do well enough for this round to count as passed?
 *
 * Deliberately generous: surviving with any lives left, or getting most of them right, counts. The
 * round feeds `answer-correct` into the lesson score, and the bar for "you engaged with this" should
 * not be the bar for "you were flawless".
 */
export function sorterPassed(s: SorterState): boolean {
  return s.lives > 0 && s.correct > s.wrong;
}
