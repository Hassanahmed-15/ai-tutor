import test from "node:test";
import assert from "node:assert/strict";
import { validateCanvasSpec } from "../canvas/validate";
import { layoutPanel } from "../canvas/layout";

const physics = {
  heading: "Potential of a point mass", notes: [], cues: [],
  stage: {
    kind: "equation",
    tokens: [
      { id: "phi", text: "ϕ", tex: "\\phi" }, { id: "eq", text: "=", tex: "=" }, { id: "minus", text: "−", tex: "-" }, { id: "g", text: "G", tex: "G" }, { id: "m", text: "M", tex: "M" }, { id: "div", text: "/", tex: "\\frac{}{}" }, { id: "r", text: "r", tex: "r" },
      { id: "gv", text: "G = 6.67 × 10⁻¹¹", tex: "G=6.67\\times10^{-11}" }, { id: "pinf", text: "ϕ(∞)", tex: "\\phi(\\infty)" }, { id: "eq2", text: "=", tex: "=" }, { id: "zero", text: "0", tex: "0" },
    ],
    steps: [
      { s: 0, order: ["phi", "eq", "minus", "g", "m", "div", "r"] }, { s: 1, order: ["gv"] }, { s: 2, order: ["pinf", "eq2", "zero"] },
      { s: 3, order: ["minus", "g", "m", "div", "r"] }, { s: 4, order: ["minus", "g", "m", "div", "r"] },
    ],
  },
};

test("an empty fraction is typeset as its plain text, never as nothing", () => {
  const spec = validateCanvasSpec(physics, 6)!;
  assert.ok(spec.stage.kind === "equation");
  const div = spec.stage.kind === "equation" ? spec.stage.tokens.find((t) => t.id === "div") : undefined;
  assert.equal(div?.text, "/");
  assert.equal(div?.tex, undefined, "no \\frac{}{} left to typeset as a blank");
});

test("stacked working writes each line once: a step adding no new term is not printed again", () => {
  const spec = validateCanvasSpec(physics, 6)!;
  const marks = layoutPanel(spec).marks.filter((m) => m.type === "equation");
  assert.equal(marks.length, 3, "three lines of working, not five");
});
