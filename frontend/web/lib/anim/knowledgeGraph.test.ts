import test from "node:test";
import assert from "node:assert/strict";
import { bktUpdate, canonicalKey, conceptStatus, edgeConfidence, implicitCredit, mergeConcept, mergeEdge, nextStability, retrievability, shakyPrerequisites, validateLectureKnowledge } from "../knowledge/graph";
import { dueForReview, rateConcept, recordAnswer, recordTaught } from "../knowledge/overlay";
import { layoutKnowledgeMap } from "../knowledge/layout";
import { emptyMemory } from "../learnerModel";
import { canvasPlanRequest } from "../canvas/lessonRequest";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";

/* ── keys and extraction ──────────────────────────────────────────────────────────────────── */

test("one concept, however it is written: formulas, plurals and case fold to one key", () => {
  assert.equal(canonicalKey("CO₂"), "carbon dioxide");
  assert.equal(canonicalKey("co2"), "carbon dioxide");
  assert.equal(canonicalKey("Carbon Dioxide"), "carbon dioxide");
  assert.equal(canonicalKey("Chloroplasts"), "chloroplast");
  assert.equal(canonicalKey("H2O"), "water");
  assert.equal(canonicalKey("Photosynthesis"), "photosynthesis", "not a plural");
  assert.equal(canonicalKey("Nucleus"), "nucleus");
});

test("an extraction is cleaned: duplicates merged, links only between its concepts, no needs-cycle, boards mapped", () => {
  const k = validateLectureKnowledge({
    concepts: [
      { key: "photosynthesis", label: "Photosynthesis", subject: "Biology" },
      { key: "chlorophyll", label: "Chlorophyll", aliases: ["chlorophylls"] },
      { key: "Chlorophyll", label: "chlorophyll again", aliases: ["green pigment"] },
      { key: "co2", label: "Carbon dioxide" },
      { key: "", label: "" },
    ],
    edges: [
      { from: "photosynthesis", to: "chlorophyll", type: "needs" },
      { from: "chlorophyll", to: "photosynthesis", type: "needs" },
      { from: "photosynthesis", to: "carbon dioxide", type: "needs" },
      { from: "photosynthesis", to: "unicorns", type: "needs" },
      { from: "photosynthesis", to: "photosynthesis", type: "related" },
      { from: "photosynthesis", to: "chlorophyll", type: "bogus" },
      { from: "chlorophyll", to: "carbon dioxide", type: "related" },
      { from: "carbon dioxide", to: "chlorophyll", type: "related" },
    ],
    beats: [
      { sequence: 0, concepts: ["photosynthesis", "CO2"], elements: { leaf: "photosynthesis", "co2-gas": "co2", "Bad Id": "chlorophyll" } },
      { sequence: 9, concepts: ["chlorophyll"] },
    ],
  }, 3)!;
  assert.deepEqual(k.concepts.map((c) => c.key), ["photosynthesis", "chlorophyll", "carbon dioxide"]);
  assert.ok(k.concepts[1].aliases.includes("green pigment"), "a duplicate's aliases are kept");
  assert.equal(k.concepts[0].subject, "biology");
  assert.deepEqual(k.edges.map((e) => `${e.from}>${e.to}`), ["photosynthesis>chlorophyll", "photosynthesis>carbon dioxide", "carbon dioxide>chlorophyll"], "the reverse link would loop; unknown and self links are dropped; a related pair is one link");
  assert.deepEqual(k.beats, [{ sequence: 0, concepts: ["photosynthesis", "carbon dioxide"], elements: { leaf: "photosynthesis", "co2-gas": "carbon dioxide" } }]);
  assert.equal(validateLectureKnowledge({ concepts: [] }, 3), null);
});

test("the shared graph counts each lecture once, and trusts a link more as lectures agree", () => {
  const now = "2026-10-03T00:00:00.000Z";
  const c1 = mergeConcept(null, { key: "glucose", label: "Glucose", aliases: ["c6h12o6"], subject: "biology", summary: "" }, now);
  const c2 = mergeConcept(c1, { key: "glucose", label: "glucose", aliases: ["blood sugar"], subject: "chemistry", summary: "A sugar." }, now);
  assert.equal(c2.lectures, 2);
  assert.deepEqual(c2.aliases, ["c6h12o6", "blood sugar"]);
  assert.equal(c2.subject, "biology", "the first subject sticks");
  const e1 = mergeEdge(null, { from: "respiration", to: "glucose", type: "needs" }, "lec-a", now);
  assert.equal(mergeEdge(e1, { from: "respiration", to: "glucose", type: "needs" }, "lec-a", now), e1, "the same lecture twice changes nothing");
  const e2 = mergeEdge(e1, { from: "respiration", to: "glucose", type: "needs" }, "lec-b", now);
  assert.equal(e2.support, 2);
  assert.ok(edgeConfidence(1) < edgeConfidence(2) && edgeConfidence(5) < 1);
});

/* ── mastery and reviews ──────────────────────────────────────────────────────────────────── */

test("knowledge tracing: right answers raise mastery, less so when a guess was likely; wrong ones lower it", () => {
  const p = 0.4;
  assert.ok(bktUpdate(p, true, { guess: 0.33 }) > p);
  assert.ok(bktUpdate(p, false, { guess: 0.33 }) < p);
  assert.ok(bktUpdate(p, true, { guess: 0.1 }) > bktUpdate(p, true, { guess: 0.5 }), "a drawing is stronger evidence than a coin flip");
  assert.ok(implicitCredit(0.5, 1) > implicitCredit(0.5, 0.4) && implicitCredit(0.5, 0.4) > 0.5, "prerequisites get a share, scaled by trust");
});

