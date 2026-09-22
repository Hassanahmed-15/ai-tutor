/**
 * ONE SUBTOPIC STAYS ONE SUBTOPIC.
 *
 * The reported failure: a subtopic explained in depth produced a separate titled slide per
 * explanation, so two or three passes over one idea read as unrelated topics. The cause was that
 * `conceptId` was built as `concept-${sequence}-${slug(title)}`, so the sequence number alone made
 * every beat a different concept and `decideBoardMove` could never return "continue".
 *
 * These tests pin the whole chain: the planner groups passes under one concept, the teaching map
 * turns that into a CONTINUE move, and the board therefore slides instead of starting a new slide.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { expandConceptPasses, passesFor } from "../board/conceptPasses";
import { buildLessonTeachingMap, decideBoardMove, EMPTY_TEACHING_STATE, recordTaught } from "../board/teachingState";
import type { Beat } from "../lessonContent";

const slug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const beat = (over: Partial<Beat> & Pick<Beat, "id" | "title">): Beat => ({
  teacherMove: "",
  stepLabel: "",
  slideKind: "intro",
  points: [],
  script: "A sentence.",
  ...over,
});

// --- The planner groups passes -----------------------------------------------------------------

test("THE BUG: a subtopic taught in depth keeps ONE concept id across its passes", () => {
  const passes = expandConceptPasses(
    [
      { title: "Why Leaves Are Green", objective: "Open with a puzzle." },
      { title: "Chlorophyll", objective: "Explain how chlorophyll absorbs light and why it works." },
      { title: "Recap", objective: "Tie it together." },
    ],
    "deep",
    slug,
  );

  const chlorophyll = passes.filter((p) => p.title === "Chlorophyll");
  assert.ok(chlorophyll.length >= 2, "a mechanism subtopic earns more than one board");
  const ids = new Set(chlorophyll.map((p) => p.conceptKey));
  assert.equal(ids.size, 1, "every pass over one subtopic shares a concept id");
  // And the title is NOT uniquified per pass — that was what made them look unrelated.
  assert.equal(new Set(chlorophyll.map((p) => p.title)).size, 1);
});

test("each pass has a distinct job, so a second board is not the first board said again", () => {
  const [, ...rest] = expandConceptPasses(
    [
      { title: "Open", objective: "hook" },
      { title: "How Induction Works", objective: "Explain the mechanism step by step." },
      { title: "Recap", objective: "close" },
    ],
    "deep",
    slug,
  );
  const passes = rest.filter((p) => p.title === "How Induction Works");
  const roles = passes.map((p) => p.passRole);
  assert.equal(roles[0], "establish");
  assert.ok(roles.includes("example"), "a later pass works a concrete example");
  assert.equal(new Set(passes.map((p) => p.objective)).size, passes.length, "objectives differ per pass");
});

test("the opener and the recap are one board each — they frame the lesson, they are not ideas", () => {
  assert.equal(passesFor({ title: "Photosynthesis", objective: "Open with a puzzle." }, "deep", { isFirst: true }), 1);
  assert.equal(passesFor({ title: "Recap", objective: "Tie the ideas together." }, "deep", { isLast: true }), 1);
});

test("a definition stays one board however deep the lesson is set", () => {
  assert.equal(passesFor({ title: "What Is A Vector", objective: "Define the term precisely." }, "deep"), 1);
});

test("concise is one board per subtopic; only balanced and deep earn continuation boards", () => {
  /*
   * A second board over one idea is a second chance to repeat it. Concise keeps the example inside
   * the single board; balanced and deep get continuation boards, each on its own rung and audited.
   */
  const subtopic = { title: "How Diffusion Works", objective: "Explain the mechanism." };
  assert.equal(passesFor(subtopic, "concise"), 1);
  assert.equal(passesFor(subtopic, "balanced"), 2);
  assert.equal(passesFor(subtopic, "deep"), 3);
});

