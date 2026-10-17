import test from "node:test";
import assert from "node:assert/strict";
import { teachingCycle, validatePlan } from "../canvas/plan";
import { OLD_TRANSFER_PROMPT, withoutOldTransferPrompt } from "../canvas/oldTransferPrompt";
import { splitNarrationSentences } from "../voice";

/* No "Predict it" in any lecture (owner's direction, 2026-10-16): no quiz, no pause for an answer. */

test("no board is given a quiz or a predict/reveal cycle, however its script or plan reads", () => {
  const script = "Teach the idea. Predict: what changes if it doubles? Reveal why. Apply it to a new case.";
  assert.deepEqual(teachingCycle(script, null, false), { interaction: null, cycle: undefined });
  assert.deepEqual(teachingCycle(script, "quiz", false), { interaction: null, cycle: undefined }, "a planned quiz is dropped too");
  const plan = validatePlan({ beats: [{ title: "Forces", script: "We teach force. What changes if mass doubles? The answer follows from F equals ma. Apply it to a bicycle.", stage: "equation", objects: ["force"], interaction: "quiz" }] });
  assert.equal(plan?.beats[0].interaction, null);
  assert.equal(plan?.beats[0].teachingCycle, undefined);
});

test("a slider the plan asked for stays; a drawing task never does (2026-10-17)", () => {
  assert.equal(teachingCycle("Explain it. Try it.", "try", false).interaction, "try");
  assert.equal(teachingCycle("Explain it. Draw it.", "draw", false).interaction, null, "no drawing tasks (2026-10-17)");
  assert.equal(validatePlan({ beats: [{ title: "Light", script: "Light drives the rate. Move the slider and watch.", stage: "graph", objects: ["rate"], interaction: "try" }] })?.beats[0].interaction, "try");
});

test("the old 'Now try the same reasoning…' ending is never added, and is taken off old scripts and the voice", () => {
  const ended = `Force changes motion. Acceleration halves when mass doubles. ${OLD_TRANSFER_PROMPT}`;
  const plan = validatePlan({ beats: [{ title: "Forces", script: ended, stage: "equation", objects: ["force"] }] })!;
  assert.equal(plan.beats[0].script, "Force changes motion. Acceleration halves when mass doubles.");
  assert.equal(validatePlan({ beats: [{ title: "Forces", script: "Force changes motion. Predict: what happens if mass doubles? Acceleration halves.", stage: "equation", objects: ["force"] }] })!.beats[0].script, "Force changes motion. Predict: what happens if mass doubles? Acceleration halves.", "nothing is appended");
  assert.deepEqual(splitNarrationSentences(ended), ["Force changes motion.", "Acceleration halves when mass doubles."]);
  assert.equal(withoutOldTransferPrompt("No ending here."), "No ending here.");
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
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "anim", "fixtures-g2-flow.json"), "utf8"));
  const spec = validateCanvasSpec(raw, 6)!;
  const fixed = dropCrossingArrows(spec, layoutPanel(spec));
  assert.ok(fixed.stage.kind === "flow" && !fixed.stage.arrows.some((a) => a.id === "reuse-arrow"));
  assert.ok(fixed.stage.kind === "flow" && fixed.stage.arrows.length === 3);
  const stage = dropContradictingPoints({ kind: "graph", x: { label: "Q", min: 0, max: 800 }, y: { label: "r", min: 0, max: 6 }, curves: [{ id: "s", expr: "2 + 0.004 * x", s: 0 }], guides: [{ id: "g", x: 500, label: "$500 billion at 3%", s: 0 }], markers: [{ id: "ok", x: "250", curve: "s", label: "3%", s: 0 }] });
  assert.equal(stage.guides, undefined);
  assert.equal(stage.markers?.length, 1);
});
