/**
 * THE PLAN A REAL LECTURE GETS: titled for the subject, one rung per board, never descending.
 *
 * Built by the same function the worker calls, so what is asserted here is what a student's
 * lecture is planned as. Three generated lessons had every one of these wrong at once.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { descends } from "../lessonLadder";
import { buildProgressivePlan, isFrontMatterSection, referenceSectionTitle } from "../progressivePlan";
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
    // No recap board: it restated the lesson, and every lecture ends with its own one-slide summary.
    assert.ok(!roles.includes("recap"), `no recap board: ${roles.join(" → ")}`);
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

test("a QUESTION is answered in its own one or two boards: no opener, no recap, no extra passes", () => {
  const plan = buildProgressivePlan({
    ...input("Why does overfitting happen?", "deep"),
    outline: {
      topic: "Overfitting",
      scope: "question",
      subtopics: [
        { title: "Memorising the noise", caption: "Why a flexible model fits noise in training data and then fails on new data." },
      ],
    },
  });
  assert.equal(plan.length, 1, plan.map((b) => b.title).join(" | "));
  assert.equal(plan[0].conceptPasses, 1);
});

test("a whole LESSON keeps its opener but never ends on a recap, and is never cut to a board count", () => {
  const subtopics = Array.from({ length: 14 }, (_, i) => ({ title: `Distinct idea number ${i + 1} alpha${i}`, caption: `Teaches separate concept ${i + 1} about topic${i}.` }));
  const plan = buildProgressivePlan({
    ...input("thermodynamics", "concise"),
    outline: { topic: "Thermodynamics", scope: "lesson", subtopics },
  });
  assert.ok(plan.length >= 15, `no 12-board ceiling: ${plan.length}`);
  assert.ok(!plan.some((b) => /recap/i.test(b.title)), "no recap board");
});

test("a specific question about a PDF keeps only the section that answers it", async () => {
  const { sectionsForQuestion } = await import("../progressivePlan");
  const text: Record<string, string> = {
    a: "Photosynthesis is the way that plants make food.",
    b: "Glucose is soluble. Instead, the plant changes some of the glucose into a different kind of carbohydrate – starch. A starch molecule is made of thousands of glucose molecules.",
    c: "Testing a leaf for starch. Iodine solution turns blue-black with starch. Boil the leaf, add iodine, look for starch.",
    d: "Questions about photosynthesis.",
  };
  const sections = [
    { title: "Photosynthesis", sourceBlockIds: ["a"] },
    { title: "Storing carbohydrates", sourceBlockIds: ["b"] },
    { title: "Testing a leaf for starch", sourceBlockIds: ["c"] },
    { title: "Questions", sourceBlockIds: ["d"] },
  ];
  const textOf = (ids: string[]) => ids.map((id) => text[id]).join(" ");
  assert.deepEqual(sectionsForQuestion(sections, "what is starch in here", textOf).map((s) => s.title), ["Storing carbohydrates"]);
  assert.equal(sectionsForQuestion(sections, "explain this pdf", textOf).length, 4, "an open request keeps the whole document");
  assert.equal(sectionsForQuestion(sections, "what is a mitochondrion?", textOf).length, 4, "a question the document never mentions keeps the whole plan");
});

/*
 * "USE IT AS A REFERENCE": the approved outline is the lecture, and the document is material.
 *
 * The document's own section plan used to win in reference mode too, so a student could plan,
 * revise and approve an outline and then be taught the PDF's section list instead. Strict mode must
 * keep the section plan exactly as before — these tests pin both sides.
 */
const bstDocument = {
  schemaVersion: "suprnotes.lesson_input.v1",
  title: "Binary search trees",
  contentBlocks: [
    { id: "blk-insert", pageNumber: 1, text: "Insertion places a new key in a binary search tree by walking left or right from the root until an empty leaf position is found." },
    { id: "blk-remove", pageNumber: 1, text: "Removal is the hardest operation: removing a node with two children replaces it with the smallest node of its right subtree, the inorder successor." },
    { id: "blk-figure", pageNumber: 1, role: "figure-labels", text: "Figure 19.3 deletion of node 5 with one child, before and after: the child is linked to the parent." },
  ],
  lessonPlan: {
    beats: [
      { title: "Section 19.1 Basic Ideas", objective: "Teach these source blocks completely and in order.", sourceBlockIds: ["blk-insert", "blk-remove", "blk-figure"] },
    ],
  },
};
const approvedOutline = {
  topic: "binary search tree removal",
  subtopics: [
    { title: "Why removal is the hardest operation", caption: "Removing a node can disconnect the tree, unlike insertion." },
    { title: "Removing a node with two children", caption: "Replace it with the inorder successor from the right subtree." },
    { title: "Balanced trees keep operations fast", caption: "Rotations bound the height so search stays logarithmic." },
  ],
};
const pdfInput = (fidelity: "strict" | "reference", outline?: typeof approvedOutline): ProgressiveLectureInput => ({
  ...input("binary search tree removal"),
  sourceType: "pdf",
  suprnotes: bstDocument,
  sourceScope: { fidelity, breadth: { kind: "whole" }, documentLabels: [] },
  ...(outline ? { outline } : {}),
});

