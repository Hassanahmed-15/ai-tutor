/**
 * Long-term learner memory: evidence moves an estimate rather than overwriting it, misconceptions
 * are remembered until resolved, only related memories seed a new topic, and the student's own edits
 * win.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCheckpoint,
  applyMemoryEdit,
  boundMemory,
  conceptKey,
  effectiveMastery,
  emptyMemory,
  isMemoryEdit,
  MASTERY_TARGETS,
  MEMORY_LIMITS,
  memoryWasUsed,
  mergeSessionProfile,
  parseMemory,
  seedProfile,
  snapshotFrom,
} from "../learnerModel";
import { emptyProfile, type LearnerProfile } from "../learnerProfile";

const T0 = "2026-09-01T00:00:00.000Z";
const T1 = "2026-09-10T00:00:00.000Z";

function profile(topic: string, extra: Partial<LearnerProfile>): LearnerProfile {
  return { ...emptyProfile(topic), ...extra };
}

test("one concept however it is phrased", () => {
  assert.equal(conceptKey("Transition Matrices"), conceptKey("transition matrix"));
  assert.equal(conceptKey("Markov chains"), conceptKey("markov chain"));
  assert.equal(conceptKey("Bellman's equation!"), "bellman s equation");
});

test("a planning conversation lands in memory, by kind of evidence", () => {
  const memory = mergeSessionProfile(emptyMemory(T0), profile("Markov chains vs MDPs", {
    masteredConcepts: ["Markov chains"],
    weakConcepts: ["transition matrix"],
    prerequisiteGaps: ["reward function"],
    misconceptions: ["An MDP is just a Markov chain with more states"],
    objective: "fundamentals",
    preferredStyle: "worked examples",
  }), T0);
  assert.equal(memory.concepts[conceptKey("Markov chains")].mastery, MASTERY_TARGETS.mastered);
  assert.equal(memory.concepts[conceptKey("transition matrix")].mastery, MASTERY_TARGETS.weak);
  assert.equal(memory.concepts[conceptKey("reward function")].mastery, MASTERY_TARGETS.missing);
  assert.equal(memory.misconceptions.length, 1);
  assert.equal(memory.misconceptions[0].resolved, false);
  assert.equal(memory.preferences.style, "worked examples");
  assert.deepEqual(memory.goals.map((g) => g.objective), ["fundamentals"]);
});

test("new evidence moves an estimate; it does not overwrite it", () => {
  let memory = mergeSessionProfile(emptyMemory(T0), profile("t", { masteredConcepts: ["chain rule"] }), T0);
  memory = mergeSessionProfile(memory, profile("t", { weakConcepts: ["chain rule"] }), T1);
  const m = memory.concepts[conceptKey("chain rule")].mastery;
  assert.ok(m < MASTERY_TARGETS.mastered && m > MASTERY_TARGETS.weak, `landed at ${m}`);
  // A concept not mentioned today keeps what it had.
  memory = mergeSessionProfile(memory, profile("other", { masteredConcepts: ["vectors"] }), T1);
  assert.equal(memory.concepts[conceptKey("chain rule")].mastery, m);
});

test("a misconception that returns is un-resolved, not duplicated", () => {
  let memory = mergeSessionProfile(emptyMemory(T0), profile("t", { misconceptions: ["Heavier objects fall faster"] }), T0);
  memory = applyMemoryEdit(memory, { op: "resolveMisconception", id: memory.misconceptions[0].id, resolved: true }, T0);
  memory = mergeSessionProfile(memory, profile("t", { misconceptions: ["heavier objects   fall faster"] }), T1);
  assert.equal(memory.misconceptions.length, 1);
  assert.equal(memory.misconceptions[0].resolved, false);
});

test("checkpoints move one concept each way", () => {
  const base = mergeSessionProfile(emptyMemory(T0), profile("t", { weakConcepts: ["Bayes rule"] }), T0);
  const right = applyCheckpoint(base, "Bayes rule", true, "t", T1).concepts[conceptKey("Bayes rule")].mastery;
  const wrong = applyCheckpoint(base, "Bayes rule", false, "t", T1).concepts[conceptKey("Bayes rule")].mastery;
  assert.ok(right > MASTERY_TARGETS.weak && wrong <= MASTERY_TARGETS.weak + 1e-9);
});

test("unrefreshed estimates drift back toward unknown", () => {
  const concept = { key: "x", label: "x", mastery: 0.9, evidence: [], lastSeen: T0, topics: [] };
  const later = Date.parse(T0) + 60 * 86_400_000;
  assert.ok(Math.abs(effectiveMastery(concept, later) - 0.7) < 1e-9); // halfway back from 0.9 to 0.5
  assert.equal(effectiveMastery(concept, Date.parse(T0)), 0.9);
});

test("only related memories seed a new topic", () => {
  let memory = mergeSessionProfile(emptyMemory(T0), profile("Markov chains", {
    masteredConcepts: ["Markov chains"],
    misconceptions: ["Markov property means no randomness"],
  }), T0);
  // Learned while planning a different subject, so it says nothing about this one.
  memory = mergeSessionProfile(memory, profile("Spanish grammar", { masteredConcepts: ["Spanish verbs"] }), T0);
  const seeded = seedProfile(memory, "diff between Markov chain and MDP", emptyProfile("x"), Date.parse(T0));
  assert.deepEqual(seeded.masteredConcepts, ["Markov chains"]);
  assert.deepEqual(seeded.misconceptions, ["Markov property means no randomness"]);
  assert.equal(seeded.claimedLevel, null, "the conversation still asks their level");
  assert.ok(memoryWasUsed(seeded));
  assert.equal(memoryWasUsed(seedProfile(memory, "French cooking", emptyProfile("x"), Date.parse(T0))), false);
});

test("the pipeline's summary is derived from the profile, not guessed again", () => {
  assert.equal(snapshotFrom(emptyProfile("t"), 1).expertise, "beginner");
  assert.equal(snapshotFrom(emptyProfile("t"), 3).expertise, "intermediate");
  const expert = snapshotFrom({ ...emptyProfile("t"), objective: "interview", preferredStyle: "worked examples, step by step" }, 5);
  assert.deepEqual([expert.expertise, expert.depth, expert.goal, expert.codeExamples, expert.preferredExamples], ["advanced", "deep", "professional", true, "worked"]);
});

test("memory stays bounded, keeping the most recent", () => {
  let memory = emptyMemory(T0);
  for (let i = 0; i < MEMORY_LIMITS.concepts + 30; i += 1) {
    memory.concepts[`c${i}`] = { key: `c${i}`, label: `c${i}`, mastery: 0.5, evidence: [], lastSeen: new Date(Date.parse(T0) + i * 1000).toISOString(), topics: [] };
  }
  memory = boundMemory(memory);
  assert.equal(Object.keys(memory.concepts).length, MEMORY_LIMITS.concepts);
  assert.ok(memory.concepts[`c${MEMORY_LIMITS.concepts + 29}`] && !memory.concepts.c0);
});

test("the student's edits win, and only valid edits are accepted", () => {
  const memory = mergeSessionProfile(emptyMemory(T0), profile("t", { weakConcepts: ["recursion"] }), T0);
  const key = conceptKey("recursion");
  assert.equal(applyMemoryEdit(memory, { op: "setMastery", key, mastery: 0.95 }, T1).concepts[key].mastery, 0.95);
  assert.equal(applyMemoryEdit(memory, { op: "removeConcept", key }, T1).concepts[key], undefined);
  assert.ok(isMemoryEdit({ op: "setPreference", field: "style", value: null }));
  assert.equal(isMemoryEdit({ op: "setMastery", key: "x" }), false);
  assert.equal(isMemoryEdit({ op: "dropTable" }), false);
});

test("a malformed stored document reads as empty memory", () => {
  assert.deepEqual(Object.keys(parseMemory({ version: 2 }).concepts), []);
  assert.deepEqual(parseMemory(null).misconceptions, []);
});

test("a months-old misconception is kept visible but not carried into a new lecture", () => {
  const memory = mergeSessionProfile(emptyMemory(T0), profile("Markov chains", { misconceptions: ["Markov property means no randomness"] }), T0);
  const soon = seedProfile(memory, "Markov chains again", emptyProfile("x"), Date.parse(T0) + 30 * 86_400_000);
  const much_later = seedProfile(memory, "Markov chains again", emptyProfile("x"), Date.parse(T0) + 200 * 86_400_000);
  assert.equal(soon.misconceptions.length, 1);
  assert.equal(much_later.misconceptions.length, 0);
  assert.equal(memory.misconceptions.length, 1, "still in memory, for the student to see");
});

test("an untouched profile is not passed off as personalised", async () => {
  const { profileHasSignal } = await import("../learnerModel");
  assert.equal(profileHasSignal(emptyProfile("t")), false);
  assert.equal(profileHasSignal({ ...emptyProfile("t"), claimedLevel: 2 }), true);
  assert.equal(profileHasSignal({ ...emptyProfile("t"), weakConcepts: ["x"] }), true);
});

test("Aria says what she remembers, so the student can correct it", async () => {
  const { rememberedLine } = await import("../learnerModel");
  assert.equal(rememberedLine(emptyProfile("t")), "");
  const line = rememberedLine({ ...emptyProfile("t"), masteredConcepts: ["Markov chains"], weakConcepts: ["rewards"] });
  assert.match(line, /remember you know Markov chains; you were unsure about rewards/);
  assert.match(line, /Tell me if any of that has changed/);
});

test("a lesson is remembered even when the planning conversation named no concepts", async () => {
  const { recordLesson, applyLectureProgress } = await import("../learnerModel");
  let memory = recordLesson(emptyMemory(T0), "Binary search tree", T0);
  memory = applyLectureProgress(memory, "Binary search tree", [{ concept: "BST insertion" }, { concept: "In-order traversal" }], T1);
  assert.equal(memory.lessons.length, 1);
  assert.equal(memory.lessons[0].beatsWatched, 2);
  // Taught, not yet checked: still settling.
  assert.equal(memory.concepts[conceptKey("BST insertion")].mastery, MASTERY_TARGETS.covered);
  assert.equal(memory.concepts[conceptKey("BST insertion")].evidence[0].source, "lecture");
});

test("being taught something you already know never lowers it", async () => {
  const { applyLectureProgress } = await import("../learnerModel");
  const known = mergeSessionProfile(emptyMemory(T0), profile("t", { masteredConcepts: ["recursion"] }), T0);
  const after = applyLectureProgress(known, "t", [{ concept: "recursion" }], T1);
  assert.equal(after.concepts[conceptKey("recursion")].mastery, MASTERY_TARGETS.mastered);
});

test("memory saved before lessons existed still reads", () => {
  const legacy = { version: 1, concepts: {}, misconceptions: [], preferences: { style: null, background: null }, goals: [], lastLevel: null, updatedAt: T0 };
  assert.deepEqual(parseMemory(legacy).lessons, []);
});

/* ── the portrait ─────────────────────────────────────────────────────────── */

