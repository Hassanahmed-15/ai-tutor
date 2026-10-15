import test from "node:test";
import assert from "node:assert/strict";
import { GENERATE_TEST_SYSTEM_PROMPT, GRADE_ANSWER_RUBRIC_INSTRUCTION } from "../testPrompt";

test("test questions cannot hide required ideas in the rubric", () => {
  assert.match(GENERATE_TEST_SYSTEM_PROMPT, /Every required key point MUST be explicitly requested by the question/);
  assert.match(GRADE_ANSWER_RUBRIC_INSTRUCTION, /question text is the grading contract/);
  assert.match(GRADE_ANSWER_RUBRIC_INSTRUCTION, /must not turn an otherwise complete answer into a wrong one/);
});

test("the post-lesson test stays proportionate to a short lecture", () => {
  assert.match(GENERATE_TEST_SYSTEM_PROMPT, /3-6 questions/);
  assert.doesNotMatch(GENERATE_TEST_SYSTEM_PROMPT, /6-10 questions/);
});
