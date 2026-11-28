import { test } from "node:test";
import assert from "node:assert/strict";
import { sameTable, stageTable, withoutDrawnTables } from "../canvas/boardDedupe";
import { layoutPanel } from "../canvas/layout";
import { revealUnits, type BoardBlock } from "../canvas/blocks";
import type { CanvasBoardSpec, StageSpec } from "../canvas/types";

// The saved Economics board 5 (QA 2026-11-28): the same measures table in the notes column and on the stage.
const stage = {
  kind: "figure", component: "conceptTable",
  params: { columns: "Measure|Example|Value forgone", rows: "Money|Studying|Income forgone;Time|Studying instead of working|Working hours;Leisure|Leisure replaces paid work|Pleasure and income", headerColumn: true },
  parts: [],
} as unknown as StageSpec;
const spoken = "Money is one measure, such as income forgone while studying. Time is another measure, such as hours spent studying instead of working. Leisure can provide pleasure, while income can be forgone when leisure replaces paid work.";
const blocks: BoardBlock[] = [
  { id: "b1", section_id: "b5", kind: "definition", s: 0, e: 0, board_text: "**Opportunity cost** is measured by the value of the next best alternative.", spoken_text: "Opportunity cost is measured by the value of the next best alternative." },
  { id: "b2", section_id: "b5", kind: "table", s: 1, e: 3, board_text: "Measures of opportunity cost", spoken_text: spoken, columns: ["Measure", "Example"], rows: [["**Money**", "Income forgone while studying."], ["**Time**", "Hours spent studying instead of working."], ["**Leisure**", "Leisure can provide pleasure."]] },
];

test("the stage's table is read from its figure", () => {
  const t = stageTable(stage)!;
  assert.deepEqual(t.rows.map((r) => r[0]), ["Money", "Time", "Leisure"]);
  assert.ok(sameTable(blocks[1], t));
  assert.ok(!sameTable({ rows: [["Rice", "x"], ["Wheat", "y"]], columns: ["Crop", "Use"] }, t), "a different table stays");
});

test("a notes table the stage already draws becomes a pointer over the same sentences", () => {
  const out = withoutDrawnTables(blocks, stage);
  assert.equal(out[0], blocks[0]);
  assert.equal(out[1].kind, "visual_ref");
  assert.equal(out[1].rows, undefined);
  assert.equal(out[1].s, 1);
  assert.equal(out[1].e, 3);
  assert.equal(out[1].spoken_text, spoken, "the spoken mapping is kept");
  assert.match(out[1].board_text, /Measures of opportunity cost/);
  assert.equal(revealUnits(out[1]).length, 1);
  assert.equal(withoutDrawnTables(blocks, { kind: "sketch", items: [] } as unknown as StageSpec), blocks, "no drawn table: untouched");
});

test("the laid-out board writes the table once; the spec (lesson notes) keeps it", () => {
  const spec = { v: 1, heading: "Opportunity Cost: Many Measures", notes: [], cues: [], stage, blocks } as unknown as CanvasBoardSpec;
  const mark = layoutPanel(spec).marks.find((m) => m.type === "blocks");
  assert.ok(mark && mark.type === "blocks");
  assert.equal(mark.blocks.filter((b) => b.kind === "table").length, 0);
  assert.equal(spec.blocks!.filter((b) => b.kind === "table").length, 1);
});
