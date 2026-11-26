import test from "node:test";
import assert from "node:assert/strict";
import { isDetourBeat, planIndexOf, withDetours } from "../lectureDetours";
import { MAX_INSERTS_PER_LECTURE, applyReplan, readEdits, replanRequest } from "../canvas/replan";
import type { ProgressiveBeatPlan } from "../progressiveLectureTypes";

/* The adaptive lecture (owner, 2026-11-26): fix-up boards after wrong answers, and the rest of the plan adapting. */

const S = "cv-11111111-2222-3333-4444-555555555555";
const b = (n: number) => ({ id: `${S}-b${n}` });
const fx = (t: string) => ({ id: `${S}-fx${t}` });

test("a fix-up board sits right after its board, and the plan keeps its numbers", () => {
  const list = withDetours([b(1), b(2), b(3), b(4)], [{ after: b(2).id, beat: fx("a1") }]);
  assert.deepEqual(list.map((x) => x.id.split("-").at(-1)), ["b1", "b2", "fxa1", "b3", "b4"]);
  assert.ok(isDetourBeat(list[2]) && !isDetourBeat(list[3]));
  // Positions in the player's list → the plan's numbers sent to the server.
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => planIndexOf(list, i)), [0, 1, 1, 2, 3]);
  // Past what is loaded, the boards to come are planned ones.
  assert.equal(planIndexOf(list, 6), 5);
});

test("two fix-ups after one board keep the order they came in", () => {
  const list = withDetours([b(1), b(2)], [{ after: b(1).id, beat: fx("a") }, { after: b(1).id, beat: fx("b") }]);
  assert.deepEqual(list.map((x) => x.id.split("-").at(-1)), ["b1", "fxa", "fxb", "b2"]);
});

const plan = (n: number): ProgressiveBeatPlan[] => Array.from({ length: n }, (_, i) => ({
  id: `b${i + 1}`, sequence: i, title: `Board ${i + 1}`, objective: `idea ${i + 1}`, visualKind: "canvas", estimatedDurationMs: 30_000,
  canvas: { id: `b${i + 1}`, title: `Board ${i + 1}`, script: `Board ${i + 1} says this. It goes on. It ends.`, stage: "flow", brief: `idea ${i + 1}`, objects: [], inside: null, carry: [], interaction: null, overview: false },
}) as unknown as ProgressiveBeatPlan);
const script = "One sentence here. Another one follows. A third closes it. And a fourth.";

test("a rewrite changes only a coming board, and its words are checked when written", () => {
  const out = applyReplan(plan(6), [{ op: "rewrite", id: "b5", script, title: "Board 5, simpler" }, { op: "rewrite", id: "b2", script }], 3, { inserted: 0, skipped: 0 });
  assert.equal(out.plan[4].canvas?.script, script);
  assert.equal(out.plan[4].title, "Board 5, simpler");
  assert.deepEqual(out.plan[4].canvas?.polishLater, { factCheck: true });
  // b2 is already taught: left alone.
  assert.notEqual(out.plan[1].canvas?.script, script);
  assert.deepEqual(out.applied, ['rewrote "Board 5, simpler"']);
});

test("an inserted board takes its place and every board is numbered again", () => {
  const out = applyReplan(plan(5), [{ op: "insert", after: "b3", title: "A worked example", brief: "example", script, stage: "compare" }], 3, { inserted: 0, skipped: 0 });
  assert.equal(out.plan.length, 6);
  assert.equal(out.plan[3].title, "A worked example");
  assert.equal(out.plan[3].canvas?.stage, "compare");
  assert.deepEqual(out.plan.map((p) => p.sequence), [0, 1, 2, 3, 4, 5]);
  assert.equal(out.inserted, 1);
});

test("budgets hold: no insert past the lecture's limit, never skip the last board", () => {
  const full = applyReplan(plan(5), [{ op: "insert", after: "b4", title: "More", brief: "", script }], 3, { inserted: MAX_INSERTS_PER_LECTURE, skipped: 0 });
  assert.equal(full.plan.length, 5);
  const last = applyReplan(plan(5), [{ op: "skip", id: "b5" }, { op: "skip", id: "b4" }], 3, { inserted: 0, skipped: 0 });
  assert.deepEqual(last.plan.map((p) => p.id), ["b1", "b2", "b3", "b5"]);
});

test("the replanner's reply is read safely; a too-short script is not a board", () => {
  const edits = readEdits({ edits: [{ op: "rewrite", id: "b4", script: "Too short." }, { op: "skip", id: "b4" }, { op: "insert", after: "b3", title: "X", script }, { op: "nonsense" }] });
  assert.deepEqual(edits.map((e) => e.op), ["skip"]);
  assert.equal(readEdits(null).length, 0);
});

test("the replanner sees what is fixed and what may change", () => {
  const text = replanRequest({ topic: "T", happened: "Answered wrongly", notes: ["struggled"], plan: plan(5), editableFrom: 3 });
  assert.match(text, /ALREADY TAUGHT OR IN LINE[\s\S]*Board 3/);
  assert.match(text, /STILL TO COME[\s\S]*id: b4[\s\S]*id: b5 \(LAST board: never skip\)/);
});
