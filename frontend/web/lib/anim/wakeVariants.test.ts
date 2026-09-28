/**
 * "ARIA", HOWEVER THE RECOGNISER HEARS IT.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { classifyAddressing } from "../voice/runtime/addressing";

const lecture = { expectingAnswer: false, tutorSpeaking: true };

test("the common mis-hearings of Aria wake her, even while she is lecturing", () => {
  for (const said of [
    "hey aria what is a leaf node",
    "hey maria can you explain that",
    "mariah pause",
    "ariana what does that mean",
    "rhea explain the second tree",
    "hey area what is a binary search tree",
    "aria",
    "okay aria continue",
    "riya go back",
    "ariya can you repeat that",
    "so aria why is the root special",
  ]) assert.equal(classifyAddressing(said, lecture).addressed, true, said);
});

// Known trade-off: "Maria" now wakes her anywhere, so a sentence about someone called Maria can too.
test("words that merely sound close stay ordinary words", () => {
  for (const said of [
    "the area of the circle is pi r squared",
    "we are going to the market",
  ]) assert.equal(classifyAddressing(said, lecture).addressed, false, said);
  assert.equal(classifyAddressing("aria just keeps talking", lecture).addressed, false, "talking about her, not to her");
});

test("an accented 'hey Aria' as a recogniser writes it still wakes her; other names do not", () => {
  const speaking = lecture;
  for (const said of ["Yaariyan", "hey idea", "hey idea what is a leaf", "hi aya", "okay ariel explain this", "can u explain me"]) {
    assert.equal(classifyAddressing(said, speaking).addressed, true, said);
  }
  for (const said of ["hey ryan", "hey dave", "orion is a constellation", "iron is a metal", "the area of a circle is pi r squared", "your answer is right"]) {
    assert.equal(classifyAddressing(said, speaking).addressed, false, said);
  }
});

test("a drawing request about the lesson is for her; household imperatives are not", () => {
  const topicWords = new Set(["binary", "search", "tree", "insert", "node"]);
  const paused = { tutorSpeaking: false, expectingAnswer: false, topicWords };
  for (const said of ["Now on the same board, show what happens when we insert 6.", "draw the tree for me", "show figure 19.2 on a new slide"]) {
    assert.equal(classifyAddressing(said, paused).addressed, true, said);
  }
  assert.equal(classifyAddressing("Now on the same board, show what happens when we insert 6.", { ...paused, tutorSpeaking: true }).addressed, true);
  for (const said of ["show the salt to your brother", "draw the curtains please", "add some sugar to it", "I will show you later"]) {
    assert.equal(classifyAddressing(said, paused).addressed, false, said);
  }
});

test("'I want you to…' and 'explain me this' are requests to her, even without her name", () => {
  const paused = { tutorSpeaking: false, expectingAnswer: false };
  for (const said of ["But I want you to explain me this.", "I want you to still draw something for me.", "explain me this", "draw something for me"]) {
    assert.equal(classifyAddressing(said, paused).addressed, true, said);
  }
  assert.equal(classifyAddressing("I want you to call your mom", paused).addressed, false);
});
