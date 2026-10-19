import test from "node:test";
import assert from "node:assert/strict";
import { diveCandidate, parseDives, withDives } from "../canvas/cardDives";
import type { CanvasPlanBeat } from "../canvas/types";

/*
 * CARD DIVES (lib/canvas/cardDives.ts, owner 2026-10-19): a board of cards becomes a tour that names
 * each card, then one close-up board "inside" every card, so the camera dives into the card being
 * explained.
 */
const beat = (over: Partial<CanvasPlanBeat> = {}): CanvasPlanBeat => ({
  id: "b2", title: "How a bill becomes law", script: "A bill passes stages. First reading introduces it. Second reading debates it.", stage: "flow",
  brief: "the stages", objects: ["first-reading", "second-reading"], inside: null, carry: [], interaction: null, overview: false, ...over,
});
const answer = {
  tour: "A bill passes through stages in Parliament. The first reading introduces the bill. The second reading debates its main idea.",
  tourBoard: [{ s: 1, text: "first reading: introduced" }],
  dives: [
    { object: "first-reading", title: "First reading", script: "The first reading is the bill's formal start. Its title is read aloud. There is no debate yet. It is then printed for MPs.", stage: "flow", brief: "title read, printed", objects: ["title"], board: [{ s: 0, text: "formal start" }] },
    { object: "second-reading", title: "Second reading", script: "The second reading debates the bill's principles. MPs argue for and against. Then they vote. A lost vote ends the bill.", stage: "compare", brief: "for vs against", objects: ["for", "against"], board: [] },
  ],
};

test("a board of two to four named cards is a dive candidate; a recap, a close-up or a code board is not", () => {
  assert.equal(diveCandidate(beat()), true);
  assert.equal(diveCandidate(beat({ stage: "scene" })), true);
  assert.equal(diveCandidate(beat({ stage: "code" })), false);
  assert.equal(diveCandidate(beat({ objects: ["one"] })), false);
  assert.equal(diveCandidate(beat({ overview: true })), false);
  assert.equal(diveCandidate(beat({ inside: { beat: "b1", object: "x" } })), false);
});

test("an answer is used only when the tour names every card and each card has a real close-up", () => {
  assert.ok(parseDives(beat(), answer));
  assert.equal(parseDives(beat(), { ...answer, tour: "A bill passes through stages. Then it is law." }), null, "the tour must name each card");
  assert.equal(parseDives(beat(), { ...answer, dives: answer.dives.slice(0, 1) }), null, "one close-up per card");
  assert.equal(parseDives(beat(), { ...answer, dives: [answer.dives[0], { ...answer.dives[1], script: "Too short. Two." }] }), null);
  assert.equal(parseDives(beat(), { ...answer, dives: [{ ...answer.dives[0], stage: "illustration" }, answer.dives[1]] })!.dives[0].stage, "scene", "no picture stage: a dive never waits on one");
});

test("close-ups follow their board, each inside its card, and every id is renumbered", () => {
  const plan = [beat({ id: "b1", objects: ["parliament"], stage: "illustration" }), beat(), beat({ id: "b3", title: "Royal assent" })];
  const out = withDives(plan, new Map([["b2", parseDives(beat(), answer)!]]));
  assert.deepEqual(out.map((b) => b.id), ["b1", "b2", "b3", "b4", "b5"]);
  assert.equal(out[1].script, answer.tour);
  assert.deepEqual(out[2].inside, { beat: "b2", object: "first-reading" });
  assert.deepEqual(out[3].inside, { beat: "b2", object: "second-reading" });
  assert.equal(out[3].stage, "compare");
  assert.equal(out[3].visualType, "comparison");
  assert.equal(out[4].title, "Royal assent");
  assert.equal(out[1].teachingCycle, undefined, "the tour's sentence plan is new");
});

test("a close-up titled with its object's id is titled in words (live run, 2026-10-19)", () => {
  const parsed = parseDives(beat(), { ...answer, dives: [{ ...answer.dives[0], title: "first-reading" }, answer.dives[1]] })!;
  assert.equal(parsed.dives[0].title, "First reading");
});

test("close-ups are marked as dives, and no check card is put on one", async () => {
  const { checkCardBoards } = await import("../canvas/checkCardPlan");
  const plan = withDives([beat({ id: "b1" }), beat({ id: "b2", objects: ["x"] }), beat({ id: "b3", objects: ["x"] }), beat({ id: "b4", objects: ["x"] })], new Map([["b1", parseDives(beat({ id: "b1" }), answer)!]]));
  assert.deepEqual(plan.map((b) => Boolean(b.dive)), [false, true, true, false, false, false]);
  const cards = [...checkCardBoards(plan, false)];
  assert.ok(cards.every((i) => !plan[i].dive), `cards on ${cards.join(",")}`);
  assert.deepEqual(cards, [4], "the 3rd teaching board, counting past the close-ups");
});
