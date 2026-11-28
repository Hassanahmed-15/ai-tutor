import { test } from "node:test";
import assert from "node:assert/strict";
import { inSolvingOrder, rowLetters, solvedLetter } from "../canvas/stepOrder";
import { givensFirst } from "../canvas/equationRepair";
import { layoutPanel } from "../canvas/layout";
import type { CanvasBoardSpec, EquationStage } from "../canvas/types";

// The saved "Recognizing Solution Types" board (QA 2026-11-28): the answer was the first of its sentence's steps.
const tokens = [
  ["l", "2x + 3"], ["e1", "="], ["r", "9"], ["m", "2x"], ["e2", "="], ["six", "6"], ["x", "x"], ["e3", "="], ["three", "3"],
  ["il", "2x + 4"], ["ie", "="], ["ir", "2(x + 2)"],
].map(([id, text]) => ({ id, text }));
const stage = (steps: EquationStage["steps"]): EquationStage => ({ kind: "equation", tokens, steps } as EquationStage);
const lines = (st: EquationStage) => st.steps.map((s) => s.order.map((id) => tokens.find((t) => t.id === id)!.text).join(" "));

test("the answer goes under the working of its sentence that reaches it", () => {
  const out = inSolvingOrder(stage([
    { s: 1, order: ["x", "e3", "three"], highlight: [], caption: "Divide by 2: x = 3" },
    { s: 1, order: ["l", "e1", "r"], highlight: [], caption: "Start with 2x + 3 = 9" },
    { s: 1, order: ["m", "e2", "six"], highlight: [], caption: "Subtract 3: 2x = 6" },
    { s: 2, order: ["il", "ie", "ir"], highlight: [] },
  ]));
  assert.deepEqual(lines(out), ["2x + 3 = 9", "2x = 6", "x = 3", "2x + 4 = 2(x + 2)"]);
});

test("a step captioned as the start goes first; other sentences never swap", () => {
  const out = inSolvingOrder(stage([
    { s: 0, order: ["il", "ie", "ir"], highlight: [] },
    { s: 1, order: ["m", "e2", "six"], highlight: [], caption: "Subtract 3" },
    { s: 1, order: ["l", "e1", "r"], highlight: [], caption: "Start with 2x + 3 = 9" },
    { s: 2, order: ["x", "e3", "three"], highlight: [] },
  ]));
  assert.deepEqual(lines(out), ["2x + 4 = 2(x + 2)", "2x + 3 = 9", "2x = 6", "x = 3"]);
});

test("working already in order is the same stage back; a step's times stay in order when steps move", () => {
  const ok = stage([{ s: 1, order: ["l", "e1", "r"], highlight: [] }, { s: 1, order: ["m", "e2", "six"], highlight: [] }, { s: 1, order: ["x", "e3", "three"], highlight: [] }]);
  assert.equal(inSolvingOrder(ok), ok);
  const timed = inSolvingOrder(stage([{ s: 1, at: 0.2, order: ["x", "e3", "three"], highlight: [] }, { s: 1, at: 0.5, order: ["l", "e1", "r"], highlight: [] }, { s: 1, at: 0.8, order: ["m", "e2", "six"], highlight: [] }]));
  assert.deepEqual(timed.steps.map((s) => s.at), [0.2, 0.5, 0.8]);
  assert.deepEqual(lines(timed), ["2x + 3 = 9", "2x = 6", "x = 3"]);
});

test("a given used by a line about something else is not taken for an answer", () => {
  // "a = 7" then "y = 2a + 1": y is another unknown, so a = 7 is a given and stays where the writer put it.
  const t = [["a", "a"], ["eq", "="], ["7", "7"], ["y", "y"], ["eq2", "="], ["f", "2a + 1"]].map(([id, text]) => ({ id, text }));
  const st = { kind: "equation", tokens: t, steps: [{ s: 0, order: ["a", "eq", "7"], highlight: [] }, { s: 0, order: ["y", "eq2", "f"], highlight: [] }] } as EquationStage;
  assert.equal(inSolvingOrder(st), st);
  assert.equal(rowLetters("y = 2a + 1")?.size, 2);
  assert.equal(rowLetters("Opportunity cost = 40"), null);
  assert.equal(solvedLetter("x = −2.5"), "x");
  assert.equal(solvedLetter("2x = 6"), null);
});

test("the given-first repair no longer lifts an answer above its own working", () => {
  const st = stage([{ s: 1, order: ["l", "e1", "r"], highlight: [] }, { s: 1, order: ["m", "e2", "six"], highlight: [] }, { s: 1, order: ["x", "e3", "three"], highlight: [] }]);
  assert.equal(givensFirst(st), 0);
  assert.deepEqual(lines(st), ["2x + 3 = 9", "2x = 6", "x = 3"]);
});

test("a saved board is drawn in solving order: the answer's line is the lowest", () => {
  const spec = { v: 1, heading: "Solution types", notes: [], cues: [], stage: stage([
    { s: 1, order: ["x", "e3", "three"], highlight: [] },
    { s: 1, order: ["l", "e1", "r"], highlight: [] },
    { s: 1, order: ["m", "e2", "six"], highlight: [] },
  ]) } as unknown as CanvasBoardSpec;
  const y = (id: string) => {
    for (const m of layoutPanel(spec).marks) if (m.type === "equation") for (const st of m.steps) if (st.place[id]) return st.place[id].y;
    return NaN;
  };
  assert.ok(y("l") < y("m") && y("m") < y("x"), `rows at ${y("l")}, ${y("m")}, ${y("x")}`);
});
