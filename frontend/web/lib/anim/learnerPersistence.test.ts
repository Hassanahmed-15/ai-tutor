import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyDiagnostic, emptyProfile, resolveDepth } from "../learnerProfile";

/**
 * The two halves of "keep learning about the learner": during the lesson, and across lessons.
 *
 * The rules worth pinning are the ones a later change could silently break without any test
 * failing — a revealed answer quietly counting as mastery, or a re-learned topic accumulating
 * contradictory history rows.
 */

const root = process.cwd();
const learnedTopics = readFileSync(join(root, "app", "api", "learned-topics", "route.ts"), "utf8");
const player = readFileSync(join(root, "components", "LessonPlayer.tsx"), "utf8");
const cosmos = readFileSync(join(root, "lib", "db", "cosmos.ts"), "utf8");

test("checkpoint results feed back into the learner model during the lesson", () => {
  // Micro-adaptation: the pre-lesson estimate is corrected by what actually happens.
  let p = emptyProfile("Neural networks");
  p = applyDiagnostic(p, { question: "Backprop", answer: "(checkpoint)", verdict: "correct", concept: "backprop" });
  assert.deepEqual(p.masteredConcepts, ["backprop"]);

  p = applyDiagnostic(p, { question: "Chain rule", answer: "(checkpoint)", verdict: "incorrect", concept: "chain rule" });
  assert.deepEqual(p.weakConcepts, ["chain rule"]);
  // A struggle mid-lesson must be able to pull the next lesson's depth down.
  assert.ok(resolveDepth(p) <= 2, "a failed checkpoint should not leave depth untouched");
});

test("a revealed answer is not recorded as mastery", () => {
  /*
   * Needing the answer shown is evidence about the concept, and counting it as a correct answer
   * would inflate the next lesson's starting depth for someone who had just been told the answer.
   */
  assert.match(
    player,
    /onCheckpointGraded\?\.\(\{ concept: beat\.title, correct: false, revealed: true \}\)/,
    "revealCheckpointAnswer must report correct:false",
  );
});

test("every settled grading path reports upward", () => {
  // A path that grades but does not report leaves the model believing its pre-lesson estimate.
  const calls = player.match(/onCheckpointGraded\?\./g) ?? [];
  assert.ok(calls.length >= 3, `only ${calls.length} grading paths report — keyword, model and reveal all should`);
});

test("re-learning a topic replaces its entry rather than stacking a second", () => {
  /*
   * Otherwise a returning student accumulates rows claiming they know the same subject at three
   * different depths, and the most recent — the only one that reflects where they now are — is
   * indistinguishable from the stalest.
   */
  assert.match(
    learnedTopics,
    /filter\(\(t\) => t\.topic\.toLowerCase\(\) !== topic\.toLowerCase\(\)\)/,
    "a repeat lesson must drop the previous entry for that topic",
  );
});

test("history is bounded, so the user document stays one cheap read", () => {
  assert.match(cosmos, /LEARNED_TOPIC_LIMIT = \d+/);
  assert.match(learnedTopics, /slice\(\s*0,\s*LEARNED_TOPIC_LIMIT,?\s*\)/);
});

test("signing out costs personalisation, never the lesson", () => {
  // The whole feature is an enhancement; an anonymous student simply starts from scratch.
  assert.match(learnedTopics, /if \(!session\) return NextResponse\.json\(\{ topics: \[\] \}\)/);
  assert.match(learnedTopics, /if \(!session\) return NextResponse\.json\(\{ ok: false, reason: "signed-out" \}\)/);
});

test("only durable facts cross sessions", () => {
  /*
   * Diagnostics and misconceptions describe one topic at one moment. Carrying a months-old
   * misconception forward would correct something the learner has since fixed, which is worse than
   * asking again.
   */
  /*
   * Asserted against the WRITE PAYLOAD, not the file text. The first version grepped the whole
   * route for "misconceptions" and failed on the comment explaining why misconceptions are
   * excluded — the prose that documents the rule is not a violation of it.
   */
  const written = learnedTopics.match(/const learnedTopics = \[\{([^}]*)\}/);
  assert.ok(written, "could not find the persisted record shape");
  const fields = written[1];
  assert.doesNotMatch(fields, /misconception/, "misconceptions must not persist across sessions");
  assert.doesNotMatch(fields, /diagnostic/, "diagnostics must not persist across sessions");
  assert.match(fields, /mastered/);
  assert.match(fields, /depth/);
});
