import test from "node:test";
import assert from "node:assert/strict";
import { equationProblem, normalizeMath, spokenEquations } from "../canvas/equationCheck";
import { isFormulaQuestion, withoutLatex } from "../drawConsent";
import { parseEquationSpec } from "../equationSpec";
import { EQUATION_FIXTURES } from "../canvas/equationFixtures";
import { layoutPanel, texEm } from "../canvas/layout";
import { canvasSentences } from "../canvas/plan";
import { validateCanvasSpec } from "../canvas/validate";
import type { EquationStage } from "../canvas/types";

/* Equation boards write what Aria says, whole, typeset by KaTeX (owner's report, 2026-10-16). */

// The "Collecting like terms" board as the 2026-10-16 lecture stored it (session 230b7b59): the
// grouped term was cut to "(5a − 2a) + (3b + ", and no step ever wrote "… = 3a + 7b".
const LECTURE_SCRIPT = "Letters represent numbers, so algebra lets us describe unknown or changing values. Like terms have the same variables raised to the same powers. Start with 5a + 3b − 2a + 4b, then group matching terms: (5a − 2a) + (3b + 4b) = 3a + 7b. The reason is that only matching quantities can be combined, just as matching units can be combined. Remember electron shells from your lesson on atoms: the symbols must match before you combine them.";
const LECTURE_STAGE = {
  kind: "equation",
  tokens: [
    { id: "like-terms", text: "5a" }, { id: "plus-1", text: "+" }, { id: "b-term", text: "3b" }, { id: "minus-1", text: "−" }, { id: "a-term-2", text: "2a" }, { id: "plus-2", text: "+" }, { id: "b-term-2", text: "4b" },
    { id: "grouped-terms", text: "(5a − 2a) + (3b + " }, { id: "simplified-expression", text: "3a + 7b" },
  ],
  steps: [
    { s: 0, order: ["like-terms", "plus-1", "b-term", "minus-1", "a-term-2", "plus-2", "b-term-2"] },
    { s: 2, order: ["grouped-terms"] },
    { s: 4, order: ["simplified-expression"] },
  ],
};
const board = (stage: unknown, script: string) => validateCanvasSpec({ heading: "Board", notes: [], stage, cues: [] }, canvasSentences(script).length)!;
const withTex = (stage: typeof LECTURE_STAGE) => ({ ...stage, tokens: stage.tokens.map((t) => ({ ...t, tex: t.text.replace(/−/g, "-") })) });

test("the equations a narration says are found, as written", () => {
  const found = spokenEquations(LECTURE_SCRIPT).map((e) => e.text);
  assert.deepEqual(found, ["(5a − 2a) + (3b + 4b) = 3a + 7b"]);
  assert.deepEqual(spokenEquations("For 4(2x − 3), multiply. Therefore, 4(2x − 3) = 8x − 12. Substituting U = ax and V = by gives it.").map((e) => e.text), ["4(2x − 3) = 8x − 12"], "a short 'U = ax' is not an equation to write");
  assert.deepEqual(spokenEquations("In 12x³ − 8x: 12x³ ÷ 4x = 3x² and −8x ÷ 4x = −2.").map((e) => e.text), ["12x³ ÷ 4x = 3x²", "−8x ÷ 4x = −2"]);
  assert.equal(normalizeMath("x² + 6x − 5"), normalizeMath("x^2+6x-5"));
  assert.equal(normalizeMath("6 × 1"), normalizeMath("6\\times 1"));
});

test("the lecture's own board is caught: a term with no LaTeX, then the equation it never wrote", () => {
  const plain = board(LECTURE_STAGE, LECTURE_SCRIPT);
  assert.match(equationProblem(LECTURE_STAGE, plain.stage as EquationStage, LECTURE_SCRIPT) ?? "", /has no "tex"/);
  const typeset = withTex(LECTURE_STAGE);
  const spec = board(typeset, LECTURE_SCRIPT);
  assert.match(equationProblem(typeset, spec.stage as EquationStage, LECTURE_SCRIPT) ?? "", /narration says "\(5a − 2a\) \+ \(3b \+ 4b\) = 3a \+ 7b" \(sentence 2\) but no step writes it whole/);
});

test("a term is never cut short: a long one is reported, and LaTeX KaTeX cannot typeset is reported", () => {
  const long = "(x² − 2x)/(x² − 5x + 6) and then some more terms that run on and on";
  const stage = { kind: "equation", tokens: [{ id: "a", text: long, tex: "x" }, { id: "b", text: "=", tex: "=" }], steps: [{ s: 0, order: ["a", "b"] }] };
  assert.match(equationProblem(stage, board(stage, "One.").stage as EquationStage, "One.") ?? "", /is \d+ characters: split it/);
  const bad = { kind: "equation", tokens: [{ id: "a", text: "x/3", tex: "\\frac{x}{" }, { id: "b", text: "=", tex: "=" }], steps: [{ s: 0, order: ["a", "b"] }] };
  const spec = board(bad, "One.");
  assert.equal((spec.stage as EquationStage).tokens[0].tex, undefined, "broken LaTeX is not kept");
  assert.match(equationProblem(bad, spec.stage as EquationStage, "One.") ?? "", /does not typeset in KaTeX/);
  const unknown = { kind: "equation", tokens: [{ id: "a", text: "x", tex: "x" }, { id: "b", text: "=", tex: "=" }], steps: [{ s: 0, order: ["a", "b", "ghost"] }] };
  assert.match(equationProblem(unknown, board(unknown, "One.").stage as EquationStage, "One.") ?? "", /"ghost", which is not one of the tokens/);
});

