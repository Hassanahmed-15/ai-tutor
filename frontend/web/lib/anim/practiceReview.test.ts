import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewFocus, reviewOutline } from "../practiceReview";

const review = {
  title: "My mistakes: simultaneous equations",
  mistakes: [
    { n: 2, stem: "Solve 3x + 5 = 26", studentAnswer: "x = 26/3", feedback: "Take away 5 first.", firstError: { step: "3x = 26", what: "You divided before taking away the 5.", why: "Undo the + 5 first." }, correctWorking: ["3x = 21", "x = 7"], subtopic: "linear equations" },
    { n: 4, stem: "x + y = 9 and x − y = 3. Find x and y.".repeat(5), studentAnswer: "", feedback: "No answer found on your pages.", correctWorking: [], subtopic: "elimination" },
  ],
};

test("one outline part per mistake, each marked shaky, within the lecture route's limits", () => {
  const o = reviewOutline("simultaneous equations", review);
  assert.equal(o.subtopics.length, 2);
  assert.ok(o.subtopics.every((s) => s.status === "shaky"));
  assert.ok(o.subtopics.every((s) => s.title.length <= 100 && s.caption.length <= 240 && s.reason.length <= 240));
  assert.match(o.subtopics[0].caption, /divided before taking away the 5/);
  assert.match(o.subtopics[0].reason, /3x = 21 → x = 7/);
  assert.match(o.subtopics[1].caption, /\(none\)/);
});

test("the focus asks for one board per mistake and stays under 1000 characters", () => {
  const f = reviewFocus(review);
  assert.ok(f.length <= 1000);
  assert.match(f, /one board per mistake/);
  assert.match(f, /Q2: You divided/);
});

test("a practice review lecture uses the compact ladder: one board per mistake", async () => {
  const { compactLadder } = await import("../canvas/lessonRequest");
  const { ladderBoardBudget } = await import("../canvas/conceptLadder");
  const outline = reviewOutline("simultaneous equations", review);
  assert.equal(compactLadder({ topic: "x", sourceType: "prompt", practiceReview: true, outline } as never), true);
  assert.deepEqual(ladderBoardBudget(outline.subtopics, true), { min: 2, max: 2 });
});
