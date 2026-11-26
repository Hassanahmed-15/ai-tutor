import test from "node:test";
import assert from "node:assert/strict";
import { MAX_FIXUPS, fixupPlacement, planIndexOf, withDetours, type Detour } from "../lectureDetours";
import { MAX_INSERTS_PER_LECTURE, MAX_SKIPS_PER_LECTURE, applyReplan, type ReplanEdit } from "../canvas/replan";
import type { ProgressiveBeatPlan } from "../progressiveLectureTypes";

/* QA matrix (2026-11-26): how the lecture's path changes, combination by combination. */

const S = "cv-11111111-2222-3333-4444-555555555555";
const B = (n: number) => ({ id: `${S}-b${n}` });
const F = (t: string) => ({ id: `${S}-fx${t}` });
const planned = [1, 2, 3, 4, 5, 6].map(B);
const ids = (list: Array<{ id: string }>) => list.map((x) => x.id.split("-").at(-1));
type K = { id: string };

// C. WHERE A FIX-UP GOES ───────────────────────────────────────────────────────────────────────────
const placements: Array<[string, Array<Detour<K>>, number, string, string, string | null]> = [
  // name, detours already shown, playhead (player list), asked on, fix id, expected anchor (null: not shown)
  ["still on the board that asked", [], 1, B(2).id, "fxa", B(2).id],
  ["arrived after moving on one board", [], 2, B(2).id, "fxa", B(3).id],
  ["arrived two boards later", [], 4, B(2).id, "fxa", B(5).id],
  // list: b1 b2 b3 fxb b4 … — position 3 is the fix-up being played.
  ["playing another fix-up when it arrives", [{ after: B(3).id, for: B(3).id, beat: F("b") }], 3, B(2).id, "fxa", B(3).id],
  ["a second fix-up for the same board", [{ after: B(2).id, for: B(2).id, beat: F("a") }], 2, B(2).id, "fxz", null],
  ["the same fix-up twice", [{ after: B(2).id, for: B(2).id, beat: F("a") }], 1, B(5).id, "fxa", null],
  ["a wrong answer on a fix-up board's own question", [{ after: B(2).id, for: B(2).id, beat: F("a") }], 2, F("a").id, "fxq", null],
  ["past the lecture's limit", [1, 2, 3].map((n) => ({ after: B(n).id, for: B(n).id, beat: F(`l${n}`) })), 6, B(5).id, "fxm", null],
  ["late fix-up of A sits after B; B still gets its own", [{ after: B(3).id, for: B(2).id, beat: F("a") }], 3, B(3).id, "fxb", B(3).id],
  ["asked on the last board", [], 5, B(6).id, "fxa", B(6).id],
  ["board not loaded (unknown id)", [], 1, `${S}-b99`, "fxa", null],
];
for (const [name, detours, playhead, asked, fix, want] of placements) {
  test(`fix-up placement — ${name}`, () => {
    assert.equal(fixupPlacement(planned, detours, playhead, asked, `${S}-${fix}`), want);
  });
}
test("fix-up limit is three", () => assert.equal(MAX_FIXUPS, 3));

test("whatever the order fix-ups arrive in, the player's list and the plan's numbers agree", () => {
  // Wrong on 2 (still there), wrong on 4 (fix-up late, lands after 5), then the list as the player sees it.
  let detours: Array<Detour<K>> = [];
  const a = fixupPlacement(planned, detours, 1, B(2).id, `${S}-fxa`)!;
  detours = [...detours, { after: a, for: B(2).id, beat: F("a") }];
  const list1 = withDetours(planned, detours);
  const b = fixupPlacement(planned, detours, list1.findIndex((x) => x.id === B(5).id), B(4).id, `${S}-fxb`)!;
  detours = [...detours, { after: b, for: B(4).id, beat: F("b") }];
  const list = withDetours(planned, detours);
  assert.deepEqual(ids(list), ["b1", "b2", "fxa", "b3", "b4", "b5", "fxb", "b6"]);
  // Each position maps to the plan board it belongs to; every plan board appears once, in order.
  assert.deepEqual(list.map((_, i) => planIndexOf(list, i)), [0, 1, 1, 2, 3, 4, 4, 5]);
});

// D. THE REPLANNER CANNOT BREAK THE LECTURE (fuzzed) ──────────────────────────────────────────────
const plan = (n: number): ProgressiveBeatPlan[] => Array.from({ length: n }, (_, i) => ({
  id: `b${i + 1}`, sequence: i, title: `Board ${i + 1}`, objective: "", visualKind: "canvas", estimatedDurationMs: 30_000,
  canvas: { id: `b${i + 1}`, title: `Board ${i + 1}`, script: "A. B. C.", stage: "flow", brief: "", objects: [], inside: i > 0 && i % 3 === 0 ? { beat: `b${i}`, object: "x" } : null, carry: [], interaction: null, overview: false },
}) as unknown as ProgressiveBeatPlan);
const script = "One. Two. Three. Four.";
let seed = 7;
const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };

test("2,000 random edit sets: frozen boards untouched, numbering whole, budgets kept, last board kept, no dangling links", () => {
  for (let run = 0; run < 2000; run++) {
    const n = 4 + rand(12);
    const before = plan(n);
    const from = 1 + rand(n);
    const used = { inserted: rand(3), skipped: rand(3) };
    const edits: ReplanEdit[] = Array.from({ length: rand(4) }, () => {
      const id = `b${1 + rand(n + 2)}`;
      const k = rand(3);
      return k === 0 ? { op: "skip", id } : k === 1 ? { op: "rewrite", id, script } : { op: "insert", after: id, title: "New", brief: "", script };
    });
    const out = applyReplan(before, edits, from, used);
    const at = (p: ProgressiveBeatPlan) => p.canvas?.id ?? p.id;
    // Frozen boards are exactly as they were, in place.
    for (let i = 0; i < Math.min(from, n); i++) assert.deepEqual(out.plan[i], before[i], `run ${run}: frozen board ${i} changed`);
    // Numbering is 0..len-1.
    assert.deepEqual(out.plan.map((p) => p.sequence), out.plan.map((_, i) => i), `run ${run}: numbering`);
    // Budgets.
    assert.ok(used.inserted + out.inserted <= Math.max(MAX_INSERTS_PER_LECTURE, used.inserted), `run ${run}: inserts`);
    assert.ok(used.skipped + out.skipped <= Math.max(MAX_SKIPS_PER_LECTURE, used.skipped), `run ${run}: skips`);
    // The last board is still last.
    assert.equal(at(out.plan.at(-1)!), at(before.at(-1)!), `run ${run}: last board`);
    // No board sits inside a board that is gone.
    const present = new Set(out.plan.map(at));
    for (const p of out.plan) if (p.canvas?.inside) assert.ok(present.has(p.canvas.inside.beat), `run ${run}: dangling inside`);
    // Ids are unique.
    assert.equal(present.size, out.plan.length, `run ${run}: duplicate ids`);
  }
});
