import test from "node:test";
import assert from "node:assert/strict";
import { capQuestionOutline, directQuestionInstruction, isDirectQuestion, parseQuestionShape } from "../planPrompt";
import { mandatoryLabels, withMandatoryLabels } from "../canvas/labelPolicy";
import { repairCues } from "../canvas/cueRepair";
import { layoutPanel } from "../canvas/layout";
import type { CanvasBoardSpec } from "../canvas/types";

/*
 * "How does the heart pump blood around the body?" for an O Level student (prompt bench, 2026-10-17):
 * ONE board, on the route of the blood only; five labels all on the right side of the heart, the
 * left ventricle — the board's key point — unlabelled; three pen cues at parts not on the picture.
 * This is that board, exactly as it shipped.
 */
const HEART = { "script": "The heart is a muscular pump with four chambers: two atria and two ventricles. Atria receive blood, while ventricles push blood out; the septum separates both sides and prevents mixing. Deoxygenated blood from the body enters the right atrium through the vena cava, then passes through the tricuspid valve into the right ventricle. The right ventricle pumps it through the pulmonary valve and pulmonary artery to the lungs. Oxygenated blood returns through the pulmonary vein, enters the left atrium, and passes through the bicuspid valve into the left ventricle. The left ventricle has the thickest wall, so it pumps blood at high pressure through the aortic valve and aorta around the body. This double circulation sends blood through the heart twice: right side to lungs, then left side to body; valves prevent backflow, such as during cycling to school.", "parts": [ { "id": "right-atrium", "name": "Right atrium", "x": 0.35, "y": 0.45, "s": 2 }, { "id": "left-ventricle", "name": "Left ventricle", "x": 0.625, "y": 0.675, "s": 4 }, { "id": "right-ventricle", "name": "Right ventricle", "x": 0.483, "y": 0.713, "s": 2 }, { "id": "left-atrium", "name": "Left atrium", "x": 0.583, "y": 0.388, "s": 4 }, { "id": "septum", "name": "Septum", "x": 0.55, "y": 0.725, "s": 0 }, { "id": "vena-cava", "name": "Vena cava", "x": 0.396, "y": 0.188, "s": 2 }, { "id": "tricuspid-valve", "name": "Tricuspid valve", "x": 0.354, "y": 0.583, "s": 2 }, { "id": "pulmonary-valve", "name": "Pulmonary valve", "x": 0.465, "y": 0.494, "s": 3 } ], "notes": [ { "id": "say-1", "s": 0, "text": "Heart: four chambers" }, { "id": "say-2", "s": 1, "text": "Septum prevents mixing" }, { "id": "say-3", "s": 2, "text": "Vena cava → right atrium" }, { "id": "say-4", "s": 3, "text": "Right ventricle → lungs" }, { "id": "say-5", "s": 4, "text": "Pulmonary vein → left atrium" }, { "id": "say-6", "s": 5, "text": "Left ventricle: thickest wall" }, { "id": "say-7", "s": 6, "text": "Double circulation" } ], "cues": [ { "s": 2, "at": 0.15, "action": "point", "target": "right-atrium" }, { "s": 1, "at": 0.28, "action": "point", "target": "septum" }, { "s": 2, "at": 0.22, "action": "point", "target": "vena-cava" }, { "s": 3, "at": 0.3, "action": "point", "target": "pulmonary-artery" }, { "s": 4, "at": 0.25, "action": "point", "target": "pulmonary-vein" }, { "s": 5, "at": 0.3, "action": "point", "target": "aorta" } ] };

function heartSpec(labels: string[]): CanvasBoardSpec {
  return {
    heading: "How the Heart Pumps Blood",
    stage: { kind: "illustration", subject: "A cross-section of the heart", src: "/x.png", parts: HEART.parts, labels } as unknown as CanvasBoardSpec["stage"],
    notes: HEART.notes,
    cues: HEART.cues as CanvasBoardSpec["cues"],
  } as CanvasBoardSpec;
}

test("a how-question about a process keeps its three steps of the answer", () => {
  const outline = [
    { title: "Heart Chambers and the Route of Blood", caption: "Four chambers, the septum and the path blood takes through them." },
    { title: "The Heartbeat: Contraction and Valves", caption: "How the atria and ventricles contract and the valves stop backflow as the heart pumps." },
    { title: "Double Circulation", caption: "Blood pumped to the lungs and to the body; why the left ventricle wall is thicker." },
  ];
  assert.deepEqual(capQuestionOutline(outline, "How does the heart pump blood around the body?"), outline);
});

test("a narrow question that the planner padded keeps only what answers it", () => {
  const outline = [
    { title: "Introduction to Light", caption: "What light is and how it travels." },
    { title: "Scattering of Sunlight", caption: "Air molecules scatter short blue wavelengths far more than red, so the sky looks blue." },
    { title: "Concrete Example: Sunsets", caption: "An example of colours at sunset." },
  ];
  const kept = capQuestionOutline(outline, "Why is the sky blue?");
  assert.deepEqual(kept.map((s) => s.title), ["Scattering of Sunlight"]);
});

