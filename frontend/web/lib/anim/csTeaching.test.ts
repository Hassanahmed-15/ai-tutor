import test from "node:test";
import assert from "node:assert/strict";
import { isCsTopic } from "../canvas/subjectLook";
import { examinerFor } from "../canvas/mathsCheck";
import { codeSyncIssues } from "../canvas/codeSync";

test("CS lectures are recognised — a named language is programming; a science practical's variables are not", () => {
  for (const t of ["Recursion in Python", "Stacks and queues", "Linked lists in Java", "Merge sort", "Python functions", "Binary to hexadecimal conversion"]) assert.equal(isCsTopic(t), true, t);
  for (const t of ["Completing the square", "Osmosis", "Independent and dependent variables in experiments", "Functions and graphs"]) assert.equal(isCsTopic(t), false, t);
  assert.equal(examinerFor("Recursion in Python", []), "cs");
  assert.equal(examinerFor("Completing the square", []), "maths");
  assert.equal(examinerFor("Osmosis", []), null);
});

const board = (lines: string[], steps: Array<{ s: number; lines: number[]; state?: Array<{ name: string; value: string }> }>) =>
  ({ v: 1, heading: "x", notes: [], cues: [], stage: { kind: "code", language: "python", lines, steps } }) as never;

test("a code line nobody explains is sent back when the narration has a sentence for it", () => {
  const lines = ["def countdown(n):", "    if n == 0:", "        return", "    print(n)", "    countdown(n - 1)"];
  const script = "We define countdown. It checks for zero. It returns at zero. It prints n. It calls itself with n minus one. That is recursion.";
  // Lines 1-5 lit on one sentence: lumped, and the narration has sentences to spare.
  const lumped = codeSyncIssues(board(lines, [{ s: 0, lines: [1, 2, 3, 4, 5] }]), script);
  assert.ok(lumped.some((f) => f.gate === "code-sync" && /only ever lit in a block/.test(f.message)));
  // One line per sentence: nothing to say.
  const good = codeSyncIssues(board(lines, lines.map((_, i) => ({ s: i, lines: [i + 1], state: [{ name: "n", value: "3" }] }))), script);
  assert.deepEqual(good, []);
  // A short narration cannot explain every line: a note, never a rewrite.
  const short = codeSyncIssues(board(lines, [{ s: 0, lines: [1, 2, 3, 4, 5] }]), "We define countdown.");
  assert.ok(short.every((f) => f.gate === "code-sync-note"));
});

test("prose dressed as code and a board of several functions are sent back; real code is not", async () => {
  const { proseLine } = await import("../canvas/codeSync");
  for (const l of ["shift 7 right", "insert 4 at index 0", "search cost: inspect up to n nodes", "push(stack, item): add item to top", "pop(stack) → item: remove top item"]) assert.equal(proseLine(l), true, l);
  for (const l of ["while count > 0:", "v ← dequeue(queue)", "if root is empty-link: return false", "NEXT i", "# update this account", "class BankAccount:"]) assert.equal(proseLine(l), false, l);
  const crammed = ["def a(x):", "    return x", "def b(x):", "    return x + 1", "def c(x):", "    return x * 2", "print(a(1))", "print(b(1))"];
  const findings = codeSyncIssues(board(crammed, [{ s: 0, lines: [1] }, { s: 1, lines: [3] }]), "One. Two. Three.");
  assert.ok(findings.some((f) => f.gate === "code-sync" && /3 functions/.test(f.message)));
});

test("a squeezed trace grows into one sentence per pass — only when the board is written again", async () => {
  const { patchNarration } = await import("../canvas/mathsCheck");
  const script = "We trace maximum. The loop compares 9, then 2 and 7, and returns 9. That is linear.";
  const fix = { kind: "squeezed-trace", where: "narration" as const, sentence: 1, detail: "three passes in one sentence", fix: "On the first pass, 9 is larger than 4, so best becomes 9. On the second pass, 2 is not larger, so best stays 9. On the third pass, 7 is not larger, so the function returns 9." };
  const grown = patchNarration(script, [fix], { grow: true });
  assert.equal(grown.grew, true);
  assert.equal((grown.script.match(/[.!?](\s|$)/g) ?? []).length, 5);
  assert.equal(patchNarration(script, [fix], { grow: false }).changed, 0, "never without a rewrite to follow");
});

