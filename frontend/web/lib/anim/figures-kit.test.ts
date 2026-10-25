import { test } from "node:test";
import assert from "node:assert/strict";
import { registerFigureComponent } from "../figures/registry";
import { leadersCross } from "../figures/labels";
import type { FigureComponent, FigureParams } from "../figures/types";
import { layoutPanel, type Mark } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { classifyInstructionalTask } from "../canvas/instructionalTask";
import { heart } from "../figures/components/heart";
import { sequences, sequenceTerms, nthTerm } from "../figures/components/sequences";
import { sectorArc, sectorMeasures } from "../figures/components/sectorArc";
import { geneticTech } from "../figures/components/geneticTech";
import { oxygenDebt, oxygenDebtArea } from "../figures/components/oxygenDebt";
import { leafCrossSection } from "../figures/components/leafCrossSection";
import { proteinSynthesis } from "../figures/components/proteinSynthesis";
import { antibody } from "../figures/components/antibody";
import { fallbackSpec } from "../canvas/fallback";
import type { CanvasPlanBeat } from "../canvas/types";
// These tests check which ready-made kit a board is routed to. Course lessons switch picture kits off by
// default (lib/canvas/courseFigures.ts, tested in coursePicture.test.ts); the routing itself is checked here.
process.env.CANVAS_COURSE_READY_FIGURES = "on";
// …and the code diagrams themselves (owner, 2026-10-24: course lessons draw everything with gpt-image-2).
process.env.CANVAS_COURSE_CODE_DIAGRAMS = "on";


const ALL: Array<[FigureComponent, FigureParams[]]> = [
  [heart, [{}, { side: "left" }, { side: "right" }, { side: "nonsense" }]],
  [sequences, [{}, { type: "geometric", a: 2, r: 3, terms: 4 }, { type: "arithmetic", a: -5, d: 2 }, { a: "x", terms: 99 }]],
  [sectorArc, [{}, { r: 10, theta: 90 }, { theta: 240, showChord: true }, { r: -4, theta: 400 }]],
  [geneticTech, [{}, { view: "pcr" }, { enzyme: "BamHI", gene: "GFP" }, { view: "nonsense" }]],
  [oxygenDebt, [{}, { rest: 0.25, exercise: 3, exerciseMin: 5, recoveryMin: 8 }, { rest: "x" }]],
  [leafCrossSection, [{}, { view: "section" }]],
  [proteinSynthesis, [{}, { view: "transcription" }, { view: "translation" }]],
  [antibody, [{}, { bound: false }]],
];

test("new kit figures: declared parts, anchors inside, finite geometry", () => {
  for (const [c, sets] of ALL) {
    const declared = new Set(c.parts.map((p) => p.id));
    assert.ok(c.build({}).parts.length >= 2, `${c.name} default has parts`);
    for (const params of [{}, ...sets]) {
      const fig = c.build(params);
      const where = `${c.name} ${JSON.stringify(params)}`;
      assert.ok(Number.isFinite(fig.w) && fig.w > 0 && fig.h > 0, where);
      for (const p of fig.parts) {
        assert.ok(declared.has(p.id), `${where}: undeclared ${p.id}`);
        assert.ok(p.anchor.x >= 0 && p.anchor.x <= fig.w && p.anchor.y >= 0 && p.anchor.y <= fig.h, `${where}: ${p.id} inside`);
        assert.ok(p.name.length > 0 && p.name.length <= 34, `${where}: ${p.id} name ${p.name}`);
      }
      for (const sh of fig.shapes) {
        if (sh.part) assert.ok(fig.parts.some((p) => p.id === sh.part), `${where}: ${sh.part}`);
        if (sh.t === "path") assert.ok(!/NaN|Infinity/.test(sh.d), where);
      }
    }
  }
});

