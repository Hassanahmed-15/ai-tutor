import test from "node:test";
import assert from "node:assert/strict";
import { mandatoryLabels, namedIn, withMandatoryLabels } from "../canvas/labelPolicy";
import type { CanvasBoardSpec } from "../canvas/types";

const heartParts = ["Right atrium", "Left atrium", "Right ventricle", "Left ventricle", "Septum", "Aorta", "Vena cava", "Pulmonary artery"].map((name) => ({ id: name.toLowerCase().replace(/ /g, "-"), name }));

test("only the parts Aria names are labelled, in the order she names them", () => {
  const beat = { script: "The left ventricle pumps blood into the aorta. Its wall is thicker than the right ventricle's." };
  assert.deepEqual(mandatoryLabels(beat, heartParts), ["left-ventricle", "aorta", "right-ventricle"]);
});

test("a part the syllabus requires is labelled even if the narration does not name it", () => {
  const beat = { script: "Blood leaves the left ventricle.", requiredVisual: { stages: ["illustration"], mustShow: ["septum"] } };
  assert.deepEqual(mandatoryLabels(beat, heartParts), ["septum", "left-ventricle"]);
});

test("naming is matched by the part's distinctive words, not by every word", () => {
  assert.ok(namedIn("Magma rises from the chamber deep below.", "Magma chamber"));
  assert.ok(!namedIn("The heart has four chambers.", "Magma chamber"));
  assert.ok(namedIn("Ash and lava build up in layers.", "Layers of ash and lava"));
});

test("a picture keeps every located part but writes only the mandatory labels", () => {
  const spec = { v: 1, heading: "Heart", notes: [], cues: [], stage: { kind: "illustration", subject: "heart", parts: heartParts.map((p, i) => ({ ...p, s: i })), labels: heartParts.map((p) => p.id) } } as unknown as CanvasBoardSpec;
  const out = withMandatoryLabels(spec, { script: "The septum separates the two sides. The aorta carries blood to the body." });
  assert.equal(out.stage.kind === "illustration" ? out.stage.parts.length : 0, 8);
  assert.deepEqual(out.stage.kind === "illustration" ? out.stage.labels : [], ["septum", "aorta"]);
});

test("a part's words said in different places do not name it", () => {
  assert.ok(!namedIn("The left ventricle pumps hardest. The right side sends blood to the lungs.", "Right ventricle"));
  assert.ok(namedIn("Blood enters the right ventricle next.", "Right ventricle"));
});

test("a figure keeps at least three labels even when Aria names fewer (one label failed every attempt)", () => {
  const spec = { v: 1, heading: "DNA", notes: [], cues: [], stage: { kind: "figure", component: "heart", params: {}, parts: [{ id: "aorta", name: "Aorta", s: 0 }, { id: "left-ventricle", name: "Left ventricle", s: 0 }, { id: "septum", name: "Septum", s: 0 }, { id: "right-atrium", name: "Right atrium", s: 0 }] } } as never;
  const out = withMandatoryLabels(spec, { script: "Blood leaves the heart. It goes to the body.", requiredVisual: undefined } as never) as { stage: { parts: unknown[] } };
  assert.equal(out.stage.parts.length, 3);
});
