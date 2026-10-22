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

test("an equation step that names a missing id is repaired in code, not sent back", async () => {
  const { repairEquationOrder } = await import("../canvas/equationRepair");
  const raw = { kind: "equation", tokens: [{ id: "a2", text: "a²", tex: "a^2" }, { id: "plus", text: "+", tex: "+" }, { id: "b2", text: "b²", tex: "b^2" }, { id: "eq", text: "=", tex: "=" }, { id: "c2", text: "c²", tex: "c^2" }],
    steps: [{ s: 0, order: ["right-triangle", "a2", "plus", "b2", "equals-6", "c2"] }, { s: 1, order: ["c2", "equals-7", "thirty-six", "plus-2", "sixty-four"] }] };
  assert.ok(repairEquationOrder(raw) >= 4);
  const ids = new Set(raw.tokens.map((t) => t.id));
  for (const st of raw.steps) for (const id of st.order) assert.ok(ids.has(id), id);
  assert.deepEqual(raw.steps[0].order, ["a2", "plus", "b2", "eq", "c2"]);
  const text = (id: string) => raw.tokens.find((t) => t.id === id)!.text;
  assert.deepEqual(raw.steps[1].order.map(text), ["c²", "=", "36", "+", "64"]);
});

test("a term used twice in one line gets its own copy, and two operators side by side are caught", async () => {
  const { repairEquationOrder } = await import("../canvas/equationRepair");
  const { equationProblem } = await import("../canvas/equationCheck");
  const raw = { kind: "equation", tokens: [{ id: "three", text: "3", tex: "3" }, { id: "times", text: "×", tex: "\\times" }, { id: "four", text: "4", tex: "4" }, { id: "eq", text: "=", tex: "=" }, { id: "twelve", text: "12", tex: "12" }, { id: "plus", text: "+", tex: "+" }, { id: "seven", text: "7", tex: "7" }],
    steps: [{ s: 0, order: ["three", "times", "four", "eq", "twelve"] }, { s: 1, order: ["three", "plus", "four", "eq", "seven"] }, { s: 1, order: ["three", "times", "four", "eq", "twelve", "three", "plus", "four", "eq", "seven"] }] };
  repairEquationOrder(raw);
  const text = (id: string) => raw.tokens.find((t) => t.id === id)!.text;
  assert.deepEqual(raw.steps[2].order.map(text), ["3", "×", "4", "=", "12", "3", "+", "4", "=", "7"]);
  const broken = { kind: "equation", tokens: [{ id: "a", text: "12", tex: "12" }, { id: "p", text: "+", tex: "+" }, { id: "e", text: "=", tex: "=" }, { id: "b", text: "7", tex: "7" }], steps: [{ s: 0, order: ["a", "p", "e", "b"] }] };
  const spec = board(broken, "One.");
  assert.match(equationProblem(broken, spec.stage as EquationStage, "One.") ?? "", /two operators side by side/);
});

test("the narration's answer must make every line of the working true (QA batch 4)", async () => {
  const { solutionContradictions } = await import("../canvas/equationCheck");
  const toks = (rows: string[][]) => {
    const tokens: Array<{ id: string; text: string; tex: string }> = [];
    const steps = rows.map((r, i) => ({ s: i, order: r.map((t, k) => { const id = `t${i}-${k}`; tokens.push({ id, text: t, tex: t }); return id; }) }));
    return { kind: "equation" as const, tokens, steps };
  };
  const script = "Use x + y = 10 and y = 2x + 1. Substituting gives x + 2x + 1 = 10. So 3x = 9, so x = 3, and y = 2(3) + 1 = 7.";
  const bad = toks([["x", "=", "2x + 1"], ["x + y", "=", "10", ",", "y", "=", "10"], ["3x", "=", "9"]]);
  assert.deepEqual(solutionContradictions(bad, script).length, 2);
  const good = toks([["y", "=", "2x + 1"], ["x + 2x + 1", "=", "10"], ["3x", "=", "9"], ["y", "=", "2(3) + 1", "=", "7"]]);
  assert.deepEqual(solutionContradictions(good, script), []);
  const quadratic = toks([["(x − 2)(x − 3)", "=", "0"], ["x", "=", "2", "or", "x", "=", "3"]]);
  assert.deepEqual(solutionContradictions(quadratic, "So x = 2 or x = 3."), [], "two roots are not a contradiction");
});

test("angle arithmetic is in degrees and '= 13²' is 169 (QA batch 5: every circle-theorem board was failed)", async () => {
  const { checkNumbers } = await import("../canvas/numberCheck");
  for (const [t, bad] of [["100° ÷ 2 = 50", false], ["180° − 112° = 68°", false], ["5² + 12² = 13²", false], ["5² + 12² = 13", true], ["100° ÷ 2 = 60°", true], ["sin(30°) = 0.5", false], ["sin(30°) = 0.7", true], ["factorial(4) = 24", false], ["3 × 4 = 13", true]] as const) {
    assert.equal(checkNumbers(t).length > 0, bad, t);
  }
});

test("a false chain is split into its two true calculations", async () => {
  const { splitFalseChains } = await import("../canvas/equationRepair");
  const { checkNumbers } = await import("../canvas/numberCheck");
  const ids = ["2", "×", "3", "=", "6", "+", "1", "=", "7"];
  const stage = { kind: "equation" as const, tokens: ids.map((t, i) => ({ id: `t${i}`, text: t, tex: t })), steps: [{ s: 0, order: ids.map((_, i) => `t${i}`), highlight: [] }] };
  assert.equal(splitFalseChains(stage as never), 1);
  const text = new Map(stage.tokens.map((t) => [t.id, t.text]));
  const line = stage.steps[0].order.map((id) => text.get(id)).join(" ");
  assert.equal(line, "2 × 3 = 6 , 6 + 1 = 7");
  assert.deepEqual(checkNumbers(line), []);
  // A true chain is left alone.
  const ok = { kind: "equation" as const, tokens: ["9", "+", "16", "=", "25"].map((t, i) => ({ id: `u${i}`, text: t, tex: t })), steps: [{ s: 0, order: ["u0", "u1", "u2", "u3", "u4"], highlight: [] }] };
  assert.equal(splitFalseChains(ok as never), 0);
});

