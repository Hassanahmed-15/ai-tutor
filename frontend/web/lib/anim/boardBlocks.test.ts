import test from "node:test";
import assert from "node:assert/strict";
import { phrasesOf, plainBlocks, revealUnits, shownCount, unitTexts, validateBlocks, type BoardBlock } from "../canvas/blocks";
import { layoutPanel } from "../canvas/layout";
import { canvasSentences } from "../canvas/plan";
import { BLOCK_FIXTURES } from "../canvas/blockFixtures";
import { LAB_FIXTURES } from "../canvas/labFixtures";
import type { CanvasBoardSpec } from "../canvas/types";

const script = "Speed tells us how far something goes. A car goes 100 metres in 5 seconds. To find its speed, we divide distance by time. So the speed is 100 divided by 5, which is 20 metres per second.";

test("every sentence reaches the board: one no block covers is written where it belongs", () => {
  const { blocks, faults } = validateBlocks({ blocks: [{ kind: "paragraph", s: 0, e: 0, board_text: "Speed is how far something goes." }, { kind: "formula", s: 3, tex: "v=d/t" }] }, "b1", script);
  assert.deepEqual(blocks.map((b) => [b.s, b.e]), [[0, 0], [1, 2], [3, 3]]);
  assert.equal(blocks[1].board_text, "A car goes 100 metres in 5 seconds. To find its speed, we divide distance by time.");
  assert.ok(faults.some((f) => /no block covers: 1, 2/.test(f)));
  assert.equal(blocks[2].board_text, "v=d/t", "a formula with no text keeps its maths");
});

test("what is spoken is the script itself, whatever the writer claimed, and long text is never shortened", () => {
  const long = "word ".repeat(400).trim();
  const { blocks } = validateBlocks({ blocks: [{ kind: "paragraph", s: 0, e: 3, board_text: long, spoken_text: "something else" }] }, "b1", script);
  assert.equal(blocks[0].spoken_text, canvasSentences(script).join(" "));
  assert.equal(blocks[0].board_text, long);
});

test("a bad reply loses nothing: unknown kinds become paragraphs, impossible sentences are dropped, the gaps filled", () => {
  const { blocks, faults } = validateBlocks({ blocks: [{ kind: "poster", s: 0, board_text: "x y z" }, { kind: "paragraph", s: 99, board_text: "no" }] }, "b1", script);
  assert.equal(blocks[0].kind, "paragraph");
  assert.ok(faults.length >= 2);
  assert.deepEqual([...new Set(blocks.flatMap((b) => Array.from({ length: b.e - b.s + 1 }, (_, i) => b.s + i)))].sort(), [0, 1, 2, 3]);
  const nothing = validateBlocks("not json", "b1", script);
  assert.equal(nothing.blocks.map((b) => b.board_text).join(" "), script, "no blocks at all: the whole script as text");
});

test("plain blocks carry the whole script", () => {
  assert.equal(plainBlocks("b1", script).map((b) => b.board_text).join(" "), script);
});

test("phrases are cut at punctuation, never inside bold or maths", () => {
  assert.deepEqual(phrasesOf("First we find the total, then **a, b and c** are added, $x, y$ too."), ["First we find the total,", " then **a, b and c** are added,", " $x, y$ too."]);
  assert.equal(phrasesOf("Short, one.").join(""), "Short, one.");
});

const block = (b: Partial<BoardBlock>): BoardBlock => ({ id: "b", section_id: "s", kind: "paragraph", s: 0, e: 3, board_text: "", spoken_text: canvasSentences(script).join(" "), ...b });

test("each piece appears when she says it, not when a shared word first turns up", () => {
  const units = revealUnits(block({ kind: "steps", items: ["A car goes 100 metres in 5 seconds.", "To find its speed, divide distance by time.", "Speed = 100 ÷ 5 = **20 metres per second**."] }));
  assert.equal(Math.floor(units[0].at), 1, "the car: sentence 1");
  assert.equal(Math.floor(units[1].at), 2, "the method: sentence 2");
  assert.equal(Math.floor(units[2].at), 3, "the answer: sentence 3, though sentence 2 says 'speed'");
  assert.equal(shownCount(units, 1.5), 1);
  assert.equal(shownCount(units, 2.5), 2);
  assert.equal(shownCount(units, 3.5), 3);
  assert.equal(shownCount(units, Infinity), 3);
});

test("a piece the words cannot find is placed between its neighbours, and time only moves forward", () => {
  const b = block({ kind: "formula", s: 2, e: 3, spoken_text: canvasSentences(script).slice(2).join(" "), tex: "\\frac{d}{t}", where: ["$d$ is the distance", "$t$ is the time"] });
  const units = revealUnits(b);
  assert.equal(units.length, 3);
  assert.ok(units[0].at >= 2 && units[0].at < 2.01, "the formula starts with its block");
  for (let i = 1; i < units.length; i++) assert.ok(units[i].at >= units[i - 1].at);
  assert.ok(units.every((u) => u.at < 4));
});

test("words in Urdu are matched too", () => {
  const urdu = "رفتار فاصلہ تقسیم وقت ہے۔ گاڑی سو میٹر چلتی ہے۔";
  const units = revealUnits({ ...block({ s: 0, e: 1, spoken_text: urdu }), board_text: "گاڑی سو میٹر چلتی ہے۔" });
  assert.equal(Math.floor(units[0].at), 1);
});

test("each kind reveals its natural pieces", () => {
  assert.deepEqual(unitTexts(block({ kind: "code", code: ["a = 1", "print(a)"] })), ["a = 1", "print(a)"]);
  assert.equal(unitTexts(block({ kind: "table", rows: [["a", "b"], ["c", "d"]] })).length, 2);
  assert.deepEqual(unitTexts(block({ kind: "formula", tex: "x", where: ["x is y"] })), ["x", "x is y"]);
});

test("the board: blocks take the notes column beside a drawing, the whole board with nothing drawn; without blocks nothing changes", () => {
  const whole = layoutPanel(BLOCK_FIXTURES[0].spec);
  const mark = whole.marks.find((m) => m.type === "blocks");
  assert.ok(mark && mark.type === "blocks" && mark.rect.w > 800);
  assert.ok(!whole.marks.some((m) => m.type === "note"));
  const figure: CanvasBoardSpec = { ...LAB_FIXTURES[0].spec, course: true, lab: undefined, notes: [{ id: "n1", text: "A note", s: 0 }] };
  const before = layoutPanel(figure);
  assert.ok(before.marks.some((m) => m.type === "note") && !before.marks.some((m) => m.type === "blocks"), "no blocks: exactly today's board");
  const column = layoutPanel({ ...figure, blocks: plainBlocks("b", script) }).marks.find((m) => m.type === "blocks");
  assert.ok(column && column.type === "blocks" && column.rect.w < 420);
});

test("the board's title and a box's own label are not written twice", () => {
  const { blocks } = validateBlocks({ blocks: [
    { kind: "heading", s: 0, board_text: "Speed" },
    { kind: "callout", callout: "mistake", s: 1, board_text: "**Common mistake:** adding them." },
    { kind: "heading", s: 2, board_text: "A later section" },
  ] }, "b1", script);
  assert.ok(!blocks.some((b) => b.board_text === "Speed"), "the opening heading is dropped");
  assert.ok(blocks.some((b) => b.s === 0 && b.kind === "paragraph"), "and its sentence is still written");
  assert.equal(blocks.find((b) => b.kind === "callout")?.board_text, "adding them.");
  assert.ok(blocks.some((b) => b.board_text === "A later section"), "a heading inside the board stays");
});
