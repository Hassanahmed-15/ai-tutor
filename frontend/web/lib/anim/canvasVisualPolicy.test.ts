import test from "node:test";
import assert from "node:assert/strict";
import { applyLessonVisualPolicy, nativeStageFor, pictureNeedScore } from "../canvas/visualPolicy";
import type { CanvasPlanBeat, CanvasStage } from "../canvas/types";

function beat(id: string, title: string, stage: CanvasStage, brief = title): CanvasPlanBeat {
  return {
    id,
    title,
    script: `${title} is introduced clearly. The student applies the idea in a new example.`,
    stage,
    brief,
    objects: [],
    inside: null,
    carry: [],
    interaction: "quiz",
    overview: false,
  };
}

test("a physical structure gets one textbook illustration while symbolic ideas keep native renderers", () => {
  const input = [
    beat("b1", "Plant cell structure", "scene", "Identify and label the parts inside a plant cell"),
    beat("b2", "Photosynthesis atom count", "scene", "Track reactant atoms into products"),
    beat("b3", "The chemical equation", "scene", "Write and balance the equation"),
    beat("b4", "Rate against light", "scene", "Plot the rate against light intensity on a graph"),
    beat("b5", "Compare limiting factors", "scene", "Compare temperature and carbon dioxide"),
  ];
  const out = applyLessonVisualPolicy(input, { mode: "course", aiPictures: true });
  assert.deepEqual(out.beats.map((b) => b.stage), ["illustration", "atom-map", "equation", "graph", "compare"]);
  assert.equal(out.audit.illustrations, 1);
  assert.equal(out.audit.meaningfulVisuals, 5);
});

test("generated pictures are capped at two unless separate curriculum contracts require them", () => {
  const input = [
    beat("b1", "Heart structure", "illustration", "Identify and label heart anatomy"),
    beat("b2", "Lung structure", "illustration", "Identify and label lung anatomy"),
    beat("b3", "Kidney structure", "illustration", "Identify and label kidney anatomy"),
    beat("b4", "Blood flow sequence", "flow"),
  ];
  const out = applyLessonVisualPolicy(input, { mode: "course", aiPictures: true });
  assert.equal(out.beats.filter((b) => b.stage === "illustration").length, 2);
  assert.notEqual(out.beats.find((b) => b.id === "b3")?.stage, "illustration");

  const required = input.map((b) => ({ ...b, requiredVisual: b.stage === "illustration" ? { stages: ["illustration"], mustShow: ["distinct visible parts"] } : undefined }));
  const exception = applyLessonVisualPolicy(required, { mode: "course", aiPictures: true });
  assert.equal(exception.beats.filter((b) => b.stage === "illustration").length, 3, "three distinct assessed structures are a justified exception");
});

test("strict mode never invents a generated textbook picture", () => {
  const sourceBeat = beat("b1", "Inside the heart", "illustration", "Label the heart structure from the supplied page");
  sourceBeat.requiredVisual = { stages: ["illustration"], mustShow: ["labels"] };
  const out = applyLessonVisualPolicy([sourceBeat], { mode: "strict" });
  assert.equal(out.beats[0].stage, "scene");
  assert.deepEqual(out.beats[0].requiredVisual?.stages, ["scene"]);
  assert.equal(out.audit.illustrations, 0);
});

test("picture scoring and native routing reject decorative AI art for symbolic content", () => {
  const cell = beat("b1", "Cell structure", "scene", "Identify and label the organelles inside a cell");
  const equation = beat("b2", "Solve the equation", "scene", "Substitute values into the formula");
  assert.ok(pictureNeedScore(cell) >= 4);
  assert.ok(pictureNeedScore(equation) < 0);
  assert.equal(nativeStageFor(beat("b3", "VSEPR shape", "scene", "Show bonds, lone pairs and bond angle")), "molecule");
  assert.equal(nativeStageFor(beat("b4", "Water cycle", "scene", "Show the process steps and arrows")), "flow");
  assert.equal(nativeStageFor(equation), "equation");
});

