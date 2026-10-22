import test from "node:test";
import assert from "node:assert/strict";
import { checksToAsk, gradeCheck, matchSpokenParts, partsPlanLine, profileFromIntake, readParts, sanitizeIntake, typedParts, type PartMark } from "../intake";
import { learnerInstruction, sanitizeLearnerProfile } from "../learnerProfile";

/*
 * THE INTAKE (lib/intake.ts, owner 2026-10-20): the student marks the parts they know, up to three
 * very basic checks confirm them, and each part becomes new / shaky / known for the lesson plan.
 */
const raw = { parts: [
  { label: "What plants need", check: { question: "What does a plant need to make food?", options: ["Sunlight", "Darkness", "Music"], answer: 0 } },
  { label: "Leaves and chlorophyll", check: { question: "What colour is chlorophyll?", options: ["Red", "Green", "Blue"], answer: 1 } },
  { label: "Gases plants take in", check: { question: "Which gas do plants take in?", options: ["Helium", "Oxygen", "Carbon dioxide"], answer: 2 } },
  { label: "What plants make", check: { question: "What food do plants make?", options: ["Sugar", "Salt", "Protein"], answer: 0 } },
  { label: "Why it matters — to us", check: { question: "Which gas do plants give out?", options: ["Oxygen", "Smoke", "Steam"], answer: 0 } },
] };

test("the model's parts are kept with valid checks; dashes go; a broken check drops the check, not the part", () => {
  const parts = sanitizeIntake(raw);
  assert.equal(parts.length, 5);
  assert.equal(parts[4].label, "Why it matters, to us");
  assert.deepEqual(parts.map((p) => p.id), ["part-1", "part-2", "part-3", "part-4", "part-5"]);
  const broken = sanitizeIntake({ parts: [raw.parts[0], { label: "Odd one", check: { question: "Q?", options: ["a", "b"], answer: 5 } }] });
  assert.equal(broken[1].check, null);
  assert.deepEqual(sanitizeIntake({ parts: [raw.parts[0]] }), [], "one part is not a topic map");
});

test("only parts marked 'I know this' are checked, at most three, in teaching order", () => {
  const parts = sanitizeIntake(raw);
  const marks: Record<string, PartMark> = { "part-1": "know", "part-2": "heard", "part-3": "know", "part-4": "know", "part-5": "know" };
  assert.deepEqual(checksToAsk(parts, marks).map((p) => p.id), ["part-1", "part-3", "part-4"]);
  assert.deepEqual(checksToAsk(parts, {}), [], "all new: no checks");
});

test("a check is right only on the right card; 'Not sure' or anything else is unsure, never wrong", () => {
  const [, chlorophyll] = sanitizeIntake(raw);
  assert.equal(gradeCheck(chlorophyll, "Green"), "right");
  assert.equal(gradeCheck(chlorophyll, "Red"), "wrong");
  assert.equal(gradeCheck(chlorophyll, "Not sure"), "unsure");
  assert.equal(gradeCheck(chlorophyll, "something else entirely"), "unsure");
});

test("known holds only when checked right; a wrong check or 'heard of it' makes a part shaky; the rest are new", () => {
  const parts = sanitizeIntake(raw);
  const marks: Record<string, PartMark> = { "part-1": "know", "part-2": "heard", "part-3": "know" };
  const readings = readParts(parts, marks, { "part-1": "right", "part-3": "wrong" });
  assert.deepEqual(readings.map((r) => r.status), ["known", "shaky", "shaky", "new", "new"]);
  // A fourth "known" part beyond the three checks counts as known only if every check passed.
  const many: Record<string, PartMark> = { "part-1": "know", "part-2": "know", "part-3": "know", "part-4": "know" };
  assert.equal(readParts(parts, many, { "part-1": "right", "part-2": "right", "part-3": "right" })[3].status, "known");
  assert.equal(readParts(parts, many, { "part-1": "right", "part-2": "wrong", "part-3": "right" })[3].status, "shaky");
});

test("the profile carries the parts, and its level follows how much is already known", () => {
  const parts = sanitizeIntake(raw);
  const none = profileFromIntake("photosynthesis", readParts(parts, {}, {}));
  assert.equal(none.claimedLevel, 2);
  assert.equal(none.parts?.length, 5);
  assert.match(none.teachingHypothesis ?? "", /from scratch/);
  const most = profileFromIntake("photosynthesis", parts.map((p, i) => ({ label: p.label, status: i < 4 ? "known" as const : "new" as const })));
  assert.equal(most.claimedLevel, 4);
  assert.deepEqual(most.masteredConcepts.length, 4);
  assert.match(partsPlanLine(most.parts), /1\. What plants need: KNOWN, one-line recap only[\s\S]*5\. Why it matters, to us: NEW, build from scratch/);
  assert.equal(partsPlanLine(undefined), "");
});

