/**
 * Whether lesson planning is a CONVERSATION or a sequence of announcements.
 *
 * A Live session cannot be unit tested — it is a socket — but what Aria is told is pure string, and
 * that is where this behaviour is actually decided. The first version failed here rather than in the
 * transport: she greeted the student, reported progress, and asked occasional questions, but nothing
 * ever carried an answer forward. Asking a question and ignoring the reply is what makes a tutor
 * feel like a form, and it is invisible in a screenshot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DESIGN_CUES, buildLessonDesignInstructions } from "../lessonDesignContract";

test("she reacts to the student's actual words, not just to the fact they spoke", () => {
  const cue = DESIGN_CUES.react("I think it's about energy from sunlight", "Photosynthesis");
  assert.match(cue, /I think it's about energy from sunlight/, "the answer itself must reach the model");
  assert.match(cue, /what they ACTUALLY said/i);
  // Reacting must be able to change the lesson, not merely acknowledge.
  assert.match(cue, /adapt_lesson/);
  // A reaction that immediately fires another question is an interrogation, not a reply.
  assert.match(cue, /do not immediately ask another question/i);
});

test("what the student already told her is carried into later turns", () => {
  const withKnown = DESIGN_CUES.teach("Neural networks", "Explain one core idea.", [
    "I already know gradient descent",
  ]);
  assert.match(withKnown, /already know gradient descent/, "prior answers must be threaded forward");
  assert.match(withKnown, /do not re-ask it/i);

  // With nothing known yet, no empty context section is appended.
  const withoutKnown = DESIGN_CUES.teach("Neural networks", "Explain one core idea.", []);
  assert.doesNotMatch(withoutKnown, /already told you/i);
});

test("she talks about what she is finding, not about percentages", () => {
  const cue = DESIGN_CUES.discovery(
    "Backpropagation",
    "Structuring the lesson",
    "Section 4 of 11",
    "It is being built from the PDF they uploaded.",
  );
  assert.match(cue, /Section 4 of 11/, "the real pipeline detail must reach her");
  assert.match(cue, /what you are finding/i);
  // The failure mode being guarded: reading the progress bar aloud.
  assert.match(cue, /Do not recite percentages or stage names/i);
});

test("the opening speaks first and asks — it never waits to be addressed", () => {
  const cue = DESIGN_CUES.opening("Photosynthesis", "It is being written from scratch.");
  assert.match(cue, /Speak FIRST, without waiting/i);
  assert.match(cue, /ask them one short question/i);
});

test("the persona makes driving the conversation her job", () => {
  const persona = buildLessonDesignInstructions({
    topic: "Krebs cycle",
    sourceKind: "topic",
    mood: "",
    blindMode: false,
  });
  assert.match(persona, /YOU DRIVE THIS/);
  assert.match(persona, /never has to press anything to talk to you/i);
  // The specific regression: answers must not be discarded.
  assert.match(persona, /THAT ANSWER IS THE CONVERSATION/i);
  assert.match(persona, /Carry what they told you forward/i);
});

test("blind mode gets the same conversation, plus spoken progress", () => {
  const blind = buildLessonDesignInstructions({
    topic: "Krebs cycle",
    sourceKind: "topic",
    mood: "",
    blindMode: true,
  });
  // Same proactive tutor — the accessibility path must not be a separate, lesser experience.
  assert.match(blind, /YOU DRIVE THIS/);
  assert.match(blind, /THAT ANSWER IS THE CONVERSATION/i);
  // Plus the part only a blind student needs.
  assert.match(blind, /CANNOT SEE THE SCREEN/);
});
