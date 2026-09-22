/**
 * THE PLAN A REAL LECTURE GETS: titled for the subject, one rung per board, never descending.
 *
 * Built by the same function the worker calls, so what is asserted here is what a student's
 * lecture is planned as. Three generated lessons had every one of these wrong at once.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { descends } from "../lessonLadder";
import { buildProgressivePlan } from "../progressivePlan";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";

const input = (topic: string, depth: "concise" | "balanced" | "deep" = "balanced"): ProgressiveLectureInput => ({
  topic,
  mood: "",
  sourceType: "prompt",
  mode: "standard",
  learnerProfile: { expertise: "beginner", depth, goal: "exam", codeExamples: false, preferredExamples: "mixed", rationale: "", confirmedAt: "" },
});

for (const topic of ["What is overfitting?", "how linear regression works", "the TCP three-way handshake", "photosynthesis"]) {
  test(`"${topic}": boards are titled for the subject, not the question`, () => {
    const plan = buildProgressivePlan(input(topic));
    for (const beat of plan) {
      assert.doesNotMatch(beat.title, /\?/, `"${beat.title}" carries the question mark`);
      assert.doesNotMatch(beat.title, /^what is\b/i, `"${beat.title}" is the question, not the subject`);
      // The truncation signatures polishBeatPlan produced: "…With Real" (Numbers), "…Actually" (Is), a trailing colon.
      assert.doesNotMatch(beat.title, /\bWith Real$|\bActually$|:$/, `"${beat.title}" was truncated mid-phrase`);
    }
  });

  test(`"${topic}": every board has a rung and the lesson never descends`, () => {
    const plan = buildProgressivePlan(input(topic));
    const roles = plan.map((b) => b.role);
    assert.ok(roles.every(Boolean), "every board carries its rung");
    assert.equal(roles[0], "hook");
    assert.equal(roles[roles.length - 1], "recap");
    assert.equal(descends(roles.map((r) => r!)), false, `descends: ${roles.join(" → ")}`);
    const core = roles.indexOf("core");
    const mechanism = roles.indexOf("mechanism");
    assert.ok(core >= 0 && (mechanism < 0 || core < mechanism), "the definition comes before the mechanism");
  });
}

test("a continuation pass climbs a rung and gets its own objective, so it cannot be its first pass again", () => {
  // Passes are for the planner's broad subtopics; the default ladder already has one rung per board.
  const plan = buildProgressivePlan({
    ...input("how linear regression works", "deep"),
    outline: {
      topic: "linear regression",
      subtopics: [
        { title: "How the line is fitted", caption: "Explain the least-squares mechanism step by step." },
        { title: "Reading slope and intercept", caption: "Interpret what the fitted numbers say." },
        { title: "Where a straight line fails", caption: "Curved data and outliers break the fit." },
      ],
    },
  });
  const passes = plan.filter((b) => (b.conceptPasses ?? 1) > 1);
  assert.ok(passes.length >= 2, `deep mode produces continuation passes: ${plan.map((b) => `${b.title}(${b.conceptPasses})`).join(", ")}`);
  const byConcept = new Map<string, typeof passes>();
  for (const b of passes) byConcept.set(b.conceptId!, [...(byConcept.get(b.conceptId!) ?? []), b]);
  for (const boards of byConcept.values()) {
    const roles = boards.map((b) => b.role);
    assert.equal(new Set(roles).size, roles.length, `passes share a rung: ${roles.join(", ")}`);
    const objectives = boards.map((b) => b.objective);
    assert.equal(new Set(objectives).size, objectives.length, "passes share an objective verbatim");
    assert.match(boards[1].objective, /already on the board above/);
  }
  // "Never descend" is a rule about ONE concept: a new subtopic starts at its own rung even when the
  // previous subtopic's passes climbed above it. So the lesson is checked over first passes.
  const firstPasses = plan.filter((b) => (b.conceptPass ?? 1) === 1).map((b) => b.role!);
  assert.equal(descends(firstPasses), false, firstPasses.join(" → "));
  for (const boards of byConcept.values()) {
    assert.equal(descends(boards.map((b) => b.role!)), false, `passes of one concept descend: ${boards.map((b) => b.role).join(" → ")}`);
  }
});

test("the default ladder gets no continuation passes — it already has one rung per board", () => {
  const plan = buildProgressivePlan(input("how linear regression works", "deep"));
  assert.ok(plan.every((b) => (b.conceptPasses ?? 1) === 1), plan.map((b) => `${b.role}(${b.conceptPasses})`).join(", "));
  assert.equal(new Set(plan.map((b) => b.role)).size, plan.length, "no two default boards share a rung");
});

test("concise produces one board per subtopic", () => {
  const plan = buildProgressivePlan(input("how linear regression works", "concise"));
  assert.ok(plan.every((b) => (b.conceptPasses ?? 1) === 1));
});
