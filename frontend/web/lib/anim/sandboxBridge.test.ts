/**
 * THE PEN KNOWS WHAT WORD IT IS UNDER, EVEN INSIDE A SANDBOX.
 *
 * The parent document cannot see into a sandboxed board, so the sandbox reports its text and boxes
 * and the lookup happens here. Pure, so the hit test is tested exactly.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { findTextAt, type SandboxTextItem } from "../board/sandboxBridge";
import { marksNarrative } from "../board/selection";
import type { AnnotationStroke } from "../board/annotations";

const items: SandboxTextItem[] = [
  { text: "Linear Regression", x: 80, y: 60, w: 300, h: 40 },
  { text: "residual eᵢ = yᵢ − ŷᵢ", x: 120, y: 200, w: 220, h: 24 },
  { text: "loss J = Σeᵢ²", x: 120, y: 240, w: 160, h: 24 },
];

test("a point inside a text box returns that text; a point in empty board returns nothing", () => {
  assert.equal(findTextAt(items, 150, 210), "residual eᵢ = yᵢ − ŷᵢ");
  assert.equal(findTextAt(items, 200, 250), "loss J = Σeᵢ²");
  assert.equal(findTextAt(items, 600, 400), "");
});

test("a stroke that just misses the glyphs still counts — a pen tip is not a cursor", () => {
  assert.equal(findTextAt(items, 116, 198), "residual eᵢ = yᵢ − ŷᵢ", "4px outside the box, inside the padding");
  assert.equal(findTextAt(items, 100, 198), "", "far outside is still nothing");
});

test("overlapping boxes prefer the smaller one — a word over its whole line", () => {
  const nested: SandboxTextItem[] = [
    { text: "y = mx + b", x: 100, y: 100, w: 200, h: 30 },
    { text: "m", x: 140, y: 100, w: 18, h: 30 },
  ];
  assert.equal(findTextAt(nested, 148, 115), "m");
  assert.equal(findTextAt(nested, 250, 115), "y = mx + b");
});

test("marks are narrated with their gesture and the text they covered, most recent last", () => {
  const stroke = (kind: AnnotationStroke["kind"], points: Array<[number, number]>, coveredText?: string): AnnotationStroke => ({
    id: Math.random().toString(36).slice(2),
    kind,
    color: "#fff",
    width: 3,
    points: points.map(([x, y]) => ({ x, y })),
    coveredText,
  } as AnnotationStroke);
  const underline = stroke("pen", [[0.2, 0.5], [0.3, 0.502], [0.4, 0.5]], "residual");
  const circle = stroke("pen", [[0.5, 0.3], [0.6, 0.3], [0.6, 0.4], [0.5, 0.4], [0.5, 0.31]], "loss J");
  const highlight = stroke("highlight", [[0.1, 0.8], [0.3, 0.8]], "line of best fit");
  const stray = stroke("pen", [[0.7, 0.7], [0.72, 0.71]]);
  assert.equal(marksNarrative([underline, circle, highlight, stray]), 'underlined "residual"; circled "loss J"; highlighted "line of best fit"');
  assert.equal(marksNarrative([stray]), "", "a mark over nothing says nothing");
});
