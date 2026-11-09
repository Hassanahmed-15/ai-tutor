import { test } from "node:test";
import assert from "node:assert/strict";
import { chartProblems, normalizeTable } from "../mathsEngine/overlap.js";

const board = { x: [-5, 10], y: [-2, 8], aspect: "equal" };
const said = (spec, re) => chartProblems({ board, ...spec }).some((p) => re.test(p));

test("a table's header given as true comes from its first row (it crashed the board)", () => {
  assert.deepEqual(normalizeTable({ header: { cols: true }, rows: [["Books", "Frequency"], [0, 2]] }), { header: { cols: ["Books", "Frequency"] }, rows: [[0, 2]] });
});

test("a header repeated as the first row is written once", () => {
  assert.deepEqual(normalizeTable({ header: { cols: ["a", "b"] }, rows: [["a", "b"], [1, 2]] }).rows, [[1, 2]]);
});

test("a table without a header is left alone", () => {
  const d = { rows: [[1, 2]] };
  assert.equal(normalizeTable(d), d);
});

test("several labels spaced apart in one text are caught, a readout is not", () => {
  assert.ok(said({ objects: [{ id: "t", type: "text", at: [0, 0], text: "A        B        C" }] }, /several labels/));
  assert.ok(said({ objects: [{ id: "t", type: "text", at: [0, 0], text: "0   2   4   6" }] }, /several labels/));
  assert.ok(!said({ objects: [{ id: "t", type: "text", at: [0, 0], text: "θ = 30°    sin θ = 0.5" }] }, /several labels/));
  assert.ok(!said({ objects: [{ id: "t", type: "text", at: [0, 0], text: "Books read" }] }, /several labels/));
});

const rect = (id, x, h) => ({ id, type: "polygon", points: [[x, 0], [x + 1, 0], [x + 1, h], [x, h]] });

test("rectangles on one baseline should be a bar chart", () => {
  assert.ok(said({ objects: [rect("a", 0, 3), rect("b", 2, 4), rect("c", 4, 2)] }, /type "bars"/));
  assert.ok(!said({ objects: [rect("a", 0, 3), rect("b", 2, 4)] }, /type "bars"/), "two rectangles are an area model");
  assert.ok(!said({ objects: [rect("a", 0, 3), rect("b", 2, 3), rect("c", 4, 3)] }, /type "bars"/), "equal heights are a row of shapes");
});

test("rows of symbols should be a pictogram, and its values must fit its unit", () => {
  const dot = (id, x) => ({ id, type: "text", at: [x, 0], text: "●" });
  assert.ok(said({ objects: [dot("a", 0), dot("b", 2), dot("c", 4)] }, /type "pictogram"/));
  assert.ok(said({ objects: [{ id: "p", type: "pictogram", categories: ["A"], values: [3], unit: 4 }] }, /not a whole or half/));
  assert.ok(!said({ objects: [{ id: "p", type: "pictogram", categories: ["A"], values: [6], unit: 4 }] }, /not a whole or half/));
  assert.ok(said({ objects: [{ id: "p", type: "pictogram", categories: ["A"], values: [6], unit: 4, symbol: "★" }] }, /not a whole number/));
});

test("two identical stem-and-leaf diagrams are caught unless one keeps the data's order", () => {
  const leaf = (id, extra) => ({ id, type: "stemleaf", data: [12, 15, 21], ...extra });
  assert.ok(said({ objects: [leaf("a"), leaf("b")] }, /show the same thing/));
  assert.ok(!said({ objects: [leaf("a", { ordered: false }), leaf("b")] }, /show the same thing/));
});

test("writing on writing and writing on a pie are caught", () => {
  const t = (id, at, text) => ({ id, type: "text", at, text });
  assert.ok(said({ objects: [t("a", [2, 2], "Frequency table"), t("b", [2.2, 2], "Frequency")] }, /sit on each other/));
  assert.ok(!said({ objects: [t("a", [-3, 6], "One"), t("b", [8, 0], "Two")] }, /sit on each other/));
  assert.ok(said({ objects: [{ id: "p", type: "pie", at: [4, 3], radius: 2, values: [1, 1] }, t("x", [4, 3], "Pets")] }, /sits on pie/));
});

test("a table that would widen onto the chart beside it is caught", () => {
  const table = { id: "t", type: "table", at: [-1, 4], cell: [0.9, 0.7], rows: [["Frequency of books", "Frequency of pens"], [0, 2]], header: { cols: true } };
  assert.ok(said({ objects: [table, { id: "b", type: "bars", x: [0, 1, 2], values: [2, 4, 3] }] }, /table t and bars b/));
  assert.ok(!said({ objects: [{ ...table, at: [-30, 4] }, { id: "b", type: "bars", x: [0, 1, 2], values: [2, 4, 3] }] }, /table t and bars b/));
});
