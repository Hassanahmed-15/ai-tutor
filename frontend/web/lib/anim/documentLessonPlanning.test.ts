import test from "node:test";
import assert from "node:assert/strict";
import {
  documentSectionTitles,
  fallbackDocumentScopeQuestion,
  isSpecificDocumentRequest,
  isWholeDocumentRequest,
  sanitizeDocumentPlanningQuestions,
  shouldPlanDocumentScope,
} from "../documentLessonPlanning";
import type { SuprnotesLessonInput } from "../suprnotes";

const source: SuprnotesLessonInput = {
  lesson: { title: "Binary Search Tree Deletion" },
  contentBlocks: [
    { id: "b1", heading: "Leaf deletion", text: "Remove a leaf directly.", sourceOrder: 0 },
    { id: "b2", heading: "One-child deletion", text: "Promote the child.", sourceOrder: 1 },
    { id: "b3", heading: "Two-child deletion", text: "Use the inorder successor.", sourceOrder: 2 },
    { id: "b4", heading: "Tree verification", text: "Check ordering after deletion.", sourceOrder: 3 },
    { id: "b5", heading: "Complexity", text: "Deletion follows tree height.", sourceOrder: 4 },
    { id: "b6", heading: "Implementation", text: "Implement the cases in C++.", sourceOrder: 5 },
  ],
  lessonPlan: {
    beats: [
      { title: "Leaf deletion" },
      { title: "One-child deletion" },
      { title: "Two-child deletion" },
      { title: "Tree verification" },
      { title: "Complexity" },
      { title: "Implementation" },
    ],
  },
};

test("a broad multi-section source asks for scope", () => {
  assert.deepEqual(documentSectionTitles(source).slice(0, 3), ["Leaf deletion", "One-child deletion", "Two-child deletion"]);
  assert.equal(shouldPlanDocumentScope(source, ""), true);
  assert.equal(shouldPlanDocumentScope(source, "Binary Search Tree Deletion"), true);
});

test("a precise source question and an explicit whole-document request bypass planning", () => {
  assert.equal(isSpecificDocumentRequest("How does two-child deletion use the inorder successor?", source), true);
  assert.equal(shouldPlanDocumentScope(source, "How does two-child deletion use the inorder successor?"), false);
  assert.equal(isWholeDocumentRequest("Teach the entire PDF"), true);
  assert.equal(shouldPlanDocumentScope(source, "Teach the entire PDF"), false);
});

test("the deterministic fallback names real document sections", () => {
  const question = fallbackDocumentScopeQuestion(source);
  assert.ok(question);
  assert.match(question.question, /Leaf deletion/);
  assert.equal(question.options[0].focus, null);
  assert.equal(question.options[2].focus, "One-child deletion");
});

test("document question sanitization rejects a scope response without whole-source coverage", () => {
  const result = sanitizeDocumentPlanningQuestions({
    planningQuestions: [
      {
        kind: "scope",
        question: "Which deletion case?",
        options: [
          { label: "Leaves", instruction: "Teach leaves.", focus: "Leaf deletion" },
          { label: "Two children", instruction: "Teach two-child deletion.", focus: "Two-child deletion" },
        ],
      },
      {
        kind: "emphasis",
        question: "For two-child deletion, which source material should lead?",
        options: [
          { label: "Procedure", instruction: "Lead with the source's replacement procedure." },
          { label: "Code", instruction: "Lead with the source's C++ implementation." },
        ],
      },
    ],
  }, source);

  assert.equal(result[0].kind, "scope");
  assert.match(result[0].question, /Leaf deletion/);
  assert.doesNotMatch(result[0].question, /^Which sections/i);
  assert.equal(result[0].options[0].focus, null);
  assert.match(result[0].options[0].instruction, /complete selected source/i);
  assert.equal(result[1].kind, "emphasis");
  assert.match(result[1].question, /Procedure and Code/);
  assert.match(result[1].options[0].instruction, /only material present/i);
});