test("reviews space out when remembered and come back soon when not; recall is 90% at the stability", () => {
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
  assert.ok(retrievability(30, 10) < 0.9);
  assert.ok(nextStability(4, "correct") > 4 && nextStability(4, "wrong") < 4);
  assert.equal(nextStability(undefined, "taught"), 1);
});

test("a student's layer: taught, answered, credited, scheduled and rated", () => {
  const at = { lectureId: "11111111-1111-1111-1111-111111111111", sequence: 2, beatId: "cv-x-b3", title: "Inside the chloroplast", topic: "Photosynthesis" };
  let m = recordTaught(emptyMemory("2026-10-01T00:00:00.000Z"), [{ key: "chlorophyll", label: "Chlorophyll", at }, { key: "light", label: "Light", at }], "2026-10-01T00:00:00.000Z");
  assert.equal(m.concepts.chlorophyll.mastery, 0.55, "taught = covered, not known");
  assert.equal(m.concepts.chlorophyll.taught?.[0].title, "Inside the chloroplast");
  assert.equal(m.concepts.chlorophyll.reviewDue, "2026-10-02T00:00:00.000Z", "first review a day later");
  m = recordAnswer(m, { concepts: [{ key: "chlorophyll", label: "Chlorophyll" }], correct: true, guess: 1 / 3, topic: "Photosynthesis", source: "quiz", prerequisites: [{ key: "light", confidence: 0.6 }] }, "2026-10-01T01:00:00.000Z");
  assert.ok(m.concepts.chlorophyll.mastery > 0.55);
  assert.ok(m.concepts.light.mastery > 0.55, "the prerequisite got implicit credit");
  assert.ok(Date.parse(m.concepts.chlorophyll.reviewDue!) > Date.parse("2026-10-02T00:00:00.000Z"), "remembered: review pushed out");
  // Light was due at 10-02 00:00 when taught; the credit from chlorophyll pushed it past 05:00.
  assert.deepEqual(dueForReview(m, Date.parse("2026-10-02T05:00:00.000Z")).map((c) => c.key), [], "the credited prerequisite's review moved too");
  assert.deepEqual(dueForReview(m, Date.parse("2026-12-01T00:00:00.000Z")).map((c) => c.key).sort(), ["chlorophyll", "light"]);
  m = rateConcept(m, "light", "unsure");
  assert.equal(m.concepts.light.selfRating, "unsure");
});

test("a lecture's needs: shaky or unmet prerequisites, and how each concept reads to the student", () => {
  const edges = [
    { from: "photosynthesis", to: "chlorophyll", type: "needs" as const, support: 1 },
    { from: "photosynthesis", to: "chemical reaction", type: "needs" as const, support: 3 },
    { from: "photosynthesis", to: "light", type: "needs" as const, support: 2 },
  ];
  const mastery = (k: string) => ({ chlorophyll: 0.3, light: 0.9 } as Record<string, number>)[k];
  const shaky = shakyPrerequisites(["photosynthesis"], edges, mastery);
  assert.deepEqual(shaky.map((s) => s.key), ["chlorophyll", "chemical reaction"], "met-but-shaky first; a mastered one is not a gap");
  assert.equal(conceptStatus(0.9, true), "known");
  assert.equal(conceptStatus(0.4, true), "shaky");
  assert.equal(conceptStatus(0.9, false), "new", "learned during this very lecture is still new on its boards");
  assert.equal(conceptStatus(undefined, true), "new");
});

test("the planner is told what the student knows, and to open with one refresher when they are shaky", () => {
  const input = { topic: "Cellular respiration", mood: "", sourceType: "prompt", mode: "standard", learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "visual", rationale: "", confirmedAt: "" } } as ProgressiveLectureInput;
  const plain = canvasPlanRequest(input);
  assert.doesNotMatch(plain, /ALREADY KNOWS/);
  const told = canvasPlanRequest(input, { mastered: ["Glucose"], shaky: [{ label: "ATP", for: "Respiration" }], earlier: [{ label: "Glucose", topic: "Photosynthesis" }] });
  assert.match(told, /Already solid: Glucose/);
  assert.match(told, /Glucose \(in "Photosynthesis"\)/);
  assert.match(told, /refreshes ATP .*"refresher": true/);
});

/* ── the map ──────────────────────────────────────────────────────────────────────────────── */

test("the map layout is deterministic, inside its frame, and keeps linked stars closer than unlinked ones", () => {
  const nodes = ["a", "b", "c", "d", "e", "f"].map((key, i) => ({ key, subject: i < 3 ? "biology" : "physics", weight: 1 }));
  const links = [{ from: "a", to: "b", strength: 1 }, { from: "d", to: "e", strength: 1 }];
  const one = layoutKnowledgeMap(nodes, links, 1600, 1000);
  assert.deepEqual(one, layoutKnowledgeMap(nodes, links, 1600, 1000), "same input, same sky");
  for (const p of Object.values(one)) assert.ok(p.x >= 40 && p.x <= 1560 && p.y >= 40 && p.y <= 960);
  const d = (a: string, b: string) => Math.hypot(one[a].x - one[b].x, one[a].y - one[b].y);
  assert.ok(d("a", "b") < d("a", "e"), "a linked pair sits closer than stars of different subjects");
});
