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

test("pictures and diagrams combine: a labelled structure is a diagram, what a thing looks like is a picture, symbols keep native renderers", () => {
  const input = [
    beat("b1", "Plant cell structure", "scene", "Identify and label the parts inside a plant cell"),
    beat("b2", "Photosynthesis atom count", "scene", "Track reactant atoms into products"),
    beat("b3", "The chemical equation", "scene", "Write and balance the equation"),
    beat("b4", "Rate against light", "scene", "Plot the rate against light intensity on a graph"),
    beat("b5", "Compare limiting factors", "scene", "Compare temperature and carbon dioxide"),
    beat("b6", "A rainforest plant in its habitat", "illustration", "What a rainforest plant and the animals around it look like"),
  ];
  const out = applyLessonVisualPolicy(input, { mode: "course", aiPictures: true });
  // A structure with no exact diagram is GENERATED as a checked textbook diagram (lib/canvas/textbookDiagram.ts),
  // not described as line art by the board writer.
  // A labelled structure with no kit is a vector diagram; a habitat view is still a photograph.
  assert.deepEqual(out.beats.map((b) => b.stage), ["diagram", "atom-map", "equation", "graph", "compare", "illustration"]);
  assert.equal(out.audit.illustrations, 1);
});

test("generated pictures are capped at four; over the cap a physical subject becomes a plain board, never line art", () => {
  const input = [
    beat("b1", "A volcano erupting", "illustration", "What an erupting volcano looks like"),
    beat("b2", "The planet Venus", "illustration", "What the planet Venus looks like through a telescope"),
    beat("b3", "The planet Mars", "illustration", "What the planet Mars looks like from orbit"),
    beat("b4", "A glacier valley", "illustration", "What a glacier valley looks like"),
    beat("b5", "A river delta", "illustration", "What a river delta looks like from above"),
    beat("b6", "Blood flow sequence", "flow"),
  ];
  const out = applyLessonVisualPolicy(input, { mode: "course", aiPictures: true });
  assert.equal(out.beats.filter((b) => b.stage === "illustration").length, 4);
  const over = out.beats.find((b) => b.stage !== "illustration" && b.id !== "b6")!;
  assert.notEqual(over.figure, "drawn");

  const required = input.map((b) => ({ ...b, requiredVisual: b.stage === "illustration" ? { stages: ["illustration"], mustShow: ["distinct visible parts"] } : undefined }));
  const exception = applyLessonVisualPolicy(required, { mode: "course", aiPictures: true });
  assert.equal(exception.beats.filter((b) => b.stage === "illustration").length, 5, "distinct assessed pictures are a justified exception");
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
  assert.notEqual(out.beats[0].stage, "illustration");
  // A lesson with no other visual has this board drawn as a real table (lesson-visual guarantee).
  assert.equal(out.beats[0].figure, "conceptTable");
});

test("every lesson gets a visual: a text-only history lesson has its dated board drawn as a timeline", () => {
  const out = applyLessonVisualPolicy([
    beat("b1", "Two different sections", "compare", "North and South economies before the war"),
    beat("b2", "From secession to war", "flow", "Lincoln elected in 1860, South Carolina secedes in 1860, Fort Sumter attacked in 1861"),
  ], { mode: "course", aiPictures: true });
  assert.equal(out.beats[1].stage, "figure");
  assert.equal(out.beats[1].figure, "timeline");
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
  assert.deepEqual(heart.preferredStages, ["figure"]);
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

test("geography boards that need a map or model become vector diagrams, never shapes3d or an icon flow", () => {
  const input = [
    beat("b1", "The three-cell model", "flow", "Hadley, Ferrel and Polar cells with the subtropical high, trade winds and polar easterlies"),
    beat("b2", "World ocean currents", "scene", "A world map of the Gulf Stream, North Atlantic Drift and Peru Current"),
    beat("b3", "Seasonal shift of the ITCZ", "compare", "January and July ITCZ over a world map of pressure belts"),
    beat("b4", "Latitude energy surplus", "graph", "Incoming solar radiation surplus between 40 degrees north and south, deficit at the poles"),
  ];
  input[3].script = "Incoming solar radiation exceeds outgoing between 40 degrees north and 40 degrees south, a surplus of 80 units. Poleward of 40 degrees there is a deficit of 100 units.";
  const out = applyLessonVisualPolicy(input, { mode: "course", aiPictures: true });
  assert.equal(out.beats[0].stage, "diagram");
  assert.notEqual(out.beats[0].figure, "shapes3d");
  assert.equal(out.beats[1].stage, "diagram");
  assert.equal(out.beats[2].stage, "diagram");
  assert.equal(out.beats[3].stage, "graph");
});

test("the exam board is never routed to a diagram", () => {
  const input = [beat("b6", "Exam practice", "exam", "Answer the structured question for full marks")];
  const out = applyLessonVisualPolicy(input, { mode: "course", aiPictures: true });
  assert.equal(out.beats[0].stage, "exam");
});

test("a real process stays an icon flow; a labelled structure does not", () => {
  const process = beat("b1", "The water cycle", "flow", "Evaporation then condensation then precipitation, a cycle of stages");
  process.script = "Water evaporates. Then it condenses. Next it falls as precipitation. The cycle repeats.";
  const structure = beat("b2", "Alpha-particle scattering", "flow", "The set-up with a source, gold foil and the paths of alpha particles");
  structure.script = "Alpha particles from a source strike a thin gold foil. Most pass straight through. Some are deflected.";
  const out = applyLessonVisualPolicy([process, structure], { mode: "course", aiPictures: false });
  assert.equal(out.beats[0].stage, "flow");
  assert.equal(out.beats[1].stage, "diagram");
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
