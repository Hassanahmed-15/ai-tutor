import test from "node:test";
import assert from "node:assert/strict";

import { classifyAddressing, looksUnfinished } from "../addressing";

const lecture = { expectingAnswer: false, tutorSpeaking: true };
const waiting = { expectingAnswer: true, tutorSpeaking: false };

test("while the tutor speaks, a bystander's sentence is not for her", () => {
  assert.equal(classifyAddressing("did you remember to send that email", lecture).addressed, false);
  assert.equal(classifyAddressing("what do you want for dinner?", lecture).addressed, false);
  assert.equal(classifyAddressing("hey Sam I'll call you back", lecture).addressed, false);
});

test("positive evidence stops her: name, command, second person, the board", () => {
  assert.equal(classifyAddressing("aria", lecture).reason, "addressed by name");
  assert.equal(classifyAddressing("stop", lecture).reason, "lesson command");
  assert.ok(classifyAddressing("can you slow down please", lecture).addressed);
  assert.ok(classifyAddressing("wait, what does that step mean?", lecture).addressed);
});

test("while she waits for an answer, a plain answer counts", () => {
  assert.ok(classifyAddressing("yes", waiting).addressed);
  assert.ok(classifyAddressing("I think it slopes down because people buy less", waiting).addressed);
  assert.equal(classifyAddressing("it's in the kitchen drawer", waiting).addressed, true, "words alone accept it — the speaker layer rejects the voice");
});

test("an unfinished clause is recognised, so the endpointer can wait", () => {
  assert.equal(looksUnfinished("I think it slopes down because"), true);
  assert.equal(looksUnfinished("so the thing is, "), true);
  assert.equal(looksUnfinished("I think it slopes down because people buy less"), false);
});
