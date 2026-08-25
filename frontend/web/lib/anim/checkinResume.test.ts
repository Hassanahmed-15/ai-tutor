import test from "node:test";
import assert from "node:assert/strict";
import { buildGeminiLiveInstructions } from "../geminiLiveContract";
import { checkpointDueAt } from "../adhd/games/mcq";
import { applyAll, initialScore, needsCheckin, SCORE_RULES } from "../adhd/score";

/**
 * What a check-in owes the learner.
 *
 * Three behaviours reported broken from production, all in the ADHD track: asking to resume was
 * ignored for the first two minutes, a dropped socket ended the conversation outright, and the maze
 * appeared only sometimes. These pin the parts that can be asserted without a browser.
 */

const SECRET_TOPIC = "Zygomorphic Quantum Basketry";

const checkinInstructions = () =>
  buildGeminiLiveInstructions({
    topic: SECRET_TOPIC,
    beatContext: "",
    lessonContext: "",
    mood: "",
    adhdMode: true,
    checkinMode: true,
    examQuestions: [],
  });

test("the check-in persona is told to resume the moment it is asked", () => {
  const text = checkinInstructions();
  assert.match(
    text,
    /IF THEY ASK TO GO BACK AT ANY MOMENT/,
    "the model must know an early request is honoured, or it talks the learner out of leaving",
  );
  assert.match(text, /resume_lecture IMMEDIATELY/);
});

test("the persona still refuses to raise coming back on its own before it is cued", () => {
  // The floor is about Aria not cutting the conversation short. It was never meant to hold a
  // learner in one they have asked to leave.
  assert.match(checkinInstructions(), /Do not raise it yourself before then/);
});

test("the check-in persona never names the lesson it interrupted", () => {
  const text = checkinInstructions();
  // A distinctive topic, so this catches a real leak rather than an ordinary English word that
  // happens to appear in the persona's own prose.
  assert.ok(!text.includes(SECRET_TOPIC), "the topic must not reach a conversation about their day");
  assert.match(text, /Do NOT mention the lesson/);
});

test("three skips is what asks for a check-in, and it lands on a maze beat", () => {
  const score = applyAll(initialScore(), [
    { type: "beat-skipped" },
    { type: "beat-skipped" },
    { type: "beat-skipped" },
  ]);
  assert.equal(score.skipRun, SCORE_RULES.SKIP_RUN_FOR_CHECKIN);
  assert.ok(needsCheckin(score));
  // Both cadences are three, which is why skipping repeatedly used to walk straight past the
  // assessment it had just landed on.
  assert.ok(checkpointDueAt(3));
});

test("two skips is not yet a check-in", () => {
  const score = applyAll(initialScore(), [{ type: "beat-skipped" }, { type: "beat-skipped" }]);
  assert.ok(!needsCheckin(score));
});
