/**
 * A QUESTION ASKED OF A DOCUMENT IS ANSWERED, AND NOTHING ELSE.
 *
 * Reported 2026-10-03: tree del.pdf uploaded, strict mode, "explain me insertion process in bst" —
 * and the lecture taught insertion AND deletion. The fixture is that PDF as parse-pdf really parses
 * it: two textbook pages on deletion, where insertion appears once, in the caption of Figure 19.2,
 * inside a section that is otherwise about removing nodes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { answeringBlocksFor, buildProgressivePlan, questionBlocks, referenceBlocksFor, topicalStems } from "../progressivePlan";
import { sourceScopeInstruction, type SourceScope } from "../sourceScope";
import { isSpecificDocumentRequest } from "../documentLessonPlanning";
import { firstPageTitle } from "../sectionTitle";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { SuprnotesLessonInput } from "../suprnotes";

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib/anim/fixtures-treedel.json"), "utf8"));
const document: SuprnotesLessonInput = {
  schemaVersion: "suprnotes.lesson_input.v1",
  source: { adapter: fixture.adapter ?? "pdf-upload" },
  lesson: { title: fixture.title ?? "Binary Search Trees" },
  contentBlocks: fixture.contentBlocks,
  lessonPlan: fixture.lessonPlan,
};
const DELETION_BLOCKS = ["ocr-p1-0-1", "ocr-p1-0-2", "ocr-p1-0-3", "ocr-p1-0-4", "ocr-p1-0-5"];

const lecture = (fidelity: "strict" | "reference", question: string): ProgressiveLectureInput => {
  const sourceScope: SourceScope = {
    fidelity,
    breadth: question ? { kind: "section", focus: question } : { kind: "whole" },
    documentLabels: [],
  };
  return {
    topic: "Binary Search Trees",
    mood: "",
    sourceType: "pdf",
    mode: "standard",
    suprnotes: document,
    ...(question ? { focus: question } : {}),
    sourceScope,
    learnerProfile: { expertise: "beginner", depth: "balanced", goal: "exam", codeExamples: false, preferredExamples: "mixed", rationale: "", confirmedAt: "" },
  };
};

test("the fixture is the reported shape: insertion is one caption in a section about deletion", () => {
  const first = (fixture.lessonPlan.beats as Array<{ sourceBlockIds: string[] }>)[0].sourceBlockIds;
  assert.ok(first.includes("ocr-p1-0-0") && DELETION_BLOCKS.every((id) => first.includes(id)));
  assert.match(fixture.contentBlocks[0].text, /insertion of 6/);
});

test("strict, 'explain me insertion process in bst': one slide, taught from the insertion figure alone", () => {
  const plan = buildProgressivePlan(lecture("strict", "explain me insertion process in bst"));
  assert.equal(plan.length, 1, `planned: ${plan.map((beat) => beat.title).join(" | ")}`);
  assert.deepEqual(plan[0].sourceBlockIds, ["ocr-p1-0-0"]);
  // Titled for the question's subject (the topic the page named), not the page it came from.
  assert.equal(plan[0].title, "Binary Search Trees");
  const named = buildProgressivePlan({ ...lecture("strict", "explain me insertion process in bst"), topic: "Insertion in a Binary Search Tree" });
  assert.equal(named[0].title, "Insertion in a Binary Search Tree");
});

test("a short request is still a question: 'explain me insertion of bst' (the reported wording)", () => {
  const plan = buildProgressivePlan(lecture("strict", "explain me insertion of bst"));
  assert.equal(plan.length, 1, `planned: ${plan.map((beat) => beat.title).join(" | ")}`);
  assert.deepEqual(plan[0].sourceBlockIds, ["ocr-p1-0-0"]);
});

test("whatever is typed is the question: bare words that pick out a part of the document", () => {
  assert.equal(isSpecificDocumentRequest("insertion", document), true);
  assert.equal(isSpecificDocumentRequest("insertion in bst", document), true);
  const plan = buildProgressivePlan(lecture("strict", "insertion in bst"));
  assert.deepEqual(plan.map((beat) => beat.sourceBlockIds), [["ocr-p1-0-0"]]);
});

test("typed words the document never uses, or uses throughout, still teach the document", () => {
  // The 2026-09-29 fix: a deck uploaded with "camera sensor" typed is taught as the deck.
  assert.equal(isSpecificDocumentRequest("camera sensor", document), false);
  // "node" is in most blocks of this chapter: it names the subject, not a part of it.
  assert.equal(isSpecificDocumentRequest("node", document), false);
  assert.equal(isSpecificDocumentRequest("explain this pdf", document), false);
});

test("a scanned page's body sentence is not the document's title", () => {
  assert.equal(firstPageTitle(document), "");
});

test("a request that names the document's own subject is taught whole", () => {
  // "node", "removal" and "child" are in most of this chapter's blocks: they name what it is about.
  const plan = buildProgressivePlan(lecture("strict", "explain removing a node with a child"));
  const ids = new Set(plan.flatMap((beat) => beat.sourceBlockIds ?? []));
  assert.ok(ids.size >= 9, `taught from ${ids.size} blocks`);
});

test("strict, a question about the two-children case: only the blocks about it", () => {
  const plan = buildProgressivePlan(lecture("strict", "how is a node with two children removed?"));
  const ids = plan.flatMap((beat) => beat.sourceBlockIds ?? []);
  assert.ok(ids.includes("ocr-p2-1-2"), `taught from: ${ids.join(", ")}`);
  assert.ok(!ids.includes("ocr-p1-0-0"), "the insertion figure is not part of the answer");
  assert.ok(!ids.includes("ocr-p2-1-3"), "the C++ implementation section is not part of the answer");
});

test("a whole-document request is taught whole, as before", () => {
  const plan = buildProgressivePlan(lecture("strict", ""));
  const ids = new Set(plan.flatMap((beat) => beat.sourceBlockIds ?? []));
  for (const block of fixture.contentBlocks) assert.ok(ids.has(block.id), `${block.id} is taught`);
});

test("questionBlocks keeps a figure caption's printed labels with it, and matches nothing it should not", () => {
  const blocks = [
    { id: "a", text: "Figure 1 The insertion of 6 into the tree." },
    { id: "a-labels", role: "figure-labels", text: "Diagram labels: 7, 2, 9, 5, 6" },
    { id: "b", text: "Removing a leaf node from the tree is easy." },
    { id: "c", text: "Removing a node with one child bypasses it in the tree." },
  ];
  assert.deepEqual(questionBlocks(blocks, "explain the insertion process"), ["a", "a-labels"]);
  assert.deepEqual(questionBlocks(blocks, "what is a mitochondrion?"), [], "no match: the caller keeps what it had");
});

test("words the whole document uses do not decide a match", () => {
  const topical = topicalStems(fixture.contentBlocks.map((block: { text?: string }) => block.text ?? ""));
  assert.ok(topical.has("nod"), `topical: ${[...topical].join(", ")}`);
  assert.ok(!topical.has("insertion"));
});

test("reference: an insertion slide is matched to the insertion figure, not to the deletion paragraphs", () => {
  const slide = "Insertion in a Binary Search Tree: how a new node is placed in the tree";
  const before = referenceBlocksFor(document, slide);
  assert.ok(before.some((id) => DELETION_BLOCKS.includes(id)), "the old matching: deletion paragraphs share the common words");
  const answering = answeringBlocksFor(lecture("reference", "explain me insertion process in bst"), document);
  assert.deepEqual([...(answering ?? [])], ["ocr-p1-0-0"]);
  const after = referenceBlocksFor(document, slide, { onlyFrom: answering });
  assert.deepEqual(after, ["ocr-p1-0-0"]);
  // A whole-document reference lecture matches across the document, as before.
  assert.equal(answeringBlocksFor(lecture("reference", ""), document), undefined);
});

test("reference with an approved one-slide outline: the slide's source is the insertion figure only", () => {
  const input = { ...lecture("reference", "explain me insertion process in bst"), outline: { topic: "BST Insertion", scope: "question", depth: "balanced", subtopics: [{ title: "Insertion in a Binary Search Tree", caption: "How a new node is placed in the tree" }] } } as unknown as ProgressiveLectureInput;
  const plan = buildProgressivePlan(input);
  const ids = plan.flatMap((beat) => beat.sourceBlockIds ?? []);
  assert.ok(!ids.some((id) => DELETION_BLOCKS.includes(id)), `slides draw on: ${ids.join(", ")}`);
});

test("the lecture writer is told to answer only the question, in both modes", () => {
  for (const fidelity of ["strict", "reference"] as const) {
    const text = sourceScopeInstruction({ fidelity, breadth: { kind: "section", focus: "explain me insertion process in bst" }, documentLabels: [] });
    assert.match(text, /ANSWER ONLY THIS: "explain me insertion process in bst"/);
    assert.match(text, /leave out every other topic/);
  }
  const whole = sourceScopeInstruction({ fidelity: "strict", breadth: { kind: "whole" }, documentLabels: [] });
  assert.match(whole, /Cover the complete selected source\./);
  assert.doesNotMatch(whole, /ANSWER ONLY THIS/);
});
