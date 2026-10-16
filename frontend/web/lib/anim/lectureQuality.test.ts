import test from "node:test";
import assert from "node:assert/strict";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { quizIssues } from "../canvas/quizLint";
import { argand, argandData, cartesianText, parseComplex, parseLocus } from "../figures/components/argand";
import { canvasSentences, teachingCycle } from "../canvas/plan";
import type { CanvasInteraction, CanvasPlanBeat, CanvasStage } from "../canvas/types";

function beat(id: string, title: string, stage: CanvasStage, script: string): CanvasPlanBeat {
  return { id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false };
}

test("most boards become diagrams: tables that fit a diagram are drawn as one", () => {
  const { beats } = applyLessonVisualPolicy([
    beat("b1", "Lincoln's election", "compare", "In 1860 Lincoln won the election. By 1861 seven states had seceded."),
    beat("b2", "Strengths and limitations of the compromise", "compare", "We weigh the strengths and limitations of the Compromise of 1850."),
    beat("b3", "Two sections", "compare", "The North and South differed in industry and labour."),
  ], { mode: "course", aiPictures: false });
  assert.equal(beats[0].figure, "timeline");
  assert.equal(beats[1].figure, "evaluationScale");
  // Two of three are diagrams: the plain comparison stays a comparison.
  assert.equal(beats[2].stage, "compare");
});

test("strict source lessons are never given invented diagrams", () => {
  const { beats } = applyLessonVisualPolicy([beat("b1", "Dates", "compare", "In 1860 and 1861 events happened.")], { mode: "strict" });
  assert.equal(beats[0].stage, "compare");
});

test("a board's title names its diagram over words its script mentions in passing", () => {
  const { beats } = applyLessonVisualPolicy([
    beat("b1", "Water moves by osmosis", "flow", "Water molecules have covalent bonds and lone pairs. Osmosis moves water through a partially permeable membrane from higher to lower water potential."),
  ], { mode: "course", aiPictures: false });
  assert.notEqual(beats[0].figure, "bonding");
});

const quiz = (question: string, texts: string[]): CanvasInteraction => ({ kind: "quiz", question, options: texts.map((text, i) => ({ text, correct: i === 0, feedback: "Because." })) } as CanvasInteraction);

test("quiz lint: yes/no cards and cards that point back at the narration are sent back", () => {
  assert.ok(quizIssues(quiz("Would one attainment pattern represent every student?", ["No, patterns differ by group", "Yes, one pattern fits all"]), "attainment pattern student").some((i) => /yes\/no/.test(i)));
  assert.ok(quizIssues(quiz("Should that pattern be called linear?", ["Non-linear, it bends", "Linear, it rises", "Linear, it is steep"]), "pattern linear").some((i) => /card alone/.test(i)));
  assert.deepEqual(quizIssues(quiz("If demand for a normal good rises, what happens to equilibrium price?", ["Price rises", "Price falls", "Price stays the same"]), "demand price equilibrium normal good"), []);
});

test("a lesson taught in Urdu has its sentences, and no prediction pause (2026-10-16)", () => {
  const script = "مضمون کا آغاز ایک دلچسپ جملے سے ہوتا ہے۔ پھر ہر پیراگراف ایک خیال پیش کرتا ہے۔ اگر آغاز کمزور ہو تو قاری پر کیا اثر پڑے گا؟ قاری دلچسپی کھو دیتا ہے اور آگے نہیں پڑھتا۔ اب ایک نئے موضوع، جیسے صفائی کی اہمیت، پر مضمون کا مضبوط آغاز لکھیے۔";
  assert.equal(canvasSentences(script).length, 5);
  assert.deepEqual(teachingCycle(script, "quiz", false), { interaction: null, cycle: undefined });
});

test("a graph with no quantity on it is drawn as a flow; a real graph stays", () => {
  const { beats } = applyLessonVisualPolicy([
    beat("b1", "Paragraph order", "graph", "A paragraph develops one central idea, and the ideas follow a logical order."),
    beat("b2", "Rate of reaction", "graph", "The rate rises as temperature increases from 20 to 40 degrees."),
  ], { mode: "course", aiPictures: false });
  assert.equal(beats[0].stage, "flow");
  assert.notEqual(beats[1].stage, "flow");
});

test("quiz lint: yes/no in Urdu and Spanish", () => {
  assert.ok(quizIssues(quiz("ترتیب کیا ہونی چاہیے؟", ["ہاں: مسئلہ، وجوہ", "نہیں: پہلے حل", "ہاں: وجوہ، مسئلہ"]), "").some((i) => /yes\/no/.test(i)));
  assert.ok(quizIssues(quiz("¿Es correcto?", ["Sí, es correcto", "No, es incorrecto"]), "").some((i) => /yes\/no/.test(i)));
});

