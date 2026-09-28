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