test("maths benchmark repairs: the quadratic formula as a fraction, side calculations split, the answer written", async () => {
  const { bracketDivisions, splitSideCalculations, writeSpokenEquations } = await import("../canvas/equationRepair");
  const { equationProblem, spokenIsWritten } = await import("../canvas/equationCheck");
  const tok = (id: string, text: string, tex = text) => ({ id, text, tex });
  // "x = −b ± √(b² − 4ac) ÷ 2a" → one fraction token.
  const formula = { kind: "equation" as const, tokens: [tok("x", "x"), tok("eq", "="), tok("num", "−b ± √(b² − 4ac)", "-b \\pm \\sqrt{b^2-4ac}"), tok("div", "÷", "\\div"), tok("den", "2a")], steps: [{ s: 0, order: ["x", "eq", "num", "div", "den"], highlight: [] }] };
  assert.equal(bracketDivisions(formula as never), 1);
  const frac = formula.tokens.find((t) => t.id === formula.steps[0].order[2])!;
  assert.match(frac.tex, /^\\frac\{-b \\pm \\sqrt\{b\^2-4ac\}\}\{2a\}$/);
  // "x = −5 ± √49 ÷ 4 = 25 + 24 = 49" → brackets, and the discriminant on its own after a comma.
  const ids = ["x", "=", "−5", "±", "√49", "÷", "4", "=", "25", "+", "24", "=", "49"];
  const sub = { kind: "equation" as const, tokens: ids.map((t, i) => tok(`t${i}`, t)), steps: [{ s: 0, order: ids.map((_, i) => `t${i}`), highlight: [] }] };
  assert.equal(splitSideCalculations(sub as never), 1);
  assert.equal(bracketDivisions(sub as never), 1);
  const text = new Map(sub.tokens.map((t) => [t.id, t.text]));
  assert.equal(sub.steps[0].order.map((i) => text.get(i)).join(" "), "x = ( −5 ± √49 ) ÷ 4 , 25 + 24 = 49");
  // The answer Aria reaches is written, joined as she says it.
  const script = "We solve 2x² + 5x − 3 = 0. Therefore x = 1/2 or x = −3, and both values work.";
  const st = { kind: "equation" as const, tokens: ["2x² + 5x − 3", "=", "0"].map((t, i) => tok(`q${i}`, t)), steps: [{ s: 0, order: ["q0", "q1", "q2"], highlight: [] }] };
  writeSpokenEquations(st as never, script);
  const t2 = new Map(st.tokens.map((t) => [t.id, t.text]));
  assert.equal(st.steps.at(-1)!.order.map((i) => t2.get(i)).join(" "), "x = 1/2 or x = −3");
  assert.equal(equationProblem(st, st as never, script), null, "two roots are two values, not a contradiction");
  assert.ok(spokenIsWritten("x = −1/3", ["x=1,-1/3"]), "a value in a list of roots counts as written");
});

test("a geometry figure never writes an angle Aria does not say", async () => {
  const { figureDataIssues } = await import("../canvas/releaseAudit");
  const board = (params: Record<string, unknown>) => ({ heading: "Proof", notes: [], cues: [], stage: { kind: "figure", component: "circleTheorem", params, parts: [] } }) as never;
  const proof = "Our goal is to prove the angle in a semicircle is a right angle. Let angle OAC be x and angle OBC be y.";
  assert.deepEqual(figureDataIssues(board({ theorem: "semicircle", show: "given", unknown: "x+y" }), proof), [], "no angle given: no invented number is drawn");
  assert.match(figureDataIssues(board({ theorem: "semicircle", angle: 35, show: "given" }), proof)[0] ?? "", /writes 35°/);
  assert.deepEqual(figureDataIssues(board({ theorem: "semicircle", angle: 35 }), "Angle CAB is 35 degrees, so angle ABC is 55 degrees and the angle at C is 90."), []);
});

test("maths said in words is checked like symbols: the sine rule board's missing ÷ sin 35° is caught, the answer written", async () => {
  const { equationProblem, formulaNotes, spokenMaths } = await import("../canvas/equationCheck");
  const { dropFalseWorking, writeSpokenEquations } = await import("../canvas/equationRepair");
  const { checkNumbers } = await import("../canvas/numberCheck");
  assert.equal(spokenMaths("b equals 6 sine 72 degrees divided by sine 35 degrees"), "b = 6 sin 72° ÷ sin 35°");
  assert.deepEqual(checkNumbers("b ÷ sin 72° = 6 ÷ sin 35°"), [], "a divided term is not a sum of its own");
  const script = "Suppose A equals 35 degrees, B equals 72 degrees, and side a equals 6 centimetres. Then b divided by sine 72 degrees equals 6 divided by sine 35 degrees, so b equals 6 sine 72 degrees divided by sine 35 degrees. Calculating gives b equals 9.95 centimetres, to three significant figures.";
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: [tok("b", "b"), tok("eq", "="), tok("six", "6"), tok("x", "×"), tok("s72", "sin 72°")], steps: [{ s: 1, order: ["b", "eq", "six", "x", "s72"], highlight: [] }] };
  assert.match(equationProblem(st, st as never, script) ?? "", /false|narration says/, "the truncated line is not accepted");
  writeSpokenEquations(st as never, script);
  dropFalseWorking(st as never, script);
  assert.equal(equationProblem(st, st as never, script), null);
  const text = new Map(st.tokens.map((t) => [t.id, t.text]));
  const rows = st.steps.map((s) => s.order.map((i) => text.get(i)).join(" "));
  assert.ok(rows.some((r) => r.includes("b = 6 sin 72° ÷ sin 35°")) && rows.some((r) => r.includes("b = 9.95")), rows.join(" | "));
  assert.ok(!rows.some((r) => /^b = 6 × sin 72°$/.test(r)), "the false line is gone");
  const notes = formulaNotes([{ s: 1, text: "Sine rule" }], "In any triangle the sine rule holds. We write it as a divided by sine A equals b divided by sine B equals c divided by sine C.");
  assert.equal(notes?.[0].text, "a/sin A = b/sin B = c/sin C");
});

test("graphs: the tangent asked for is inside the window; axis numbers a curve crosses are left out", async () => {
  const { figureComponent } = await import("../figures/registry");
  const graph = figureComponent("functionGraph")!;
  const d = graph.build({ f: "x^3 - 2*x", xmin: 0, xmax: 1, features: "none", tangentAt: 1 });
  assert.ok(d.parts.some((p) => /tangent/i.test(p.id) || /tangent|gradient/i.test(p.name)) || d.shapes.some((s) => s.t === "text" && /gradient/.test(String(s.text))), "the tangent is drawn");
  const { isLabLookTopic } = await import("../canvas/subjectLook");
  assert.equal(isLabLookTopic("The sine rule"), true);
  assert.equal(isLabLookTopic("Sine waves in physics"), false);
});

test("batch 3 fixes: ellipses, word-only steps, repeated formula notes, trivial order cards", async () => {
  const { mathsEllipsis, canvasSentences } = await import("../canvas/plan");
  assert.equal(canvasSentences(mathsEllipsis("Write S = a + (a+d) +... + l, then reverse it. Add them.")).length, 2, "a typed ... never ends a sentence");
  const { dropWordSteps } = await import("../canvas/equationRepair");
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: [tok("a", "Tree routes"), tok("c", "3/5 × 3/5"), tok("d", "="), tok("e", "9/25")], steps: [{ s: 0, order: ["a"], highlight: [] }, { s: 2, order: ["c", "d", "e"], highlight: [] }] };
  assert.equal(dropWordSteps(st as never), 1);
  assert.equal((st.steps[0] as { caption?: string }).caption, "Tree routes");
  const { formulaNotes } = await import("../canvas/equationCheck");
  assert.equal(formulaNotes([{ s: 0, text: "S = n(a + l)/2" }], "We pair the terms. Each pair is equal. Dividing by 2 gives S = n(a+l)/2.")?.length, 1);
  const { orderCard } = await import("../canvas/cardKinds");
  const flow = { heading: "Reading conditional probability", notes: [], cues: [], stage: { kind: "flow", nodes: [{ id: "a", label: "First stage", s: 0 }, { id: "b", label: "Second stage", s: 1 }, { id: "c", label: "Outcomes", s: 2 }], arrows: [{ from: "a", to: "b", s: 1 }, { from: "b", to: "c", s: 2 }] } };
  assert.equal(orderCard(flow as never, "One. Two. Three."), null);
});