test("REFERENCE with an approved outline: the outline IS the lecture, not the PDF's sections", () => {
  const plan = buildProgressivePlan(pdfInput("reference", approvedOutline));
  const titles = plan.map((b) => b.title);
  // The student's subtopics are taught; the document's single section title is not the lecture.
  assert.ok(!titles.includes("Section 19.1 Basic Ideas"), `taught the PDF's section list: ${titles.join(" | ")}`);
  for (const sub of approvedOutline.subtopics) {
    assert.ok(titles.some((t) => t.toLowerCase().includes(sub.title.split(" ").slice(-2).join(" ").toLowerCase()) || plan.some((b) => b.objective.includes(sub.caption))), `missing outline subtopic "${sub.title}"`);
  }
  // It plans like a typed topic: the ladder, so every board has a rung.
  assert.ok(plan.every((b) => b.role), "every board carries its rung");
});

test("REFERENCE: each outline beat is matched to the document blocks it draws on", () => {
  const plan = buildProgressivePlan(pdfInput("reference", approvedOutline));
  const twoChildren = plan.find((b) => /two children/i.test(b.title) || /inorder successor/i.test(b.objective));
  assert.ok(twoChildren, "the two-children beat exists");
  assert.ok(twoChildren!.sourceBlockIds?.includes("blk-remove"), `matched ${JSON.stringify(twoChildren!.sourceBlockIds)}`);
  // A beat the document says nothing about is taught from the idea alone — no invented source.
  const balanced = plan.find((b) => /balanced/i.test(b.title));
  assert.ok(balanced, "the balanced-trees beat exists");
  assert.equal(balanced!.sourceBlockIds, undefined, "no document blocks for a point the PDF does not make");
});

test("STRICT is untouched: the PDF's section plan wins even with an outline", () => {
  const plan = buildProgressivePlan(pdfInput("strict", approvedOutline));
  assert.deepEqual(plan.map((b) => b.title), ["Section 19.1 Basic Ideas"]);
  assert.deepEqual(plan[0].sourceBlockIds, ["blk-insert", "blk-remove", "blk-figure"]);
});

test("REFERENCE with no outline keeps today's section plan", () => {
  const plan = buildProgressivePlan(pdfInput("reference"));
  assert.deepEqual(plan.map((b) => b.title), ["Section 19.1 Basic Ideas"]);
});

test("a TYPED TOPIC is not a reference lesson, even though it carries fidelity 'reference'", () => {
  const plan = buildProgressivePlan({
    ...input("binary search tree removal"),
    sourceScope: { fidelity: "reference", breadth: { kind: "whole" }, documentLabels: [] },
    outline: approvedOutline,
  });
  assert.ok(plan.every((b) => b.sourceBlockIds === undefined), "no document, so no source blocks");
});

/*
 * REFERENCE-MODE SECTION TITLES. A cover slide "ACTUATORS Dr. Ahmed Khan" was cut at the full stop
 * after "Dr." and taught as "ACTUATORS DR", followed by the contents page as a lesson section. Strict
 * keeps its titles exactly — the parser that made them serves strict mode too.
 */
