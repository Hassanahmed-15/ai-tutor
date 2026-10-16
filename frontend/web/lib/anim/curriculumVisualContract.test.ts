import test from "node:test";
import assert from "node:assert/strict";
import { visualRequirements } from "../curriculum/lessonSpec";
import { visualContractIssues } from "../curriculum/visualContract";
import type { CanvasBoardSpec } from "../canvas/types";

const board = (stage: CanvasBoardSpec["stage"]): CanvasBoardSpec => ({ v: 1, heading: "Test", notes: [], cues: [], stage });

test("Phase 3 maps syllabus verbs to a concrete visual stage", () => {
  const reqs = visualRequirements([
    { code: "1", text: "Draw and label the human heart." },
    { code: "2", text: "Calculate speed using the formula." },
    { code: "3", text: "Compare diffusion and osmosis." },
  ]);
  assert.deepEqual(reqs.map((r) => r.preferredStages[0]), ["figure", "equation", "compare"]);
  assert.ok(reqs.every((r) => r.required));
  assert.ok(reqs[0].mustShow.includes("aorta") || reqs[0].mustShow.includes("right-atrium"));
});

test("Phase 3 rejects a decorative or structurally incomplete board", () => {
  const contract = { stages: ["illustration"], mustShow: ["distinct visible parts", "labels for every required part"] };
  const empty = board({ kind: "illustration", subject: "heart", parts: [], labels: [] });
  assert.match(visualContractIssues(empty, contract).join("; "), /at least three|labels/);
  const complete = board({ kind: "illustration", subject: "heart", parts: [
    { id: "a", name: "Atrium", s: 0 }, { id: "v", name: "Ventricle", s: 1 }, { id: "valve", name: "Valve", s: 2 },
  ], labels: ["a", "v", "valve"] });
  assert.deepEqual(visualContractIssues(complete, contract), []);
});

test("a figure board is not failed for leftover equation-contract words like formula", () => {
  const grid = board({
    kind: "figure",
    component: "coordinateGrid",
    params: {},
    parts: [{ id: "object", name: "Object", s: 0 }, { id: "image", name: "Image", s: 1 }],
  });
  assert.deepEqual(visualContractIssues(grid, { stages: ["figure"], mustShow: ["formula", "operators", "object", "image"] }), []);
  const heart = board({
    kind: "figure",
    component: "heart",
    params: {},
    parts: [{ id: "right-atrium", name: "Right atrium", s: 0 }, { id: "left-ventricle", name: "Left ventricle", s: 1 }],
  });
  assert.match(visualContractIssues(heart, { stages: ["figure"], mustShow: ["aorta"] }).join("; "), /aorta/);
});

test("Phase 3 requires both sides of a comparison and both ends of an atom map", () => {
  const compare = board({ kind: "compare", left: { id: "l", title: "A", items: [{ id: "x", text: "one", s: 0 }] }, right: { id: "r", title: "B", items: [{ id: "y", text: "two", s: 0 }] } });
  assert.ok(visualContractIssues(compare, { stages: ["compare"], mustShow: ["both sides"] }).length);
  const atomMap = board({ kind: "atom-map", reactants: [], products: [] });
  assert.ok(visualContractIssues(atomMap, { stages: ["atom-map"], mustShow: ["reactant and product atom counts"] }).length);
});