test("a bound is a condition, not an answer; limits alone are taken out of a row", async () => {
  const { spokenEquations } = await import("../canvas/equationCheck");
  const eqs = spokenEquations("To find the area from x = 1 to x = 3, we substitute the bounds. So the answer is x = 5.").map((e) => e.text);
  assert.ok(!eqs.includes("x = 1") && !eqs.includes("x = 3"), eqs.join(" | "));
  assert.ok(eqs.includes("x = 5"));
  const { dropWordSteps } = await import("../canvas/equationRepair");
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: [tok("f", "3x² + 2"), tok("b", "₁³")], steps: [{ s: 0, order: ["f", "b"], highlight: [] }] };
  dropWordSteps(st as never);
  assert.deepEqual(st.steps[0].order, ["f"]);
});

test("batch 5 fixes: board language, broken lines, logs, circles", async () => {
  const { languageIssues } = await import("../canvas/releaseAudit");
  const urdu = { heading: "قانون ضرب لگاریتم", notes: [], cues: [], stage: { kind: "equation", tokens: [], steps: [{ s: 0, order: [], highlight: [], caption: "ضرب کے اندر لگاریتم جمع بن جاتا ہے" }] } };
  assert.equal(languageIssues(urdu as never, "We begin with the product law, which turns a logarithm of multiplication into addition.").length, 1);
  assert.equal(languageIssues({ ...urdu, heading: "The product law", stage: { kind: "equation", tokens: [], steps: [] } } as never, "We begin with the product law.").length, 0);
  const { dropBrokenClauses } = await import("../canvas/equationRepair");
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: ["3log₂8", "=", "×", "3", "=", "9"].map((t, i) => tok(`b${i}`, t)).concat([tok("ok", "log₂(8³) = 9")]), steps: [{ s: 0, order: ["ok"], highlight: [] }, { s: 1, order: ["b0", "b1", "b2", "b3", "b4", "b5"], highlight: [] }] };
  assert.equal(dropBrokenClauses(st as never), 1);
  assert.equal(st.steps.length, 1, "the broken line is never shipped");
  const { checkNumbers } = await import("../canvas/numberCheck");
  assert.deepEqual(checkNumbers("log₂(8 × 4) = 5"), []);
  assert.deepEqual(checkNumbers("log(100) = 2"), []);
  assert.equal(checkNumbers("log(1000) = 2").length, 1);
  const { figureComponent } = await import("../figures/registry");
  const d = figureComponent("functionGraph")!.build({ f: "x + 1", g: "sqrt(25 - x^2)", features: "intersections", gName: "Circle x² + y² = 25" });
  const meets = d.parts.filter((p) => p.id.startsWith("intersection") || /Intersection/.test(p.name));
  assert.ok(d.shapes.some((s) => s.t === "text" && /−4, −3/.test(String((s as { text: unknown }).text))) || meets.length >= 1, "the lower intersection is marked");
});

test("verification fixes: ≈ results are written, conditions are not, statements are not chained", async () => {
  const { spokenEquations } = await import("../canvas/equationCheck");
  assert.deepEqual(spokenEquations("To find side b when a = 5, A = 30°, and B = 45°, we use b = 5 × sin 45° ÷ sin 30° = 5√2.").map((e) => e.text), ["b = 5 × sin 45° ÷ sin 30° = 5√2"]);
  assert.deepEqual(spokenEquations("We use B = sin⁻¹(5 ÷ 14) ≈ 20.9°.").map((e) => e.text), ["B = sin⁻¹(5 ÷ 14) ≈ 20.9°"]);
  const { writeSpokenEquations, splitSideCalculations } = await import("../canvas/equationRepair");
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: [tok("b", "B = sin⁻¹(5 ÷ 14)")], steps: [{ s: 0, order: ["b"], highlight: [] }] };
  writeSpokenEquations(st as never, "We use B = sin⁻¹(5 ÷ 14) ≈ 20.9°.");
  const text = new Map(st.tokens.map((t) => [t.id, t.text]));
  assert.equal(st.steps[0].order.map((i) => text.get(i)).join(" "), "B = sin⁻¹(5 ÷ 14) ≈ 20.9°", "the completing line replaces the unfinished one");
  const q = { kind: "equation" as const, tokens: [tok("a", "(−3 ± 5)/4"), tok("e", "="), tok("r", "x = 1/2 or x = −2")], steps: [{ s: 0, order: ["a", "e", "r"], highlight: [] }] };
  splitSideCalculations(q as never);
  const t2 = new Map(q.tokens.map((t) => [t.id, t.text]));
  assert.equal(q.steps[0].order.map((i) => t2.get(i)).join(" "), "(−3 ± 5)/4 , x = 1/2 or x = −2");
});

test("verification batch 2: words inside a bracket stay with it; a started line is finished, not repeated", async () => {
  // "P(A and defect) = 0.60 × 0.02 = 0.012" was cut at "and" and written as "defect) = 0.60 × 0.02".
  assert.deepEqual(spokenEquations("Thus P(A and defect) = 0.60 × 0.02 = 0.012, while P(not A) = 1 − 0.6 = 0.4.").map((e) => e.text), ["P(A and defect) = 0.60 × 0.02 = 0.012", "P(not A) = 1 − 0.6 = 0.4"]);
  const { plainTex, writeSpokenEquations } = await import("../canvas/equationRepair");
  assert.equal(plainTex("P(A and defect)"), "P(A\\text{ and defect})", "spaces kept around words");
  assert.equal(plainTex("2×3"), "2\\times 3", "an operator is never read as a word");
  assert.equal(plainTex("6 sin 72°÷sin 35°"), "6 \\sin 72°\\div \\sin 35°");
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: [tok("l", "P(A ∩ D)"), tok("e", "="), tok("a", "0.60"), tok("x", "×"), tok("b", "0.02")], steps: [{ s: 0, order: ["l", "e", "a", "x", "b"], highlight: [] }] };
  writeSpokenEquations(st as never, "Thus P(A and defect) = 0.60 × 0.02 = 0.012 here. That is the path.");
  const text = new Map(st.tokens.map((t) => [t.id, t.text]));
  assert.equal(st.steps[0].order.map((i) => text.get(i)).join(" "), "P(A ∩ D) = 0.60 × 0.02 = 0.012");
});

