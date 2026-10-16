import assert from "node:assert/strict";
import test from "node:test";
import { foreignFigureWords } from "../figures/foreignText";
import { fallbackSpec } from "../canvas/fallback";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { validatePlan } from "../canvas/plan";
import type { CanvasPlanBeat } from "../canvas/types";

const beat = (over: Partial<CanvasPlanBeat>): CanvasPlanBeat => ({ id: "b1", title: "", script: "One. Two.", stage: "scene", brief: "", objects: [], inside: null, carry: [], interaction: null, overview: false, ...over }) as CanvasPlanBeat;

test("a content figure with no data of its own is recognised as someone else's lesson", () => {
  const psychology = "Opportunity sampling uses whoever is available. It is quick but biased. Volunteer sampling relies on people who reply to an advert.";
  assert.ok(foreignFigureWords("evaluationScale", {}, psychology).length >= 3, "the Treaty of Versailles demo is foreign to a sampling board");
  assert.deepEqual(foreignFigureWords("evaluationScale", { claim: "Is opportunity sampling useful?", for: "quick; cheap", against: "biased; unrepresentative" }, psychology), []);
});

test("the backup never draws a content figure's demo — it builds from what Aria says", () => {
  const spec = fallbackSpec(beat({ title: "Sampling bias", figure: "evaluationScale", stage: "figure", objects: ["claim", "for", "against"], script: "Opportunity sampling is quick and cheap. It is biased towards people who are around. Volunteer sampling attracts keen participants." }));
  assert.notEqual(spec.stage.kind, "figure");
  assert.doesNotMatch(JSON.stringify(spec), /Versailles/);
});

test("backup box titles are cut at a word, never inside one", () => {
  const spec = fallbackSpec(beat({ title: "Employment", script: "Employment structure measures the share of workers in each sector of the economy. Countries move from primary to tertiary work as they develop. The UK is now mostly tertiary." }));
  const labels = JSON.stringify(spec).match(/"label":"([^"]*)"/g) ?? [];
  for (const l of labels) assert.doesNotMatch(l, /\bstructure m"/);
});

test("an atom map is kept only for a reaction; the structure of an atom gets its diagram", () => {
  const { beats } = applyLessonVisualPolicy([
    beat({ id: "b1", title: "The atomic structure", stage: "atom-map", script: "An atom has a small positive nucleus with electrons around it. Predict: where is the electron? On an orbit around the nucleus." }),
    beat({ id: "b2", title: "Burning methane", stage: "atom-map", script: "Methane reacts with oxygen. Atoms are conserved: one carbon, four hydrogen and four oxygen on each side." }),
  ], { mode: "course", aiPictures: true });
  assert.notEqual(beats[0].stage, "atom-map");
  assert.equal(beats[1].stage, "atom-map");
});

test('the planner choosing "picture" asks for a generated textbook picture', () => {
  const plan = validatePlan({ beats: [{ title: "Alpha scattering", stage: "scene", diagram: "picture", script: "Alpha particles were fired at thin gold foil. Most passed straight through.", objects: ["foil"] }] })!;
  assert.equal(plan.beats[0].stage, "illustration");
});

test("a structure is drawn once per lesson: other boards about it get their own picture", () => {
  const { beats } = applyLessonVisualPolicy([
    beat({ id: "b1", title: "A broad, thin surface", stage: "figure", plannedFigure: "leafCrossSection", script: "A leaf is broad and thin, so light reaches the palisade cells. Predict: why is it thin? Gases diffuse a short distance." }),
    beat({ id: "b2", title: "Leaf tissues", stage: "figure", plannedFigure: "leafCrossSection", script: "Find the cuticle, the upper epidermis, the palisade mesophyll, the spongy mesophyll, the xylem and phloem, and the stoma with its guard cells. Predict: which layer has most chloroplasts? The palisade." }),
  ], { mode: "course", aiPictures: true });
  assert.equal(beats[1].figure, "leafCrossSection", "the labelling board keeps the diagram");
  assert.equal(beats[0].stage, "illustration", "the other board gets its own picture");
});

test("an atom map is one balanced reaction with formula labels", async () => {
  const { atomMapIssues } = await import("../canvas/releaseAudit");
  const g = (label: string, atoms: Array<[string, number]>) => ({ id: label, label, s: 0, atoms: atoms.map(([element, count]) => ({ element, count })) });
  const ok = { kind: "atom-map" as const, reactants: [g("C₃H₈", [["C", 3], ["H", 8]]), g("5O₂", [["O", 10]])], products: [g("3CO₂", [["C", 3], ["O", 6]]), g("4H₂O", [["H", 8], ["O", 4]])] };
  assert.deepEqual(atomMapIssues(ok), []);
  const mixed = { ...ok, products: [...ok.products, g("6CO", [["C", 6], ["O", 6]]), g("C: not fully oxidised", [["C", 1]])] };
  const issues = atomMapIssues(mixed);
  assert.ok(issues.some((i) => /do not balance/.test(i)));
  assert.ok(issues.some((i) => /formula/.test(i)));
});

test("the exam board is never routed into a diagram, and a backup never draws a data diagram's demo", () => {
  const exam = applyLessonVisualPolicy([beat({ id: "b6", title: "Exam practice", stage: "exam", script: "Calculate the bounds of the area. A length of 8 m lies between 7.5 m and 8.5 m. The lower bound is included." })], { mode: "course" });
  assert.equal(exam.beats[0].stage, "exam");
  const backup = fallbackSpec(beat({ id: "b4", title: "Bounds of rounded data", stage: "figure", figure: "numberLine", objects: ["number-line"], script: "A length of 8 m lies between 7.5 m and 8.5 m. The lower bound 7.5 is included, so 7.5 ≤ L < 8.5." }));
  assert.notEqual(backup.stage.kind, "figure", "a −2…3 number line is not this lesson's data");
});

test("haploid and diploid boards get the chromosome-sets diagram, never a picture or a flow of icons", () => {
  const { beats } = applyLessonVisualPolicy([
    beat({ id: "b1", title: "Chromosomes, DNA and genes", stage: "compare", script: "A chromosome is made of a long, coiled thread of DNA. A gene is a short section of that DNA." }),
    beat({ id: "b2", title: "Two chromosome sets: diploid", stage: "illustration", script: "A diploid nucleus has two sets of chromosomes. Each type occurs as a homologous pair, so humans have 23 pairs." }),
    beat({ id: "b3", title: "One chromosome set: haploid", stage: "illustration", script: "A haploid nucleus has one set: one chromosome of each type, written as n." }),
  ], { mode: "course", aiPictures: true });
  assert.deepEqual(beats.map((b) => b.figure), ["chromosomeSets", "chromosomeSets", "chromosomeSets"]);
});
