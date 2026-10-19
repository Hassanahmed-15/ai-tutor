import test from "node:test";
import assert from "node:assert/strict";
import { cardNumbersOf } from "../canvas/cardOrder";
import type { PanelLayout } from "../canvas/layout";

/* Sticky notes are numbered along their arrows when the arrows chain them; otherwise in teaching order. */
const box = (id: string, x: number, y: number, s: number) => ({ type: "box" as const, id, rect: { x, y, w: 140, h: 80 }, label: id, color: "#2563eb", s, size: 18 });
const arrow = (id: string, x0: number, y0: number, x1: number, y1: number) => ({ type: "arrow" as const, id, p0: { x: x0, y: y0 }, c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, p1: { x: x1, y: y1 }, labelAt: { x: 0, y: 0 }, s: 0, flow: false, color: "#555" });
const layout = (marks: unknown[]): PanelLayout => ({ marks, targets: {}, stage: { x: 0, y: 0, w: 1000, h: 560 } }) as unknown as PanelLayout;

test("notes chained by arrows are numbered along the arrows, not by when Aria names them", () => {
  // Taught a, c, b, but the arrows run a → b → c.
  const l = layout([box("a", 0, 0, 0), box("b", 200, 0, 2), box("c", 400, 0, 1), arrow("ab", 140, 40, 200, 40), arrow("bc", 340, 40, 400, 40)]);
  assert.deepEqual([...cardNumbersOf(l)].sort(), [["a", 1], ["b", 2], ["c", 3]]);
});

test("a loop starts at the note Aria names first", () => {
  const l = layout([box("a", 0, 0, 1), box("b", 200, 0, 0), box("c", 100, 200, 2), arrow("ab", 140, 40, 200, 40), arrow("bc", 270, 80, 170, 200), arrow("ca", 100, 200, 70, 80)]);
  assert.deepEqual(Object.fromEntries(cardNumbersOf(l)), { b: 1, c: 2, a: 3 });
});

test("unlinked notes, or a branching map, are numbered in teaching order", () => {
  const free = layout([box("a", 0, 0, 2), box("b", 200, 0, 0), box("c", 400, 0, 1)]);
  assert.deepEqual(Object.fromEntries(cardNumbersOf(free)), { b: 1, c: 2, a: 3 });
  const fork = layout([box("a", 0, 0, 0), box("b", 200, 0, 1), box("c", 200, 200, 2), arrow("ab", 140, 40, 200, 40), arrow("ac", 140, 60, 200, 220)]);
  assert.deepEqual(Object.fromEntries(cardNumbersOf(fork)), { a: 1, b: 2, c: 3 });
  assert.deepEqual(Object.fromEntries(cardNumbersOf(layout([box("only", 0, 0, 0)]))), { only: 0 }, "one note: no number");
});