test("the student's own words are kept, once each, and capped", async () => {
  const { addExcerpts } = await import("../learnerModel");
  let memory = addExcerpts(emptyMemory(T0), [
    { source: "planning", topic: "Hill cipher", text: "  I know   matrices   but not modular arithmetic " },
    { source: "planning", topic: "Hill cipher", text: "I know matrices but not modular arithmetic" },
    { source: "question", topic: "Hill cipher", text: "hi" },
  ], T0);
  assert.equal(memory.excerpts.length, 1);
  assert.equal(memory.excerpts[0].text, "I know matrices but not modular arithmetic");
  memory = addExcerpts(memory, Array.from({ length: 100 }, (_, i) => ({ source: "question" as const, topic: "t", text: `question number ${i}` })), T1);
  assert.equal(memory.excerpts.length, MEMORY_LIMITS.excerpts);
  assert.equal(memory.excerpts.at(-1)?.text, "question number 99");
  // Nothing new: the same object, so no write happens.
  assert.equal(addExcerpts(memory, [{ source: "question", topic: "t", text: "question number 99" }]), memory);
});

test("the evidence digest carries every source and stays within its cap", async () => {
  const { addExcerpts, personaEvidence, recordLesson, recordSignal } = await import("../learnerModel");
  let memory = mergeSessionProfile(emptyMemory(T0), profile("Markov chains", { masteredConcepts: ["matrices"], prerequisiteGaps: ["eigenvalues"], misconceptions: ["a chain remembers its whole past"], preferredStyle: "visual" }), T0);
  memory = recordLesson(memory, "Markov chains", T0, { codeExamples: true, expertise: "intermediate", goal: "exam" });
  memory = recordSignal(memory, "code", T1);
  memory = applyCheckpoint(memory, "stationary distribution", false, "Markov chains", T1);
  memory = addExcerpts(memory, [{ source: "question", topic: "Markov chains", text: "why does the chain forget its past?" }], T1);
  memory = applyMemoryEdit(memory, { op: "setPersonaNote", text: "I am a physics student who wants proofs." }, T1);
  const digest = personaEvidence(memory, Date.parse(T1));
  for (const expected of ["authoritative", "physics student", "why does the chain forget", "- Markov chains [code, intermediate, exam]", "asked for code examples in 1 of 1 lessons", "asked to see it as code 1 time", "matrices", "eigenvalues", "stationary distribution", "remembers its whole past", "style: visual"]) {
    assert.ok(digest.includes(expected), `digest is missing "${expected}"`);
  }
  assert.ok(digest.indexOf("authoritative") < digest.indexOf("THEIR OWN WORDS"));
  const flooded = addExcerpts(memory, Array.from({ length: 60 }, (_, i) => ({ source: "question" as const, topic: "t", text: `a long question about something, repeated with a different number so it is kept, ${i} `.repeat(2) })), T1);
  assert.ok(personaEvidence(flooded).length <= 6_000);
});

