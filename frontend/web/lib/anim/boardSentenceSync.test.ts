/**
 * Putting each board action on the sentence that introduces it.
 *
 * The bug these pin: a chalkboard op the model forgot to tag kept the freehand `at` it was born
 * with, so it appeared at a moment unrelated to the narration — the chlorophyll row written while
 * the teacher was still on the opening sentence. Nothing detected it, because the only check was
 * "did the model supply a number", and a missing number simply skipped the re-timing.
 *
 * Pure functions over strings, so none of this needs a key or a client.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  assignOpSentences,
  boardSyncIssue,
  inferSentenceForText,
  reactLabelMismatches,
  reactLabelSyncIssue,
  SYNC_RULES,
} from "../boardSentenceSync";

/** A photosynthesis beat, of the shape the reported failure came from. */
const SENTENCES = [
  "Today we are going to look at how a leaf feeds itself.",
  "Sunlight arrives carrying energy that the leaf needs to capture.",
  "Chlorophyll is the green pigment that absorbs that light.",
  "The captured energy splits water and fixes carbon dioxide into sugar.",
  "Oxygen leaves the leaf as a by-product of that reaction.",
];

/* ── reading the op's own words ──────────────────────────────────────────── */

test("a row lands on the sentence that actually mentions it", () => {
  // The whole complaint, in one assertion: chlorophyll is spoken in sentence 2, not sentence 0.
  assert.equal(inferSentenceForText("Chlorophyll", SENTENCES), 2);
  assert.equal(inferSentenceForText("Oxygen released", SENTENCES), 4);
  assert.equal(inferSentenceForText("Sunlight energy", SENTENCES), 1);
});

test("a rare word outweighs a word the whole script repeats", () => {
  /*
   * "Leaf" appears in three of these sentences and identifies none of them; "chlorophyll" appears in
   * one and identifies it completely. Without inverse-frequency weighting the common word wins on
   * sheer count and drags the row to the wrong sentence — which is the failure mode that makes a
   * naive keyword match worse than useless on a board that repeats its subject on every row.
   */
  assert.equal(inferSentenceForText("Chlorophyll in the leaf", SENTENCES), 2);
});

test("text that matches nothing meaningful is not forced onto a sentence", () => {
  // A confident wrong placement looks deliberate; admitting defeat lets the caller do better.
  assert.equal(inferSentenceForText("", SENTENCES), null);
  assert.equal(inferSentenceForText("and the of it", SENTENCES), null);
  assert.equal(inferSentenceForText("Chlorophyll", []), null);
});

test("word forms do not have to match exactly", () => {
  // The board says "absorbs", the script says "absorbs that light" — but a board saying "absorbing"
  // is the same idea, and a student would not accept the suffix as a reason to draw it late.
  assert.equal(inferSentenceForText("Absorbing light", SENTENCES), 2);
});

/* ── deciding the whole board ────────────────────────────────────────────── */

test("a tag the model supplied is always trusted over inference", () => {
  // The model knows its own intent; inference is a rescue, never an override.
  const [entry] = assignOpSentences([{ text: "Chlorophyll", group: 4 }], SENTENCES);
  assert.equal(entry.index, 4);
  assert.equal(entry.source, "group");
});

test("a null tag is absent, not sentence zero", () => {
  /*
   * `Number(null)` is 0 and passes an `isFinite` check, so the old code pinned a null-tagged op to
   * the very start of the beat. That is the worst possible default: it looks like a decision.
   */
  const [entry] = assignOpSentences([{ text: "Chlorophyll", group: null }], SENTENCES);
  assert.equal(entry.index, 2, "a null tag should have fallen through to inference");
  assert.equal(entry.source, "inferred");
});

test("an untagged board is rescued row by row", () => {
  const ops = [
    { text: "How a leaf feeds" },
    { text: "Sunlight" },
    { text: "Chlorophyll" },
    { text: "Sugar from carbon dioxide" },
  ];
  assert.deepEqual(assignOpSentences(ops, SENTENCES).map((a) => a.index), [0, 1, 2, 3]);
});

test("an op with no words of its own inherits from the row above it", () => {
  // An arrow is drawn with the row it points at; it has no moment of its own to be placed at.
  const ops = [{ text: "Chlorophyll", group: 2 }, { text: "" }];
  const assignments = assignOpSentences(ops, SENTENCES);
  assert.equal(assignments[1].index, 2);
  assert.equal(assignments[1].source, "inherited");
});

test("the board never runs backwards", () => {
  /*
   * A board is written top to bottom as it is spoken. A later row whose wording echoes the opening
   * sentence must not jump to the front of the timeline and be drawn before the rows it sits under —
   * visibly out of order, and worse than the imprecision the inference was fixing.
   */
  const ops = [
    { text: "Chlorophyll", group: 2 },
    { text: "Today we look at a leaf" },
    { text: "Oxygen", group: 4 },
  ];
  const indices = assignOpSentences(ops, SENTENCES).map((a) => a.index as number);
  assert.deepEqual(indices, [2, 2, 4]);
  for (let i = 1; i < indices.length; i += 1) {
    assert.ok(indices[i] >= indices[i - 1], `op ${i} went backwards`);
  }
});