test("the electrolytic cell board is drawn by the wired-cell renderer, not a picture or an equation board", () => {
  const input = [
    beat("b1", "The electrolysis cell", "illustration", "Label the anode, cathode, electrolyte and power supply of the cell apparatus"),
    beat("b2", "Half-equations at the electrodes", "equation", "Write the half-equations at the anode and cathode in electrolysis"),
  ];
  const out = applyLessonVisualPolicy(input, { mode: "course" });
  assert.equal(out.beats[0].stage, "scene");
  assert.deepEqual(out.beats[0].objects.slice(0, 4), ["power-supply", "electrolyte", "anode", "cathode"]);
  assert.equal(out.beats[1].stage, "equation", "only the first cell board is redrawn");
  assert.equal(out.audit.meaningfulVisuals, 2, "the wired cell counts as a purpose-built visual");
});

test("a board about the forces on an object becomes a free-body diagram", () => {
  const out = applyLessonVisualPolicy([beat("b1", "Forces on a skydiver", "illustration", "Show the weight and air resistance acting on the skydiver; the resultant force")], { mode: "course" });
  assert.equal(out.beats[0].stage, "scene");
  assert.equal(out.beats[0].objects[0], "body");
});

test("abstract or tabular content is never an AI picture", () => {
  const out = applyLessonVisualPolicy([beat("b1", "Compare perspectives with evidence", "illustration", "A labelled four-column perspective grid with rows for viewpoint, scale and evidence")], { mode: "course" });
  assert.equal(out.beats[0].stage, "compare");
});

test("the visual contract no longer turns economics 'product' into chemistry, or 'identifying' into a picture", async () => {
  const { visualRequirements } = await import("../curriculum/lessonSpec");
  const [funding, perspectives, heart] = visualRequirements([
    { text: "Explain how a company funding research into its own product can bias findings." },
    { text: "Explore the issue by identifying personal, local, national and global perspectives." },
    { text: "Identify and label the chambers of the heart." },
  ] as never);
  assert.ok(!funding.preferredStages.includes("atom-map"));
  assert.deepEqual(perspectives.preferredStages, ["compare"]);
  assert.deepEqual(heart.preferredStages, ["illustration"]);
});

test("lesson length has a floor per qualification, and humanities get an exam-depth rule", async () => {
  const { boardBudget, depthRule, specSystemPrompt } = await import("../curriculum/lessonSpec");
  const gp = boardBudget([{ text: "Explore global issues in social identity and inclusion from personal, local, national and global perspectives." }] as never, "O Level");
  assert.equal(gp.recommended, 3);
  const soc = boardBudget([{ text: "Explain how research findings can be biased." }, { text: "Use validity and reliability to judge research methods." }] as never, "AS");
  assert.ok(soc.recommended >= 4);
  assert.match(depthRule("Cambridge AS & A Level Sociology 9699"), /named sources/);
  assert.match(depthRule("Cambridge O Level Global Perspectives 2069"), /causes.*consequences/);
  assert.doesNotMatch(specSystemPrompt("Cambridge AS & A Level Sociology 9699", "AS"), /tempting content this level does NOT require/);
});

test("with AI pictures off (the default), no board is a generated picture", () => {
  const input = [
    beat("b1", "Heart structure", "illustration", "Identify and label heart anatomy"),
    beat("b2", "Plant cell structure", "scene", "Identify and label the parts inside a plant cell"),
  ];
  const out = applyLessonVisualPolicy(input, { mode: "course", aiPictures: false });
  assert.equal(out.beats.filter((b) => b.stage === "illustration").length, 0);
  assert.equal(out.audit.illustrations, 0);
});

test("a titration board is drawn as the apparatus by code, whatever stage the planner chose", () => {
  const out = applyLessonVisualPolicy([
    beat("b1", "Setting up the titration", "flow", "Burette, pipette, conical flask and indicator for an acid-base titration"),
    beat("b2", "Calculating the concentration", "equation", "Use the titre to calculate moles in the titration"),
  ], { mode: "course", aiPictures: false });
  assert.equal(out.beats[0].stage, "figure");
  assert.equal(out.beats[0].figure, "titration");
  assert.ok(out.beats[0].objects.includes("burette"));
  assert.equal(out.beats[1].stage, "equation", "a calculation board stays an equation");
});
