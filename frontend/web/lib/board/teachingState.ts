/**
 * WHERE THE TEACHER IS, AND WHAT THE BOARD SHOULD DO NEXT.
 *
 * The lecture had no model of its own teaching. A beat knew its title and its script; it did not
 * know which concept it belonged to, whether the previous beat had been part of the same idea, or
 * whether the student had already been shown what it was about to show. Two consequences, both
 * reported:
 *
 *   1. Going deeper on one sub-topic produced a NEW SLIDE each time, because "next beat" was the
 *      only move the system had. A teacher continuing an explanation does not wipe the board and
 *      start a fresh one; they keep writing underneath.
 *   2. Nothing could tell "this elaborates the last board" from "this is a different idea", so
 *      every transition was identical and the lecture read as a carousel.
 *
 * This module is the missing state. It answers, for each beat: which concept is this, is it the
 * same concept as the last one, and therefore should the board CONTINUE (slide down, previous work
 * still above), START FRESH (erase, new idea), or REFER BACK (scroll up to something already
 * taught). Board movement becomes a consequence of the teaching rather than a UI transition
 * chosen at random.
 *
 * Pure and serialisable: no React, no DOM, no model calls. The worker builds it, the player reads
 * it, the tests exercise it.
 */

import { conceptOverlap } from "../lectureDepth";

/** One idea in the lesson, which may span several boards. */
export interface Concept {
  id: string;
  title: string;
  /** What this concept teaches, from the plan. */
  objective: string;
  /** Concepts that must be understood first — used to explain "why are we here". */
  prerequisites: string[];
}

export interface TaughtBeat {
  beatId: string;
  conceptId: string;
  sequence: number;
  title: string;
  /** The sentences actually narrated, so a later beat can refer back accurately. */
  script: string;
}

/** What the board should do when this beat begins. */
export type BoardMove =
  /** A different idea: wipe and start clean. */
  | "fresh"
  /** The same idea, going deeper: keep the work and slide down to empty space. */
  | "continue"
  /** Returning to something already taught: scroll back to it. */
  | "refer-back";

export interface TeachingState {
  concepts: Concept[];
  taught: TaughtBeat[];
  /** The concept currently on the board. */
  currentConceptId: string | null;
  /** How many boards this concept has already used — the depth of the current explanation. */
  boardsInConcept: number;
}

export const EMPTY_TEACHING_STATE: TeachingState = {
  concepts: [],
  taught: [],
  currentConceptId: null,
  boardsInConcept: 0,
};

/**
 * How many screens a concept may occupy before it must move on.
 *
 * Not a style choice: the camera pans down a tall canvas, and past three screens the student can
 * no longer scroll back to the start of the idea without losing their place. A concept that needs
 * more than this is really two concepts, and the plan should have said so.
 */
export const MAX_BOARDS_PER_CONCEPT = 3;

/**
 * Decide the board's move for an incoming beat.
 *
 * The rule is deliberately conservative about CONTINUE: a board that keeps growing is only right
 * while the beat genuinely elaborates the one before it. Getting this wrong in the continue
 * direction is worse than getting it wrong in the fresh direction — a fresh board on a
 * continuation costs a transition, while continuing onto an unrelated idea leaves two unrelated
 * explanations stacked on one surface with no way to tell where one ends.
 */
export function decideBoardMove(
  state: TeachingState,
  incoming: { conceptId: string; title: string; objective: string },
): { move: BoardMove; reason: string } {
  if (!state.currentConceptId) {
    return { move: "fresh", reason: "first board of the lesson" };
  }

  if (incoming.conceptId === state.currentConceptId) {
    if (state.boardsInConcept >= MAX_BOARDS_PER_CONCEPT) {
      return {
        move: "fresh",
        reason: `this concept has already filled ${state.boardsInConcept} screens — starting clean rather than scrolling past what the student can follow`,
      };
    }
    return { move: "continue", reason: "same concept, going deeper — keep the work and slide down" };
  }

  /*
   * A different concept that the student has ALREADY been taught is a callback, not new material:
   * "remember the line of best fit" should return to that board rather than redraw it, which is
   * both what a teacher does and what stops the same content being generated twice.
   */
  const taughtConcept = state.taught.find((beat) => beat.conceptId === incoming.conceptId);
  if (taughtConcept) {
    return { move: "refer-back", reason: `returning to "${taughtConcept.title}", already taught` };
  }

  return { move: "fresh", reason: "a genuinely new concept" };
}

/** Record that a beat has been taught, advancing the state. */
export function recordTaught(state: TeachingState, beat: TaughtBeat): TeachingState {
  const sameConcept = beat.conceptId === state.currentConceptId;
  return {
    ...state,
    taught: [...state.taught.filter((t) => t.beatId !== beat.beatId), beat],
    currentConceptId: beat.conceptId,
    boardsInConcept: sameConcept ? state.boardsInConcept + 1 : 1,
  };
}

/**
 * What the student has already been told, as a brief the next beat's prompt can use.
 *
 * This is the anti-repetition input: a beat that can see the actual sentences already spoken can
 * build on them instead of re-establishing them. Capped, and weighted toward the current concept,
 * because the immediately preceding explanation is what a continuation must connect to.
 */
export function priorKnowledge(state: TeachingState, limit = 6): Array<{ title: string; gist: string }> {
  return state.taught
    .slice(-limit)
    .map((beat) => ({ title: beat.title, gist: beat.script.slice(0, 220) }));
}

/**
 * Does this beat's plan duplicate something already taught?
 *
 * Reuses the overlap detector from lib/lectureDepth.ts rather than inventing a second notion of
 * "same concept", so the planner and the runtime agree about what repetition means.
 */
export function alreadyTaught(
  state: TeachingState,
  incoming: { title: string; objective: string },
): { duplicate: boolean; of: string | null; overlap: number } {
  if (state.taught.length === 0) return { duplicate: false, of: null, overlap: 0 };
  const { overlap, with: index } = conceptOverlap(
    incoming,
    state.taught.map((beat) => ({ title: beat.title, objective: beat.script.slice(0, 200) })),
  );
  return {
    duplicate: overlap > 0.55,
    of: index >= 0 ? state.taught[index].title : null,
    overlap,
  };
}