test("a programming board is never sent to a drawn diagram", () => {
  const { beats } = applyLessonVisualPolicy([
    beat("b1", "Variables", "flow", "A variable is a named memory cell that a program reads and updates in a loop."),
    beat("b2", "Lists", "flow", "A list holds values in order."),
  ], { mode: "prompt", aiPictures: false });
  assert.ok(beats.every((b) => b.figure !== "drawn"));
});

test("Argand diagram: every form parses to the right point, written exactly", () => {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const p = parseComplex("2(cos π/3 + i sin π/3)")!;
  assert.ok(near(p.re, 1) && near(p.im, Math.sqrt(3)));
  assert.equal(cartesianText(p.re, p.im), "1 + √3i");
  const q = parseComplex("3 - 4i")!;
  assert.ok(near(q.re, 3) && near(q.im, -4));
  const r = parseComplex("4∠150°")!;
  assert.equal(cartesianText(r.re, r.im), "−2√3 + 2i");
  assert.ok(near(parseComplex("-2i")!.im, -2) && near(parseComplex("5")!.re, 5));
  const [z] = argandData({ points: "z = -1 + i" });
  assert.ok(near(z.mod, Math.SQRT2) && near(z.arg, (3 * Math.PI) / 4));
  const d = argand.build({ points: "z = 3 + 4i; w = -2 - i", conjugate: true });
  assert.ok(["point-1", "point-2", "modulus", "argument", "conjugate"].every((id) => d.parts.some((x) => x.id === id)));
});

test("Argand loci: circles, bisectors, half-lines and regions read from exam notation", () => {
  const c = parseLocus("|z - (2 + i)| = 3");
  assert.ok(c?.kind === "circle" && c.a.x === 2 && c.a.y === 1 && c.r === 3);
  const c2 = parseLocus("|z + 1 - 2i| = 2");
  assert.ok(c2?.kind === "circle" && c2.a.x === -1 && c2.a.y === 2);
  assert.equal(parseLocus("|z - 1| = |z + i|")?.kind, "bisector");
  const ray = parseLocus("arg(z - 1) = π/4");
  assert.ok(ray?.kind === "ray" && Math.abs(ray.from - Math.PI / 4) < 1e-9 && ray.a.x === 1);
  const region = parseLocus("Im z > 1");
  assert.ok(region?.kind === "line" && region.axis === "im" && region.op === ">");
  const d = argand.build({ loci: "|z - 2| ≤ 3; Im z > 1" });
  assert.ok(d.parts.some((p) => p.id === "locus-1") && d.parts.some((p) => p.id === "locus-2"));
});

test("an Argand board's numbers come from its narration when the writer gives none", async () => {
  const { complexNumbersIn } = await import("../figures/components/argand");
  assert.equal(complexNumbersIn("For z = -3 + 4i, the point is in quadrant II, so |z| = 5."), "z = -3 + 4i");
  assert.match(complexNumbersIn("Let w = 2 cis(π/3) and z = 1 − √3i.") ?? "", /w = 2 \(cos π\/3 \+ i sin π\/3\); z = 1 − √3i/);
});

test("an enzyme board gets the enzyme diagram, even when planned as an atom count", () => {
  const { beats } = applyLessonVisualPolicy([
    beat("b1", "Enzymes are biological catalysts", "atom-map", "An enzyme is a protein that acts as a biological catalyst: it speeds up reactions in cells and is not used up."),
    beat("b2", "Conservation of mass", "atom-map", "In a balanced equation the atoms are conserved: four hydrogen atoms on each side."),
  ], { mode: "course", aiPictures: false });
  assert.equal(beats[0].figure, "enzymeAction");
  assert.equal(beats[1].stage, "atom-map");
});

test("quiz lint: 'the first description is correct' and 'both descriptions are correct' are not real options", () => {
  assert.ok(quizIssues(quiz("Which description of an enzyme is correct?", ["The second description is correct.", "The first description is correct.", "Both descriptions are correct.", "Neither description is correct."]), "enzyme description").length > 0);
});

test("a biology response curve is not drawn by the maths function plotter", () => {
  const { beats } = applyLessonVisualPolicy([
    beat("b1", "Memory and long-term immunity", "graph", "On a second exposure the curve rises faster and higher: the secondary response produces more antibody in less time."),
  ], { mode: "course", aiPictures: false });
  assert.notEqual(beats[0].figure, "functionGraph");
});
