import test from "node:test";
import assert from "node:assert/strict";
import { verdictNote, verdictOfAnswer, verdictVoiceLine } from "../planningFeedback";
import { emptyProfile, type LearnerProfile } from "../learnerProfile";

/* Planning answers: right is praised, wrong is explained, a preference is never judged (2026-10-18). */

const before = emptyProfile("photosynthesis");
const graded = (verdict: LearnerProfile["diagnostics"][number]["verdict"], answer: string, extra: Partial<LearnerProfile["diagnostics"][number]> = {}): LearnerProfile =>
  ({ ...before, diagnostics: [...before.diagnostics, { question: "q", answer, verdict, ...extra }] });

test("the answer just given is judged from the grade the server added", () => {
  assert.deepEqual(verdictOfAnswer(before, graded("correct", "B: Chlorophyll absorbs light"), "B: Chlorophyll absorbs light"), { verdict: "correct" });
  assert.deepEqual(verdictOfAnswer(before, graded("misconception", "Plants get food from soil", { misconception: "thinks plants take their food from the soil" }), "Plants get food from soil"), { verdict: "misconception", misconception: "thinks plants take their food from the soil" });
});

test("a preference, a self-description, a skip or 'Not sure' is never judged", () => {
  assert.equal(verdictOfAnswer(before, graded("incorrect", "Not sure"), "Not sure"), null);
  assert.equal(verdictOfAnswer(before, graded("correct", "Advanced", { selfReport: true }), "Advanced"), null);
  assert.equal(verdictOfAnswer(before, graded("skipped", "just teach me"), "just teach me"), null);
  assert.equal(verdictOfAnswer(before, before, "Intermediate, I know the basics"), null, "no new grade: nothing to judge");
});

test("what Aria is told to say, and what the screen shows", () => {
  assert.match(verdictVoiceLine({ verdict: "correct" }), /right.*no explanation/i);
  const wrong = verdictVoiceLine({ verdict: "misconception", misconception: "thinks plants take their food from the soil" });
  assert.match(wrong, /not right/);
  assert.match(wrong, /food from the soil/);
  assert.match(wrong, /what was wrong/);
  assert.match(verdictVoiceLine(null), /do not grade/);
  assert.equal(verdictNote({ verdict: "correct" }), "That's right — well done!");
  assert.match(verdictNote({ verdict: "incorrect" }), /Not quite/);
  assert.equal(verdictNote(null), "");
});
