/**
 * "Asked her something while she explained the new slide and she kept on listening" (2026-11-11). While a
 * slide the student asked for is read aloud, a plain question is for her; everything that is not still is not.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { classifyAddressing } from "../voice/runtime/addressing";

const topicWords = new Set(["latency", "throughput", "pipeline", "instruction", "stage"]);
const during = { expectingAnswer: false, tutorSpeaking: true, inConversation: true, topicWords };
const lecture = { expectingAnswer: false, tutorSpeaking: true, topicWords };

test("a plain question while she explains the student's slide is heard", () => {
  for (const q of ["what is throughput?", "why is latency higher here?", "so each stage takes 2 nanoseconds?", "how does the pipeline overlap them?"]) {
    assert.equal(classifyAddressing(q, during).addressed, true, q);
  }
});

test("the same question over her lecture narration still needs more", () => {
  assert.equal(classifyAddressing("what is throughput?", lecture).addressed, false);
});

test("side talk, other people and backchannels are still not for her", () => {
  for (const q of ["did you send that email", "hey Dave pass me that", "okay", "mm hmm", "dinner is ready"]) {
    assert.equal(classifyAddressing(q, during).addressed, false, q);
  }
});
