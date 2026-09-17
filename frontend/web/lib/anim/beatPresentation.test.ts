import assert from "node:assert/strict";
import test from "node:test";
import { polishBeatPlan, transitionSentence } from "../beatPresentation";

test("role-aware titles replace generic templates without touching precise titles", () => {
  const plan = polishBeatPlan([
    { title: "Loops: Core idea", objective: "Define the control condition that decides whether another iteration runs." },
    { title: "How a loop decides to continue", objective: "Explain how the condition is evaluated before each iteration." },
    { title: "Overview", objective: "Trace one loop step by step with concrete values." },
    { title: "Loops: put it together", objective: "Connect conditions, updates, and termination into one mental model." },
  ], "Loops");

  assert.equal(plan[1]?.title, "How a loop decides to continue");
  assert.ok(plan.every((beat) => !/overview|core idea|put it together/i.test(beat.title)));
  assert.ok(plan.every((beat) => beat.title.length <= 60));
});

test("duplicate titles are replaced instead of receiving numbered suffixes", () => {
  const plan = polishBeatPlan([
    { title: "The Event Loop", objective: "Define the event loop." },
    { title: "The Event Loop", objective: "Trace callbacks moving from the queue to the stack." },
  ], "JavaScript concurrency");
  assert.notEqual(plan[0]?.title.toLowerCase(), plan[1]?.title.toLowerCase());
  assert.ok(!/\(2\)/.test(plan[1]?.title ?? ""));
});

test("a transition is one short sentence and old lectures receive a deterministic bridge", () => {
  const generated = transitionSentence(
    "That gives us the condition. Now I am accidentally a second sentence.",
    "The loop condition",
    "Trace one loop",
  );
  assert.equal(generated, "That gives us the condition.");

  const fallback = transitionSentence(undefined, "The loop condition", "A worked example");
  assert.match(fallback, /put .* to work/i);
  assert.ok(fallback.split(/\s+/).length <= 18);
});
