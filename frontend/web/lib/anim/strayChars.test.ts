import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { cleanStrayChars } from "../strayChars";

const red = (tex: string) => katex.renderToString(tex, { throwOnError: false }).includes("katex-error");

test("the junk character before a formula no longer turns it into red source", () => {
  const raw = "\u007F\\mathrm{C}";
  assert.ok(red(raw));
  assert.equal(cleanStrayChars(raw), "\\mathrm{C}");
  assert.ok(!red(cleanStrayChars(raw)));
});

test("a lost pseudocode arrow comes back; lines, tabs and other writing are untouched", () => {
  assert.equal(cleanStrayChars("position \u0010 3"), "position ← 3");
  assert.equal(cleanStrayChars("Temperature[position] \u0010 18\nOUTPUT x"), "Temperature[position] ← 18\nOUTPUT x");
  const fine = "a\tb\nc\r\n← $x^2$ ۱۲ کتاب";
  assert.equal(cleanStrayChars(fine), fine);
});

test("every string in a board is cleaned, whatever its depth; other values stay", () => {
  const board = { n: 3, ok: true, none: null, ops: [{ blocks: [{ board_text: "carbon, $\u007F\\mathrm{C}$", items: ["\u007Fa"] }] }] };
  assert.deepEqual(cleanStrayChars(board), { n: 3, ok: true, none: null, ops: [{ blocks: [{ board_text: "carbon, $\\mathrm{C}$", items: ["a"] }] }] });
});