test("new kit figures lay out with leaders on anchors and no crossing leaders", () => {
  for (const [c] of ALL) {
    registerFigureComponent(c);
    const d = c.build({});
    const spec = validateCanvasSpec({ heading: c.title.slice(0, 40), notes: [], cues: [], stage: { kind: "figure", component: c.name, params: {}, parts: d.parts.slice(0, 6).map((p, i) => ({ id: p.id, s: i })) } }, 9);
    assert.ok(spec && spec.stage.kind === "figure", c.name);
    const layout = layoutPanel(spec!);
    const fig = layout.marks.find((m) => m.type === "figure") as Extract<Mark, { type: "figure" }>;
    const labels = layout.marks.filter((m): m is Extract<Mark, { type: "figure-label" }> => m.type === "figure-label");
    assert.ok(labels.length >= 2, c.name);
    for (const l of labels) {
      const part = fig.drawing.parts.find((p) => p.id === l.part)!;
      const end = l.leader[l.leader.length - 1];
      assert.ok(Math.abs(end.x - (fig.rect.x + part.anchor.x * fig.scale)) < 0.02, `${c.name}.${l.part}`);
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      assert.ok(!leadersCross(labels[i].leader, labels[j].leader), `${c.name}: ${labels[i].part} × ${labels[j].part}`);
    }
  }
});

test("sequence terms and sector formulae are computed, not guessed", () => {
  assert.deepEqual(sequenceTerms("arithmetic", 3, 4, 5), [3, 7, 11, 15, 19]);
  assert.deepEqual(sequenceTerms("geometric", 2, 3, 4), [2, 6, 18, 54]);
  assert.ok(nthTerm("arithmetic", 3, 4).includes("n"));
  const m = sectorMeasures(7, 90);
  assert.ok(Math.abs(m.arc - (0.25 * 2 * Math.PI * 7)) < 1e-9);
  assert.ok(Math.abs(m.area - (0.25 * Math.PI * 49)) < 1e-9);
  assert.ok(oxygenDebtArea(0.3, 2.4, 4, 6) > 0);
});

const beat = (title: string, script: string, stage: CanvasPlanBeat["stage"] = "scene"): CanvasPlanBeat => ({
  id: "b1", title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false,
});

