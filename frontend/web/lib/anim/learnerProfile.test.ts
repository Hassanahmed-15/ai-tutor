import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPTH_NAMES,
  MAX_DIAGNOSTIC_QUESTIONS,
  applyDiagnostic,
  cognitiveLoad,
  emptyProfile,
  hasEnoughSignal,
  learnerInstruction,
  resolveDepth,
  type DepthLevel,
  type LearnerProfile,
} from "../learnerProfile";
import { isSubstantive, wantsToStart } from "../diagnosticPrompt";

/**
 * What decides how deep a lecture goes, and who it is written for.
 *
 * Standard Mode pitched every lecture at the same imagined middle beginner: someone who already
 * implements backprop sat through a definition of a neuron, and someone who had never met a
 * derivative hit the chain rule unwarned. These pin the rule that replaces that — depth comes from
 * what the student DEMONSTRATES, with self-report as one input among several.
 *
 * The scenarios below are the ones the feature was specified against (A-G), written as the
 * situations they actually describe rather than as coverage of the function's branches.
 */

const profile = (over: Partial<LearnerProfile> = {}): LearnerProfile => ({
  ...emptyProfile("Neural networks"),
  ...over,
});

test("A — a complete beginner is taught from the ground up", () => {
  const p = profile({ claimedLevel: 1, confidence: "high" });
  const depth = resolveDepth(p);
  assert.ok(depth <= 2, `a beginner must not be pitched above Beginner, got ${DEPTH_NAMES[depth]}`);

  const text = learnerInstruction(p, depth);
  assert.match(text, /Define every term|Define terminology/i);
  assert.doesNotMatch(text, /SKIP the basics/i);
});

test("B — someone who knows the basics is not re-taught them", () => {
  const p = profile({
    claimedLevel: 3,
    confidence: "medium",
    masteredConcepts: ["gradient descent", "chain rule"],
    diagnostics: [
      { question: "q", answer: "a", verdict: "correct", concept: "gradient descent" },
      { question: "q2", answer: "a2", verdict: "correct", concept: "chain rule" },
    ],
  });
  const depth = resolveDepth(p);
  assert.ok(depth >= 3, `demonstrated basics should lift depth, got ${DEPTH_NAMES[depth]}`);

  const text = learnerInstruction(p, depth);
  // The single most important instruction for this student: do not spend the lesson on what they
  // just proved they know.
  assert.match(text, /Do NOT re-teach/i);
  assert.match(text, /gradient descent/);
});

test("C — a verified advanced student skips the basics entirely", () => {
  const p = profile({
    claimedLevel: 4,
    confidence: "high",
    masteredConcepts: ["backpropagation", "optimisers"],
    diagnostics: [
      { question: "q", answer: "a", verdict: "correct", concept: "backpropagation" },
      { question: "q2", answer: "a2", verdict: "correct", concept: "optimisers" },
    ],
  });
  const depth = resolveDepth(p, 5);
  assert.ok(depth >= 4, `a verified advanced claim should reach Advanced, got ${DEPTH_NAMES[depth]}`);
  /*
   * Asserted as BEHAVIOUR, not as one level's wording. Depth 4 says "SKIP the basics" and depth 5
   * says "assume the standard treatment is known"; both are correct outcomes for a verified
   * advanced student, and pinning the depth-4 phrase made this fail the moment the profile
   * legitimately resolved to Expert.
   */
  const text = learnerInstruction(p, depth);
  assert.match(text, /SKIP the basics|Assume the standard treatment is known/i);
  assert.doesNotMatch(text, /Define every term/i, "an advanced student must never be given the beginner treatment");
});

test("D — an UNVERIFIED advanced claim is not taken at face value", () => {
  /*
   * The asymmetry that matters. Being pitched too high is the more damaging error, because the
   * explanation the student needed was skipped as "obvious" and they have no way back. So a claim
   * with nothing corroborating it is capped rather than honoured.
   */
  const claimed = profile({ claimedLevel: 5, confidence: "high" });
  const depth = resolveDepth(claimed, 5);
  assert.ok(depth <= 3, `an unverified expert claim must be capped, got ${DEPTH_NAMES[depth]}`);

  // And once they demonstrably get it wrong, it drops further and the wrong model is named.
  const caught = profile({
    claimedLevel: 5,
    confidence: "high",
    misconceptions: ["thinks gradient descent always finds the global minimum"],
    diagnostics: [
      {
        question: "q",
        answer: "a",
        verdict: "misconception",
        concept: "gradient descent",
        misconception: "thinks gradient descent always finds the global minimum",
      },
    ],
  });
  const caughtDepth = resolveDepth(caught, 5);
  assert.ok(caughtDepth < depth, "a demonstrated misconception must lower depth below the unverified claim");

  const text = learnerInstruction(caught, caughtDepth);
  assert.match(text, /MISCONCEPTIONS TO CORRECT/i);
  assert.match(text, /global minimum/);
  assert.match(text, /EXPLICITLY/i);
});

