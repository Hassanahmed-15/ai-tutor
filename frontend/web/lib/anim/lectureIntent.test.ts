/**
 * PAUSE AND CONTINUE, AS PEOPLE ACTUALLY SAY THEM.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { isPauseIntent, isResumeIntent } from "../voice/lectureIntent";

test("a pause asked for in a sentence is a pause", () => {
  for (const said of [
    "pause",
    "Aria, pause",
    "Aria can you pause the lecture?",
    "hey aria could you please stop for a moment",
    "wait",
    "hold on",
    "hang on a sec",
    "one second please",
    "give me a minute",
    "stop the lecture",
    "can we stop here",
    "area, stop",
  ]) assert.equal(isPauseIntent(said), true, said);
});

test("a question about stopping, or talk that mentions waiting, is not a pause", () => {
  for (const said of [
    "why did it stop?",
    "what does stop and wait mean",
    "how does the program know when to stop the loop",
    "I had to wait a long time for the bus this morning and then it rained and I missed it",
    "don't stop",
    "what is the difference between pause and stop",
  ]) assert.equal(isPauseIntent(said), false, said);
});

test("carrying on, however it is asked, is a resume", () => {
  for (const said of [
    "continue",
    "okay continue",
    "Aria, resume the lecture",
    "can you keep going",
    "go on",
    "okay go ahead",
    "let's move on",
    "carry on please",
    "next part",
    "don't stop",
    "alright, let's go",
  ]) assert.equal(isResumeIntent(said), true, said);
});

test("a question about continuing, or a pause, is not a resume", () => {
  for (const said of [
    "why does the loop continue after the break",
    "what happens next in the algorithm",
    "wait, can you pause",
    "stop",
  ]) assert.equal(isResumeIntent(said), false, said);
});