test("verification batch 3: a proof's result is not its first row; the semicircle proof figure", async () => {
  const { dropGoalRow } = await import("../canvas/equationRepair");
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const st = {
    kind: "equation" as const,
    tokens: [tok("xy", "x + y"), tok("e1", "="), tok("n", "90°"), tok("aoc", "∠AOC"), tok("e2", "="), tok("r", "180° − 2x"), tok("sum", "(180° − 2x) + (180° − 2y)"), tok("e3", "="), tok("o", "180°")],
    steps: [
      { s: 0, order: ["xy", "e1", "n"], highlight: [], caption: "We aim to prove x + y = 90°" },
      { s: 1, order: ["aoc", "e2", "r"], highlight: [] },
      { s: 3, order: ["sum", "e3", "o"], highlight: [] },
      { s: 4, order: ["xy", "e1", "n"], highlight: [] },
    ],
  };
  assert.equal(dropGoalRow(st as never, "We now prove that x + y is 90 degrees. A. B. C. D."), true);
  assert.deepEqual(st.steps.map((x) => x.s), [1, 3, 4], "the result is written where it is reached");
  const worked = { kind: "equation" as const, tokens: st.tokens, steps: [{ s: 0, order: ["aoc", "e2", "r"], highlight: [] }, { s: 1, order: ["sum", "e3", "o"], highlight: [] }, { s: 2, order: ["aoc", "e2", "r"], highlight: [] }] };
  assert.equal(dropGoalRow(worked as never, "Angle AOC is 180 minus 2x. Then the sum. So again."), false, "no aim stated: left alone");
  const { figureComponent } = await import("../figures/registry");
  const d = figureComponent("circleTheorem")!.build({ theorem: "semicircle", unknown: "x+y", givenSymbol: "x&y", letters: "A,B,C", centre: "O" });
  const texts = d.shapes.filter((s) => s.t === "text").map((s) => String((s as { text: unknown }).text));
  assert.equal(texts.filter((t) => t === "x").length, 2, "x at A and at C");
  assert.equal(texts.filter((t) => t === "y").length, 2, "y at B and at C");
  assert.ok(!texts.some((t) => /90|&/.test(t)), "nothing claims the 90° being proved; no literal x&y");
});

test("verification batch 3: series boards — '…' is maths, inputs are not answers, said order kept, word rows go", () => {
  const show = (spec: ReturnType<typeof validateCanvasSpec>) => { const t = new Map(spec!.stage.kind === "equation" ? spec!.stage.tokens.map((x) => [x.id, x.text]) : []); return spec!.stage.kind === "equation" ? spec!.stage.steps.map((st) => st.order.map((i) => t.get(i)).join(" ")) : []; };
  const s2 = "We now build a shortcut. Write S = a + (a + d) + … + l, then reverse the same series. Adding them, every pair totals a + l, so 2S = n(a + l). To isolate S, divide both sides by 2, giving S = n(a + l) ÷ 2. So we now know the formula.";
  const b2 = { heading: "Deriving", notes: [], cues: [], stage: { kind: "equation", tokens: [{ id: "series", text: "Arithmetic series", tex: "\\text{Arithmetic series}" }, { id: "two", text: "2S = n(a + l)", tex: "2S = n(a + l)" }], steps: [0, 1, 2, 3, 4].map((s) => ({ s, order: s === 2 ? ["series", "two"] : ["series"] })) } };
  assert.deepEqual(show(validateCanvasSpec(b2, canvasSentences(s2).length, [], s2)), ["S = a + (a + d) + … + l", "2S = n(a + l)", "S = n(a + l) ÷ 2"]);
  const s3 = "We now use the formula. First 43 − 7 = 36, so n = 9 + 1 = 10. To find the sum, substitute a = 7, l = 43, and n = 10 into S = n(a + l) ÷ 2, giving S = 10(7 + 43) ÷ 2 = 250. So the sum is 250.";
  const tk = (id: string, text: string) => ({ id, text, tex: text });
  const b3 = { heading: "Using", notes: [], cues: [], stage: { kind: "equation", tokens: [tk("a", "43 − 7"), tk("e1", "="), tk("b", "36"), tk("c", ","), tk("n", "n"), tk("e2", "="), tk("d", "9 + 1"), tk("e3", "="), tk("ten", "10"), tk("S", "S"), tk("e4", "="), tk("sub", "10(7 + 43) ÷ 2"), tk("e5", "="), tk("r", "250")], steps: [{ s: 1, order: ["a", "e1", "b", "c", "n", "e2", "d", "e3", "ten"] }, { s: 2, order: ["S", "e4", "sub", "e5", "r"] }, { s: 3, order: ["S", "e4", "r"] }] } };
  assert.deepEqual(show(validateCanvasSpec(b3, canvasSentences(s3).length, [], s3)).slice(1, 2), ["S = n(a + l) ÷ 2 , S = 10(7 + 43) ÷ 2 = 250"], "formula first; a = 7, l = 43 are inputs");
  const q = validateCanvasSpec({ heading: "Series 5, 9, 13, …, 41 and angle...", notes: [{ text: "1 + 2 + 3 + …", s: 0 }], cues: [], stage: b3.stage }, 4, [], s3)!;
  assert.equal(q.heading, "Series 5, 9, 13, …, 41 and angle");
  assert.equal(q.notes[0].text, "1 + 2 + 3 + …");
  assert.deepEqual(spokenEquations("Letting h approach zero gives f′(x) = lim h→0 [f(x + h) − f(x)] ÷ h.").map((e) => e.text), ["f′(x) = lim h→0 [f(x + h) − f(x)] ÷ h"]);
  assert.equal(normalizeMath("\\lim_{h\\to 0}(f(x+h)-f(x))/h"), normalizeMath("lim h→0 [f(x + h) − f(x)] ÷ h"));
});

test("verification batch 4: powers in a chain are read; a word label glued to working goes, word equations stay", async () => {
  const { checkNumbers } = await import("../canvas/numberCheck");
  assert.deepEqual(checkNumbers("8 × 4 = 2³ × 2² = 2³⁺² = 2⁵"), []);
  assert.deepEqual(checkNumbers("32 ÷ 4 = 2⁵ ÷ 2² = 2³"), []);
  assert.equal(checkNumbers("8 × 4 = 2³ × 2² = 2⁶").length, 1, "a wrong power is still caught");
  const { dropWordClauses } = await import("../canvas/equationRepair");
  const tk = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: [tk("pts", "A(2, 1), B(5, 7), C(8, 13)"), tk("lbl", "AB and AC"), tk("ab", "AB"), tk("e", "="), tk("v", "(3, 6)")], steps: [{ s: 0, order: ["pts", "lbl"], highlight: [] }, { s: 1, order: ["ab", "e", "v"], highlight: [] }] };
  dropWordClauses(st as never);
  assert.deepEqual(st.steps[0].order, ["pts"]);
  const word = { kind: "equation" as const, tokens: [tk("g", "glucose"), tk("p", "+"), tk("o", "oxygen"), tk("to", "→"), tk("c", "carbon dioxide"), tk("p2", "+"), tk("w", "water"), tk("x", "x"), tk("e", "="), tk("two", "2")], steps: [{ s: 0, order: ["g", "p", "o", "to", "c", "p2", "w"], highlight: [] }, { s: 1, order: ["x", "e", "two"], highlight: [] }] };
  dropWordClauses(word as never);
  assert.equal(word.steps[0].order.length, 7, "a word equation keeps its terms");
});