test("the hand-written boards pass: every term typeset, every spoken equation written whole", () => {
  for (const f of EQUATION_FIXTURES) {
    const spec = board(f.raw.stage, f.script);
    assert.ok(spec, f.id);
    assert.equal(equationProblem(f.raw.stage, spec.stage as EquationStage, f.script), null, f.id);
  }
});

test("LaTeX widths: a fraction is as wide as its wider part; longer terms are wider", () => {
  assert.ok(texEm("\\frac{x}{3}") < texEm("x/3") + 0.5);
  assert.ok(texEm("\\frac{5x - 12}{6}") > texEm("\\frac{x}{6}"));
  assert.ok(texEm("x^2") < texEm("x2"), "a power is small");
  assert.ok(texEm("(5a - 2a) + (3b + 4b)") > texEm("(5a - 2a)"));
  assert.ok(texEm("\\sqrt{x}") > texEm("x"));
});

test("a long equation wraps onto two lines inside the stage, terms never overlapping", () => {
  // Seven bracketed terms joined by signs: far wider than the 612-wide stage of a board with notes.
  const terms = ["(x^2 + 6x + 9)", "(x^2 - 4x + 4)", "(2x^2 + 3x - 5)", "(x^2 + 2x + 1)", "(3x^2 - x + 7)", "(x^2 - 9)", "(4x^2 + 4x + 1)"];
  const tokens = terms.flatMap((tex, i) => [{ id: `t${i}`, text: tex, tex }, ...(i < terms.length - 1 ? [{ id: `op${i}`, text: i === 3 ? "=" : "+", tex: i === 3 ? "=" : "+" }] : [])]);
  const spec = validateCanvasSpec({ heading: "Long", notes: [{ text: "a note", s: 0 }], stage: { kind: "equation", tokens, steps: [{ s: 0, order: tokens.map((t) => t.id) }] }, cues: [] }, 1)!;
  const layout = layoutPanel(spec);
  const eq = layout.marks.find((m) => m.type === "equation");
  assert.ok(eq && eq.type === "equation");
  const step = eq.steps[0];
  const lines = [...new Set(Object.values(step.place).map((p) => Math.round(p.y)))];
  assert.equal(lines.length, 2, "written on two lines");
  const secondStart = Object.entries(step.place).filter(([, p]) => Math.round(p.y) === Math.max(...lines)).sort((a, b) => a[1].x - b[1].x)[0][0];
  assert.equal(secondStart, "op3", "the break comes before the \"=\"");
  const placed = Object.entries(step.place).map(([id, p]) => ({ p, w: eq.tokens.find((t) => t.id === id)!.w }));
  for (const { p, w } of placed) assert.ok(p.x >= layout.stage.x - 1 && p.x + w <= layout.stage.x + layout.stage.w + 1, "inside the stage");
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (Math.abs(a.p.y - b.p.y) > 1) continue;
    assert.ok(a.p.x + a.w <= b.p.x + 0.5 || b.p.x + b.w <= a.p.x + 0.5, "terms on a line do not overlap");
  }
  assert.ok(eq.size >= 18);
});

test("a question asking for a formula is answered with the formula; asking why is not", () => {
  for (const q of ["what is the formula for gradient descent?", "Give me the equation of a straight line", "what's the formula of squared error", "expression for kinetic energy?"]) assert.ok(isFormulaQuestion(q), q);
  for (const q of ["why does the formula work?", "derive the quadratic formula", "how does gradient descent learn?", "explain expanding brackets", ""]) assert.ok(!isFormulaQuestion(q), q);
});

test("a formula card is one line (up to three); a derivation still needs two", () => {
  const one = { title: "Squared error", steps: [{ tex: "J(m) = \sum_i (y_i - m x_i)^2", why: "y: actual · m: slope" }] };
  assert.equal(parseEquationSpec(one).spec, null, "a derivation of one line is refused");
  assert.equal(parseEquationSpec(one, { formula: true }).spec?.steps.length, 1);
  const many = { steps: Array.from({ length: 5 }, (_, i) => ({ tex: `x = ${i}` })) };
  assert.equal(parseEquationSpec(many, { formula: true }).spec?.steps.length, 3, "a card keeps at most three lines");
});

test("a spoken formula answer carries no LaTeX: the board shows it, the words refer to it", () => {
  // As the model wrote it on 2026-10-16.
  const raw = String.raw`The squared error cost is \(J(\theta)=\frac{1}{2m}\sum_{i=1}^{m}(h_\theta(x^{(i)})-y^{(i)})^2\). Here, \(m\) is the number of training examples, and \(y^{(i)}\) is the true value.`;
  const said = withoutLatex(raw);
  assert.doesNotMatch(said, /\\|\$/);
  assert.equal(said, "The squared error cost is the formula on the board. Here, m is the number of training examples, and y is the true value.");
  assert.equal(withoutLatex("No maths here."), "No maths here.");
  assert.equal(withoutLatex("It is $a^2 + b^2$, and then $$c^2$$ too."), "It is the formula on the board, and then c too.");
});
