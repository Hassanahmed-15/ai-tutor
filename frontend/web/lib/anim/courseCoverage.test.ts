import assert from "node:assert/strict";
import test from "node:test";
import { courseCoverageGaps, keyPointTaught, requiredTermsOf, termUsed } from "../canvas/courseCoverage";
import { courseBoardSentences } from "../canvas/lessonRequest";
import { visualRequirements } from "../curriculum/lessonSpec";

test("a key point is taught when most of its words are said on its board", () => {
  assert.ok(keyPointTaught("The cuticle is a waxy layer that reduces water loss.", "Look at the waxy cuticle: it reduces water loss from the leaf."));
  assert.ok(!keyPointTaught("Each stoma is controlled by two guard cells that open or close the pore.", "The palisade cells contain many chloroplasts."));
});

test("a board that drops key points is reported with exactly what it left out", () => {
  const gaps = courseCoverageGaps(
    [{ id: "b1", title: "Leaf tissues", script: "The waxy cuticle reduces water loss. Palisade cells hold many chloroplasts." }],
    [{ heading: "Leaf tissues", keyIdeas: ["The cuticle is waxy and reduces water loss.", "Palisade cells contain many chloroplasts.", "Each stoma is controlled by two guard cells.", "Air spaces give a large internal surface for gas exchange."] }],
    ["cuticle", "guard cell"],
  );
  assert.equal(gaps.boards.length, 1);
  assert.equal(gaps.boards[0].missing.length, 2);
  assert.deepEqual(gaps.terms, ["guard cell"]);
});

test("refresher boards are skipped when boards are matched to the plan's blocks", () => {
  const gaps = courseCoverageGaps(
    [{ id: "b1", title: "Refresher", script: "Remember fractions.", refresher: true }, { id: "b2", title: "Scale", script: "The scale factor multiplies every length, because the shapes are similar." }],
    [{ heading: "Scale", keyIdeas: ["The scale factor multiplies every length."] }],
  );
  assert.equal(gaps.boards.length, 0);
});

test("terms and sentence counts read from the lesson document", () => {
  assert.deepEqual(requiredTermsOf(["Level: O Level.", "Use these terms: scale factor, enlargement."]), ["scale factor", "enlargement"]);
  assert.ok(termUsed("scale factor", "the scale factors are equal"));
  assert.equal(courseBoardSentences({ keyIdeas: Array(9).fill("x"), text: "Worked example: 3 × 2" }), 11, "capped: a board with more to say is two boards");
  assert.equal(courseBoardSentences({ keyIdeas: ["a"], text: "" }), 6, "the floor");
});

test("an outcome's own listed structures become required labels; budgets are not code", () => {
  const [leaf] = visualRequirements([{ code: null, text: "Label a dicot leaf's cuticle, stomata, guard cells, mesophyll, air spaces, vascular bundles, chloroplasts and epidermis, and explain how each is adapted." }]);
  for (const part of ["cuticle", "guard-cell", "air-space", "chloroplast", "vascular-bundle"]) assert.ok(leaf.mustShow.includes(part), part);
  const [budget] = visualRequirements([{ code: null, text: "Prepare a flexible budget statement." }], [{ outcomeRef: 1, teach: "Separate fixed and variable costs and flex the variable costs.", visualEvidence: "", check: "", transfer: "" }]);
  assert.ok(!budget.preferredStages.includes("code"));
});

test("depth: a board that lists facts without reasons, or skips its worked example, is sent back", async () => {
  const { depthIssues } = await import("../canvas/courseCoverage");
  const block = { keyIdeas: ["a", "b", "c", "d"], text: "Worked example: 1. Scale factor 9/6 = 1.5. 2. x = 10 × 1.5 = 15 cm." };
  const listing = "Similar shapes have equal angles. Sides are in proportion. The scale factor is a ratio. Lengths multiply.";
  assert.equal(depthIssues(listing, block).length, 2);
  const deep = "Similar shapes have equal angles, so their sides are in proportion. The scale factor is 9 divided by 6, which means 1.5. Because every length scales the same way, x is 10 times 1.5, so x is 15 cm.";
  assert.deepEqual(depthIssues(deep, block), []);
});

test("course boards are sized by what they explain", async () => {
  const { courseBoardSentences, workedSteps } = await import("../canvas/lessonRequest");
  assert.equal(workedSteps("Worked example: 1. a. 2. b. 3. c."), 3);
  assert.equal(courseBoardSentences({ keyIdeas: ["a", "b", "c", "d"], text: "Worked example: 1. a. 2. b. 3. c." }), 10);
});