test("a step that extends the line before writes only what it adds (maths benchmark V4)", () => {
  const tk = (id: string, text: string) => ({ id, text, tex: text });
  const stage = { kind: "equation" as const, tokens: [tk("a", "log₂(32 ÷ 4)"), tk("e", "="), tk("b", "5 − 2"), tk("e2", "="), tk("c", "3"), tk("sep", ","), tk("r", "log_b(M/N)"), tk("e3", "="), tk("s", "log_b M − log_b N"), tk("x", "2^m ÷ 2^n"), tk("e4", "="), tk("y", "2^(m−n)")], steps: [{ s: 0, order: ["x", "e4", "y"], highlight: [] }, { s: 1, order: ["a", "e", "b", "e2", "c"], highlight: [] }, { s: 2, order: ["a", "e", "b", "e2", "c", "sep", "r", "e3", "s"], highlight: [] }] };
  const { marks } = layoutPanel({ v: 1, heading: "Quotient law", notes: [], cues: [], stage } as never);
  const written = marks.filter((m) => m.type === "equation").flatMap((m) => (m.type === "equation" ? m.tokens.map((t) => t.id) : []));
  assert.equal(written.filter((id) => id === "a").length, 1, "log₂(32 ÷ 4) is written once");
  assert.ok(written.includes("r") && written.includes("s"), "the new rule is written");
});

test("round 1 prep: log bases are one character; a rebuilt row leaves out lines written elsewhere", async () => {
  const { plainTex, repairEquationRows } = await import("../canvas/equationRepair");
  assert.equal(plainTex("log_bM"), "\\log_{b} M");
  assert.equal(plainTex("log_aM ÷ log_ab"), "\\log_{a} M \\div  \\log_{a} b");
  const tk = (id: string, text: string) => ({ id, text, tex: text });
  const script = "Intro here. Then more. For x² + 4x + 5 = 0, the discriminant is 4² − 4×1×5 = 16 − 20 = −4, so x = −2 ± i. Done.";
  const st = { kind: "equation" as const, tokens: [tk("d", "4² − 4×1×5"), tk("e", "="), tk("r", "16 − 20"), tk("e2", "="), tk("m", "−4"), tk("q", "x² + 4x + 5"), tk("e3", "="), tk("z", "0"), tk("bad", "+")], steps: [{ s: 2, order: ["d", "e", "r", "e2", "m"], highlight: [] }, { s: 2, order: ["q", "e3", "z", "bad"], highlight: [] }] };
  repairEquationRows(st as never, script);
  const text = new Map(st.tokens.map((t) => [t.id, t.text]));
  const second = st.steps[1].order.map((id) => text.get(id)).join(" ");
  assert.ok(!/4² − 4×1×5/.test(second), `the discriminant line is not repeated: ${second}`);
});

test("round 1: short results, ∠ names, sin/cos words, S₂₀, units and second values are read; answers become notes", async () => {
  const eqs = (s: string) => spokenEquations(s).map((e) => e.text);
  assert.deepEqual(eqs("Combining gives 2x plus 2y equals 180 degrees, and dividing by 2 gives x plus y equals 90 degrees."), ["2x + 2y = 180°", "x + y = 90°"]);
  assert.deepEqual(eqs("Because angle ACB is x plus y, angle ACB equals 90 degrees."), ["∠ACB = 90°"]);
  assert.deepEqual(eqs("For sin θ = 3/5, substitution gives cos²θ = 1 − 9/25 = 16/25."), ["sin θ = 3/5", "cos²θ = 1 − 9/25 = 16/25"]);
  assert.deepEqual(eqs("Taking square roots gives cos θ = 4/5 or −4/5, so we need the quadrant."), ["cos θ = 4/5 or −4/5"]);
  assert.deepEqual(eqs("This gives S₂₀ = 20(6 + 82) ÷ 2 = 880."), ["S₂₀ = 20(6 + 82) ÷ 2 = 880"]);
  assert.deepEqual(eqs("Substitute into a² + b² = c²: so 100 = c², and c = 10 centimetres."), ["a² + b² = c²", "100 = c²", "c = 10 cm"]);
  assert.deepEqual(eqs("In 12x³ − 8x: 12x³ ÷ 4x = 3x² and −8x ÷ 4x = −2."), ["12x³ ÷ 4x = 3x²", "−8x ÷ 4x = −2"]);
  assert.equal(normalizeMath("8ᵏ⁺¹ − 1"), normalizeMath("8^{k+1} - 1"));
  const { plainTex, givensFirst, malformedRow } = await import("../canvas/equationRepair");
  assert.equal(plainTex("8ᵏ⁺¹"), "8^{k+1}");
  assert.equal(plainTex("[[1, 2], [3, 4]]"), "\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}");
  assert.equal(plainTex("7 choose 3"), "\\binom{7}{3}");
  assert.ok(malformedRow(["=", "cos²θ", "=", "1"]), "a row that opens on '=' is broken");
  const tk = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: [tk("u", "∠AOB = 2 × ∠ACB = 68°"), tk("g", "∠ACB = 34°")], steps: [{ s: 2, order: ["u"], highlight: [] }, { s: 2, order: ["g"], highlight: [] }] };
  givensFirst(st as never);
  assert.deepEqual(st.steps.map((x) => x.order[0]), ["g", "u"], "the given comes first");
  const { withResultNotes } = await import("../canvas/equationCheck");
  const mk = (text: string, s: number, k: number) => ({ id: `answer-${k + 1}`, text, s });
  const notes = withResultNotes([{ id: "a", text: "6² + 8² = c²", s: 1 }, { id: "b", text: "f′(x) = lim h→0", s: 0 }], "We find the hypotenuse. With legs 6 cm and 8 cm, 6² + 8² = c², so 100 = c², and c = 10 centimetres. Done.", mk);
  assert.ok(notes.some((n) => n.text === "c = 10 cm"), "the answer is a note");
  assert.ok(!notes.some((n) => /lim h→0$/.test(n.text)), "a note that breaks off goes");
});

