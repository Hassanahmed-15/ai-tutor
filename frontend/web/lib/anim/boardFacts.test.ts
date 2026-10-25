import test from "node:test";
import assert from "node:assert/strict";
import { alignNotesWithStructure, applyExaminerFixes } from "../canvas/boardFacts";
import type { CanvasBoardSpec } from "../canvas/types";
import type { MathsProblem } from "../canvas/mathsCheck";

// The bipartite check lecture (owner, 2026-10-25): "U = {A, B}" while the colours put D in that set too, and
// "E = blue" while Aria said red — both caught by the examiner, both shipped.
const graph = { kind: "graph", nodes: ["A", "B", "C", "D", "E"].map((v) => ({ id: v.toLowerCase(), value: v })), edges: [{ from: "a", to: "c" }, { from: "c", to: "d" }, { from: "c", to: "e" }, { from: "b", to: "e" }] };
const steps = [
  { s: 0 },
  { s: 1, ops: [{ op: "group", id: "a", group: 0 }, { op: "group", id: "c", group: 1 }] },
  { s: 2, ops: [{ op: "group", id: "d", group: 0 }] },
  { s: 3, ops: [{ op: "group", id: "e", group: 1 }, { op: "group", id: "b", group: 0 }] },
];
const board = (notes: Array<{ text: string; s: number }>) => ({ v: 1, heading: "Two sets", cues: [], notes: notes.map((n, i) => ({ id: `n${i}`, ...n })), stage: { kind: "structure", structure: graph, steps } }) as unknown as CanvasBoardSpec;

test("layer 1: the examiner's quoted correction replaces the wrong text on the board", () => {
  const spec = board([{ text: "C = blue", s: 1 }, { text: "E = blue", s: 3 }]);
  (spec.notes[1] as { tex?: string }).tex = "E = \\text{blue}";
  // The examiner's words from the check lecture's board 5.
  const problems: MathsProblem[] = [
    { kind: "contradicts-narration", where: "board", detail: 'The board note says "E = blue", but Aria says E is coloured red from C and the C–E edge detects equal colours.', fix: 'It should read "E = red".' },
    { kind: "unexplained", where: "board", detail: 'The label "pubkey" is never explained.', fix: "Explain it in the narration." },
    { kind: "wrong-trace", where: "narration", sentence: 2, detail: "x", fix: "A whole corrected sentence." },
  ];
  const r = applyExaminerFixes(spec, problems);
  assert.equal(r.fixed, 1);
  assert.equal(spec.notes[1].text, "E = red");
  assert.equal((spec.notes[1] as { tex?: string }).tex, undefined, "typeset again from its new words");
  assert.equal(r.left.length, 1, "an instruction with no exact text is left for a rewrite");
  // A note the examiner corrected is never changed back by the drawing check.
  alignNotesWithStructure(spec);
  assert.equal(spec.notes[1].text, "E = red");
});

test("layer 2: a vertex's colour and a set's members are corrected from the drawing", () => {
  const spec = board([{ text: "A = blue", s: 1 }, { text: "C = orange", s: 1 }, { text: "D = orange", s: 2 }, { text: "U = {A, B}", s: 2 }]);
  const r = alignNotesWithStructure(spec);
  assert.equal(spec.notes[2].text, "D = blue", "D is in the blue set when it is said");
  assert.equal(spec.notes[3].text, "U = {A, D}", "U is the blue set, and at that sentence it holds A and D");
  assert.equal(spec.notes[0].text, "A = blue");
  assert.equal(r.fixed, 2);
});

test("layer 2: the board's own words for the sets are learned (colour 1 / colour 2), and notes that agree are untouched", () => {
  const spec = board([{ text: "A: colour 1", s: 1 }, { text: "C: colour 2", s: 1 }, { text: "D: colour 1", s: 2 }, { text: "E: colour 1", s: 3 }, { text: "B: colour 1", s: 3 }]);
  const r = alignNotesWithStructure(spec);
  assert.equal(spec.notes[3].text, "E: colour 2", "E was put in the second set");
  assert.equal(r.fixed, 1);
  const clean = board([{ text: "A = blue", s: 1 }, { text: "Edges join the two sets", s: 2 }]);
  assert.equal(alignNotesWithStructure(clean).fixed, 0);
});

test("a board with no coloured sets is left alone", () => {
  const spec = { v: 1, heading: "x", cues: [], notes: [{ id: "n", text: "A = blue", s: 0 }], stage: { kind: "structure", structure: graph, steps: [{ s: 0 }] } } as unknown as CanvasBoardSpec;
  assert.equal(alignNotesWithStructure(spec).fixed, 0);
});

test("layer 2 leaves a note alone when Aria says the same thing (then the drawing is the one that is wrong)", () => {
  const spec = board([{ text: "A = blue", s: 1 }, { text: "E = blue", s: 3 }, { text: "D = blue", s: 2 }]);
  const script = "We start. A is blue and C is orange. D joins A in blue. Then E is coloured blue, which clashes with B.";
  alignNotesWithStructure(spec, script);
  assert.equal(spec.notes[1].text, "E = blue", "Aria says E is blue: the note stays");
  const silent = board([{ text: "A = blue", s: 1 }, { text: "E = blue", s: 3 }, { text: "D = blue", s: 2 }]);
  alignNotesWithStructure(silent, "We start. A and C differ. D joins A. Then E gets its colour.");
  assert.equal(silent.notes[1].text, "E = orange", "no word from Aria: the drawing decides");
});
