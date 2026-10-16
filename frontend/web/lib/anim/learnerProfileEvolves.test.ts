/** The learner profile's contextual options and how it evolves (owner's spec, 2026-09-30). */
import test from "node:test";
import assert from "node:assert/strict";
import { matchCountry, studyLevelOptions, subjectOptions } from "../education";
import { knownLevelForTopic, mergeLearnerBasics } from "../learnerBasics";
import { learnerContextForPrompt, learnerProfileView } from "../learnerProfileView";
import { configuredProviders } from "../oauth";
import type { LearnerBasics } from "../db/cosmos";

const physics = { id: "physics", label: "Physics" };
const biology = { id: "biology", label: "Biology" };
const basics = (over: Partial<LearnerBasics> = {}): LearnerBasics => ({
  country: "GB",
  countrySource: "user",
  studyLevel: { id: "gb-gcse", label: "GCSE / O-Level (Years 10–11)" },
  subjects: [physics, biology],
  curricula: [{ id: "gcse", label: "GCSE" }],
  subjectLevels: {},
  subjectCurricula: {},
  completedAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
  ...over,
});

test("subjects follow the student's country: its own first, another country's last", () => {
  const pk = subjectOptions("PK").map((s) => s.id);
  assert.ok(pk.indexOf("urdu") < 12 && pk.indexOf("pakistan-studies") < 12, "Pakistan's own subjects are near the top");
  const gb = subjectOptions("GB").map((s) => s.id);
  assert.ok(gb.indexOf("pakistan-studies") > gb.indexOf("philosophy"), "and at the end elsewhere — still searchable");
  assert.ok(gb.indexOf("welsh") < gb.indexOf("urdu"));
  assert.deepEqual(subjectOptions().length, subjectOptions("US").length, "nothing is ever removed");
});

test("study levels follow the subjects: medicine brings medical school and puts university first", () => {
  const medic = studyLevelOptions("GB", [{ id: "medicine", label: "Medicine" }]);
  assert.equal(medic[0].id, "medical-school");
  assert.ok(medic.findIndex((l) => l.id === "undergrad") < medic.findIndex((l) => l.id === "gcse-uk"));
  const school = studyLevelOptions("GB", [physics]);
  assert.equal(school[0].id, "gb-primary", "a school subject keeps the country's school-first order");
  assert.ok(studyLevelOptions("US", [{ id: "law", label: "Law" }]).some((l) => l.id === "law-school"));
});

test("a typed country is matched, or refused out loud", () => {
  assert.equal(matchCountry("UK"), "GB");
  assert.equal(matchCountry("usa"), "US");
  assert.equal(matchCountry("pakistan"), "PK");
  assert.equal(matchCountry("pk"), "PK");
  assert.equal(matchCountry("Narnia"), null);
});

test("old per-subject levels are kept on save but no longer change the level (2026-10-15)", () => {
  const old = basics({ subjectLevels: { physics: { id: "gb-alevel", label: "A-Level", learned: true } } });
  const saved = mergeLearnerBasics({ studyLevel: { id: "o-level", label: "O Level" } }, old, "Sam");
  assert.equal(saved.subjectLevels?.physics?.id, "gb-alevel", "a save that does not send them keeps what is stored");
  assert.equal(knownLevelForTopic(saved, "projectile motion and velocity")?.level.id, "o-level", "the Study level is used, not the hidden one");
});

test("the level Aria already knows is used, and only for the student's own subjects", () => {
  const known = knownLevelForTopic(basics({ studyLevel: { id: "a-level-uk", label: "A Level (UK boards)" } }), "projectile motion and velocity");
  assert.equal(known?.subject.id, "physics");
  assert.equal(known?.depth, 3);
  assert.equal(knownLevelForTopic(basics(), "photosynthesis in a leaf")?.depth, 2, "their main level (GCSE) for biology");
  assert.equal(knownLevelForTopic(basics(), "the causes of World War One"), null, "outside their subjects: Aria asks");
});

test("how the student likes to be taught, and what they wrote, reach the lesson writer", () => {
  const text = learnerContextForPrompt(learnerProfileView(basics({ studyLevel: { id: "a-level-uk", label: "A Level (UK boards)" } }), null), {
    slowerPace: true,
    simplerLanguage: true,
    notes: "I learn best from diagrams",
  });
  assert.match(text, /slower pace/);
  assert.match(text, /simpler language/);
  assert.match(text, /I learn best from diagrams/);
  assert.match(text, /Curriculum \/ exam \/ track: A Level — use its terminology/);
});

test("without a usable AUTH_SECRET no social button claims to work", () => {
  const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };
  assert.equal(configuredProviders(env).google, false);
  assert.equal(configuredProviders({ ...env, AUTH_SECRET: "x".repeat(40) }).google, true);
});
