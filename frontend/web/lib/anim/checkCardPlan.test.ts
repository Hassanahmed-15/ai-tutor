import test from "node:test";
import assert from "node:assert/strict";
import { checkCardBoards, spaceCheckCards } from "../canvas/checkCardPlan";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../canvas/types";

/* Question cards about every third board, at most three, none in strict (owner, 2026-10-16). */

const board = (over: Partial<CanvasPlanBeat> = {}) => ({ title: "b", script: "s", stage: "flow", objects: [], interaction: null, overview: false, ...over }) as unknown as CanvasPlanBeat;
const plan = (n: number, at: Record<number, Partial<CanvasPlanBeat>> = {}) => Array.from({ length: n }, (_, i) => board(at[i]));
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

test("every third teaching board gets a card, never more than three", () => {
  assert.deepEqual(sorted(checkCardBoards(plan(9), false)), [2, 5, 8]);
  assert.deepEqual(sorted(checkCardBoards(plan(6), false)), [2, 5]);
  assert.deepEqual(sorted(checkCardBoards(plan(14), false)), [2, 5, 8], "capped at three");
  assert.deepEqual(sorted(checkCardBoards(plan(2), false)), [], "a one- or two-board answer gets none");
  assert.deepEqual(sorted(checkCardBoards(plan(9), true)), [], "a strict PDF lesson gets none");
});

test("refreshers, recap overviews and exam boards are not counted; a hands-on board resets the count", () => {
  // A refresher first: the cards follow the 3rd and 6th TEACHING boards.
  assert.deepEqual(sorted(checkCardBoards(plan(7, { 0: { refresher: true } }), false)), [3, 6]);
  assert.deepEqual(sorted(checkCardBoards(plan(7, { 6: { overview: true } }), false)), [2, 5]);
  assert.deepEqual(sorted(checkCardBoards(plan(7, { 2: { stage: "exam" as CanvasPlanBeat["stage"] } }), false)), [3, 6]);
  // A slider on board 3 is its own activity: the next card waits three boards after it.
  assert.deepEqual(sorted(checkCardBoards(plan(9, { 2: { interaction: "try" } }), false)), [5, 8]);
});

test("a lecture written with a card on every board shows at most three, at least two boards apart", () => {
  const card = { kind: "quiz" as const, question: "q", check: true, options: [{ text: "a", correct: true, feedback: "f" }, { text: "b", correct: false, feedback: "g" }, { text: "c", correct: false, feedback: "h" }] };
  const spec = (withCard: boolean) => ({ heading: "h", ...(withCard ? { interaction: card } : {}) }) as unknown as CanvasBoardSpec;
  const panels = Array.from({ length: 12 }, (_, i) => ({ key: `b${i}`, spec: spec(true) }));
  const kept = spaceCheckCards(panels).map((p, i) => (p.spec.interaction ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(kept, [2, 5, 8]);
  // A lecture already spaced is left as it is.
  const spaced = Array.from({ length: 9 }, (_, i) => ({ key: `b${i}`, spec: spec(i === 2 || i === 5 || i === 8) }));
  assert.deepEqual(spaceCheckCards(spaced).map((p) => Boolean(p.spec.interaction)), spaced.map((p) => Boolean(p.spec.interaction)));
});
