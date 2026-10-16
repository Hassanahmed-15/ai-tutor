import assert from "node:assert/strict";
import test from "node:test";
import { alignToNarration, unshownSentences } from "../canvas/narrationSync";
import type { CanvasBoardSpec } from "../canvas/types";

const script = "The testes produce sperm cells. Sperm travel through the sperm ducts. The urethra carries semen out of the body. Predict: which tube also carries urine? The urethra does.";

test("every label appears on the sentence that first names it — not before, not after", () => {
  const spec = { v: 1, heading: "Male system", notes: [], cues: [{ s: 0, at: 0.2, action: "point", target: "urethra" }], stage: { kind: "figure", component: "library", parts: [{ id: "testis", name: "Testes", s: 2 }, { id: "sperm-duct", name: "Sperm duct", s: 0 }, { id: "urethra", name: "Urethra", s: 0 }] } } as unknown as CanvasBoardSpec;
  alignToNarration(spec, { script });
  const parts = (spec.stage as unknown as { parts: Array<{ id: string; s: number }> }).parts;
  assert.deepEqual(parts.map((p) => p.s), [0, 1, 2], "\"sperm duct\" is not named by \"sperm cells\"");
  assert.equal(spec.cues[0].s, 2, "the pen never points at something not yet drawn");
});

test("an arrow appears only once both things it joins are on the board", () => {
  const spec = { v: 1, heading: "Route", notes: [], cues: [], stage: { kind: "flow", arrangement: "chain", nodes: [{ id: "testes", label: "Testes", s: 0 }, { id: "urethra", label: "Urethra", s: 0 }], arrows: [{ id: "a", from: "testes", to: "urethra", s: 0 }] } } as unknown as CanvasBoardSpec;
  alignToNarration(spec, { script });
  assert.equal((spec.stage as unknown as { arrows: Array<{ s: number }> }).arrows[0].s, 2);
});

test("an equation builds as Aria works it", () => {
  const spec = { v: 1, heading: "Area", notes: [], cues: [], stage: { kind: "equation", tokens: [{ id: "k", text: "k² = 9" }, { id: "a", text: "18 × 9 = 162" }], steps: [{ s: 0, order: ["k"], highlight: [] }, { s: 0, order: ["k", "a"], highlight: [] }] } } as unknown as CanvasBoardSpec;
  alignToNarration(spec, { script: "Areas scale by the square of k. Here k is 3, so k² = 9. Multiply the area by 9: 18 × 9 = 162 square metres." });
  assert.deepEqual((spec.stage as unknown as { steps: Array<{ s: number }> }).steps.map((x) => x.s), [1, 2]);
});

test("spoken teaching sentences with nothing on the board are found; a whole label counts as shown", () => {
  const spec = { v: 1, heading: "Electrolysis", notes: [], cues: [], stage: { kind: "scene", items: [{ id: "anode", kind: "box", label: "Anode (+)", cell: "B2", s: 0 }], arrows: [] } } as unknown as CanvasBoardSpec;
  const bare = unshownSentences(spec, { script: "The positive electrode is called the anode in every cell. Pressure inside the container rises steadily as gas collects there." });
  assert.deepEqual(bare, [1]);
});
