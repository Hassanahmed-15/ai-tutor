import test from "node:test";
import assert from "node:assert/strict";
import { layoutPanel } from "../canvas/layout";
import { boardNotesOf } from "../canvas/plan";
import { validateCanvasSpec } from "../canvas/validate";
import { applyMentions, mentionLabels, unsaidLabels } from "../canvas/labelMentions";
import type { CanvasBoardSpec } from "../canvas/types";

/*
 * WHAT ARIA SAYS IS WRITTEN (owner's manager, 2026-10-23: "whatever it was saying was not being written
 * down"; owner's answers: a short key phrase per teaching sentence, lists item by item, a fresh page when
 * the board is full, every diagram part she draws is named).
 */

const flow = (notes: Array<{ s: number; text: string }>, labels = ["Lungs", "Heart"]): CanvasBoardSpec =>
  validateCanvasSpec({
    heading: "Blood flow",
    notes: notes.map((n, i) => ({ id: `n${i}`, ...n })),
    stage: { kind: "flow", nodes: labels.map((label, i) => ({ id: `p${i}`, label, s: i })), arrows: labels.slice(1).map((_, i) => ({ from: `p${i}`, to: `p${i + 1}`, s: i + 1 })) },
    cues: [],
  }, 12)!;

test("the notes column holds what Aria said over most of a board — not four notes, then a wipe", () => {
  const notes = Array.from({ length: 10 }, (_, s) => ({ s, text: `Point number ${s + 1}` }));
  const marks = layoutPanel(flow(notes)).marks.filter((m) => m.type === "note") as Array<{ id: string; y: number; s: number; until?: number }>;
  assert.equal(marks.length, 10);
  const firstPage = marks.filter((m) => m.until === undefined || m.until > 6);
  assert.ok(marks.slice(0, 7).every((m) => m.until === undefined || m.until >= 7), "seven one-line notes stay up together");
  assert.ok(firstPage.length >= 7);
  // Places are fixed by the notes before them: laying the board out again moves nothing.
  const again = layoutPanel(flow(notes)).marks.filter((m) => m.type === "note") as Array<{ y: number }>;
  assert.deepEqual(again.map((m) => m.y), marks.map((m) => m.y));
  // A page is wiped only by the note that does not fit, and the next page starts at the top again.
  const wiped = marks.find((m) => m.until !== undefined);
  if (wiped) assert.ok(marks.some((m) => m.y === marks[0].y && m.s >= wiped.until!), "the next page starts at the top");
});

test("a sentence that lists several items writes them all (up to three notes), never the same note twice", () => {
  const { boardNotes } = boardNotesOf([
    { s: 1, text: "H₂O, CO₂, CO" }, { s: 1, text: "CH₄, NH₃" }, { s: 1, text: "HCl, HNO₃" }, { s: 1, text: "a fourth" },
    { s: 2, text: "H₂O, CO₂, CO" }, { s: 0, text: "Compound formulae" },
  ], 4);
  assert.deepEqual(boardNotes, [{ s: 0, text: "Compound formulae" }, { s: 1, text: "H₂O, CO₂, CO" }, { s: 1, text: "CH₄, NH₃" }, { s: 1, text: "HCl, HNO₃" }]);
});

test("a diagram part Aria never names is named on the sentence it appears on", async () => {
  const script = "Blood leaves the heart. It picks up oxygen in the lungs. Then it returns.";
  const spec = flow([], ["Heart", "Pulmonary artery", "Lungs"]);
  const needed = unsaidLabels(spec, script);
  assert.deepEqual(needed, [{ s: 1, labels: ["Pulmonary artery"] }], "heart and lungs are said; the pulmonary artery is not");
  // A good rewrite is used; one that drops a number, or names nothing, gets the plain clause instead.
  const good = applyMentions(script, needed, [{ i: 1, text: "It travels along the pulmonary artery and picks up oxygen in the lungs." }]);
  assert.match(good.script, /pulmonary artery and picks up oxygen/);
  const bad = applyMentions(script, needed, [{ i: 1, text: "It picks up oxygen." }]);
  assert.match(bad.script, /in the lungs; on the diagram this is labelled "Pulmonary artery"\./);
  assert.equal(bad.script.split(/(?<=[.!?])\s+/).length, 3, "the narration keeps its sentence count");
  // One call per board; nothing to do, no call.
  let calls = 0;
  const out = await mentionLabels(async () => { calls++; return { json: { sentences: [{ i: 1, text: "It goes up the pulmonary artery to pick up oxygen in the lungs." }] }, costUsd: 0.0004 }; }, spec, script);
  assert.equal(out.mentioned, 1);
  assert.equal(calls, 1);
  const none = await mentionLabels(async () => { calls++; return { json: {}, costUsd: 0 }; }, flow([], ["Heart", "Lungs"]), script);
  assert.equal(none.mentioned, 0);
  assert.equal(calls, 1, "every label already said: no call");
});