test("E — a prerequisite gap overrides any claimed level", () => {
  const p = profile({
    claimedLevel: 4,
    confidence: "high",
    prerequisiteGaps: ["partial derivatives"],
  });
  const depth = resolveDepth(p, 5);
  assert.ok(depth <= 2, `a missing prerequisite is a hard floor, got ${DEPTH_NAMES[depth]}`);

  const text = learnerInstruction(p, depth);
  assert.match(text, /MISSING PREREQUISITES/);
  assert.match(text, /partial derivatives/);
  // It must be taught, not merely mentioned on the way past.
  assert.match(text, /teach these FIRST/i);
});

test("F — an exam goal changes what the depth is spent on", () => {
  const p = profile({ claimedLevel: 3, objective: "exam" });
  const text = learnerInstruction(p, resolveDepth(p));
  assert.match(text, /EXAM/);
  assert.match(text, /lose marks|examiners/i);
});

test("G — a project goal produces practical emphasis, not theory", () => {
  const p = profile({ claimedLevel: 3, objective: "project" });
  const text = learnerInstruction(p, resolveDepth(p));
  assert.match(text, /PRACTICAL\/PROJECT/);
  assert.match(text, /failure modes|gotchas/i);
  // Two different goals at the same depth must not produce the same lecture.
  const exam = learnerInstruction(profile({ claimedLevel: 3, objective: "exam" }), 3);
  assert.notEqual(text, exam);
});

test("depth never escapes its range, whatever the inputs", () => {
  const extreme = profile({
    claimedLevel: 5,
    masteredConcepts: ["a", "b", "c"],
    diagnostics: Array.from({ length: 6 }, (_, i) => ({
      question: `q${i}`,
      answer: "a",
      verdict: "correct" as const,
      concept: `c${i}`,
    })),
  });
  const high = resolveDepth(extreme, 5);
  assert.ok(high >= 1 && high <= 5, `out of range: ${high}`);

  const floor = profile({
    claimedLevel: 1,
    prerequisiteGaps: ["x", "y"],
    misconceptions: ["m"],
    diagnostics: Array.from({ length: 4 }, (_, i) => ({
      question: `q${i}`,
      answer: "a",
      verdict: "incorrect" as const,
      concept: `c${i}`,
    })),
  });
  const low = resolveDepth(floor, 5);
  assert.ok(low >= 1 && low <= 5, `out of range: ${low}`);
});

test("a simple topic cannot be taught at expert depth", () => {
  // Otherwise "what is a prime number" gets a research-level treatment, which can only be padding.
  const p = profile({
    claimedLevel: 5,
    diagnostics: [
      { question: "q", answer: "a", verdict: "correct", concept: "x" },
      { question: "q2", answer: "a2", verdict: "correct", concept: "y" },
    ],
  });
  assert.ok(resolveDepth(p, 1) <= 2, "topic complexity must cap depth");
});

test("grading moves a concept between mastered and weak rather than duplicating it", () => {
  let p = profile();
  p = applyDiagnostic(p, { question: "q", answer: "a", verdict: "incorrect", concept: "backprop" });
  assert.deepEqual(p.weakConcepts, ["backprop"]);
  assert.deepEqual(p.masteredConcepts, []);

  // Answering it correctly later must not leave it in both lists.
  p = applyDiagnostic(p, { question: "q2", answer: "a2", verdict: "correct", concept: "backprop" });
  assert.deepEqual(p.masteredConcepts, ["backprop"]);
  assert.deepEqual(p.weakConcepts, []);
});

test("the same misconception is never recorded twice", () => {
  let p = profile();
  const hit = {
    question: "q",
    answer: "a",
    verdict: "misconception" as const,
    concept: "gd",
    misconception: "thinks it finds the global minimum",
  };
  p = applyDiagnostic(p, hit);
  p = applyDiagnostic(p, { ...hit, question: "asked again" });
  assert.equal(p.misconceptions.length, 1, "a repeated misconception must not accumulate");
});