test("round 2: factorials end no sentence and are checked; false expansions and wrong sums leave the board; matrices measure", async () => {
  const { mathsEllipsis } = await import("../canvas/plan");
  const s = mathsEllipsis("The coefficient is n! divided by r! times (n − r)!, so 6 choose 2 = 6! ÷ (2! × 4!) = 15. Great! Done.");
  assert.equal(canvasSentences(s).length, 3, "only real sentence ends split");
  assert.deepEqual(spokenEquations(s).map((e) => e.text), ["6 choose 2 = 6! ÷ (2! × 4!) = 15"]);
  const { checkNumbers } = await import("../canvas/numberCheck");
  assert.deepEqual(checkNumbers("6! ÷ (2! × 4!) = 15"), []);
  assert.equal(checkNumbers("6! ÷ 2! × 4! = 15").length, 1, "n! ÷ r! × (n − r)! is not the coefficient");
  const { falseIdentities } = await import("../canvas/equationCheck");
  const tk = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: [tk("a", "(1 + x) = (1 + x)(1 + x)"), tk("b", "(1 + x)² = 1 + 2x + x²"), tk("c", "2x + 3 = x + 7")], steps: [{ s: 0, order: ["a"], highlight: [] }, { s: 0, order: ["b"], highlight: [] }, { s: 1, order: ["c"], highlight: [] }] };
  assert.deepEqual(falseIdentities(st as never, "We expand by multiplying brackets. To solve, we rearrange.").map((f) => f.clause), ["(1 + x) = (1 + x)(1 + x)"]);
  const { dropWrongArithmetic, dropBrokenClauses } = await import("../canvas/equationRepair");
  const sums = { kind: "equation" as const, tokens: [tk("w", "6 + 10 + 14 = 5"), tk("c", ","), tk("r", "6 + 10 + 14 = 30")], steps: [{ s: 0, order: ["w", "c", "r"], highlight: [] }] };
  dropWrongArithmetic(sums as never);
  assert.deepEqual(sums.steps[0].order, ["r"]);
  const lone = { kind: "equation" as const, tokens: [tk("x", "x = 1"), tk("n", "≠")], steps: [{ s: 0, order: ["x"], highlight: [] }, { s: 1, order: ["n"], highlight: [] }] };
  dropBrokenClauses(lone as never);
  assert.equal(lone.steps.length, 1, "a lone sign is not a row");
  const { spokenIsWritten, withResultNotes } = await import("../canvas/equationCheck");
  assert.ok(spokenIsWritten("b = 12 cm", [normalizeMath("b = 12")]));
  const notes = withResultNotes([{ id: "n", text: "= 2xh + h²", s: 1 }], "We start. Expanding gives (x + h)² − x² = 2xh + h², so we divide. Done.", (text, s2, k) => ({ id: `a${k}`, text, s: s2 }));
  assert.equal(notes[0].text, "(x + h)² − x² = 2xh + h²");
  assert.ok(texEm("\\begin{pmatrix}19 & 22 \\\\ 43 & 50\\end{pmatrix}") < 6, "a matrix is as wide as its columns");
});

test("round 3: '1 + nx + n(n − 1)x² ÷ 2!' divides only its last term; a line ending on a sign is broken", async () => {
  const { bracketDivisions, dropBrokenClauses } = await import("../canvas/equationRepair");
  const tk = (id: string, text: string) => ({ id, text, tex: text });
  const st = { kind: "equation" as const, tokens: [tk("l", "(1 + x)ⁿ"), tk("e", "="), tk("one", "1"), tk("p1", "+"), tk("nx", "nx"), tk("p2", "+"), tk("t2", "n(n − 1)x²"), tk("d", "÷"), tk("f", "2!")], steps: [{ s: 0, order: ["l", "e", "one", "p1", "nx", "p2", "t2", "d", "f"], highlight: [] }] };
  bracketDivisions(st as never);
  const text = new Map(st.tokens.map((t) => [t.id, t.text]));
  assert.equal(st.steps[0].order.map((i) => text.get(i)).join(" "), "(1 + x)ⁿ = 1 + nx + n(n − 1)x² ÷ 2!", "no brackets added");
  const q = { kind: "equation" as const, tokens: [tk("x", "x"), tk("e", "="), tk("n", "−b ± √(b² − 4ac)"), tk("d", "÷"), tk("a", "2a")], steps: [{ s: 0, order: ["x", "e", "n", "d", "a"], highlight: [] }] };
  bracketDivisions(q as never);
  assert.ok(q.tokens.some((t) => /\\frac/.test(t.tex ?? "")), "the quadratic formula is still a fraction");
  const dangling = { kind: "equation" as const, tokens: [tk("a", "(1 + x)ⁿ"), tk("e", "="), tk("o", "1"), tk("p", "+"), tk("ok", "x = 1")], steps: [{ s: 0, order: ["ok"], highlight: [] }, { s: 1, order: ["a", "e", "o", "p"], highlight: [] }] };
  dropBrokenClauses(dangling as never);
  assert.equal(dangling.steps.length, 1);
});

test("round 3: narration sums in words, false chains and ≠, joins trimmed, 1 ÷ (ad − bc), quadratic number lines, −x²", async () => {
  const { narrationArithmetic } = await import("../canvas/equationCheck");
  assert.equal(narrationArithmetic("Adding in order, 3 + 7 + 11 + 15 gives 38, so S₄ = 38.").length, 1, "36, not 38");
  assert.equal(narrationArithmetic("Adding gives 3 + 7 + 11 + 15 = 36.").length, 0);
  const { falseNumberChain, trimRowJoins, bracketDivisions } = await import("../canvas/equationRepair");
  assert.ok(falseNumberChain("29 = 40 − 29 = 11"));
  assert.ok(falseNumberChain("6 − 5 = 1 ≠ 1"));
  assert.ok(!falseNumberChain("6 − 5 = 1 ≠ 0"));
  const tk = (id: string, text: string) => ({ id, text, tex: text });
  const rows = { kind: "equation" as const, tokens: [tk("g", "gives"), tk("a", "2 − 5 = −3"), tk("c", ",")], steps: [{ s: 0, order: ["g", "a", "c"], highlight: [] }] };
  trimRowJoins(rows as never);
  assert.deepEqual(rows.steps[0].order, ["a"]);
  const inv = { kind: "equation" as const, tokens: [tk("l", "A⁻¹"), tk("e", "="), tk("o", "1"), tk("d", "÷"), tk("s", "ad − bc")], steps: [{ s: 0, order: ["l", "e", "o", "d", "s"], highlight: [] }] };
  bracketDivisions(inv as never);
  assert.ok(inv.tokens.some((t) => t.tex === "\\frac{1}{ad − bc}"));
  const { parseInequality, intervalsText } = await import("../figures/components/numberLine");
  assert.equal(intervalsText(parseInequality("(x − 1)(x + 4) ≤ 0")!), "−4 ≤ x ≤ 1");
  assert.equal(intervalsText(parseInequality("x² − 5x + 6 > 0")!), "x < 2 or x > 3");
  assert.equal(intervalsText(parseInequality("−x² + 4x + 5 ≥ 0")!), "−1 ≤ x ≤ 5");
  const { evalExpr } = await import("../canvas/expr");
  assert.equal(evalExpr("-x^2", { x: 3 }), -9, "−x² is −(x²)");
  assert.equal(evalExpr("2^-1", {}), 0.5);
});

test("final round: 'log base 5 of 25 squared' is log₅(25²), matched against the board's log₅", async () => {
  const { spokenIsWritten } = await import("../canvas/equationCheck");
  const e = spokenEquations("For example, log base 5 of 25 squared equals 2 log base 5 of 25, which equals 2 times 2, or 4.").map((x) => x.text);
  assert.deepEqual(e, ["log_5(25²) = 2 log_5(25)"]);
  assert.ok(spokenIsWritten(e[0], [normalizeMath("log₅(25²) = 2 log₅(25) = 2 × 2 = 4")]));
});