/* ── is the finished board actually synchronised? ────────────────────────── */

test("a board spread across the narration raises no issue", () => {
  const ops = [{ text: "Sunlight" }, { text: "Chlorophyll" }, { text: "Oxygen" }];
  assert.equal(boardSyncIssue(assignOpSentences(ops, SENTENCES), SENTENCES.length), null);
});

test("a board pinned to one sentence is rejected", () => {
  /*
   * This is what "the board appears all at once" looks like in data, and it is the exact condition
   * the React-animation path has always rejected. The chalkboard had no equivalent, so it shipped.
   */
  const ops = [{ text: "A", group: 0 }, { text: "B", group: 0 }, { text: "C", group: 0 }];
  const issue = boardSyncIssue(assignOpSentences(ops, SENTENCES), SENTENCES.length);
  assert.match(issue ?? "", /front-loaded/);
});

test("an op that could not be placed is reported, not hidden", () => {
  const assignments = [{ index: null, source: "none" as const }, { index: 1, source: "group" as const }];
  assert.match(boardSyncIssue(assignments, SENTENCES.length) ?? "", /could not be matched/);
});

test("a one-sentence script is not asked for three", () => {
  // The rule must be satisfiable. Demanding spread from a script that has none would reject a board
  // that is already as synchronised as it can possibly be.
  const ops = [{ text: "Anything", group: 0 }, { text: "More", group: 0 }];
  assert.equal(boardSyncIssue(assignOpSentences(ops, ["Only one sentence here."]), 1), null);
});

test("the distinct-sentence bar matches the animation path's", () => {
  // Two boards in the same lecture held to different standards is how one of them ends up wrong.
  assert.equal(SYNC_RULES.MIN_DISTINCT_SENTENCES, 3);
});

/* ── React animations: a label must not be drawn before it is said ───────── */

/** A board as the generator writes it: every text node carries its own sentence tag. */
function board(labels: Array<[string, number | string]>): string {
  return labels
    .map(([text, sentence]) => `<text x="10" y="10" data-teach-order="1" data-teach-kind="label" data-teach-weight="1" data-teach-sentence=${typeof sentence === "number" ? `{${sentence}}` : `"${sentence}"`}>${text}</text>`)
    .join("\n");
}

test("a label drawn before the teacher reaches it is reported", () => {
  // The reported failure: chlorophyll on the board during sentence 0, spoken at sentence 2.
  const code = board([["How a leaf feeds", 0], ["Chlorophyll", 0], ["Sunlight", 1]]);
  assert.deepEqual(reactLabelMismatches(code, SENTENCES), [{ text: "Chlorophyll", tagged: 0, spoken: 2 }]);
});

test("labels tagged to the sentence that says them pass", () => {
  const code = board([["How a leaf feeds", 0], ["Sunlight", 1], ["Chlorophyll", 2], ["Sugar", 3], ["Oxygen", "4"]]);
  assert.deepEqual(reactLabelMismatches(code, SENTENCES), []);
  assert.equal(reactLabelSyncIssue(code, SENTENCES), null);
});

test("the first label is the title and may sit at the start", () => {
  const code = board([["Oxygen and sugar from light", 0], ["Sunlight", 1]]);
  assert.deepEqual(reactLabelMismatches(code, SENTENCES), []);
});

test("a recap label written after its mention is not reported", () => {
  // Late captions are usually deliberate summaries; only EARLY labels break sync.
  const code = board([["Title", 0], ["Chlorophyll", 4]]);
  assert.deepEqual(reactLabelMismatches(code, SENTENCES), []);
});

test("labels with nothing to match on are skipped, not flagged", () => {
  const code = board([["Title", 0], ["t = 0", 0], ["{value.toFixed(2)}", 0], ["A", 0]]);
  assert.deepEqual(reactLabelMismatches(code, SENTENCES), []);
});

test("one stray label is tolerated; two reject with a reason naming them", () => {
  const one = board([["Title", 0], ["Chlorophyll", 0]]);
  assert.equal(reactLabelSyncIssue(one, SENTENCES), null);
  const two = board([["Title", 0], ["Chlorophyll", 0], ["Oxygen", 1]]);
  const issue = reactLabelSyncIssue(two, SENTENCES);
  assert.ok(issue);
  assert.match(issue, /"Chlorophyll" is tagged data-teach-sentence=0 but is spoken in sentence \[2\]/);
  assert.match(issue, /"Oxygen" is tagged data-teach-sentence=1 but is spoken in sentence \[4\]/);
});
