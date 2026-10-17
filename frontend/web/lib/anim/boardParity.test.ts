import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withCourseContract } from "../canvas/sourceContract";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { checkDiagram } from "../diagrams/check";
import { compileDiagram } from "../diagrams/render";
import type { DiagramSpec } from "../diagrams/spec";
import type { CanvasPlanBeat } from "../canvas/types";

/* Typed, PDF and video boards built like course boards (owner, 2026-10-17). */

const beat = (over: Partial<CanvasPlanBeat>) => ({ id: "b1", title: "t", script: "s.", brief: "", stage: "scene", objects: [], interaction: null, overview: false, ...over }) as unknown as CanvasPlanBeat;

test("a typed lesson's board gets the course contract: a planned 'diagram' becomes the course's board", () => {
  const out = withCourseContract(beat({ title: "Symmetric versus asymmetric encryption", brief: "compare the two key systems", stage: "diagram" }));
  assert.equal(out.stage, "compare");
  assert.deepEqual(out.requiredVisual?.stages, ["compare"]);
  assert.ok(out.requiredVisual?.mustShow.length, "the course's must-show evidence comes too");
});

test("a purpose-built stage the planner chose is kept", () => {
  const out = withCourseContract(beat({ title: "Inserting into a BST: compare keys and follow the path", stage: "structure" }));
  assert.equal(out.stage, "structure");
  assert.ok(!out.requiredVisual || out.requiredVisual.stages.includes("structure"));
});

test("no free-form 'diagram' board survives the visual policy, for any source", () => {
  for (const mode of ["prompt", "reference", "course"] as const) {
    const out = applyLessonVisualPolicy([beat({ title: "Assuming a finite list of primes", brief: "suppose every prime is listed", stage: "diagram" }), beat({ id: "b2", title: "Ocean currents of the world", brief: "warm and cold currents on a map", stage: "scene" })], { mode, aiPictures: false });
    assert.ok(out.beats.every((b) => b.stage !== "diagram"), `${mode}: ${out.beats.map((b) => b.stage).join(", ")}`);
  }
});

const primes = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "anim", "fixtures-primes-finite-list.json"), "utf8")) as { narration: string; spec: DiagramSpec };

test("the 'Assuming a Finite List' board: every line where it was placed, none on top of another, none cut", () => {
  const checked = checkDiagram(primes.spec, primes.narration);
  const drawing = compileDiagram(checked.spec);
  const texts = drawing.shapes.filter((s) => s.t === "text") as Array<{ text: string; x: number; y: number }>;
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    assert.ok(Math.abs(a.y - b.y) >= 10 || Math.abs(a.x - b.x) >= Math.max(a.text.length, b.text.length) * 4, `"${a.text}" and "${b.text}" overlap`);
  }
  const all = texts.map((t) => t.text).join(" ");
  assert.match(all, /Every prime is on the list/);
  assert.match(all, /pᵢ means any prime in the list/);
  assert.match(all, /Use the list to test whether it is/, "a label is never cut short by the checker");
});