const actuatorDocument = {
  schemaVersion: "suprnotes.lesson_input.v1",
  title: "Actuators",
  contentBlocks: [
    { id: "cover", pageNumber: 1, text: "ACTUATORS Dr. Ahmed Khan, Department of Mechatronics, University of Engineering" },
    { id: "toc", pageNumber: 2, text: "Contents 1. What Is an Actuator? 2. Types of Actuators 3. Selection" },
    { id: "types", pageNumber: 3, text: "Actuators convert electrical, hydraulic or pneumatic energy into motion. Electric motors, hydraulic cylinders and pneumatic cylinders are the three main types, chosen by force, speed and precision." },
    { id: "thanks", pageNumber: 9, text: "Thank you! Any questions?" },
  ],
  lessonPlan: {
    beats: [
      { title: "ACTUATORS DR", objective: "Teach these source blocks.", sourceBlockIds: ["cover"] },
      { title: "CONTENTS \uFFFD What Is an Actuator?", objective: "Teach these source blocks.", sourceBlockIds: ["toc"] },
      { title: "TYPES OF ACTUATORS", objective: "Teach these source blocks.", sourceBlockIds: ["types"] },
      { title: "Thank You", objective: "Teach these source blocks.", sourceBlockIds: ["thanks"] },
    ],
  },
};
const actuatorInput = (fidelity: "strict" | "reference"): ProgressiveLectureInput => ({
  ...input("actuators"),
  sourceType: "pdf",
  suprnotes: actuatorDocument,
  sourceScope: { fidelity, breadth: { kind: "whole" }, documentLabels: [] },
});

test("REFERENCE: no cut-off lecturer's name, no contents page, no thank-you slide", () => {
  const titles = buildProgressivePlan(actuatorInput("reference")).map((b) => b.title);
  assert.ok(titles.length > 0, "something is still taught");
  for (const title of titles) {
    assert.doesNotMatch(title, /\bDR\b/i, `"${title}" carries the lecturer's cut-off name`);
    assert.doesNotMatch(title, /\uFFFD|contents|thank you/i, `"${title}" is front matter`);
    assert.notEqual(title, title.toUpperCase(), `"${title}" is shouted`);
  }
  assert.ok(titles.some((t) => /types of actuators/i.test(t)), `the real section is kept: ${titles.join(" | ")}`);
});

test("STRICT keeps every section and the titles it always had", () => {
  const plan = buildProgressivePlan(actuatorInput("strict"));
  // "TYPES of ACTUATORS" is polishBeatPlan's long-standing minor-word casing, applied to strict before
  // this change as after it; the reference cleaning never runs here.
  assert.deepEqual(plan.map((b) => b.title), ["ACTUATORS DR", "CONTENTS \uFFFD What Is an Actuator?", "TYPES of ACTUATORS", "Thank You"]);
});

test("REFERENCE never drops a document down to nothing", () => {
  const onlyFrontMatter = {
    ...actuatorDocument,
    lessonPlan: { beats: [{ title: "Contents", objective: "x", sourceBlockIds: ["toc"] }] },
  };
  const plan = buildProgressivePlan({ ...actuatorInput("reference"), suprnotes: onlyFrontMatter });
  assert.equal(plan.length, 1);
});

test("section titles a student can read", () => {
  assert.equal(referenceSectionTitle("ACTUATORS DR"), "Actuators");
  assert.equal(referenceSectionTitle("Actuators — Dr. Ahmed Khan"), "Actuators");
  assert.equal(referenceSectionTitle("DC MOTORS AND ACTUATORS"), "DC Motors and Actuators");
  assert.equal(referenceSectionTitle("CONTENTS \uFFFD What Is an Actuator?"), "What Is an Actuator?");
  // A colon clause is the informative part of a title and stays.
  assert.equal(referenceSectionTitle("Step 2: Download HOL4"), "Step 2: Download HOL4");
  // "Sir Isaac Newton's laws" is not a byline: its name words are not all capitalised.
  assert.equal(referenceSectionTitle("Motion and Sir Isaac Newton's laws"), "Motion and Sir Isaac Newton's laws");
});

test("front matter is recognised; teaching is not", () => {
  assert.equal(isFrontMatterSection("Contents", "", 1), true);
  assert.equal(isFrontMatterSection("Thank You", "", 7), true);
  assert.equal(isFrontMatterSection("Page 2", "Contents 1. Intro 2. Types", 1), true);
  assert.equal(isFrontMatterSection("Actuators", "ACTUATORS Dr. Ahmed Khan, University of Engineering", 0), true, "the cover");
  // The same lecturer-ish words deep in a real section are not a cover.
  assert.equal(isFrontMatterSection("History", "The motor was improved by Dr. Tesla at a university lab over many years of experiments and patents.", 3), false);
  assert.equal(isFrontMatterSection("Types of Actuators", "Electric motors, hydraulic and pneumatic cylinders.", 2), false);
});