test("an answer timed before its working is written when Aria says it, below the working", async () => {
  const { revealWhenSaid } = await import("../canvas/equationRepair");
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const stage = {
    kind: "equation" as const,
    tokens: [tok("c", "c"), tok("eq", "="), tok("ten", "10"), tok("a", "36"), tok("plus", "+"), tok("b", "64"), tok("eq2", "="), tok("h", "100"), tok("c2", "c²"), tok("eq3", "="), tok("h2", "100")],
    steps: [
      { s: 0, order: ["c", "eq", "ten"], highlight: [] },
      { s: 1, order: ["a", "plus", "b", "eq2", "h"], highlight: [] },
      { s: 2, order: ["c2", "eq3", "h2"], highlight: [] },
    ],
  };
  const script = "We find the hypotenuse. The squares add: 36 + 64 = 100. So c² = 100. Taking the positive root, c = 10.";
  assert.equal(revealWhenSaid(stage as never, script), 1);
  assert.deepEqual(stage.steps.map((st) => `${st.s}:${st.order[0]}`), ["1:a", "2:c2", "3:c"], "c = 10 last, on the sentence that says it");
  // A row said where it is timed, or never said, stays; "x = 1" is not found inside "x = 12".
  const keep = { kind: "equation" as const, tokens: [tok("x", "x"), tok("e", "="), tok("n", "12")], steps: [{ s: 0, order: ["x", "e", "n"], highlight: [] }] };
  assert.equal(revealWhenSaid(keep as never, "Start here. Later, x = 1."), 0);
});

test("a graph's second curve that repeats the first is dropped, and its marker moves to the first", async () => {
  const { validateCanvasSpec } = await import("../canvas/validate");
  const spec = validateCanvasSpec({
    v: 1, heading: "The cosine graph", notes: [], cues: [],
    stage: { kind: "graph", x: { label: "Angle x (degrees)", min: 0, max: 360 }, y: { label: "y", min: -1, max: 1 },
      curves: [{ id: "cos", expr: "cos(x*pi/180)", label: "y = cos x" }, { id: "shift", expr: "cos(x*pi/180)", label: "Horizontal shift" }],
      markers: [{ id: "m", x: "90", curve: "shift", label: "Root" }] },
  }, 3) as { stage: { curves: Array<{ id: string }>; markers?: Array<{ curve: string }> } } | null;
  assert.ok(spec);
  assert.deepEqual(spec.stage.curves.map((c) => c.id), ["cos"]);
  assert.equal(spec.stage.markers?.[0]?.curve, "cos");
});

test("an equation rewritten while expanding or collecting is working, not a false identity — a false expansion still goes", async () => {
  const { dropFalseIdentities } = await import("../canvas/equationRepair");
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const words = (row: string, prefix: string) => row.split(" ").map((t, i) => tok(`${prefix}${i}`, t));
  const board = (rows: Array<[number, string]>) => {
    const tokens = rows.flatMap(([, r], k) => words(r, `r${k}-`));
    return { kind: "equation" as const, tokens, steps: rows.map(([s, r], k) => ({ s, order: r.split(" ").map((_, i) => `r${k}-${i}`), highlight: [] })) };
  };
  // The tangent: "expand" on the sentence, but y − 4 = 4x − 8 and y = 4x − 4 are the same line as y − 4 = 4(x − 2).
  const tangent = board([[2, "y − 4 = 4(x − 2)"], [3, "y − 4 = 4x − 8 , y = 4x − 4"]]);
  assert.equal(dropFalseIdentities(tangent as never, "We know the gradient. We have the point. Substituting gives y − 4 = 4(x − 2). Expand to get y − 4 = 4x − 8, then y = 4x − 4."), 0);
  // Collecting: 3x + 5 − x = x + 13 − x is 2x + 5 = 13, written after it.
  const linear = board([[2, "3x + 5 − x = x + 13 − x , 2x + 5 = 13"]]);
  assert.equal(dropFalseIdentities(linear as never, "Start. Next. Collect the unknowns: 3x + 5 − x = x + 13 − x, giving 2x + 5 = 13."), 0);
  // A false expansion is still taken off.
  const wrong = board([[1, "(x + 2)² = x² + 4"]]);
  assert.equal(dropFalseIdentities(wrong as never, "Start. Expand the bracket: (x + 2)² = x² + 4."), 1);
});

test("notes of one sentence go in the order Aria says them; a both-sides line follows the equation it comes from", async () => {
  const { orderNotesAsSaid } = await import("../canvas/equationCheck");
  const n = (text: string, s: number) => ({ id: text, text, s });
  // R8 tangent board: the point was listed above the calculation that gives it.
  const tangent = "We combine both ideas. For y = x² + 2x at x = 1, first find the point: y = 1² + 2 × 1 = 3, so the point is (1, 3). Differentiate to get dy/dx = 2x + 2, then substitute x = 1 to get m = 2 × 1 + 2 = 4.";
  const a = orderNotesAsSaid([n("Point = (1, 3)", 1), n("y = 1² + 2 × 1 = 3", 1), n("m = 2 × 1 + 2 = 4", 2), n("dy/dx = 2x + 2; m = 4", 2)], tangent);
  assert.deepEqual(a.map((x) => x.text), ["y = 1² + 2 × 1 = 3", "Point = (1, 3)", "dy/dx = 2x + 2; m = 4", "m = 2 × 1 + 2 = 4"]);
  // R8 linear board: the subtracted line and its result were listed above the starting equation.
  const linear = "Unknowns can cancel. To compare the constants, subtract 2x from both sides of 2x + 3 = 2x + 7, giving 3 = 7.";
  const b = orderNotesAsSaid([n("When unknowns cancel", 0), n("2x + 3 − 2x = 2x + 7 − 2x", 1), n("3 = 7", 1), n("2x + 3 = 2x + 7", 1)], linear);
  assert.deepEqual(b.map((x) => x.text), ["When unknowns cancel", "2x + 3 = 2x + 7", "2x + 3 − 2x = 2x + 7 − 2x", "3 = 7"]);
});

test("working Aria says that the board does not show is written in at its sentence — rows on an equation board, notes elsewhere", async () => {
  const { writeMissingLines, soundLine } = await import("../canvas/writeMissing");
  const { parseMathsVerdict } = await import("../canvas/mathsCheck");
  const script = "We shrink the interval. A limit is a value approached. For f(x) = x² at x = 2, the average rate is [(2+h)² − 2²] divided by h. Expanding gives [4 + 4h + h² − 4] divided by h, then 4 + h. As h approaches zero, f′(2) = 4.";
  const verdict = parseMathsVerdict({ ship: false, problems: [
    { kind: "working-not-written", where: "board", sentence: 2, detail: "the average rate is never written", line: "[(2 + h)² − 2²] ÷ h" },
    { kind: "working-not-written", where: "board", sentence: 3, detail: "the expansion is never written", line: "[4 + 4h + h² − 4] ÷ h = 4 + h" },
    { kind: "working-not-written", where: "board", sentence: 3, detail: "false line", line: "2 + 2 = 5" },
    { kind: "working-not-written", where: "board", sentence: 3, detail: "cut line", line: "(4 + h" },
  ] });
  assert.equal(verdict.problems[0].line, "[(2 + h)² − 2²] ÷ h");
  // A figure board: notes, at the sentence that says them.
  const figure = { v: 1, heading: "The limit definition", notes: [{ id: "n1", text: "f(x) = x², x = 2", s: 2 }, { id: "n2", text: "f′(2) = 4", s: 4 }], cues: [], stage: { kind: "figure", component: "functionGraph", params: { f: "x^2" }, parts: [] } };
  const out = writeMissingLines(figure as never, verdict.problems, script, 5);
  assert.equal(out.written, 2);
  assert.equal(out.left.length, 2, "the false line and the cut line go back to the writer");
  assert.deepEqual(figure.notes.map((n) => `${n.s}:${n.text}`), ["2:f(x) = x², x = 2", "2:[(2 + h)² − 2²] ÷ h", "3:[4 + 4h + h² − 4] ÷ h = 4 + h", "4:f′(2) = 4"]);
  // An equation board: a row at that sentence.
  const tok = (id: string, text: string) => ({ id, text, tex: text });
  const eq = { v: 1, heading: "x", notes: [], cues: [], stage: { kind: "equation", tokens: [tok("f", "f′(2)"), tok("e", "="), tok("four", "4")], steps: [{ s: 4, order: ["f", "e", "four"], highlight: [] }] } };
  assert.equal(writeMissingLines(eq as never, verdict.problems.slice(0, 2), script, 5).written, 2);
  assert.deepEqual((eq.stage.steps as Array<{ s: number }>).map((st) => st.s), [2, 3, 4]);
  assert.ok(soundLine("x²(1) + (x + 1)(2x) = 3x² + 2x") && !soundLine("× 72π = 24π") && !soundLine("y = 3x +"));
});

