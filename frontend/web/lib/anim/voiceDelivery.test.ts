import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryFor, spokenWords } from "../voiceDelivery";

// luna's real lines from a saved course lecture (Circulatory systems) — the words must never change.
const LINES: Array<[string, string]> = [
  ["Think of a water pump pushing water through connected pipes.", "story"],
  ["This keeps blood moving in one direction, called one-way flow.", "definition"],
  ["Deoxygenated blood travels from the heart to the lungs and returns oxygenated to the heart; this is pulmonary circulation.", "definition"],
  ["In your head, a fish has one or two heart passes?", "question"],
  ["The answer is one.", "reveal"],
  ["A common mistake is omitting the return from the lungs to the heart or saying fish blood passes twice.", "warning"],
  ["That's right — well done!", "praise"],
  ["State, in three marks, how valves help blood flow.", "task"],
  ["High pressure moves blood faster through systemic circulation, body-wide blood flow.", "plain"],
  ["We call this single circulation.", "definition"],
];

test("every line is acted without changing a single word", () => {
  for (const [line] of LINES) assert.equal(spokenWords(deliveryFor(line).input), line);
});

test("each kind of moment gets its acting", () => {
  for (const [line, kind] of LINES) assert.equal(deliveryFor(line).kind, kind, line);
  // Pauses are off by default (round 1: unnatural): the voice gets the sentence exactly.
  assert.equal(deliveryFor("The answer is one.").input, "The answer is one.");
  assert.equal(deliveryFor("We call this single circulation.").input, "We call this single circulation.");
  assert.equal(deliveryFor("In your head, a fish has one or two heart passes?").style, "curious");
});

test("only styles checked never to add words are used (\"friendly\" added \"Okay, so\")", () => {
  const allowed = new Set(["", "curious", "gentle", "warm", "warm, pleased"]);
  for (const [line] of LINES) assert.ok(allowed.has(deliveryFor(line).style), `${line} → ${deliveryFor(line).style}`);
});

test("styles stay a couple of words (a longer style drifted the cloned voice)", () => {
  for (const [line] of LINES) assert.ok(deliveryFor(line).style.split(/[\s,]+/).filter(Boolean).length <= 2, line);
});
