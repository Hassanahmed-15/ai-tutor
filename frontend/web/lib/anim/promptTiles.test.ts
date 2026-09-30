/** Homepage prompt tiles: lecture recommendations from the learner profile. */
import test from "node:test";
import assert from "node:assert/strict";
import type { LearnerBasics } from "../db/cosmos";
import type { LearnerMemory } from "../learnerModel";
import { learnerProfileView } from "../learnerProfileView";
import { fallbackFreshTiles, freshTilesFrom, MAX_TILES, memoryTiles, promptTiles } from "../promptTiles";

const NOW = Date.parse("2026-09-29T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const basics: LearnerBasics = {
  country: "GB", countrySource: "ip",
  studyLevel: { id: "gb-alevel", label: "A-Level" },
  subjects: [{ id: "physics", label: "Physics" }, { id: "mathematics", label: "Mathematics" }],
  curricula: [],
  completedAt: day(30), updatedAt: day(30),
};
const concept = (label: string, mastery: number, topics: string[]) => ({ key: label.toLowerCase(), label, mastery, evidence: [], lastSeen: day(2), topics });
const memory = {
  version: 1,
  concepts: {
    newton: concept("Newton's laws", 0.95, ["Forces and motion"]),
    vectors: concept("Vectors", 0.55, ["Mechanics"]),
    probability: concept("Probability", 0.2, ["Probability basics"]),
  },
  misconceptions: [], preferences: { style: null, background: null }, goals: [], lastLevel: null,
  lessons: [{ topic: "Mechanics", at: day(3), beatsWatched: 16 }],
  signals: {}, excerpts: [], persona: null, updatedAt: day(1),
} as unknown as LearnerMemory;

test("memory tiles lead with the weakest idea, then review, capped so fresh lessons get room", () => {
  const tiles = memoryTiles(learnerProfileView(basics, memory, NOW));
  assert.deepEqual(tiles.map((t) => t.kind), ["weak", "review"]);
  assert.match(tiles[0].prompt, /Probability/);
  assert.match(tiles[1].prompt, /Vectors/);
});

test("with no model, every subject still gets a plain tile at the student's level", () => {
  const view = learnerProfileView(basics, null, NOW);
  const fresh = fallbackFreshTiles(view);
  assert.equal(fresh.length, 2);
  assert.equal(fresh[0].prompt, "The key ideas in Physics at A-Level level");
  const withCurriculum = fallbackFreshTiles(learnerProfileView({ ...basics, curricula: [{ id: "aqa", label: "AQA A-Level" }] }, null, NOW));
  assert.equal(withCurriculum[1].prompt, "The key ideas in AQA A-Level Mathematics");
});

test("the row mixes memory and fresh ideas, drops mastered topics and duplicates, and caps at four", () => {
  const view = learnerProfileView(basics, memory, NOW);
  const fresh = freshTilesFrom([
    { prompt: "Explain Newton's laws with examples", subject: "Physics" },
    { prompt: "Solve quadratic equations by factoring", subject: "Mathematics" },
    "Solve quadratic equations by factoring",
    { prompt: "How do capacitors store energy?", subject: "Physics" },
    { prompt: "Differentiate using the chain rule", subject: "Mathematics" },
    { nope: true }, 42, "hi",
  ]);
  assert.equal(fresh.length, 4, "junk and duplicates are dropped");
  const row = promptTiles(view, fresh);
  assert.equal(row.length, MAX_TILES);
  assert.ok(!row.some((t) => /Newton/.test(t.prompt)), "nothing they already mastered");
  assert.deepEqual(row.map((t) => t.kind), ["weak", "review", "fresh", "fresh"]);
  assert.equal(row[2].reason, "Mathematics");
});

test("no profile and no memory means no tiles", () => {
  assert.deepEqual(promptTiles(learnerProfileView(null, null, NOW), null), []);
});
