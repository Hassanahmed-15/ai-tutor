import test from "node:test";
import assert from "node:assert/strict";
import { isMathsTopic, predictCardFor } from "../canvas/predictCard";
import type { CanvasBoardSpec, CodeStage, EquationStage } from "../canvas/types";

const board = (stage: CodeStage | EquationStage, extra: Partial<CanvasBoardSpec> = {}): CanvasBoardSpec => ({ v: 1, heading: "Board", notes: [], stage, cues: [], ...extra }) as CanvasBoardSpec;

const loop: CodeStage = {
  kind: "code",
  language: "python",
  lines: ["total = 0", "for n in range(1, 4):", "    total = total + n", "print(total)"],
  steps: [
    { s: 0, lines: [1], state: [{ name: "total", value: "0" }] },
    { s: 1, lines: [2, 3], state: [{ name: "total", value: "1" }, { name: "n", value: "1" }] },
    { s: 2, lines: [2, 3], state: [{ name: "total", value: "3" }, { name: "n", value: "2" }] },
    { s: 3, lines: [2, 3], state: [{ name: "total", value: "6" }, { name: "n", value: "3" }] },
    { s: 4, lines: [4], state: [{ name: "total", value: "6" }, { name: "n", value: "3" }] },
  ],
};

test("a code board asks what a variable holds after a step, held before the sentence that shows it", () => {
  const p = predictCardFor(board(loop), "For loops in Python");
  assert.ok(p);
  const right = p.card.options.filter((o) => o.correct);
  assert.equal(right.length, 1);
  assert.ok(p.card.options.length >= 3 && p.card.options.length <= 4);
  assert.equal(new Set(p.card.options.map((o) => o.text)).size, p.card.options.length, "no duplicate options");
  // The answer is the state of the step revealed at sentence `at`.
  const step = loop.steps.find((st) => st.s === p.at)!;
  assert.ok(step.state!.some((v) => v.value === right[0].text && p.card.question.includes(v.name)));
  assert.ok(p.at >= 1);
  assert.equal(p.card.check, true);
});

test("a value the trace table already printed before the reveal is not asked", () => {
  const traced: CodeStage = { ...loop, trace: { vars: ["n", "total"], rows: [{ s: 0, values: ["1", "1"] }, { s: 1, values: ["2", "3"] }, { s: 1, values: ["3", "6"] }] } };
  const p = predictCardFor(board(traced), "loops");
  if (p) {
    const right = p.card.options.find((o) => o.correct)!.text;
    assert.ok(!["1", "3", "6"].includes(right) || p.card.question.includes(" n "), `asked a value the trace shows early: ${right}`);
  }
});

test("a board with its own mid-board task keeps it; a plain code board with too few steps gets nothing", () => {
  const withTry = board(loop, { interaction: { kind: "try", prompt: "x", controls: [], reactions: [] } as never });
  assert.equal(predictCardFor(withTry, "loops"), null);
  assert.equal(predictCardFor(board({ ...loop, steps: loop.steps.slice(0, 2) }), "loops"), null);
});

const solve: EquationStage = {
  kind: "equation",
  tokens: [
    { id: "a", text: "2x" }, { id: "p", text: "+" }, { id: "b", text: "3" }, { id: "e", text: "=" }, { id: "c", text: "11" },
    { id: "d", text: "8" }, { id: "x", text: "x" }, { id: "f", text: "4" },
  ],
  steps: [
    { s: 0, order: ["a", "p", "b", "e", "c"] },
    { s: 1, order: ["a", "e", "d"] },
    { s: 2, order: ["x", "e", "f"] },
  ],
};

test("a maths equation board that solves for x asks for x before its last line", () => {
  const p = predictCardFor(board(solve), "Solving linear equations");
  assert.ok(p);
  assert.equal(p.at, 2);
  const texts = p.card.options.map((o) => o.text);
  assert.ok(texts.includes("x = 4") && texts.includes("x = −4") && texts.includes("x = 8"), texts.join(" | "));
  assert.equal(p.card.options.find((o) => o.correct)!.text, "x = 4");
});

test("equation boards outside maths (physics, chemistry) get no prediction", () => {
  assert.equal(predictCardFor(board(solve), "Newton's second law: force and acceleration"), null);
  assert.equal(predictCardFor(board(solve), "Balancing chemical equations"), null);
  assert.equal(isMathsTopic("Completing the square"), true);
  assert.equal(isMathsTopic("Solving quadratic equations"), true);
});

test("history and biology boards never get one", () => {
  const scene = { v: 1, heading: "Causes", notes: [], stage: { kind: "flow", nodes: [], arrows: [] }, cues: [] } as unknown as CanvasBoardSpec;
  assert.equal(predictCardFor(scene, "Fall of the Roman Empire"), null);
});

test("the question names the line that changes the variable, not the loop's condition line", () => {
  const w: CodeStage = {
    kind: "code",
    language: "python",
    lines: ["steps_left = 3", "while steps_left > 0:", "    steps_left -= 1", 'print("Done")'],
    steps: [
      { s: 0, lines: [1], state: [{ name: "steps_left", value: "3" }] },
      { s: 1, lines: [2, 3], state: [{ name: "steps_left", value: "2" }] },
      { s: 2, lines: [2, 3], state: [{ name: "steps_left", value: "1" }] },
      { s: 3, lines: [2, 3], state: [{ name: "steps_left", value: "0" }] },
    ],
  };
  const p = predictCardFor(board(w), "While loops");
  assert.ok(p);
  assert.match(p.card.question, /after line 3 \(steps_left -= 1\) runs/);
});

test("a Pythagoras answer line with working and a unit ('c = √100 = 10 cm') is predicted, with the classic slips", () => {
  const eq: EquationStage = {
    kind: "equation",
    tokens: [
      { id: "c2", text: "c²" }, { id: "eq", text: "=" }, { id: "s", text: "6² + 8²" }, { id: "eq2", text: "=" }, { id: "n", text: "36 + 64" }, { id: "eq3", text: "=" }, { id: "h", text: "100" },
      { id: "c", text: "c" }, { id: "r", text: "√100" }, { id: "ten", text: "10 cm" },
    ],
    steps: [
      { s: 2, order: ["c2", "eq", "s", "eq2", "n", "eq3", "h"] },
      { s: 3, order: ["c", "eq", "r", "eq2", "ten"] },
    ],
  };
  const p = predictCardFor(board(eq), "Pythagoras' theorem: finding a missing side");
  assert.ok(p);
  const texts = p.card.options.map((o) => o.text);
  assert.equal(p.card.options.find((o) => o.correct)!.text, "c = 10 cm");
  assert.ok(texts.includes("c = 100 cm"), "the forgot-to-square-root slip is offered");
  assert.ok(!texts.some((t) => t.includes("−")), "no negative length");
});