test("questioning stops as soon as another answer would not change the lesson", () => {
  // The requirement that matters most: do not run an intake interview on someone who came to learn.
  assert.equal(hasEnoughSignal(profile()), false, "with nothing known, ask something");

  assert.ok(
    hasEnoughSignal(profile({ claimedLevel: 1, confidence: "high" })),
    "a stated beginner should be believed, not verified",
  );
  assert.ok(
    hasEnoughSignal(profile({ prerequisiteGaps: ["derivatives"] })),
    "a found gap is already actionable — stop asking",
  );
  assert.ok(
    hasEnoughSignal(profile({ misconceptions: ["wrong model"] })),
    "a found misconception is already actionable — stop asking",
  );
  assert.equal(
    hasEnoughSignal(profile({ claimedLevel: 4, confidence: "high" })),
    false,
    "a high claim is the one thing worth verifying",
  );
  assert.ok(
    hasEnoughSignal(
      profile({
        claimedLevel: 4,
        diagnostics: [{ question: "q", answer: "a", verdict: "correct", concept: "x" }],
      }),
    ),
    "one verification is enough — never two",
  );
});

test("a boast is not its own verification", () => {
  /*
   * THE BUG THIS PINS. Saying "I know everything about neural networks" is a turn, so the model
   * grades it, so a diagnostic gets recorded — and the gate then treated the claim as verified,
   * suppressed the probe, and taught an unverified expert. The one student the spec says to check
   * was the one who never got a question.
   */
  const boast = profile({
    claimedLevel: 5,
    confidence: "high",
    diagnostics: [
      { question: "What do you know?", answer: "I know everything", verdict: "partial", concept: "neural networks", selfReport: true },
    ],
  });
  assert.equal(hasEnoughSignal(boast), false, "a self-report must not verify a high claim");

  // A real demonstration on the same claim DOES settle it.
  const shown = profile({
    claimedLevel: 5,
    confidence: "high",
    diagnostics: [
      { question: "What happens at zero error?", answer: "the gradient vanishes so weights stop moving", verdict: "correct", concept: "gradient descent" },
    ],
  });
  assert.ok(hasEnoughSignal(shown), "a demonstrated answer verifies the claim");
});

test("two wordings of one wrong belief are corrected once", () => {
  /*
   * One answer ("it happens in the nucleus and makes most of the ATP") reliably produced the two
   * separate misconceptions AND a combined restatement, so three overlapping corrections reached
   * the lecture prompt for what is really two mistakes.
   */
  let p = profile();
  p = applyDiagnostic(p, {
    question: "q", answer: "a", verdict: "misconception", concept: "krebs",
    misconception: "thinks it happens in the nucleus",
  });
  p = applyDiagnostic(p, {
    question: "q2", answer: "a2", verdict: "misconception", concept: "krebs",
    misconception: "thinks that it happens in the nucleus",
  });
  assert.equal(p.misconceptions.length, 1, `restatement was recorded separately: ${JSON.stringify(p.misconceptions)}`);
});

test("the question ceiling is a chat, not an interview", () => {
  assert.ok(MAX_DIAGNOSTIC_QUESTIONS <= 3, `${MAX_DIAGNOSTIC_QUESTIONS} questions before teaching is an intake form`);
});

test("the student can always end the questioning themselves", () => {
  // Enforced in code rather than asked for in a prompt: a model told to be curious will occasionally
  // ask one more, and the student's override must not depend on the model agreeing.
  for (const said of ["just teach me", "skip this", "stop asking", "get on with it", "I don't know"]) {
    assert.ok(wantsToStart(said), `"${said}" must end the questioning`);
  }
  assert.equal(wantsToStart("I know a bit about gradients"), false, "a real answer is not an override");
});

test("a bare yes is an answer but not evidence", () => {
  assert.equal(isSubstantive("yes"), false);
  assert.equal(isSubstantive("idk"), false);
  assert.ok(isSubstantive("it adjusts weights using the error gradient"));
});

test("cognitive load is derived from what was demonstrated, not self-reported", () => {
  const strained = profile({ prerequisiteGaps: ["derivatives"], misconceptions: ["wrong model"] });
  assert.equal(cognitiveLoad(strained, 2), "high");
  assert.match(learnerInstruction(strained, 2), /One new idea per board/i);

  const fluent = profile({ masteredConcepts: ["a", "b"] });
  assert.equal(cognitiveLoad(fluent, 3), "low");
});

test("an empty profile produces a short instruction, not a page of 'none'", () => {
  /*
   * A wall of "none recorded" lines teaches the model that these fields are usually empty and can
   * be skimmed — which would blunt the ones that do matter on the next student.
   */
  const text = learnerInstruction(profile(), 2);
  assert.doesNotMatch(text, /ALREADY KNOWS|MISSING PREREQUISITES|MISCONCEPTIONS/);
  assert.ok(text.length < 1200, `empty profile instruction is ${text.length} chars — too much boilerplate`);
});

test("every depth level says something genuinely different about teaching", () => {
  const texts = ([1, 2, 3, 4, 5] as DepthLevel[]).map((d) => learnerInstruction(profile(), d));
  assert.equal(new Set(texts).size, 5, "two depth levels produced identical instructions");
});