test("a squeezed sentence in the plan becomes one per step; the board phrases after it move; a lost or invented value is refused", async () => {
  const { applySplits, squeezedSentence } = await import("../canvas/squeeze");
  assert.equal(squeezedSentence("It returns to 6, visits 4, records 6, then records 7."), true);
  assert.equal(squeezedSentence("Line 3 loops through each character in text, assigning it to letter."), false);
  const beat = () => ({ id: "b2", title: "In-order", stage: "code", brief: "", objects: [], inside: null, carry: [], interaction: null, overview: false,
    script: "We trace in-order. It returns to 6, visits 4, records 6, then records 7. That is ascending.", boardNotes: [{ s: 0, text: "trace" }, { s: 2, text: "ascending" }] }) as never;
  const good = [beat()];
  assert.equal(applySplits(good, [{ beat: "b2", sentence: 1, sentences: ["It returns to 6.", "It visits 4 and records it.", "It records 6.", "Then it records 7."] }]), 1);
  assert.equal((good[0] as { script: string }).script, "We trace in-order. It returns to 6. It visits 4 and records it. It records 6. Then it records 7. That is ascending.");
  assert.deepEqual((good[0] as { boardNotes: unknown }).boardNotes, [{ s: 0, text: "trace" }, { s: 5, text: "ascending" }]);
  const lost = [beat()];
  assert.equal(applySplits(lost, [{ beat: "b2", sentence: 1, sentences: ["It returns to 6.", "Then it records 7."] }]), 0, "4 was dropped");
  const invented = [beat()];
  assert.equal(applySplits(invented, [{ beat: "b2", sentence: 1, sentences: ["It returns to 6.", "It visits 4.", "It records 6.", "Then it records 7 and 9."] }]), 0, "9 was invented");
  assert.equal(applySplits([beat()], [{ beat: "b2", sentence: 1, sentences: ["It returns to 6, visits 4, records 6, then records 7."] }]), 0, "one sentence is no split");
});

test("an unindented listing is sent back; a CS board that writes or traces code becomes a code board", async () => {
  const flat = ["heap_sort(A):", "for end from n − 1 down to 1:", "swap A[0] and A[end]", "sift_down(A, 0, end)", "return A"];
  assert.ok(codeSyncIssues(board(flat, flat.map((_, i) => ({ s: i, lines: [i + 1] }))), "A. B. C. D. E.").some((f) => /indent/.test(f.message)));
  const indented = ["def f(a):", "    for x in a:", "        print(x)", "    return a"];
  assert.ok(!codeSyncIssues(board(indented, indented.map((_, i) => ({ s: i, lines: [i + 1] }))), "A. B. C. D.").some((f) => /indent/.test(f.message)));
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const beat = (id: string, stage: string, script: string) => ({ id, title: id, brief: "", stage, script, objects: [], inside: null, carry: [], interaction: null, overview: false }) as never;
  const out = applyLessonVisualPolicy([beat("b1", "sketch", "A stack is last in, first out."), beat("b2", "sketch", "We now express that pattern as pseudocode and trace it on [1, 2, 3].")], { mode: "prompt", aiPictures: true, topic: "Generating permutations with backtracking" });
  // No free sketches in a typed CS lesson (owner, 2026-10-25): the first board is a flow code lays out.
  assert.deepEqual(out.beats.map((b) => b.stage), ["flow", "code"]);
});

test("the line Aria names is the line that does it, and the line lit; a right reference is left alone", async () => {
  const { fixLineReferences } = await import("../canvas/codeSync");
  const lines = ["def pair_sum(nums, target):", "    left = 0", "    right = len(nums) - 1", "    while left < right:", "        total = nums[left] + nums[right]", "        if total == target:", "            return (nums[left], nums[right])", "        elif total > target:", "            right -= 1", "        else:", "            left += 1"];
  const spec = board(lines, [{ s: 0, lines: [7] }, { s: 1, lines: [2] }]);
  const r = fixLineReferences(spec, "Line 7 sees that the first total, 16, is too large and decrements right. Line 2 sets left to zero.");
  assert.equal(r.fixed, 1);
  assert.match(r.script, /^Line 8 sees/);
  assert.deepEqual((spec as { stage: { steps: Array<{ lines: number[] }> } }).stage.steps.map((p) => p.lines), [[8], [2]]);
});
