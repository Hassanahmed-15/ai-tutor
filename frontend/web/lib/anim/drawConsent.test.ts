import test from "node:test";
import assert from "node:assert/strict";
import { asksForVisual, isAffirmative, isNegative } from "../drawConsent";
import { asksForCode } from "../codeSpec";

/**
 * Drawing needs consent now, and these are the questions that decide it.
 *
 * The two mistakes are not equal. Missing an explicit "draw me a diagram" costs one extra exchange;
 * treating an ordinary question as a drawing request stops the lecture for tens of seconds to build an
 * animation nobody wanted, which is the complaint this exists to fix.
 */

test("an outright request for a picture draws without being asked twice", () => {
  for (const text of [
    "draw me a diagram of the water cycle",
    "can you sketch that?",
    "visualise the call stack",
    "show me a diagram",
    "put it on the board",
    "plot it",
    "map it out for me",
    "I'd like an illustration of the process",
    "animate the sorting steps",
  ]) {
    assert.equal(asksForVisual(text), true, text);
  }
});

test("an ordinary question is not a drawing request", () => {
  // The regression this guards: lib/geminiLiveContract.ts matches "show" plus any word, so all
  // three of the "show" lines below force a board there.
  for (const text of [
    "show me an example",
    "can you show why that happens?",
    "show what you mean",
    "what does dp stand for?",
    "why is the pressure dropping there?",
    "how does backpropagation work?",
    "is that the same as the trapezoid rule?",
    "explain that again please",
  ]) {
    assert.equal(asksForVisual(text), false, text);
  }
});

test("a refusal names the thing it refuses, and must not trigger it", () => {
  for (const text of [
    "no diagram please, just tell me",
    "explain it without a drawing",
    "don't draw it, I just want the answer",
    "words only please",
    "no need to draw, just say it",
  ]) {
    assert.equal(asksForVisual(text), false, text);
  }
});

test("yes to the offer, in the ways people actually say it", () => {
  for (const text of ["yes", "Yes please", "yeah", "yep", "sure", "ok", "okay", "alright", "go ahead", "do it", "draw it", "yes, draw it", "please do", "let's see it", "why not"]) {
    assert.equal(isAffirmative(text), true, text);
    assert.equal(isNegative(text), false, `${text} must not read as a no`);
  }
});

test("no to the offer, likewise", () => {
  for (const text of ["no", "nope", "no thanks", "nah", "not now", "never mind", "skip it", "just tell me", "carry on", "keep going", "I'm good"]) {
    assert.equal(isNegative(text), true, text);
    assert.equal(isAffirmative(text), false, `${text} must not read as a yes`);
  }
});

test("a question that merely OPENS with yes or no is neither — it is a new question", () => {
  /*
   * This is the case that would hurt most. "yes but why does it drop?" answered as consent would
   * draw a board and never answer the question, and the student would have to ask it again.
   */
  for (const text of [
    "yes but why does the pressure drop?",
    "no I meant the second one",
    "yeah, so what happens if the node has two children?",
    "sure, and how does that affect the error term?",
    "no, that's not what I asked — explain the slope",
  ]) {
    assert.equal(isAffirmative(text), false, text);
    assert.equal(isNegative(text), false, text);
  }
});

test("nothing at all is not an answer", () => {
  for (const text of ["", "   ", null, undefined]) {
    assert.equal(isAffirmative(text), false);
    assert.equal(isNegative(text), false);
    assert.equal(asksForVisual(text), false);
  }
});

test("a code question stays a code question, and still skips the offer", () => {
  /*
   * "when user is asking for code you have to show code" was a deliberate earlier fix. A code
   * question is answered with the code board immediately, so asksForCode is the second door past the
   * offer and must keep opening.
   */
  for (const text of ["explain me the deletion code", "show me the implementation", "how does remove() work in C++"]) {
    assert.equal(asksForCode(text), true, text);
  }
  // …and it is NOT a picture request, so the two doors stay distinguishable.
  assert.equal(asksForVisual("explain me the deletion code"), false);
});
