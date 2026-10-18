import test from "node:test";
import assert from "node:assert/strict";
import { equationTerms, malformedRow, repairEquationRows, writtenEquations } from "../canvas/equationRepair";
import { validateCanvasSpec } from "../canvas/validate";
import type { EquationStage } from "../canvas/types";

/* The broken rows of the prompt bench's 2026-10-18 run, exactly as they shipped. */

const rowText = (stage: EquationStage, i: number) => stage.steps[i].order.map((id) => stage.tokens.find((t) => t.id === id)?.text).join(" ");
const stageOf = (tokens: Array<[string, string]>, steps: Array<{ s: number; order: string[]; caption?: string }>): EquationStage => ({
  kind: "equation",
  tokens: tokens.map(([id, text]) => ({ id, text, tex: text })),
  steps: steps.map((st) => ({ ...st, highlight: [] })),
});

test("terms split at the top level only", () => {
  assert.deepEqual(equationTerms("2 kg × 3 m/s² = 6 N"), ["2 kg", "×", "3 m/s²", "=", "6 N"]);
  assert.deepEqual(equationTerms("(−2)(−3) = 6"), ["(−2)(−3)", "=", "6"]);
  assert.deepEqual(equationTerms("4 − 10 + 6 = 0"), ["4", "−", "10", "+", "6", "=", "0"]);
  assert.deepEqual(equationTerms("x − 2 = 0 or x − 3 = 0"), ["x", "−", "2", "=", "0", "or", "x", "−", "3", "=", "0"]);
});

test("a sentence's equations are found, units included", () => {
  assert.deepEqual(writtenEquations("For x = 2, calculate 2² − 5(2) + 6 = 4 − 10 + 6 = 0."), ["x = 2", "2² − 5(2) + 6 = 4 − 10 + 6 = 0"]);
  assert.deepEqual(writtenEquations("2 kg × 3 m/s² = 6 N"), ["2 kg × 3 m/s² = 6 N"]);
});

test("side by side, or ending on an operator, is broken; a minus and a space continues", () => {
  assert.equal(malformedRow(["F", "=", "2 kg", "×", "3 m/s²", "6 N"]), true);
  assert.equal(malformedRow(["2 V", "+", "4 V", "="]), true);
  assert.equal(malformedRow(["x²", "− 5x", "+ 6", "= 0"]), false);
  assert.equal(malformedRow(["2", "x"]), false, "a coefficient and its variable are one product");
});

test("Newton: the row is finished from its caption, keeping its own start", () => {
  const stage = stageOf([["f", "F"], ["eq", "="], ["m", "2 kg"], ["x", "×"], ["a", "3 m/s²"], ["r", "6 N"]], [{ s: 0, order: ["f", "eq", "m", "x", "a", "r"], caption: "2 kg × 3 m/s² = 6 N" }]);
  assert.equal(repairEquationRows(stage, "For 2 kg at 3 m/s², F equals 2 times 3, or 6 newtons."), 1);
  assert.equal(rowText(stage, 0), "F = 2 kg × 3 m/s² = 6 N");
});

test("circuits: a row that writes only one side is finished from its caption", () => {
  const stage = stageOf([["a", "2 V"], ["p", "+"], ["b", "4 V"]], [{ s: 0, order: ["a", "p", "b"], caption: "2 V + 4 V = 6 V" }]);
  repairEquationRows(stage, "Readings of two volts and four volts give six volts.");
  assert.equal(rowText(stage, 0), "2 V + 4 V = 6 V");
});