test("a row written three times is written once, on the sentence that says it; a line starting on × is broken", async () => {
  const { dropRepeatedRows, dropBrokenClauses } = await import("../canvas/equationRepair");
  const words = "first × derivative of second + second × derivative of first";
  const tokens: Array<{ id: string; text: string; tex: string }> = [];
  const row = (k: number, text: string) => text.split(" ").map((t, j) => { const id = `r${k}-${j}`; tokens.push({ id, text: t, tex: t }); return id; });
  const stage = { kind: "equation" as const, tokens, steps: [
    { s: 0, order: row(0, words), highlight: [] },
    { s: 1, order: row(1, "6x + 4 = 6x + 4"), highlight: [] },
    { s: 2, order: row(2, words), highlight: [] },
    { s: 4, order: row(4, "× numerator derivative"), highlight: [] },
  ] };
  const script = "We differentiate sums and products. The sum rule gives 6x + 4. The product rule says first times derivative of second plus second times derivative of first. For x²(x+1) this gives 3x² + 2x. The quotient rule uses the numerator derivative.";
  assert.equal(dropRepeatedRows(stage as never, script), 1);
  assert.deepEqual(stage.steps.map((st) => st.s), [1, 2, 4], "the copy on sentence 2 (which says it) is kept");
  assert.ok(dropBrokenClauses(stage as never) >= 1);
  assert.deepEqual(stage.steps.map((st) => st.s), [1, 2]);
});

test("worked steps from the sources reach the planner line by line; long working continues on a second board", async () => {
  const { sanitizeSourcePack, packForPrompt } = await import("../webSources");
  const pack = sanitizeSourcePack({ query: "q", checklist: ["first principles"], points: [{ text: "The derivative is a limit.", sources: ["S1"] }],
    worked: [{ title: "Derivative of x² from first principles", steps: ["f(x + h) − f(x) = (x + h)² − x²", "= 2xh + h²", "÷ h gives 2x + h", "h → 0 gives 2x"], sources: ["S1"] }],
    sources: [{ id: "S1", url: "https://example.org/a", title: "A", site: "example.org" }] })!;
  assert.equal(pack.worked?.[0].steps.length, 4);
  const prompt = packForPrompt(pack);
  assert.ok(/WORKED STEPS FROM THE SOURCES/.test(prompt) && /3\. ÷ h gives 2x \+ h/.test(prompt));
  const { splitLongWorking } = await import("../canvas/splitWorking");
  const long = Array.from({ length: 12 }, (_, i) => `Step ${i + 1} of the working is said here.`).join(" ");
  const beat = (id: string, script: string) => ({ id, title: "Derivative from first principles", script, stage: "equation", brief: "", objects: [], inside: null, carry: [], interaction: "quiz", overview: false, boardNotes: [{ s: 1, text: "a" }, { s: 8, text: "b" }] });
  const out = splitLongWorking([beat("b1", "Short board. Two sentences."), beat("b2", long) as never] as never);
  assert.equal(out.count, 1);
  assert.deepEqual(out.beats.map((b) => b.id), ["b1", "b2", "b3"]);
  assert.equal(out.beats[2].title, "Derivative from first principles (continued)");
  assert.equal(out.beats[1].interaction, null, "the check card stays at the end of the working");
  assert.equal(out.beats[2].interaction, "quiz");
  assert.deepEqual(out.beats[2].boardNotes, [{ s: 3, text: "b" }]);
});

test("ten lines of working go over pages at a readable size; working beside a figure draws both side by side", async () => {
  const { validateCanvasSpec } = await import("../canvas/validate");
  const { layoutPanel } = await import("../canvas/layout");
  const rows = ["x² + 6x + 5 = 0", "x² + 6x = −5", "x² + 6x + 9 = −5 + 9", "(x + 3)² = 4", "x + 3 = ±√4", "x + 3 = ±2", "x = −3 + 2", "x = −1", "x = −3 − 2", "x = −5"];
  // "±√4" is typeset tall (a root), so ten lines no longer fit one page at a readable size.
  const tokens = rows.flatMap((r, k) => r.split(" ").map((w, j) => ({ id: `l${k}-${j}`, text: w, tex: w === "±√4" ? "\\pm\\sqrt{4}" : w })));
  const steps = rows.map((r, k) => ({ s: k, order: r.split(" ").map((_, j) => `l${k}-${j}`) }));
  const paged = validateCanvasSpec({ v: 1, heading: "Completing the square", notes: [], cues: [], stage: { kind: "equation", tokens, steps } }, 10, [], "")!;
  const eq = layoutPanel(paged).marks.filter((m) => m.type === "equation") as Array<{ size: number; until?: number }>;
  assert.equal(eq.length, 10, "every line is written");
  assert.ok(eq.every((m) => m.size >= 26), "at a readable size");
  assert.ok(eq.some((m) => m.until !== undefined) && eq.some((m) => m.until === undefined), "the first page is wiped, the last stays");
  const beside = validateCanvasSpec({ v: 1, heading: "Gradient at a point", notes: [{ id: "n", text: "note", s: 0 }], cues: [], stage: { kind: "equation", tokens: [{ id: "a", text: "4", tex: "4" }, { id: "p", text: "+", tex: "+" }, { id: "h", text: "h", tex: "h" }], steps: [{ s: 1, order: ["a", "p", "h"] }], figure: { component: "functionGraph", params: { f: "x^2", tangentAt: 2 }, parts: [] } } }, 3, [], "")!;
  const marks = layoutPanel(beside).marks;
  const fig = marks.find((m) => m.type === "figure") as { rect: { x: number; w: number } } | undefined;
  const line = marks.find((m) => m.type === "equation") as { center: number } | undefined;
  assert.ok(fig && line && line.center > fig.rect.x + fig.rect.w, "the working is to the right of the figure");
  assert.ok(!marks.some((m) => m.type === "note"), "no notes column: the working is the writing");
});
