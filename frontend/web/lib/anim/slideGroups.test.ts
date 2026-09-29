import test from "node:test";
import assert from "node:assert/strict";
import { groupSlides } from "./slideGroups";

test("boards of one subtopic in a row are one line; a title met again later is its own line", () => {
  const rows = [
    { sequence: 0, title: "Overfitting", state: "ready" },
    { sequence: 1, title: "Defining Overfitting", state: "ready" },
    { sequence: 2, title: "Defining Overfitting", state: "generating" },
    { sequence: 3, title: "Defining Overfitting ", state: "queued" },
    { sequence: 4, title: "Mechanism of Overfitting", state: "queued" },
    { sequence: 5, title: "Overfitting", state: "queued" },
  ];
  const groups = groupSlides(rows);
  assert.deepEqual(groups.map((g) => [g.title, g.first, g.last, g.rows.length, g.readyCount]), [
    ["Overfitting", 0, 0, 1, 1],
    ["Defining Overfitting", 1, 3, 3, 1],
    ["Mechanism of Overfitting", 4, 4, 1, 0],
    ["Overfitting", 5, 5, 1, 0],
  ]);
});
