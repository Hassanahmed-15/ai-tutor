import test from "node:test";
import assert from "node:assert/strict";
import { addTransferPrompt, teachingCycle, validatePlan } from "../canvas/plan";
import { validateInteraction } from "../canvas/validate";

test("Phase 4 adds the teach-predict-reveal-transfer slots locally", () => {
  const cycle = teachingCycle("Teach the idea. Predict: what changes if it doubles? Reveal why. Apply it to a new case.", null, false);
  assert.equal(cycle.interaction, "quiz");
  assert.deepEqual(cycle.cycle, { teach: 0, predict: 1, reveal: 2, transfer: 3 });
});

test("Phase 4 preserves hands-on interactions and does not add work to recap boards", () => {
  assert.equal(teachingCycle("Explain it. Try it.", "try", false).interaction, "try");
  assert.equal(teachingCycle("Explain it. Summarise it.", null, true).interaction, null);
  assert.equal(teachingCycle("One sentence only.", null, false).cycle, undefined);
});

test("validated plans give substantive boards a prediction interaction without another model call", () => {
  const plan = validatePlan({ beats: [{ title: "Forces", script: "We teach force. What changes if mass doubles? The answer follows from F equals ma. Apply it to a bicycle.", stage: "equation", objects: ["force"] }] });
  assert.equal(plan?.beats[0].interaction, "quiz");
  assert.deepEqual(plan?.beats[0].teachingCycle, { teach: 0, predict: 1, reveal: 2, transfer: 3 });
  assert.equal(validateInteraction({ kind: "quiz", question: "What changes?", options: [
    { text: "A", correct: true, feedback: "Because the mass changes." },
    { text: "B", correct: false, feedback: "This ignores the formula." },
    { text: "C", correct: false, feedback: "That reverses the relationship." },
  ] })?.kind, "quiz");
});

test("the cycle is anchored on the script's own Predict sentence, wherever it is", () => {
  // F board 3 of the 2026-10-15 audit: position-based slots pointed the quiz at sentence 2.
  const script = "The demand curve slopes downward. A higher real interest rate makes borrowing more costly. A lower real interest rate makes borrowing less costly. Predict: when the real interest rate rises from 4 percent to 6 percent, what happens to quantity demanded? It falls to 600 billion dollars. This is movement along the curve.";
  assert.deepEqual(teachingCycle(script, null, false).cycle, { teach: 0, predict: 3, reveal: 4, transfer: 5 });
  assert.equal(teachingCycle("Teach it. Explain it. Apply it.", null, false).cycle, undefined, "no prediction, no cycle");
});

test("a board ending on its answer is kept as written — no filler line — and a real transfer is preserved", async () => {
  const { teachingCycleIssues } = await import("../canvas/predict");
  const weak = validatePlan({ beats: [{ title: "Forces", script: "Force changes motion. Predict: what happens if mass doubles? Acceleration halves. This is the force relationship.", stage: "equation", objects: ["force"] }] })!.beats[0];
  assert.deepEqual(teachingCycleIssues(weak), []);
  assert.doesNotMatch(weak.script, /try the same reasoning on a new example/i, "the filler line read out on every board is gone (audit 2026-10-17)");
  const transfer = validatePlan({ beats: [{ title: "Forces", script: "Force changes motion. Predict: what happens if mass doubles? Acceleration halves. Apply the same reasoning to a loaded bicycle.", stage: "equation", objects: ["force"] }] })!.beats[0];
  assert.deepEqual(teachingCycleIssues(transfer), []);
  assert.equal(addTransferPrompt("Teach. Predict: what happens? The answer is clear. Apply it to a new case.", "Forces", null, false), "Teach. Predict: what happens? The answer is clear. Apply it to a new case.");
  assert.match(addTransferPrompt("Teach it. Predict what changes. It doubles.", "Rates", null, false), /Predict what changes\?/);
});

test("Week 4 catches an answer printed before the prediction reveal", async () => {
  const { predictionRevealIssues } = await import("../canvas/predict");
  const beat = validatePlan({ beats: [{ title: "Rates", script: "Rate links amount and time. Predict: what is the rate for 600 grams in 3 seconds? The rate is 200 grams per second. Apply it to 900 grams in 3 seconds.", stage: "scene", objects: ["rate"] }] })!.beats[0];
  const early = { v: 1 as const, heading: "Rate", notes: [{ id: "answer", text: "200 grams per second", s: 0 }], stage: { kind: "scene" as const, items: [{ id: "rate", kind: "text" as const, label: "Rate", cell: "C3", s: 0 }], arrows: [] }, cues: [] };
  assert.match(predictionRevealIssues(early, beat).join(" "), /200|already printed/);
  early.notes[0].s = beat.teachingCycle!.reveal;
  assert.deepEqual(predictionRevealIssues(early, beat), []);
});

