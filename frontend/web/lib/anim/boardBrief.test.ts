/**
 * A board is briefed on what the student hears and reads — never on the tutor's stage directions or
 * the planner's objective. The first case is the real beat that shipped a blank board.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { boardBriefFor, firstSentences, pointsFromScript } from "../boardBrief";
import { hasUsableBoard } from "../boardFallback";
import type { Beat } from "../lessonContent";

// From the database: beat 1 of "1857 war", as it was generated.
const TEACHER_MOVE = "Engage the student with a vivid example to spark curiosity.";
const OBJECTIVE = "Open with a concrete puzzle or use case that makes 1857 War worth learning.";
const SCRIPT =
  "Imagine a group of people feeling oppressed and wanting to reclaim their freedom. This is what happened in India in 1857. " +
  "The 1857 War, also known as the Indian Rebellion, was a significant uprising against British rule. It began among the sepoys " +
  "and spread to peasants and princes across the north.";

test("the 1857 War board is briefed on the rebellion, not on 'spark curiosity'", () => {
  // The model gave no points, so the board's points now come from the script — not the objective.
  const points = pointsFromScript(SCRIPT);
  const brief = boardBriefFor({ title: "1857 War", script: SCRIPT, points });
  assert.match(brief, /1857 War/);
  assert.match(brief, /Indian Rebellion|British rule|oppressed/);
  for (const stageDirection of ["spark curiosity", "Engage the student", "Open with a concrete puzzle", "worth learning"]) {
    assert.ok(!brief.includes(stageDirection), `the brief must not contain "${stageDirection}"`);
  }
  // Even handed a beat that still carries the stage directions, the brief does not read them.
  const beatWithDirections = { title: "1857 War", script: SCRIPT, points, teacherMove: TEACHER_MOVE, conceptObjective: OBJECTIVE };
  assert.ok(!boardBriefFor(beatWithDirections).includes("spark curiosity"));
});

test("the board's points fall back to what the student hears, and never to nothing but a half-word", () => {
  const points = pointsFromScript(SCRIPT);
  assert.equal(points.length, 3);
  assert.equal(points[0], "Imagine a group of people feeling oppressed and wanting to reclaim their freedom.");
  for (const point of points) {
    assert.ok(point.length <= 110, `"${point}" is longer than a board line`);
    // Shortened only at a word boundary.
    assert.ok(!/\w…$/.test(point) || / \S+…$/.test(point), `"${point}" was cut mid-word`);
  }
  // No script, no points — an empty board beats the tutor's instructions printed on it.
  assert.deepEqual(pointsFromScript(undefined), []);
  assert.deepEqual(pointsFromScript("   "), []);
});

test("a definition, the points and the opening of the script all reach the brief, capped", () => {
  const brief = boardBriefFor({
    title: "The Doctrine of Lapse",
    definitionTerm: "Doctrine of Lapse",
    definitionMeaning: "a rule letting the Company annex a state whose ruler died without a natural heir",
    points: ["Satara annexed in 1848", "Jhansi annexed in 1854"],
    script: "Dalhousie used one rule again and again. " + "It turned grief into annexation. ".repeat(40),
  });
  assert.match(brief, /Doctrine of Lapse: a rule letting the Company annex/);
  assert.match(brief, /Satara annexed in 1848\. Jhansi annexed in 1854\./);
  assert.match(brief, /Dalhousie used one rule again and again\./);
  assert.ok(brief.length <= 700, `brief is ${brief.length} characters`);
});

test("sentences split on real sentence ends, keeping closing quotes", () => {
  assert.deepEqual(firstSentences('He said "enough." Then the revolt began! Why?', 3), ['He said "enough."', "Then the revolt began!", "Why?"]);
  assert.deepEqual(firstSentences("no ending at all", 2), ["no ending at all"]);
  assert.deepEqual(firstSentences("", 2), []);
});

test("a board whose generator failed is not usable — so it is rescued, not published blank", () => {
  // What enrichBeat holds after a refused animation: the placeholder op, with no code.
  const refused = {
    id: "beat-1", title: "1857 War", slideKind: "intro", points: [], script: SCRIPT,
    draw: { caption: "1857 War", durationMs: 45_000, surface: "paper", ops: [{ kind: "reactAnimation", teachingPoint: "…", at: 0, endAt: 1, status: "failed" }] },
  } as unknown as Beat;
  assert.equal(hasUsableBoard(refused), false);
  // Once a written board is filled in its place, it is.
  const rescued = {
    ...refused,
    draw: { ...refused.draw, ops: [{ kind: "chalkBoard", boardBrief: "…", ops: [{ kind: "label", text: "1857", x: 50, y: 20 }], at: 0, endAt: 1 }] },
  } as unknown as Beat;
  assert.equal(hasUsableBoard(rescued), true);
});
