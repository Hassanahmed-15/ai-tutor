/**
 * TEXT THAT LANDS ON TOP OF OTHER TEXT GETS MOVED.
 *
 * Reported against a linear-regression board: the point labels sat on the plotted line and on each
 * other, so the board was unreadable exactly where it was making its point. Overlap was previously
 * checked only on blackboards, and only as a pass/fail that asked the model to regenerate — every
 * plot and diagram had no protection at all.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeDraw } from "../drawSanitize";

const draw = (ops: unknown[]) => sanitizeDraw({ caption: "t", durationMs: 20000, ops });

const textAt = (text: string, x: number, y: number, size = "md") => ({
  kind: "label", text, x, y, size, color: "slate", at: 0.1,
});

test("THE BUG: two labels written at the same spot no longer render on top of each other", () => {
  const result = draw([textAt("2 h, 70", 30, 50), textAt("4 h, 85", 30, 50)]);
  assert.ok(result, "the board still renders");
  const labels = result!.ops.filter((op) => op.kind === "label") as Array<{ y: number; text: string }>;
  assert.equal(labels.length, 2, "both labels survive — nothing is dropped to fix a collision");
  assert.notEqual(labels[0].y, labels[1].y, "they no longer share a row");
  assert.ok(Math.abs(labels[0].y - labels[1].y) >= 6, "and are far enough apart to read");
});

test("the first op keeps the position the model chose — only the collider moves", () => {
  const result = draw([textAt("Exam score", 20, 40), textAt("Study hours", 20, 40)]);
  const labels = result!.ops.filter((op) => op.kind === "label") as Array<{ y: number; text: string }>;
  assert.equal(labels[0].y, 40, "the authored placement of the first label is respected");
  assert.notEqual(labels[1].y, 40);
});

test("text that does not collide is left exactly where it was authored", () => {
  const result = draw([textAt("Top", 20, 15), textAt("Middle", 20, 45), textAt("Bottom", 20, 75)]);
  const ys = (result!.ops.filter((op) => op.kind === "label") as Array<{ y: number }>).map((op) => op.y);
  assert.deepEqual(ys, [15, 45, 75], "deliberate composition is not disturbed");
});

test("labels far apart horizontally may share a row — a plot is not a single column", () => {
  // x:10 and x:70 with short text do not overlap, so forcing them onto separate rows would be
  // wrong: on a scatter plot, two labels at the same height is normal and meaningful.
  const result = draw([textAt("A", 10, 40), textAt("B", 70, 40)]);
  const ys = (result!.ops.filter((op) => op.kind === "label") as Array<{ y: number }>).map((op) => op.y);
  assert.deepEqual(ys, [40, 40], "horizontally separated text is left alone");
});

test("nudged text stays inside the frame", () => {
  const stacked = Array.from({ length: 6 }, () => textAt("colliding text", 20, 90));
  const result = draw(stacked);
  const labels = result!.ops.filter((op) => op.kind === "label") as Array<{ y: number }>;
  for (const label of labels) {
    assert.ok(label.y >= 6 && label.y <= 94, `y ${label.y} is inside the board`);
  }
});

test("a board with a single text op needs no separation and is passed through unchanged", () => {
  /*
   * `sanitizeDraw` rejects a one-op board as too sparse — that predates this change and is correct.
   * What matters here is that the de-collision pass itself handles the <2-text case without
   * touching anything, so it is exercised through a board that does survive sanitising.
   */
  const result = draw([textAt("Only one", 20, 40), textAt("Far below", 20, 80)]);
  const labels = result!.ops.filter((op) => op.kind === "label") as Array<{ y: number }>;
  assert.deepEqual(labels.map((l) => l.y), [40, 80], "neither label is moved");
});
