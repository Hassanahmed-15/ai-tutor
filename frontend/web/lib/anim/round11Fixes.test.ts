import assert from "node:assert/strict";
import test from "node:test";
import { anchorNotes } from "../canvas/narrationSync";
import { validateCanvasSpec } from "../canvas/validate";
import { layoutPanel } from "../canvas/layout";
import { cleanExamPractice } from "../curriculum/lessonSpec";
import { trimToFit } from "../text/fit";

test("each spoken note lands on the sentence that says it, in order, whatever number the planner gave", () => {
  const script = "Bretton Woods fixed the dollar to gold. Each ounce was worth 35 dollars. The IMF lent to countries in deficit. GATT cut tariffs.";
  const notes = [{ id: "a", text: "Dollar fixed to gold", s: 0 }, { id: "b", text: "$35 per ounce", s: 0 }, { id: "c", text: "IMF lends in deficit", s: 1 }, { id: "d", text: "GATT cuts tariffs", s: 2 }];
  assert.deepEqual(anchorNotes(notes, script).map((n) => n.s), [0, 1, 2, 3]);
});

test("a worked calculation keeps every line of working on the board", () => {
  const spec = validateCanvasSpec({ heading: "Expected frequency", notes: [], cues: [], stage: { kind: "equation", tokens: [{ id: "a", text: "k² = 9" }, { id: "b", text: "18 × 9" }, { id: "c", text: "=" }, { id: "d", text: "162" }], steps: [{ s: 0, order: ["a"] }, { s: 1, order: ["b", "c", "d"] }] } } as never, 3)!;
  const lines = layoutPanel(spec).marks.filter((m) => m.type === "equation");
  assert.equal(lines.length, 2, "one line per step, both kept");
  assert.ok((lines[1] as { steps: Array<{ place: Record<string, { y: number }> }> }).steps[0].place.d.y > (lines[0] as { steps: Array<{ place: Record<string, { y: number }> }> }).steps[0].place.a.y);
});

test("an essay question is marked by levels: its total is the top band, not one mark per point", () => {
  const [q] = cleanExamPractice([{ outcomeRef: 1, commandWord: "assess", question: "To what extent did US leadership weaken?", marks: 4, markPoints: ["gold outflow", "Triffin dilemma"], modelAnswer: "…", lostMarks: "Narrating", levels: [{ level: "Level 5", marks: "25–30", descriptor: "sustained judgement" }, { level: "Level 2", marks: "7–12", descriptor: "description" }] }], 1);
  assert.equal(q.marks, 30);
  assert.equal(q.levels?.length, 2);
});

test("text is never ended with \"…\"", () => {
  assert.doesNotMatch(trimToFit("Competitive devaluation, import controls and trade wars of the 1930s", 30), /…$/);
});