test("substitution: each check is rebuilt from what Aria says, and a nonsense row keeps the last good one", () => {
  const stage = stageOf(
    [["e", "x² − 5x + 6 = 0"], ["t2", "2²"], ["m2", "− 5(2)"], ["p6", "+ 6"], ["four", "4"], ["m10", "− 10"], ["z1", "0"], ["t3", "3²"], ["m3", "− 5(3)"], ["nine", "9"], ["m15", "− 15"], ["z2", "0"]],
    [{ s: 0, order: ["e"] }, { s: 1, order: ["t2", "m2", "p6", "four", "m10", "z1"] }, { s: 2, order: ["t3", "m3", "p6", "nine", "m15", "z2"] }, { s: 3, order: ["z1", "z2"] }],
  );
  repairEquationRows(stage, "Verify by substituting. For x = 2, calculate 2² − 5(2) + 6 = 4 − 10 + 6 = 0. For x = 3, calculate 3² − 5(3) + 6 = 9 − 15 + 6 = 0. Both values give zero.");
  assert.match(rowText(stage, 1), /2² − 5\(2\) \+ 6 = 4 − 10 \+ 6 = 0$/);
  assert.match(rowText(stage, 2), /3² − 5\(3\) \+ 6 = 9 − 15 \+ 6 = 0$/);
  assert.equal(rowText(stage, 3), rowText(stage, 2), "the last good row stays up; the layout does not write it twice");
});

test("two equations jammed together are joined with the word Aria uses", () => {
  const stage = stageOf([["a", "−2"], ["x", "×"], ["b", "−3"], ["e", "="], ["six", "6"], ["c", "−2"], ["p", "+"], ["d", "−3"], ["e2", "="], ["r", "−5"]], [{ s: 0, order: ["a", "x", "b", "e", "six", "c", "p", "d", "e2", "r"] }]);
  repairEquationRows(stage, "Those numbers are −2 and −3, because (−2)(−3) = 6 and −2 + −3 = −5.");
  assert.match(rowText(stage, 0), /^(?:\(−2\)\(−3\)|−2 × −3) = 6 and −2 \+ −3 = −5$/);
});

test("a correct row is never touched", () => {
  const stage = stageOf([["l", "x² − 5x + 6"], ["e", "="], ["z", "0"]], [{ s: 0, order: ["l", "e", "z"], caption: "Our equation" }]);
  assert.equal(repairEquationRows(stage, "Our equation is x² − 5x + 6 = 0."), 0);
});

test("a row that lost an undefined term in validation is rebuilt from the sentence (zero product)", () => {
  const raw = {
    heading: "Zero product property",
    notes: [],
    cues: [],
    stage: {
      kind: "equation",
      tokens: [
        { id: "left", text: "(x − 2)", tex: "(x-2)" }, { id: "times", text: "×", tex: "\\times" }, { id: "right", text: "(x − 3)", tex: "(x-3)" },
        { id: "eq", text: "=", tex: "=" }, { id: "zero", text: "0", tex: "0" }, { id: "implies", text: "⇒", tex: "\\Rightarrow" }, { id: "a", text: "x − 2", tex: "x-2" },
      ],
      // "zero-3", "or-1" and "x-minus-3-zero" were never defined: the row used to end at "⇒ x − 2".
      steps: [{ s: 0, order: ["left", "times", "right", "eq", "zero", "implies", "a", "zero-3", "or-1", "x-minus-3-zero"] }],
    },
  };
  const spec = validateCanvasSpec(raw, 1, [], "Applying it to (x − 2)(x − 3) = 0 gives x − 2 = 0 or x − 3 = 0.");
  assert.ok(spec && spec.stage.kind === "equation");
  const text = rowText(spec.stage as EquationStage, 0);
  assert.match(text, /x − 2 = 0 or x − 3 = 0/);
});

test("a lone ≠ is drawn as the character, never as KaTeX's overlay", () => {
  const raw = { heading: "Quadratics", notes: [], cues: [], stage: { kind: "equation", tokens: [{ id: "a", text: "a", tex: "a" }, { id: "ne", text: "≠", tex: "\\ne" }, { id: "z", text: "0", tex: "0" }], steps: [{ s: 0, order: ["a", "ne", "z"] }] } };
  const spec = validateCanvasSpec(raw, 1, [], "And a cannot be zero.");
  const ne = (spec!.stage as EquationStage).tokens.find((t) => t.id === "ne")!;
  assert.equal(ne.tex, undefined);
  assert.equal(ne.text, "≠");
});
