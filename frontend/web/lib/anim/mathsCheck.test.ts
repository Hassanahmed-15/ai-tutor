import test from "node:test";
import assert from "node:assert/strict";
import { mathsCheck, mathsCheckOn, mathsCheckRequest, mathsFixes, parseMathsVerdict, patchNarration } from "../canvas/mathsCheck";
import type { CanvasBoardSpec } from "../canvas/types";

test("maths examiner: on for maths lectures only, and can be switched off", () => {
  assert.equal(mathsCheckOn("Sum of an arithmetic series", []), true);
  assert.equal(mathsCheckOn("How do vaccines work?", [{ title: "Antibodies", brief: "immune memory" }]), false);
  process.env.CANVAS_MATHS_CHECK = "off";
  assert.equal(mathsCheckOn("Sum of an arithmetic series", []), false);
  delete process.env.CANVAS_MATHS_CHECK;
});

test("maths examiner: verdicts parsed; ship only with no problems; narration fixes keep the sentence count", () => {
  const v = parseMathsVerdict({ ship: true, problems: [{ kind: "false-maths", where: "narration", sentence: 1, detail: "3 + 7 + 11 + 15 is 36, not 38", fix: "Adding in order gives 36." }, { kind: "garbled", where: "board", detail: "\"y = m\" is cut off", fix: "y = mx + c" }] });
  assert.equal(v.ship, false, "a problem means it does not ship, whatever the model said");
  assert.equal(v.problems[0].where, "narration");
  assert.equal(v.problems[1].where, "board");
  const script = "We add the terms. Adding in order gives 38. So the sum is known.";
  const patched = patchNarration(script, v.problems);
  assert.equal(patched.changed, 1);
  assert.equal(patched.script, "We add the terms. Adding in order gives 36. So the sum is known.");
  const two = patchNarration(script, [{ kind: "false-maths", where: "narration", sentence: 1, detail: "x", fix: "One. Two." }]);
  assert.equal(two.changed, 0, "a fix that is two sentences would shift every sentence after it");
  assert.match(mathsFixes(v.problems.slice(1)), /y = m.*→ y = mx \+ c/);
  assert.deepEqual(parseMathsVerdict({ ship: true, problems: [] }), { ship: true, problems: [] });
});

test("maths examiner: the request carries the numbered narration and what the board shows; a failing call ships the board", async () => {
  const spec = { v: 1, heading: "Sum", notes: [{ id: "n", text: "S₄ = 36", s: 1 }], cues: [], stage: { kind: "equation", tokens: [{ id: "a", text: "3 + 7 + 11 + 15 = 36", tex: "3+7+11+15=36" }], steps: [{ s: 1, order: ["a"], highlight: [] }] } } as unknown as CanvasBoardSpec;
  const req = mathsCheckRequest(spec, { title: "Sum", script: "We add. It gives 36." }, "Series");
  assert.match(req, /0\. We add\./);
  assert.match(req, /1\. It gives 36\./);
  assert.match(req, /3 \+ 7 \+ 11 \+ 15 = 36/);
  const broken = { chat: { completions: { create: async () => { throw new Error("network down"); } } } };
  const verdict = await mathsCheck(broken as never, "Series", spec, { title: "Sum", script: "We add. It gives 36." }, 1000);
  assert.equal(verdict.ship, true);
  assert.equal(verdict.checked, false);
});
