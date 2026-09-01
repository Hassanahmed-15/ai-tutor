/**
 * The persona and tools for planning a lesson out loud.
 *
 * A Live session cannot be unit tested — it is a socket — but the two things most likely to be
 * wrong here are pure strings: which verbs the model is offered, and whether it was actually handed
 * the student's document. Both fail silently in a way that looks like the model behaving oddly
 * rather than like a bug: she invents content, or she cannot act on what the student asks for.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { PLANNING_TOOLS, buildPlanningVoiceInstruction } from "../planningVoiceContract";

test("the session offers exactly the two verbs the screen can act on", () => {
  /*
   * One tool per thing the application can DO, not per thing a student might SAY. Declaring a tool
   * the planning screen has no handler for is worse than omitting it: the model calls it, something
   * silently does nothing, and the student is told their change was made.
   */
  assert.deepEqual(PLANNING_TOOLS.map((t) => t.name).sort(), ["approve_plan", "revise_plan"]);
});

test("revise_plan takes the instruction in the student's own words", () => {
  const revise = PLANNING_TOOLS.find((t) => t.name === "revise_plan")!;
  const schema = revise.parametersJsonSchema as { properties?: Record<string, unknown>; required?: string[] };
  assert.ok(schema.properties?.instruction, "there is nothing to revise with");
  assert.deepEqual(schema.required, ["instruction"]);
});

test("approve_plan is warned against being called speculatively", () => {
  // It spends minutes and money and cannot be undone, so the description has to say so — the model
  // filling an awkward silence by starting a build is the expensive failure here.
  const approve = PLANNING_TOOLS.find((t) => t.name === "approve_plan")!;
  assert.match(approve.description, /do not call this speculatively|only when they have actually agreed/i);
});

test("the document is handed over, and named as the only source", () => {
  /*
   * The whole point of spoken planning over an upload. Without the document she plans from general
   * knowledge of the subject and sounds exactly as confident doing it.
   */
  const instruction = buildPlanningVoiceInstruction({
    topic: "ablation study",
    documentContext: "[page 4] Fig. 3: Lower-triangular Pearson correlation matrix. r = 0.49",
  });
  assert.match(instruction, /r = 0\.49/, "the document never reached the persona");
  assert.match(instruction, /not from general knowledge/i);
});

test("a typed topic gets no document section at all", () => {
  // An empty "here is their document" heading would assert an upload that does not exist.
  const instruction = buildPlanningVoiceInstruction({ topic: "photosynthesis" });
  assert.doesNotMatch(instruction, /uploaded a document/);
  assert.match(instruction, /photosynthesis/);
});

test("she keeps turns short and does not read the outline back", () => {
  // The student is looking at the outline while she speaks; reading it aloud is the obvious failure
  // mode for a model that has just been handed a list.
  const instruction = buildPlanningVoiceInstruction({ topic: "anything" });
  assert.match(instruction, /a sentence or two/);
  assert.match(instruction, /Do not read the outline back/);
  // She opens by asking, not by presenting.
  assert.match(instruction, /Open by asking what they want/);
});

test("she is told to ASK, not to deliver information", () => {
  /*
   * THIS ASSERTION IS A CORRECTION, and the old wording is named so it cannot come back.
   *
   * The persona used to say "teach something genuinely useful about the material while they wait",
   * which produced exactly what was reported: talking AT the student through the whole build. The
   * wait is better spent finding out what they already know, which also makes the lecture land.
   */
  const instruction = buildPlanningVoiceInstruction({ topic: "anything" });
  assert.match(instruction, /ASK, do not tell/);
  assert.match(instruction, /ONE question per turn/);
  assert.match(instruction, /stop talking and wait/);
  assert.match(instruction, /They should be doing most of the talking/);
  assert.doesNotMatch(instruction, /teach something genuinely useful/);
});

test("the build wait is a diagnostic drawn from the document", () => {
  // Questions about the subject in general would be a quiz she could run without their upload; the
  // point is to find out what they know about THIS material.
  const instruction = buildPlanningVoiceInstruction({ topic: "anything" });
  assert.match(instruction, /WHILE THE LECTURE IS BUILDING/);
  assert.match(instruction, /not from the subject in general/);
  assert.match(instruction, /not hold music, and not a lecture delivered early/);
  // She cannot see progress, so she must not invent it.
  assert.match(instruction, /never guess at how far along|Do not narrate progress you cannot see/i);
});

test("a direct question still gets a real answer", () => {
  // "Only ask questions" taken literally would make her refuse to answer, which is worse than the
  // lecturing it replaced.
  assert.match(buildPlanningVoiceInstruction({ topic: "anything" }), /answer it properly[^]*then go back to asking/i);
});

test("she is told she cannot draw", () => {
  // Planning has no board, and the caller's onBoardRequest is a deliberate no-op — so a drawing
  // offer would be a promise nothing can keep.
  assert.match(buildPlanningVoiceInstruction({ topic: "anything" }), /cannot draw|no board/i);
});
