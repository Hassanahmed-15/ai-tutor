import assert from "node:assert/strict";
import test from "node:test";
import { openingSentence, polishBeatPlan, topicKeywords, transitionSentence } from "../beatPresentation";

test("beat titles are compact keyword phrases", () => {
  const plan = polishBeatPlan([
    { title: "Loops: Core idea", objective: "Define the control condition that decides whether another iteration runs." },
    { title: "How a loop decides to continue", objective: "Explain how the condition is evaluated before each iteration." },
    { title: "Overview", objective: "Trace one loop step by step with concrete values." },
    { title: "Loops: put it together", objective: "Connect conditions, updates, and termination into one mental model." },
  ], "Loops");

  assert.equal(plan[1]?.title, "Loop Decides to Continue");
  assert.ok(plan.every((beat) => !/overview|core idea|put it together/i.test(beat.title)));
  assert.ok(plan.every((beat) => beat.title.length <= 42));
  assert.ok(plan.every((beat) => beat.title.split(/\s+/).length <= 5));
});

test("request wording is removed from lecture topic cards", () => {
  assert.equal(topicKeywords("explain me hill cipher step by step to a"), "Hill Cipher");
  const plan = polishBeatPlan([
    { title: "Why explain me hill cipher step by step to a matters", objective: "Open with why Hill cipher is useful." },
    { title: "Hill cipher: put it together", objective: "Connect matrices and modular arithmetic." },
  ], "explain me hill cipher step by step to a");
  assert.equal(plan[0]?.title, "Hill Cipher");
  assert.equal(plan[1]?.title, "Hill Cipher Recap");
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

test("the lecture opens with a spoken line, so it never starts in silence", () => {
  // Written by the model: kept, trimmed to one sentence.
  assert.equal(
    openingSentence("Hash tables are everywhere once you look. And here is a stray second sentence.", "how a hash table handles collisions"),
    "Hash tables are everywhere once you look.",
  );

  // Not written (an older lecture, or an empty field): a deterministic line naming the topic, the
  // same one every time that lecture is replayed.
  const fallback = openingSentence(undefined, "how a hash table handles collisions");
  assert.equal(openingSentence("", "how a hash table handles collisions"), fallback);
  assert.ok(fallback.split(/\s+/).length <= 18);
  assert.match(fallback, /[.!?]$/);
  assert.match(fallback.toLowerCase(), /hash table/);

  // Different lectures do not all open the same way.
  const others = ["photosynthesis", "the Krebs cycle", "binary search trees", "Markov chains", "the Hill cipher"]
    .map((topic) => openingSentence(undefined, topic));
  assert.ok(new Set(others.map((line) => line.replace(/ .*/, ""))).size > 1, "openings should vary between lectures");

  // No topic at all is still a sentence, never an empty narration.
  assert.match(openingSentence(undefined, ""), /\S/);
});

test("a lecture with no outline gets role titles, never ones made from the tutor's instructions", () => {
  // Exactly what the default plan hands polishBeatPlan when the student skipped planning.
  const subject = "1857 War";
  const plan = polishBeatPlan([
    { title: subject, objective: `Open with a concrete puzzle or use case that makes ${subject} worth learning.` },
    { title: `${subject}: Core idea`, objective: `Define ${subject} plainly and establish the mental model.` },
    { title: `${subject}: How it works`, objective: `Explain the mechanism or sequence behind ${subject}.` },
    { title: `${subject}: A worked example`, objective: `Apply ${subject} step by step to a concrete example.` },
    { title: `${subject}: Common mistake`, objective: `Expose and repair a common misconception about ${subject}.` },
    { title: `${subject} Recap`, objective: "Connect the core ideas, correct the main misconception, and give the learner a usable recap." },
  ], "the 1857 war");
  const titles = plan.map((beat) => beat.title);
  // What shipped: "1857 War plainly and establish", "How It".
  for (const title of titles) {
    assert.ok(!/plainly|establish|mechanism or sequence|misconception about|how it$/i.test(title), `"${title}" is made from a tutor instruction`);
    assert.ok(title.split(/\s+/).length >= 2 || /^\w{5,}/.test(title), `"${title}" is not a real title`);
  }
  assert.deepEqual(titles, ["The 1857 War", "The 1857 War Fundamentals", "The 1857 War Mechanism", "Worked Example", "Common Pitfalls", "The 1857 War Recap"]);
  assert.equal(new Set(titles.map((t) => t.toLowerCase())).size, titles.length, "titles are distinct");
});
