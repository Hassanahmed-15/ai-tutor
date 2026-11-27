import { test } from "node:test";
import assert from "node:assert/strict";
import { uncoveredKeyBlocks } from "../canvas/documentContext";
import type { SuprnotesLessonInput } from "../suprnotes";

// QA report 2026-11-27: a strict lecture "covering every page" never taught Table 1 or a worked example.
const doc = {
  title: "Ohm's law",
  contentBlocks: [
    { id: "p1-b1", type: "paragraph", text: "Current is the rate of flow of charge.", pageNumber: 1 },
    { id: "p1-b2", type: "paragraph", heading: "Worked example", text: "A lamp of resistance 4 Ω has 12 V across it. I = V ÷ R = 12 ÷ 4 = 3 A.", pageNumber: 1 },
    { id: "p2-b1", type: "table", heading: "Table 1: series and parallel", columns: ["", "Series", "Parallel"], rows: [["If one bulb breaks", "all go out", "others stay on"], ["Current", "same everywhere", "splits between branches"]], pageNumber: 2 },
  ],
} as unknown as SuprnotesLessonInput;

test("a table or worked example no board teaches is named; one a board names or says is not", () => {
  const prose = [{ script: "Current is the rate of flow of charge.", source: { pages: [1, 2], blocks: ["p1-b1"] } }];
  const missing = uncoveredKeyBlocks(doc, prose);
  assert.deepEqual(missing.map((m) => m.id), ["p1-b2", "p2-b1"]);
  assert.match(missing[1].label, /the table "Table 1: series and parallel"/);

  const said = [...prose, { script: "A lamp of 4 ohms with 12 volts across it carries 12 divided by 4, which is 3 amps.", source: { pages: [1] } }];
  assert.deepEqual(uncoveredKeyBlocks(doc, said).map((m) => m.id), ["p2-b1"], "the example's numbers were said");

  const named = [...said, { script: "In series every bulb goes out.", source: { pages: [2], blocks: ["p2-b1"] } }];
  assert.deepEqual(uncoveredKeyBlocks(doc, named), []);
});
