/**
 * THE BOARD SHOWS THE BOOK'S FIGURE THE NARRATION IS ON.
 *
 * Built like the scanned Weiss page: one part teaching two captioned figures.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { activeFigureIndex, sourceFiguresFor } from "../sourceFigures";

const BLOCKS = [
  { id: "c1", role: "caption", pageNumber: 1, text: "Figure 19.2 Binary search trees (a) before and (b) after the insertion of 6.", figureRegion: { x: 0.04, y: 0.08, width: 0.6, height: 0.19 } },
  { id: "c2", role: "caption", pageNumber: 1, text: "Figure 19.3 Deletion of node 5 with one child: (a) before and (b) after.", figureRegion: { x: 0.04, y: 0.33, width: 0.6, height: 0.19 } },
  { id: "p1", role: "paragraph", pageNumber: 1, text: "The hardest operation is remove." },
];

test("a scanned part's captioned figures are found in reading order, with their captions", () => {
  const figures = sourceFiguresFor(BLOCKS, ["c1", "c2", "p1"]);
  assert.equal(figures.length, 2);
  assert.deepEqual(figures[1].crop, BLOCKS[1].figureRegion);
  assert.match(figures[1].caption ?? "", /^Figure 19\.3/);
  assert.deepEqual(sourceFiguresFor(BLOCKS, ["p1"]), [], "prose alone has no figure");
});

test("the narration moves the board to the figure it names or describes, and otherwise stays put", () => {
  const figures = sourceFiguresFor(BLOCKS, ["c1", "c2", "p1"]);
  assert.equal(activeFigureIndex(figures, "This is illustrated in Figure 19.3, with the removal of node 5.", 0), 1);
  assert.equal(activeFigureIndex(figures, "If a node has one child, deletion lets its parent bypass it.", 0), 1, "caption words: deletion, child");
  assert.equal(activeFigureIndex(figures, "We start with the easiest case.", 1), 1, "a sentence about neither keeps the figure showing");
  assert.equal(activeFigureIndex(figures, "Look back at Figure 19.2 for the insertion.", 1), 0);
});
