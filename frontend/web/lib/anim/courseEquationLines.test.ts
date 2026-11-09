import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutPanel } from "../canvas/layout";
import { dollarMath } from "../canvas/blocks";
import type { CanvasBoardSpec } from "../canvas/types";

const term = (id: string, text: string, tex?: string) => ({ id, text, ...(tex ? { tex } : {}) });
function linesOf(tokens: ReturnType<typeof term>[], steps: Array<{ s: number; order: string[] }>): string[][] {
  const spec = { heading: "Working", notes: [], course: true, subject: "physics", stage: { kind: "equation", tokens, steps }, blocks: [{ id: "b1", section_id: "x", kind: "paragraph", s: 0, e: 0, board_text: "Words.", spoken_text: "Words." }] } as unknown as CanvasBoardSpec;
  const mark = layoutPanel(spec).marks.find((m) => m.type === "equation") as unknown as { steps: Array<{ place: Record<string, { x: number; y: number }> }> };
  const place = mark.steps[mark.steps.length - 1].place;
  const rows = new Map<number, Array<[number, string]>>();
  for (const [id, p] of Object.entries(place)) rows.set(Math.round(p.y), [...(rows.get(Math.round(p.y)) ?? []), [p.x, tokens.find((t) => t.id === id)!.text]]);
  return [...rows.keys()].sort((a, b) => a - b).map((y) => rows.get(y)!.sort((a, b) => a[0] - b[0]).map((x) => x[1]));
}

const force = [term("f", "F", "F"), term("eq", "=", "="), term("open", "(", "("), term("a", "18 N", "18\\,\\mathrm{N}"), term("x", "×", "\\times"), term("b", "0.25 m", "0.25\\,\\mathrm{m}"), term("close", ")", ")"), term("d", "÷", "\\div"), term("c", "0.45 m", "0.45\\,\\mathrm{m}"), term("eq2", "=", "="), term("r", "10 N", "10\\,\\mathrm{N}")];

test("a course line that fits stays on one line", () => {
  const lines = linesOf(force, [{ s: 0, order: force.map((t) => t.id) }]);
  assert.equal(lines.length, 1, JSON.stringify(lines));
});

test("when a line must split, it never splits inside brackets and no comma starts a line", () => {
  const long = [term("f", "Resultant moment about the chosen pivot"), term("eq", "=", "="), term("open", "("), term("a", "eighteen newtons multiplied by"), term("b", "the first perpendicular distance"), term("close", ")"), term("c", "divided by the second perpendicular distance"), term("eq2", "=", "="), term("r", "ten newtons exactly")];
  for (const line of linesOf(long, [{ s: 0, order: long.map((t) => t.id) }])) {
    const opens = line.filter((t) => t === "(").length, closes = line.filter((t) => t === ")").length;
    assert.equal(opens, closes, JSON.stringify(line));
    assert.notEqual(line[0], ",");
  }
});

test("equations joined by commas take a line each, even when a term is a whole equation", () => {
  const t = [term("m", "M", "M"), term("e", "=", "="), term("f", "F", "F"), term("c1", ","), term("d", "d = 0", "d=0"), term("c2", ","), term("z", "M = 0", "M=0")];
  assert.deepEqual(linesOf(t, [{ s: 0, order: t.map((x) => x.id) }]), [["M", "=", "F"], ["d = 0"], ["M = 0"]]);
});

test("the other ways of writing maths become what the board typesets", () => {
  assert.equal(dollarMath("Answer: \\[ x = 2 \\] marks"), "Answer: $x = 2$ marks");
  assert.equal(dollarMath("so \\(y\\) grows"), "so $y$ grows");
  assert.equal(dollarMath("plain $x$ text"), "plain $x$ text");
});
