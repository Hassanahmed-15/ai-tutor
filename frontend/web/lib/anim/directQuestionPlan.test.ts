import test from "node:test";
import assert from "node:assert/strict";
import { capQuestionOutline, isDirectQuestion } from "../planPrompt";

test("a direct question is recognised; a request to learn a topic is not", () => {
  for (const q of ["why does underfitting happen", "Why does overfitting happen?", "how does a transistor switch", "Explain why the sky is blue", "difference between TCP and UDP?", "what is the role of chlorophyll in photosynthesis", "what is the difference between mitosis and meiosis?", "what does the p-value mean?"]) {
    assert.equal(isDirectQuestion(q), true, q);
  }
  for (const t of ["Krebs cycle", "teach me linear regression", "Photosynthesis", "I want to learn thermodynamics in depth"]) {
    assert.equal(isDirectQuestion(t), false, t);
  }
});

test("asking what a topic is, or how it works, is a request for the whole lesson (reported 2026-09-29)", () => {
  // Each of these was planned as ONE subtopic — a one-board lecture.
  for (const t of ["what is photosynthesis", "what is krebs cycle", "What is a mitochondrion?", "what are black holes", "how does the heart work", "How do vaccines work?", "explain the Krebs cycle", "tell me about plate tectonics", "what is the theory of evolution", "what is the law of demand"]) {
    assert.equal(isDirectQuestion(t), false, t);
  }
});

test("the reported five-topic outline for 'why does underfitting happen' is cut to the answer", () => {
  // Exactly what the planner produced for the question (screenshot, 2026-09-28).
  const outline = [
    { title: "Underfitting in Machine Learning", caption: "Learn how models perform on training data versus new data." },
    { title: "Concrete Example of Underfitting", caption: "Explore a simple example illustrating underfitting in a linear model." },
    { title: "Defining Underfitting", caption: "Understand what underfitting means in the context of machine learning." },
    { title: "Balancing Bias and Variance", caption: "Discover how underfitting relates to bias and variance in models." },
    { title: "Underfitting Happens", caption: "Identify the main reasons why underfitting occurs in models." },
  ];
  const kept = capQuestionOutline(outline, "why does underfitting happen");
  assert.ok(kept.length <= 2, `kept ${kept.length}`);
  assert.ok(kept.some((s) => /reasons why/.test(s.caption)), "the topic that actually answers 'why' survives");
  assert.ok(!kept.some((s) => /^Concrete Example|^Defining/.test(s.title)), "a standalone example or definition is not the answer");
});

test("an outline already sized for a question is untouched", () => {
  const one = [{ title: "Why Underfitting Happens", caption: "A model too simple for the pattern misses it on training and new data." }];
  assert.deepEqual(capQuestionOutline(one, "why does underfitting happen"), one);
});