test("passes are capped at MAX_BOARDS_PER_CONCEPT, so a concept stays scrollable", () => {
  const subtopic = { title: "How The Krebs Cycle Works Step By Step", objective: "Derive and work through every stage and its mechanism." };
  assert.ok(passesFor(subtopic, "deep") <= 3);
});

// --- The teaching map turns that into a board move ----------------------------------------------

test("THE FIX, END TO END: later passes CONTINUE the board instead of starting a slide", () => {
  const map = buildLessonTeachingMap([
    beat({ id: "b1", title: "Why Leaves Are Green", conceptId: "c-intro" }),
    beat({ id: "b2", title: "Chlorophyll", conceptId: "c-chloro", conceptPass: 1, conceptPasses: 3 }),
    beat({ id: "b3", title: "Chlorophyll", conceptId: "c-chloro", conceptPass: 2, conceptPasses: 3 }),
    beat({ id: "b4", title: "Chlorophyll", conceptId: "c-chloro", conceptPass: 3, conceptPasses: 3 }),
    beat({ id: "b5", title: "Light Reactions", conceptId: "c-light" }),
  ]);

  assert.equal(map.entries[1].move, "fresh", "the subtopic opens with a fresh board");
  assert.equal(map.entries[2].move, "continue", "its second explanation continues the same board");
  assert.equal(map.entries[3].move, "continue", "and so does its third");
  assert.equal(map.entries[4].move, "fresh", "only a genuinely new subtopic starts a new board");

  // The three passes are ONE node in the concept map, not three.
  assert.equal(map.concepts.filter((c) => c.id === "c-chloro").length, 1);
  assert.deepEqual(map.concepts.find((c) => c.id === "c-chloro")?.beatIds, ["b2", "b3", "b4"]);
});

test("board numbering runs 1,2,3 within the subtopic, which is what the header shows", () => {
  const map = buildLessonTeachingMap([
    beat({ id: "b1", title: "Chlorophyll", conceptId: "c" }),
    beat({ id: "b2", title: "Chlorophyll", conceptId: "c" }),
    beat({ id: "b3", title: "Chlorophyll", conceptId: "c" }),
  ]);
  assert.deepEqual(map.entries.map((e) => e.sectionInConcept), [1, 2, 3]);
});

test("a lesson whose beats predate concept ids still behaves exactly as it used to", () => {
  const map = buildLessonTeachingMap([
    beat({ id: "old1", title: "One" }),
    beat({ id: "old2", title: "Two" }),
  ]);
  assert.equal(map.entries[0].move, "fresh");
  assert.equal(map.entries[1].move, "fresh", "no concept ids means no accidental continuations");
});

test("a continuation pass is not announced — only the concept's first board gets a bridge", () => {
  /*
   * `transitionIn` is what holds the title card while a section is announced. Emitting one for the
   * second board of the same subtopic would re-announce an idea already in progress, which is the
   * "new slide per explanation" symptom in its spoken form.
   */
  const passes = expandConceptPasses(
    [
      { title: "Open", objective: "hook" },
      { title: "How Photosynthesis Works", objective: "Explain the mechanism and work an example." },
      { title: "Recap", objective: "close" },
    ],
    "deep",
    slug,
  );
  const later = passes.filter((p) => p.pass > 1);
  assert.ok(later.length > 0, "there is at least one continuation pass to check");
  for (const pass of later) {
    assert.ok(pass.pass > 1 && pass.conceptKey === passes.find((p) => p.title === pass.title && p.pass === 1)?.conceptKey);
  }
});

test("a fourth pass would start fresh rather than scroll past what a student can follow", () => {
  let state = EMPTY_TEACHING_STATE;
  for (let i = 0; i < 3; i++) {
    state = recordTaught(state, { beatId: `b${i}`, conceptId: "c", sequence: i, title: "Chlorophyll", script: "." });
  }
  const decision = decideBoardMove(state, { conceptId: "c", title: "Chlorophyll", objective: "more" });
  assert.equal(decision.move, "fresh");
});