test("a malformed portrait changes nothing", async () => {
  const { applyPersonaResult, recordLesson } = await import("../learnerModel");
  const memory = recordLesson(emptyMemory(T0), "t", T0);
  assert.equal(applyPersonaResult(memory, null), memory);
  assert.equal(applyPersonaResult(memory, "nope"), memory);
  assert.equal(applyPersonaResult(memory, { summary: "short" }), memory);
  assert.equal(applyPersonaResult(memory, { interests: ["x"] }), memory);
});

test("the portrait lands, with only well-formed fields, and records what it was based on", async () => {
  const { applyPersonaResult, recordLesson, personaIsStale } = await import("../learnerModel");
  let memory = recordLesson(emptyMemory(T0), "Hill cipher", T0);
  assert.equal(personaIsStale(memory), true);
  memory = applyPersonaResult(memory, {
    summary: "You are drawn to the mathematics behind security and pick up matrix ideas quickly.",
    interests: ["cryptography", 42, "", "linear algebra"],
    strengths: ["matrices"],
    growthAreas: "not an array",
    learningStyle: "worked examples first",
    teachingPlan: "Start from a cipher, then reveal the algebra.",
  }, T1);
  assert.deepEqual(memory.persona?.interests, ["cryptography", "linear algebra"]);
  assert.deepEqual(memory.persona?.growthAreas, []);
  assert.equal(memory.persona?.basedOn.lessons, 1);
  assert.equal(memory.persona?.generatedAt, T1);
  assert.equal(personaIsStale(memory), false);
  // New evidence makes it stale again; no evidence at all is never "stale".
  assert.equal(personaIsStale(recordLesson(memory, "Vigenere", "2026-09-20T00:00:00.000Z")), true);
  assert.equal(personaIsStale(emptyMemory(T0)), false);
});