test("visual policy routes panel-critical boards onto the new kit", () => {
  const heartBeat = applyLessonVisualPolicy([beat("Heart structure and action", "Label the right atrium, left ventricle and aorta.")], { mode: "course" }).beats[0];
  assert.equal(heartBeat.figure, "heart");
  assert.ok(heartBeat.objects.includes("aorta"), "required heart parts are labelled even when the kit has more than six parts");
  assert.equal(applyLessonVisualPolicy([beat("Sequences", "Find the nth term of the arithmetic sequence 3, 7, 11.")], { mode: "course" }).beats[0].figure, "sequences");
  assert.equal(applyLessonVisualPolicy([beat("Circles, arcs and sectors", "Find the arc length and the area of the sector.")], { mode: "course" }).beats[0].figure, "sectorArc");
  assert.equal(applyLessonVisualPolicy([beat("Oxygen debt", "Oxygen uptake rises in exercise then the oxygen debt is repaid in recovery.")], { mode: "course" }).beats[0].figure, "oxygenDebt");
  const repay = beat("How the oxygen debt is repaid", "After exercise, the heart rate remains fast so blood transports lactic acid while the oxygen debt is repaid.");
  assert.equal(applyLessonVisualPolicy([repay], { mode: "course" }).beats[0].figure, "oxygenDebt");
  assert.notEqual(classifyInstructionalTask(repay).figure, "heart");
  assert.equal(applyLessonVisualPolicy([beat("Principles of genetic technology", "A plasmid is cut at a restriction site and a gene is inserted.")], { mode: "course" }).beats[0].figure, "geneticTech");
  assert.equal(applyLessonVisualPolicy([beat("The transformer", "A step-down transformer has fewer turns on the secondary coil.")], { mode: "course" }).beats[0].figure, "electromagnetism");
  assert.equal(applyLessonVisualPolicy([beat("Transformations", "Translate the triangle by the column vector, then reflect it in the mirror line.")], { mode: "course" }).beats[0].figure, "coordinateGrid");
  assert.notEqual(classifyInstructionalTask(beat("Read the vertex", "Complete the square and read the vertex of the quadratic y = x² + 4x.")).figure, "coordinateGrid");
  assert.notEqual(applyLessonVisualPolicy([beat("Definite integrals and exact evaluation", "Evaluate the definite integral from 0 to 1 of x².")], { mode: "course" }).beats[0].figure, "evaluationScale");
  assert.equal(applyLessonVisualPolicy([beat("The leaf as a photosynthesis organ", "Label the palisade mesophyll, stomata and xylem in a leaf cross-section.")], { mode: "course" }).beats[0].figure, "leafCrossSection");
  assert.equal(applyLessonVisualPolicy([beat("Protein synthesis", "DNA is transcribed to mRNA, then translated at a ribosome into a polypeptide.")], { mode: "course" }).beats[0].figure, "proteinSynthesis");
  assert.equal(applyLessonVisualPolicy([beat("Active immunity and antibodies", "An antibody binds its antigen at the antigen-binding site.")], { mode: "course" }).beats[0].figure, "antibody");
  assert.equal(applyLessonVisualPolicy([beat("Inequalities", "Solve −2 < x ≤ 3 and show the solution set on a number line.")], { mode: "course" }).beats[0].figure, "numberLine");
  assert.equal(applyLessonVisualPolicy([beat("Functions", "Sketch y = f(x) and read the domain and range.")], { mode: "course" }).beats[0].figure, "functionGraph");
  assert.equal(applyLessonVisualPolicy([beat("The trapezium rule", "Use the trapezium rule with four strips to approximate the area under the curve.")], { mode: "course" }).beats[0].figure, "riemannSum");
  assert.notEqual(classifyInstructionalTask(beat("Core derivatives and composites", "Differentiate e to the x, ln x, and a composite with the chain rule.")).figure, "functionGraph");
  assert.notEqual(classifyInstructionalTask(beat("Products and quotients", "Differentiate using the product rule and the quotient rule.")).figure, "functionGraph");
  assert.notEqual(applyLessonVisualPolicy([beat("Trigonometric identities before integration", "A transformation chain rewrites sin²x with a double-angle identity before integration.")], { mode: "course" }).beats[0].figure, "coordinateGrid");
});

test("instructional task maps the heart labelling outcome to the heart figure", () => {
  const d = classifyInstructionalTask(beat("Heart", "Draw and label the human heart."));
  assert.equal(d.figure, "heart");
  assert.ok(d.requiredParts?.includes("aorta"));
});

test("heart fallback still labels aorta when the script names other chambers first", () => {
  const planned = beat("Heart structure", "The right atrium receives blood. The left ventricle pumps it out.", "figure");
  planned.figure = "heart";
  planned.requiredVisual = { stages: ["figure"], mustShow: ["right-atrium", "left-ventricle", "aorta"] };
  const spec = fallbackSpec(planned);
  assert.equal(spec.stage.kind, "figure");
  if (spec.stage.kind !== "figure") return;
  assert.ok(spec.stage.parts.some((p) => p.id === "aorta"), spec.stage.parts.map((p) => p.id).join(","));
});

test("transformer fallback draws the transformer, not a solenoid", () => {
  const planned = beat("The transformer", "Vs / Vp = Ns / Np for a step-down transformer.", "figure");
  planned.figure = "electromagnetism";
  const spec = fallbackSpec(planned);
  assert.ok(spec.stage.kind === "figure" && spec.stage.component === "electromagnetism");
  if (spec.stage.kind !== "figure") return;
  assert.equal(spec.stage.params?.device, "transformer");
  const drawn = layoutPanel(spec).marks.find((m) => m.type === "figure") as Extract<Mark, { type: "figure" }>;
  assert.ok(drawn.drawing.parts.some((p) => p.id === "primary-coil"), "primary coil present");
  assert.ok(drawn.drawing.parts.some((p) => p.id === "secondary-coil"), "secondary coil present");
});
