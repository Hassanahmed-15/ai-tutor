/**
 * The per-beat brief: opposite directions for novices and experts (expertise reversal), only the
 * concepts this beat touches, and a hard length cap.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { BRIEF_MAX_CHARS, learnerBrief } from "../learnerBrief";
import { emptyProfile, type LearnerProfile } from "../learnerProfile";

const beat = { title: "From Markov chains to MDPs", objective: "Add actions and rewards to a Markov chain" };

function profile(extra: Partial<LearnerProfile>): LearnerProfile {
  return { ...emptyProfile("Markov chain vs MDP"), ...extra };
}

test("novices get worked examples and labels; experts get precision and edge cases", () => {
  const novice = profile({});
  const expert = profile({});
  const noviceScript = learnerBrief(novice, beat, "script", 1);
  const expertScript = learnerBrief(expert, beat, "script", 5);
  assert.match(noviceScript, /worked example BEFORE/);
  assert.match(noviceScript, /define each technical term/);
  assert.match(expertScript, /do not re-explain basics/);
  assert.match(expertScript, /edge cases/);
  assert.match(learnerBrief(novice, beat, "visual", 2), /label every part/);
  assert.match(learnerBrief(expert, beat, "visual", 4), /denser board is fine/);
  assert.match(learnerBrief(novice, beat, "script", 3), /faded example/);
});

test("only the concepts this beat touches are named", () => {
  const p = profile({
    masteredConcepts: ["Markov chains", "Spanish verbs"],
    weakConcepts: ["reward function"],
    misconceptions: ["an MDP is just a Markov chain with more states"],
  });
  const script = learnerBrief(p, beat, "script", 3);
  assert.match(script, /already know Markov chains/);
  assert.doesNotMatch(script, /Spanish/);
  assert.match(script, /shaky on reward function/);
  assert.match(script, /Correct this belief explicitly/);
  const visual = learnerBrief(p, beat, "visual", 3);
  assert.match(visual, /reward function its own clearly labelled step/);
  assert.match(visual, /show why this is wrong/);
});

test("the brief stays small however much is known", () => {
  const many = Array.from({ length: 40 }, (_, i) => `Markov concept number ${i}`);
  const brief = learnerBrief(profile({ masteredConcepts: many, weakConcepts: many, misconceptions: many }), beat, "script", 3);
  assert.ok(brief.length <= BRIEF_MAX_CHARS, `was ${brief.length}`);
});