test("the clean-up merges duplicates without losing evidence, and cannot drop what the student or a checkpoint established", async () => {
  const { applyLectureProgress, applyPersonaResult } = await import("../learnerModel");
  let memory = mergeSessionProfile(emptyMemory(T0), profile("t", { masteredConcepts: ["recursion"] }), T0);
  memory = applyLectureProgress(memory, "t", [{ concept: "Why explain me hill cipher" }, { concept: "Hill cipher: the key matrix" }, { concept: "Biometric Cash Point" }], T1);
  memory = applyCheckpoint(memory, "Hill cipher: the key matrix", true, "t", T1);
  const keyA = conceptKey("Why explain me hill cipher");
  const keyB = conceptKey("Hill cipher: the key matrix");
  const masteryB = memory.concepts[keyB].mastery;
  memory = applyPersonaResult(memory, {
    summary: "You are working through classical ciphers and already hold the matrix side firmly.",
    concepts: {
      merge: [{ into: "Hill cipher", keys: [keyA, keyB, "no-such-key"] }],
      rename: [{ key: conceptKey("Biometric Cash Point"), label: "Biometric authentication" }, { key: "missing", label: "x" }],
      drop: [conceptKey("recursion"), conceptKey("Biometric authentication")],
    },
  }, T1);
  const merged = memory.concepts[conceptKey("Hill cipher")];
  assert.ok(merged, "merged concept exists");
  assert.equal(merged.label, "Hill cipher");
  assert.equal(merged.mastery, masteryB);
  assert.ok(merged.evidence.some((e) => e.source === "checkpoint"));
  assert.equal(memory.concepts[keyA], undefined);
  assert.equal(memory.concepts[keyB], undefined);
  // Renamed, then dropped: only lecture-title evidence backed it, so dropping is allowed.
  assert.equal(memory.concepts[conceptKey("Biometric authentication")], undefined);
  assert.equal(memory.concepts[conceptKey("Biometric Cash Point")], undefined);
  // The student said they know recursion: a clean-up may not forget that.
  assert.equal(memory.concepts[conceptKey("recursion")].mastery, MASTERY_TARGETS.mastered);
});

