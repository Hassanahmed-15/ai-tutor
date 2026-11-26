import test from "node:test";
import assert from "node:assert/strict";
import { spokenOnly, validateBlocks, type BoardBlock } from "../canvas/blocks";
import { timeCodeSteps } from "../canvas/codeSync";
import type { CanvasBoardSpec, CodeStage } from "../canvas/types";

/*
 * SYNC QA (2026-11-26): what the board writes is what Aria says, when she says it. Cases from the three QA
 * lectures (maths, history, coding) on the live site.
 */

const maths = "The key identity is x squared plus two p x plus p squared equals x plus p all squared. For the middle term, p is half the coefficient of x.";

const block = (b: Partial<BoardBlock>): BoardBlock => ({ id: "b1", section_id: "s", kind: "paragraph", s: 0, e: 0, board_text: "", spoken_text: "", ...b });

test("a formula's 'where' lines she never says are faults, and are taken off", () => {
  const raw = { blocks: [{ kind: "formula", s: 0, e: 0, tex: "x^2+2px+p^2=(x+p)^2", where: ["$x$ is the variable.", "$p^2$ is the added constant term.", "$p$ is half the coefficient of $x$."] }, { kind: "paragraph", s: 1, e: 1, board_text: "For the middle term, $p$ is half the coefficient of $x$." }] };
  const { blocks, faults } = validateBlocks(raw, "s", maths);
  assert.ok(faults.some((f) => /"where" lines/.test(f)), faults.join("; "));
  const synced = spokenOnly(blocks, "s", maths);
  const formula = synced.blocks.find((b) => b.kind === "formula")!;
  // "p is half the coefficient of x" is said in sentence 2, not sentence 1, so its line under sentence 1's formula goes too.
  assert.deepEqual(formula.where ?? [], []);
  assert.equal(formula.tex, "x^2+2px+p^2=(x+p)^2");
});

test("a block in words she does not say is written as her own sentences", () => {
  const history = "First, how did national pride create competition, especially in the Balkans? Next, how did empire-building turn competition into conflict?";
  const written = [
    block({ id: "b1", kind: "definition", s: 0, e: 0, board_text: "The **Balkans** are a region of southeastern Europe where Slavs share related languages and cultural origins.", spoken_text: "First, how did national pride create competition, especially in the Balkans?" }),
    block({ id: "b2", s: 1, e: 1, board_text: "How did empire-building turn competition into conflict?", spoken_text: "Next, how did empire-building turn competition into conflict?" }),
  ];
  const { blocks, changed } = spokenOnly(written, "s", history);
  assert.equal(changed, 1);
  assert.equal(blocks[0].kind, "paragraph");
  assert.equal(blocks[0].board_text, "First, how did national pride create competition, especially in the Balkans?");
  assert.equal(blocks[1].board_text, "How did empire-building turn competition into conflict?");
});

test("a step she never says is taken off a steps block; one she says stays", () => {
  const script = "First, how did national pride create competition? Then, how did military expansion pull countries toward war?";
  const steps = block({ kind: "steps", s: 0, e: 1, spoken_text: script, items: ["1. How did **national pride** create competition?", "2. How did national competition affect rival states and peoples?", "3. How did **military expansion** pull countries toward war?"], board_text: "" });
  const { blocks } = spokenOnly([steps], "s", script);
  assert.deepEqual(blocks[0].items, ["1. How did **national pride** create competition?", "3. How did **military expansion** pull countries toward war?"]);
});

test("too many pieces during one sentence is a fault", () => {
  const script = "Here is the rule. It has many parts.";
  const { faults } = validateBlocks({ blocks: [{ kind: "steps", s: 0, e: 0, items: ["Here", "is", "the", "rule", "now"].map((w, i) => `${w} piece ${i}`) }, { kind: "paragraph", s: 1, board_text: "It has many parts." }] }, "s", script);
  assert.ok(faults.some((f) => /too much written while one sentence is said/.test(f)), faults.join("; "));
});

const codeBoard = (steps: CodeStage["steps"], lines = 12): CanvasBoardSpec => ({
  v: 1, heading: "Iterative binary search", notes: [], cues: [],
  stage: { kind: "code", language: "python", lines: Array.from({ length: lines }, (_, i) => `line_${i + 1} = ${i}`), steps } as CodeStage,
});

test("a trace piled on one sentence moves to the words that say its values, in order, with no value early", () => {
  const script = [
    "Line 1 defines the function.",
    "Line 2 initializes low to index 0.",
    "Line 4 repeats the search while low is less than or equal to high.",
    "It starts with low 0 and high 4, computes mid 2, moves low to 3, then computes mid 3 and returns 3.",
  ].join(" ");
  const spec = codeBoard([
    { s: 0, lines: [1, 2, 3, 4], state: [{ name: "low", value: "0" }, { name: "high", value: "4" }] },
    { s: 1, lines: [6, 7, 8], state: [{ name: "low", value: "0" }, { name: "high", value: "4" }] },
    { s: 2, lines: [4], state: [{ name: "low", value: "0" }, { name: "high", value: "4" }] },
    { s: 2, lines: [5], state: [{ name: "low", value: "0" }, { name: "high", value: "4" }, { name: "mid", value: "2" }] },
    { s: 2, lines: [8, 9], state: [{ name: "low", value: "3" }, { name: "high", value: "4" }, { name: "mid", value: "2" }] },
    { s: 2, lines: [5], state: [{ name: "low", value: "3" }, { name: "high", value: "4" }, { name: "mid", value: "3" }] },
    { s: 2, lines: [6, 7], state: [{ name: "low", value: "3" }, { name: "high", value: "4" }, { name: "mid", value: "3" }] },
  ]);
  const { moved } = timeCodeSteps(spec, script);
  assert.ok(moved >= 4);
  const steps = (spec.stage as CodeStage).steps;
  // The line she names is lit: "Line 2" was over lines 6–8.
  assert.deepEqual(steps.find((p) => Math.floor(p.s) === 1)?.lines, [2]);
  // Sentence 3 ("Line 4 …") shows the start state only.
  const third = steps.filter((p) => Math.floor(p.s) === 2).at(-1)!;
  assert.deepEqual(third.lines, [4]);
  assert.equal(third.state?.find((v) => v.name === "mid"), undefined);
  // The trace is in sentence 4, in the order she says it.
  const trace = steps.filter((p) => Math.floor(p.s) === 3);
  assert.deepEqual(trace.map((p) => p.state?.find((v) => v.name === "mid")?.value ?? "-"), ["2", "2", "3", "3"]);
  assert.ok(trace.every((p, i) => i === 0 || p.s >= trace[i - 1].s));
  assert.ok(trace[0].s > 3 && trace[0].s < 4);
});

test("a code board already in step is left alone", () => {
  const script = "Line 1 sets low to 0. Line 2 sets high to 4.";
  const spec = codeBoard([
    { s: 0, lines: [1], state: [{ name: "low", value: "0" }] },
    { s: 1, lines: [2], state: [{ name: "low", value: "0" }, { name: "high", value: "4" }] },
  ], 4);
  const before = JSON.stringify(spec);
  assert.equal(timeCodeSteps(spec, script).moved, 0);
  assert.equal(JSON.stringify(spec), before);
});
