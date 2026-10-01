import test from "node:test";
import assert from "node:assert/strict";
import {
  documentSectionTitles,
  fallbackDocumentScopeQuestion,
  isSpecificDocumentRequest,
  isWholeDocumentRequest,
  pagesForLecture,
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
  assert.equal(isSpecificDocumentRequest("Explain this particular example", source), true);
  assert.equal(isSpecificDocumentRequest("Explain this formula", source), true);
  assert.equal(shouldPlanDocumentScope(source, "How does two-child deletion use the inorder successor?"), false);
  assert.equal(shouldPlanDocumentScope(source, "Explain this particular example"), false);
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

/**
 * A question is answered from EVERY page, whatever was ticked; anything else is taught from the
 * ticked pages. `[]` is the whole document, as both parsers read an empty `pages` field.
 */
test("a question uses every page, even when some were ticked", () => {
  assert.deepEqual(pagesForLecture("Why does SMOTE help the minority class?", [2]), []);
  assert.deepEqual(pagesForLecture("how is the decision threshold chosen?", [2, 3]), []);
  // "How does X work" asks for the whole topic (isTopicRequest), so from the front page the ticked
  // pages stand; typed in the picker's box it still reads every page (test below).
  assert.deepEqual(pagesForLecture("how does the ablation work", [2, 3]), [2, 3]);
});

test("a topic, or nothing typed, uses the ticked pages", () => {
  assert.deepEqual(pagesForLecture("camera sensor", [2]), [2]);
  assert.deepEqual(pagesForLecture("", [4, 1]), [4, 1]);
  assert.deepEqual(pagesForLecture("", []), []);
});

test("anything typed in the picker's box uses every page, however it is worded", () => {
  assert.deepEqual(pagesForLecture("explain the flow chart diagram", [2], true), []);
  // The same words from the front page are a topic, and the ticked pages stand.
  assert.deepEqual(pagesForLecture("explain the flow chart diagram", [2]), [2]);
  // An empty picker box leaves the ticked pages.
  assert.deepEqual(pagesForLecture("", [2], true), [2]);
});
