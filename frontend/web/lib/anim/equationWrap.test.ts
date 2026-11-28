import { test } from "node:test";
import assert from "node:assert/strict";
import { continuationX, layoutPanel } from "../canvas/layout";
import type { CanvasBoardSpec, EquationStage } from "../canvas/types";

// Economics board 8 (QA 2026-11-28): worded lines of working, wrapped, read as separate equations.
const words = [
  ["oc", "Opportunity cost of leisure"], ["e1", "="], ["h", "4 hours"], ["x1", "×"], ["r", "10 dollars/hour"], ["e2", "="], ["d", "40 dollars/day"],
  ["fi", "forgone income"], ["e3", "="], ["r2", "10 dollars/hour"], ["x2", "×"], ["h2", "4 hours"], ["e4", "="], ["d2", "40 dollars/day"],
].map(([id, text]) => ({ id, text }));
const board = (steps: EquationStage["steps"], w = 1000): CanvasBoardSpec => ({ v: 1, heading: "Measure a complete trade-off", notes: [], cues: [], stage: { kind: "equation", tokens: words, steps } } as unknown as CanvasBoardSpec);

/** Each token's place on the board, from the laid-out equation marks. */
function places(spec: CanvasBoardSpec) {
  const out: Record<string, { x: number; y: number }> = {};
  for (const m of layoutPanel(spec).marks) if (m.type === "equation") for (const st of m.steps) Object.assign(out, st.place);
  return out;
}

test("a labelled line never breaks before its first =, and its continuation starts under that =", () => {
  const p = places(board([
    { s: 0, order: ["oc", "e1", "h", "x1", "r", "e2", "d"], highlight: [] },
    { s: 1, order: ["fi", "e3", "r2", "x2", "h2", "e4", "d2"], highlight: [] },
  ]));
  // The label and its "=" are on one line.
  assert.equal(p.oc.y, p.e1.y);
  // Wrapped or not, nothing of the line sits above its label, and a continuation that starts with "=" is under the first "=".
  for (const [a, rel, cont] of [["oc", "e1", "e2"], ["fi", "e3", "e4"]] as const) {
    if (p[cont].y > p[a].y) assert.ok(Math.abs(p[cont].x - p[rel].x) < 1, `"=" of the continuation at ${p[cont].x}, the line's at ${p[rel].x}`);
  }
  // A continuation sits closer to its own line than the next line does.
  const contGap = p.e2.y > p.oc.y ? p.e2.y - p.oc.y : 0;
  if (contGap) assert.ok(contGap < p.fi.y - p.e2.y, `continuation ${contGap} vs next line ${p.fi.y - p.e2.y}`);
});

test("continuationX: under the =, under the right side for an operator, kept on the board", () => {
  const text = (id: string) => ({ a: "y", eq: "=", b: "2x + 3", eq2: "=", c: "9", plus: "+", d: "6" } as Record<string, string>)[id] ?? "";
  const place = { a: { x: 100, y: 50 }, eq: { x: 130, y: 50 }, b: { x: 160, y: 50 } };
  const box = { x: 0, y: 0, w: 600, h: 400 };
  assert.equal(continuationX(["eq2", "c"], ["a", "eq", "b"], place, () => 20, text, 8, 60, box), 130);
  assert.equal(continuationX(["plus", "d"], ["a", "eq", "b"], place, () => 20, text, 8, 60, box), 158);
  assert.equal(continuationX(["c"], ["a", "eq", "b"], place, () => 20, text, 8, 60, box), undefined);
  assert.equal(continuationX(["eq2", "c"], ["a", "eq", "b"], { ...place, eq: { x: 560, y: 50 } }, () => 20, text, 8, 60, box), 520);
});