test("a fact keeps the one-board rule, an idea gets two, a process two or three and the mechanism", () => {
  const fact = directQuestionInstruction("What is the SI unit of force?", { shape: "fact" });
  assert.match(fact, /Plan exactly ONE subtopic/);
  // One board for a one-idea answer was too thin (lightning: one board of ten sentences, bench 2026-10-18).
  const single = directQuestionInstruction("What does the septum do?", { shape: "single" });
  assert.match(single, /plan TWO subtopics/);
  assert.doesNotMatch(single, /TWO or THREE/);
  const unknown = directQuestionInstruction("What does the septum do?");
  assert.match(unknown, /Plan exactly ONE subtopic/, "no classification: planned as one idea, as before");
  const process = directQuestionInstruction("How does the heart pump blood around the body?", { shape: "process" });
  assert.match(process, /TWO or THREE subtopics/);
  assert.match(process, /Never more than three/);
  assert.match(process, /explain the mechanism/);
  for (const rule of [fact, single, process]) assert.match(rule, /importance, impact, role in health or applications/);
});

test("the shape answer is read strictly", () => {
  assert.equal(parseQuestionShape({ shape: "process" }), "process");
  assert.equal(parseQuestionShape({ shape: "single" }), "single");
  assert.equal(parseQuestionShape({ shape: "lesson" }), null);
  assert.equal(parseQuestionShape(null), null);
});

test("the heart board labels its key parts on both sides, not the first five said", () => {
  const ids = mandatoryLabels({ script: HEART.script }, HEART.parts, HEART.notes.map((n) => n.text));
  assert.equal(ids.length, 5);
  assert.ok(ids.includes("left-ventricle"), "the board's key point is labelled");
  assert.ok(ids.includes("right-ventricle"));
  assert.ok(ids.includes("left-atrium") || ids.includes("left-ventricle"), "the left side has a label");
  assert.ok(!ids.includes("pulmonary-valve") && !ids.includes("tricuspid-valve"), "a part said once and written nowhere loses to the chambers");
  const left = HEART.parts.filter((p) => ids.includes(p.id) && p.x > 0.55).length;
  assert.ok(left >= 2, `${left} labels on the left half of the heart (the picture's right)`);
});

test("five or fewer named parts are all labelled, in the order said (unchanged)", () => {
  const parts = HEART.parts.slice(0, 3);
  assert.deepEqual(mandatoryLabels({ script: HEART.script }, parts, []), ["right-atrium", "right-ventricle", "left-ventricle"]);
});

test("every pen cue on the heart board points at something on the board", () => {
  const spec = withMandatoryLabels(heartSpec([]), { script: HEART.script });
  const layout = layoutPanel(spec);
  const onBoard = new Set(Object.keys(layout.targets));
  const before = spec.cues.filter((c) => c.target && !onBoard.has(c.target)).length;
  assert.ok(before >= 3, `the shipped board had ${before} cues at nothing`);
  const { cues, moved } = repairCues(spec, { script: HEART.script }, onBoard);
  assert.ok(moved >= 3);
  for (const c of cues) assert.ok(!c.target || onBoard.has(c.target), `cue at ${c.target}`);
  // "…pumps it through the pulmonary valve and pulmonary artery…" (sentence 3) names the right ventricle.
  assert.equal(cues.find((c) => c.s === 3)?.target, "right-ventricle");
  // "The left ventricle … through the aortic valve and aorta" (sentence 5): the pen goes to the left ventricle.
  assert.equal(cues.find((c) => c.s === 5)?.target, "left-ventricle");
});

test("a cue already on the board, an unzoom and a recap visit are left alone", () => {
  const spec = withMandatoryLabels(heartSpec([]), { script: HEART.script });
  spec.cues = [{ s: 2, action: "point", target: "right-atrium" }, { s: 4, action: "unzoom", target: "gone" }, { s: 5, action: "visit", beat: "b1" }];
  const onBoard = new Set(Object.keys(layoutPanel(spec).targets));
  assert.deepEqual(repairCues(spec, { script: HEART.script }, onBoard).cues, spec.cues);
});

test("a unit, formula, symbol or value of something is a question, not the whole topic", () => {
  for (const q of ["What is the unit of power?", "what is the formula for density", "What is the symbol of resistance?", "what is the value of g"]) assert.equal(isDirectQuestion(q), true, q);
  for (const t of ["what is the theory of evolution", "what is the law of demand", "what is photosynthesis"]) assert.equal(isDirectQuestion(t), false, t);
});

test("a plural names every part of that kind; a singular still names none", () => {
  const parts = [{ id: "rv", name: "Right ventricle" }, { id: "lv", name: "Left ventricle" }, { id: "ra", name: "Right atrium" }, { id: "la", name: "Left atrium" }, { id: "ao", name: "Aorta" }];
  // The heartbeat board, as it shipped with only the aorta of these labelled.
  assert.deepEqual(mandatoryLabels({ script: "The atria contract first, pushing blood into the ventricles. Then blood leaves through the aorta." }, parts).sort(), ["ao", "la", "lv", "ra", "rv"]);
  assert.deepEqual(mandatoryLabels({ script: "The ventricle contracts." }, parts), [], "the singular names neither of two");
  assert.deepEqual(mandatoryLabels({ script: "Both arteries carry blood away." }, [{ id: "pa", name: "Pulmonary artery" }, { id: "ca", name: "Coronary artery" }]).sort(), ["ca", "pa"]);
});