test("spoken answers on the parts screen: parts by their words, 'heard of', 'all new', 'done'", () => {
  const parts = sanitizeIntake(raw);
  assert.deepEqual(matchSpokenParts("I know about chlorophyll and the gases", parts).marks, { "part-2": "know", "part-3": "know" });
  assert.deepEqual(matchSpokenParts("I've heard of chlorophyll", parts).marks, { "part-2": "heard" });
  assert.deepEqual(matchSpokenParts("honestly it's all new to me", parts), { marks: {}, allNew: true, done: true });
  assert.equal(matchSpokenParts("ok that's it", parts).done, true);
  assert.deepEqual(matchSpokenParts("hmm", parts).marks, {});
});

test("cards are shuffled so the right one is not always first, and a check that gives itself away is dropped (probe, 2026-10-20)", () => {
  const many = { parts: ["Militarism", "Alliances", "Imperialism", "Nationalism", "Assassination", "Outbreak"].map((label, i) => ({ label, check: { question: `Basic question number ${i}?`, options: [`right ${i}`, `wrong a${i}`, `wrong b${i}`], answer: 0 } })) };
  const parts = sanitizeIntake(many);
  const firsts = parts.filter((p) => p.check!.answer === 0).length;
  assert.ok(firsts < parts.length, "not every right answer stays first");
  for (const p of parts) assert.match(p.check!.options[p.check!.answer], /^right/, "the answer index follows its card");
  const giveaway = sanitizeIntake({ parts: [
    { label: "Electrolytes", check: { question: "What is needed for electrolysis?", options: ["Electrolytes", "Metals", "Gases"], answer: 0 } },
    { label: "Double rotation", check: { question: "What does double rotation involve?", options: ["Two rotations", "No rotations", "One"], answer: 0 } },
    { label: "Electrodes", check: { question: "What are the two electrodes called?", options: ["Anode and cathode", "Left and right", "Up and down"], answer: 0 } },
  ] });
  assert.deepEqual(giveaway.map((p) => Boolean(p.check)), [false, false, true]);
});

test("the card: parts as one multi-select, a check tab per ticked part (at most three), graded on Submit", async () => {
  const { intakeCard, gradeCard, ALL_NEW, NOT_SURE } = await import("../intake");
  const parts = sanitizeIntake(raw);
  const none = intakeCard(parts, []);
  assert.equal(none.length, 1, "nothing ticked: only the parts question");
  assert.equal(none[0].multi, true);
  assert.equal(none[0].options[none[0].options.length - 1].label, ALL_NEW);
  const card = intakeCard(parts, ["part-1", "part-2", "part-3", "part-4"]);
  assert.deepEqual(card.map((q) => q.id), ["parts", "check-part-1", "check-part-2", "check-part-3"]);
  assert.equal(card[1].options[card[1].options.length - 1].label, NOT_SURE);
  const right = parts[0].check!.options[parts[0].check!.answer];
  const graded = gradeCard(parts, ["part-1", "part-2"], { "part-1": right, "part-2": "Red" });
  assert.deepEqual(graded, { "part-1": "right", "part-2": "wrong" });
  assert.deepEqual(gradeCard(parts, ["part-1"], {}), { "part-1": "unsure" }, "an unanswered check counts as not sure");
});

/*
 * THE OTHER BOX (owner, 2026-10-22: "like Claude — if Other, you can type your answer"): a typed answer
 * ticks the parts it says the student knows, a typed check answer is graded by the option it means, and
 * the student's own words reach the planner.
 */
test("a typed answer ticks the parts it says are known, clause by clause, never the ones it says are not", () => {
  const parts = sanitizeIntake(raw);
  const t = typedParts("I know about chlorophyll and the gases plants take in, but not what plants make", parts);
  assert.deepEqual(t.known.sort(), ["part-2", "part-3"]);
  assert.equal(t.allNew, false);
  assert.deepEqual(typedParts("I don't know anything about leaves", parts).known, [], "a negative clause ticks nothing");
  assert.equal(typedParts("honestly it's all new to me", parts).allNew, true);
  assert.deepEqual(typedParts("I want to focus on exam questions", parts).known, [], "words that name no part tick nothing");
});

test("a typed check answer is graded by the option it means; one that means none is 'not sure'", () => {
  const [, leaves] = sanitizeIntake(raw);
  assert.equal(gradeCheck(leaves, "it's green"), "right");
  assert.equal(gradeCheck(leaves, "I think red"), "wrong");
  assert.equal(gradeCheck(leaves, "something to do with light?"), "unsure");
});

test("the student's typed words reach the planner and survive the round trip", () => {
  const parts = sanitizeIntake(raw);
  const profile = profileFromIntake("Photosynthesis", readParts(parts, {}, {}), undefined, "I know the equation but not why light matters");
  const back = sanitizeLearnerProfile(JSON.parse(JSON.stringify(profile)), "Photosynthesis");
  assert.equal(back.ownWords, "I know the equation but not why light matters");
  assert.match(learnerInstruction(back, 2), /IN THEIR OWN WORDS: "I know the equation but not why light matters"/);
  assert.equal(profileFromIntake("Photosynthesis", readParts(parts, {}, {})).ownWords, null);
});
