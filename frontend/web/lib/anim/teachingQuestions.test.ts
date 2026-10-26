import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeTeachingChoices, sanitizeTeachingQuestions, teachingChoices, teachingLine, teachingSettings, TEACH_TAB_PREFIX } from "../teachingQuestions";
import { cardQuestions } from "../intake";
import { checkCardBoards } from "../canvas/checkCardPlan";
import type { CanvasPlanBeat } from "../canvas/types";

// The owner's request (2026-10-24): questions tailored to the topic that capture how to teach it.
const RAW = {
  questions: [
    { id: "code", kind: "code", header: "Code", question: "Should the lesson show code, and in which language?", options: [{ label: "Python", value: "python" }, { label: "Java", value: "java" }, { label: "No code", value: "none", description: "Pictures and words only" }] },
    { id: "focus", kind: "focus", header: "Focus", question: "Which parts should get more time?", multi: true, options: [{ label: "Relaxing edges", value: "relaxing edges" }, { label: "Priority queue", value: "priority queue" }, { label: "Path reconstruction", value: "path reconstruction" }] },
    { id: "depth", kind: "depth", header: "Depth", question: "A quick overview or the full detail?", options: [{ label: "Quick overview", value: "overview" }, { label: "In depth", value: "deep" }] },
    { id: "depth2", kind: "depth", header: "Depth", question: "Again?", options: [{ label: "a" }, { label: "b" }] },
    { id: "bad", kind: "style", header: "Examples", question: "One option only", options: [{ label: "x" }] },
    { id: "practice", kind: "practice", header: "Practice", question: "Quick questions to check yourself?", options: [{ label: "None", value: "none" }, { label: "A few", value: "some" }, { label: "Lots", value: "lots" }] },
    { id: "extra", kind: "other", header: "More", question: "A fifth question", options: [{ label: "a" }, { label: "b" }] },
  ],
};

test("the model's questions are kept only when usable: one per kind, 2+ options, at most 4", () => {
  const qs = sanitizeTeachingQuestions(RAW);
  assert.deepEqual(qs.map((q) => q.kind), ["code", "focus", "depth", "practice"]);
  assert.equal(qs.find((q) => q.kind === "focus")?.multi, true);
  assert.equal(qs.find((q) => q.kind === "code")?.multi, undefined, "only focus is multi-select");
  assert.deepEqual(sanitizeTeachingQuestions({}), []);
});

test("the answers become settings code applies, and a rule the planners follow", () => {
  const qs = sanitizeTeachingQuestions(RAW);
  const choices = teachingChoices(qs, { code: ["Java"], focus: ["Relaxing edges", "Path reconstruction"], depth: ["Quick overview"], practice: ["Lots"] });
  const s = teachingSettings(choices);
  assert.deepEqual(s.code, { include: true, language: "java" });
  assert.equal(s.depth, "concise");
  assert.equal(s.practice, "lots");
  assert.deepEqual(s.focus, ["relaxing edges", "path reconstruction"]);
  const line = teachingLine(choices);
  assert.match(line, /Show code in java \(never another language\)/);
  assert.match(line, /Give more time to: relaxing edges; path reconstruction/);
  assert.match(line, /Q: Should the lesson show code/);
  assert.deepEqual(teachingSettings(teachingChoices(qs, { code: ["No code"] })).code, { include: false });
  // A typed (Other) answer reaches the planners as words, with no value to apply.
  const typed = teachingChoices(qs, { depth: ["Medium, with proofs"] });
  assert.deepEqual(typed[0].values, []);
  assert.equal(teachingSettings(typed).depth, undefined);
  assert.equal(teachingLine([]), "");
  assert.equal(sanitizeTeachingChoices(JSON.parse(JSON.stringify(choices))).length, 4, "they survive the trip to the server");
});

test("the card asks them last, with a loading tab holding their place while they are written", () => {
  const base = { parts: [], known: [] };
  assert.deepEqual(cardQuestions({ ...base, loadingTeaching: true }).map((q) => q.id), [`${TEACH_TAB_PREFIX}loading`]);
  const qs = sanitizeTeachingQuestions(RAW);
  const card = cardQuestions({ ...base, goal: { question: "Your goal?", options: ["Exam", "Understand"] }, teaching: qs });
  assert.deepEqual(card.map((q) => q.id), ["goal", ...qs.map((q) => `${TEACH_TAB_PREFIX}${q.id}`)]);
});

const beat = (id: string): CanvasPlanBeat => ({ id, title: id, script: "It is explained. It is shown.", stage: "flow", brief: id, objects: [], inside: null, carry: [], interaction: "quiz", overview: false });

test("the practice answer decides the check cards: none, the usual few, or more", () => {
  const plan = Array.from({ length: 9 }, (_, i) => beat(`b${i + 1}`));
  assert.equal(checkCardBoards(plan, false, "none").size, 0);
  const usual = checkCardBoards(plan, false).size;
  assert.ok(checkCardBoards(plan, false, "lots").size > usual);
  assert.equal(checkCardBoards(plan, false, "some").size, usual);
});

test("an emphasised subtopic finds its part in the outline; an overview is held to 4 parts", async () => {
  const { emphasisedParts } = await import("../teachingQuestions");
  const parts = ["Weighted graphs", "Distance estimates", "Relaxing edges", "Priority queue", "Applications"];
  assert.deepEqual([...emphasisedParts(parts, ["relaxation"])], [2]);
  assert.deepEqual([...emphasisedParts(parts, ["priority queues", "use cases"])], [3]);
  assert.match(teachingLine([{ kind: "depth", question: "How deep?", answer: "Quick overview", values: ["overview"] }]), /AT MOST 4 parts/);
});