test("the student's correction becomes the portrait and survives every refresh", async () => {
  const { applyPersonaResult, personaForPrompt } = await import("../learnerModel");
  assert.equal(isMemoryEdit({ op: "setPersonaNote", text: "x" }), true);
  assert.equal(isMemoryEdit({ op: "setPersonaNote" }), false);
  let memory = applyMemoryEdit(emptyMemory(T0), { op: "setPersonaNote", text: "  I am a nurse; teach me with clinical cases.  " }, T0);
  assert.equal(memory.persona?.summary, "I am a nurse; teach me with clinical cases.");
  assert.equal(memory.persona?.studentNote, "I am a nurse; teach me with clinical cases.");
  memory = applyPersonaResult(memory, { summary: "You bring clinical experience and want each idea tied to a patient you might meet.", teachingPlan: "Clinical cases first." }, T1);
  assert.equal(memory.persona?.studentNote, "I am a nurse; teach me with clinical cases.");
  const block = personaForPrompt(memory);
  assert.ok(block.includes("clinical experience"));
  assert.ok(block.includes("In their own words: I am a nurse"));
  assert.ok(block.includes("Clinical cases first"));
  assert.ok(block.length <= 900);
  assert.equal(personaForPrompt(emptyMemory(T0)), "");
  assert.equal(personaForPrompt(null), "");
});

test("memory saved before the portrait existed still reads", () => {
  const legacy = { version: 1, concepts: {}, misconceptions: [], preferences: { style: null, background: null }, goals: [], lastLevel: null, lessons: [], updatedAt: T0 };
  const parsed = parseMemory(legacy);
  assert.deepEqual(parsed.excerpts, []);
  assert.deepEqual(parsed.signals, {});
  assert.equal(parsed.persona, null);
  assert.equal(parseMemory({ ...legacy, persona: { bogus: true } }).persona, null);
});
