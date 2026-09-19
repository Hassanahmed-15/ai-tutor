/**
 * One planning transcript for voice and text: every line appears once, and Aria's spoken copy of a
 * question already on screen is not printed twice.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { planMessage, shouldAddVoiceLine, speaksQuestion, type TranscriptEntry } from "../planningTranscript";

const QUESTION = "How deep do you want to go with the difference between a Markov chain and an MDP?";

test("Aria speaking the question on screen is recognised, even wrapped in an acknowledgement", () => {
  assert.ok(speaksQuestion(`Great, thanks. So — how deep do you want to go with the difference between a Markov chain and an MDP?`, QUESTION));
  assert.ok(!speaksQuestion("That's a lovely way to put it, transitions really are just probabilities.", QUESTION));
});

test("her spoken copy of an open question is not added; everything else she says is", () => {
  const log: TranscriptEntry[] = [{ role: "aria", text: QUESTION, isDiagnostic: true }];
  assert.equal(shouldAddVoiceLine(log, { role: "aria", text: "Okay! How deep do you want to go with Markov chains versus MDPs, the difference between them?" }), false);
  assert.equal(shouldAddVoiceLine(log, { role: "aria", text: "Good question — a reward is just a number the agent gets for an action." }), true);
});

test("the student's spoken answer is added once", () => {
  const log: TranscriptEntry[] = [{ role: "aria", text: QUESTION, isDiagnostic: true }];
  assert.equal(shouldAddVoiceLine(log, { role: "you", text: "I know Markov chains but not MDPs" }), true);
  const withAnswer: TranscriptEntry[] = [...log, { role: "you", text: "I know Markov chains but not MDPs" }];
  assert.equal(shouldAddVoiceLine(withAnswer, { role: "you", text: "i know markov chains  but not MDPs" }), false);
  assert.equal(shouldAddVoiceLine(withAnswer, { role: "you", text: "   " }), false);
});

test("the plan message names what was understood and the plan, and asks", () => {
  const msg = planMessage(["Recap Markov chains", "Add actions", "Add rewards"], "Intermediate, knows Markov chains");
  assert.match(msg, /understood about you: Intermediate, knows Markov chains/);
  assert.match(msg, /1\. Recap Markov chains; 2\. Add actions; 3\. Add rewards\./);
  // A title's own question mark is kept, but no stray punctuation is doubled onto it.
  assert.doesNotMatch(planMessage(["Why MDPs?", "Recap."], ""), /\?\.|\.\./);
  assert.doesNotMatch(planMessage(["Recap", "Use MDPs Over Markov Chains?"], ""), /\?\./);
  assert.match(msg, /Shall we start/);
  assert.match(planMessage(Array.from({ length: 9 }, (_, i) => `T${i}`), ""), /; and 3 more/);
});
