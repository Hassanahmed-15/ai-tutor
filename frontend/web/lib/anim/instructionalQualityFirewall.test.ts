import test from "node:test";
import assert from "node:assert/strict";
import { classifyInstructionalTask } from "../canvas/instructionalTask";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { fallbackSpec } from "../canvas/fallback";
import { semanticBoardIssues } from "../canvas/semanticGate";
import { auditBoardForRelease } from "../canvas/releaseAudit";
import { figureComponent } from "../figures/registry";
import type { CanvasPlanBeat, CanvasStage } from "../canvas/types";

function beat(title: string, brief: string, stage: CanvasStage = "scene"): CanvasPlanBeat {
  return {
    id: "b1", title, brief, stage, objects: [], inside: null, carry: [], interaction: null, overview: false,
    script: `${brief}. Predict what the result will show? The result follows from the evidence. Apply the method to a new condition.`,
  };
}

test("instructional intent outranks an ambiguous subject keyword", () => {
  const experiment = beat("Investigating photosynthesis", "Design a fair test to measure how light intensity affects oxygen bubbles from pondweed");
  const decision = classifyInstructionalTask(experiment);
  assert.equal(decision.task, "experimental-method");
  assert.equal(decision.figure, "photosynthesisExperiment");
  const [routed] = applyLessonVisualPolicy([experiment], { mode: "course", aiPictures: false }).beats;
  assert.equal(routed.stage, "figure");
  assert.equal(routed.figure, "photosynthesisExperiment");
});

test("p-value and stationary-wave tasks route to semantic renderers", () => {
  const p = applyLessonVisualPolicy([beat("Interpreting a p-value", "Show the null distribution, observed test statistic and p-value tail")], { mode: "course" }).beats[0];
  assert.equal(p.figure, "inferenceDistribution");
  const wave = applyLessonVisualPolicy([beat("Stationary waves", "Identify nodes and antinodes and show adjacent nodes are half a wavelength apart")], { mode: "course" }).beats[0];
  assert.equal(wave.figure, "standingWave");
  const features = applyLessonVisualPolicy([beat("Wave motion and wave features", "Identify crest, trough, wavelength and amplitude on a transverse wave")], { mode: "course" }).beats[0];
  assert.equal(features.figure, "wave");
  assert.deepEqual(features.objects.sort(), ["amplitude", "crest", "trough", "wavelength", "rest-position", "compression"].sort());
});

test("semantic gate rejects plausible-looking substitutes and accepts the deterministic fallback", () => {
  const p = beat("Interpreting a p-value", "Show the null distribution, observed test statistic and p-value tail", "graph");
  const fake = {
    v: 1 as const, heading: "p-value", notes: [], cues: [],
    stage: { kind: "graph" as const, x: { label: "z", min: -4, max: 4 }, y: { label: "density", min: 0, max: 1 }, curves: [{ id: "c", expr: "0.5", s: 0 }] },
  };
  assert.match(semanticBoardIssues(fake, p).join("; "), /requires the inferenceDistribution/);
  const routed = applyLessonVisualPolicy([p], { mode: "course" }).beats[0];
  const safe = fallbackSpec(routed);
  assert.deepEqual(semanticBoardIssues(safe, routed), []);
  assert.equal(safe.stage.kind === "figure" && safe.stage.component, "inferenceDistribution");
});

test("semantic figures stay textbook-sized when explanatory notes are present", () => {
  const p = beat("Interpreting a p-value", "Show the null distribution, observed test statistic and p-value tail", "figure");
  const routed = applyLessonVisualPolicy([p], { mode: "course" }).beats[0];
  const safe = fallbackSpec(routed);
  safe.notes = [
    { id: "n1", text: "The null distribution models results expected when H₀ is true.", s: 0 },
    { id: "n2", text: "The observed statistic locates the sample result.", s: 1 },
    { id: "n3", text: "The shaded tail is the p-value region.", s: 2 },
  ];
  assert.deepEqual(semanticBoardIssues(safe, routed), []);
});

test("deterministic figures encode the required scientific invariants", () => {
  const inference = figureComponent("inferenceDistribution")!.build({ observed: 2, tail: "right" });
  assert.ok(inference.shapes.some((shape) => shape.part === "p-value-region" && shape.fill !== "none"), "tail is shaded");
  assert.ok(inference.parts.some((part) => part.id === "observed-statistic"), "observed statistic is marked");

  const experiment = figureComponent("photosynthesisExperiment")!.build({ distanceCm: 25 });
  assert.ok(["light-source", "ruler", "pondweed", "oxygen", "thermometer"].every((id) => experiment.parts.some((part) => part.id === id)));

  const wave = figureComponent("standingWave")!.build({ loops: 3 });
  assert.ok(wave.shapes.filter((shape) => shape.part === "node").length >= 4);
  assert.ok(wave.parts.some((part) => part.id === "node-spacing"));
});

test("the final release audit is also applied to deterministic fallbacks", () => {
  const p = beat("Interpreting a p-value", "Show the null distribution, observed test statistic and p-value tail", "figure");
  const routed = applyLessonVisualPolicy([p], { mode: "course" }).beats[0];
  const safe = fallbackSpec(routed);
  assert.deepEqual(auditBoardForRelease(safe, routed), []);
  if (safe.stage.kind === "figure") safe.stage.parts = safe.stage.parts.filter((part) => part.id !== "observed-statistic");
  assert.match(auditBoardForRelease(safe, routed).map((finding) => finding.message).join(" "), /observed-statistic/);
});