test("a quiz must ask what the spoken prediction asked", async () => {
  const { quizMatchesPrediction } = await import("../canvas/predict");
  const said = "Predict: using investment equals national savings plus net capital inflow, what is investment when national savings is 700 billion dollars and net capital inflow is 80 billion dollars?";
  assert.equal(quizMatchesPrediction("What does positive net capital inflow allow?", said).ok, false);
  assert.equal(quizMatchesPrediction("What is investment when national savings is $700 billion and net capital inflow is $80 billion?", said).ok, true);
});

test("quiz flaws: throwaway options, give-away length, all-of-the-above", async () => {
  const { quizIssues } = await import("../canvas/quizLint");
  const context = "Funding interests can influence the research question, method, timing or publication of findings about a product's safety.";
  const quiz = (texts: string[], right = 0) => ({ kind: "quiz" as const, question: "Which research decision might a funder influence first?", options: texts.map((text, i) => ({ text, correct: i === right, feedback: "x" })) });
  assert.deepEqual(quizIssues(quiz(["The research question or method", "The publication of the findings only", "The sample's safety rules", "The timing of the interviews"]), context), []);
  // Only a fully off-topic option is caught by words; a subtler absurd one ("birth dates after
  // publication" shares "publication") is left to the prompt's named-misconception rule.
  assert.match(quizIssues(quiz(["The research question or method", "The colour of the report cover", "The timing of the method"]), context).join(" "), /throwaways.*colour/);
  assert.match(quizIssues(quiz(["The research question or method", "All of the above", "The timing"]), context).join(" "), /all\/none/);
});

test("cards: duplicates and whole-sentence options are flaws; signs make options different; no 'Predict:' prefix", async () => {
  const { quizIssues } = await import("../canvas/quizLint");
  const { validateInteraction } = await import("../canvas/validate");
  const q = (texts: string[]) => ({ kind: "quiz" as const, question: "What is the rate?", options: texts.map((text, i) => ({ text, correct: i === 0, feedback: "x" })) });
  assert.match(quizIssues(q(["The rate is 0.030 mg per s", "The rate is 0.070 mg per s", "The rate is 0.030 mg per s"]), "rate").join(" "), /same thing/);
  assert.deepEqual(quizIssues(q(["x = 0.060 m, v = 0, a ≈ −121 m s⁻²", "x = 0, v is maximum, a = 0", "x = −0.060 m, v = 0, a ≈ +121 m s⁻²"]), "x v a"), []);
  assert.match(quizIssues(q(["The cytoplasmic enzyme is intracellular, while the secreted gut enzyme is extracellular because it catalyses the reaction outside cells.", "Both intracellular", "Both extracellular"]), "enzyme cells").join(" "), /short answers/);
  const card = validateInteraction({ kind: "quiz", question: "Predict: will both substrates bind?", options: [{ text: "No", correct: true, feedback: "Only one fits." }, { text: "Yes", correct: false, feedback: "Size is not enough." }, { text: "Only the larger", correct: false, feedback: "Size is not it." }] });
  assert.equal(card?.kind === "quiz" && card.question, "Will both substrates bind?");
});

test("last-attempt repairs: a crossing arrow and a contradicting graph label are removed", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { validateCanvasSpec } = await import("../canvas/validate");
  const { layoutPanel } = await import("../canvas/layout");
  const { dropCrossingArrows } = await import("../canvas/layoutQa");
  const { dropContradictingPoints } = await import("../canvas/graphCheck");
  const raw = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures-g2-flow.json"), "utf8"));
  const spec = validateCanvasSpec(raw, 6)!;
  const fixed = dropCrossingArrows(spec, layoutPanel(spec));
  assert.ok(fixed.stage.kind === "flow" && !fixed.stage.arrows.some((a) => a.id === "reuse-arrow"));
  assert.ok(fixed.stage.kind === "flow" && fixed.stage.arrows.length === 3);
  const stage = dropContradictingPoints({ kind: "graph", x: { label: "Q", min: 0, max: 800 }, y: { label: "r", min: 0, max: 6 }, curves: [{ id: "s", expr: "2 + 0.004 * x", s: 0 }], guides: [{ id: "g", x: 500, label: "$500 billion at 3%", s: 0 }], markers: [{ id: "ok", x: "250", curve: "s", label: "3%", s: 0 }] });
  assert.equal(stage.guides, undefined);
  assert.equal(stage.markers?.length, 1);
});
