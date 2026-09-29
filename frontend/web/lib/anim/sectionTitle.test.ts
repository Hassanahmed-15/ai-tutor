import test from "node:test";
import assert from "node:assert/strict";
import { firstPageTitle, referenceSectionTitle } from "../sectionTitle";

/**
 * A reference lecture is titled by its document's FIRST PAGE. It used to be named after the typed
 * words, so an actuators PDF opened with "camera sensor" became a lecture called "Camera Sensor".
 */

const doc = (blocks: Array<Record<string, unknown>>) => ({ schemaVersion: "suprnotes.lesson_input.v1", contentBlocks: blocks });

test("the cover names the lecture, without the lecturer", () => {
  const title = firstPageTitle(doc([
    { id: "cover", pageNumber: 1, sourceOrder: 0, text: "ACTUATORS Dr. Ahmed Khan, Department of Mechatronics, University of Engineering" },
    { id: "p2", pageNumber: 2, sourceOrder: 1, text: "Contents 1. What Is an Actuator?" },
  ]));
  assert.equal(title, "Actuators");
});

test("a page-1 heading wins over its body text", () => {
  const title = firstPageTitle(doc([
    { id: "h", pageNumber: 1, sourceOrder: 0, heading: "Ablation Study of Attention Heads", text: "In this report we remove each component in turn and measure the drop in accuracy." },
  ]));
  assert.equal(title, "Ablation Study of Attention Heads");
});

test("figure labels are not a title; the next page-1 block is used", () => {
  const title = firstPageTitle(doc([
    { id: "fig", pageNumber: 1, sourceOrder: 0, role: "figure-labels", text: "Diagram labels: input, output" },
    { id: "t", pageNumber: 1, sourceOrder: 1, text: "Binary Search Trees\nA binary search tree keeps its keys ordered." },
  ]));
  assert.equal(title, "Binary Search Trees");
});

test("source order decides, not array order", () => {
  const title = firstPageTitle(doc([
    { id: "later", pageNumber: 1, sourceOrder: 5, text: "Summary of results" },
    { id: "first", pageNumber: 1, sourceOrder: 0, text: "Heat Transfer Basics" },
  ]));
  assert.equal(title, "Heat Transfer Basics");
});

test("a page 1 that is only a long paragraph gives no title, so the caller falls back", () => {
  const title = firstPageTitle(doc([
    { id: "para", pageNumber: 1, sourceOrder: 0, text: "This paragraph goes on for a long time without ever reaching anything that could be called a heading at all" },
  ]));
  assert.equal(title, "");
});

test("nothing usable at all is an empty title, never a crash", () => {
  assert.equal(firstPageTitle(null), "");
  assert.equal(firstPageTitle({}), "");
  assert.equal(firstPageTitle(doc([])), "");
  assert.equal(firstPageTitle(doc([{ id: "n", pageNumber: 1, text: "3" }])), "");
});

test("section titles a student can read (moved from progressivePlan, unchanged)", () => {
  assert.equal(referenceSectionTitle("ACTUATORS DR"), "Actuators");
  assert.equal(referenceSectionTitle("Actuators — Dr. Ahmed Khan"), "Actuators");
  assert.equal(referenceSectionTitle("DC MOTORS AND ACTUATORS"), "DC Motors and Actuators");
  assert.equal(referenceSectionTitle("Step 2: Download HOL4"), "Step 2: Download HOL4");
});

/**
 * A parser's placeholder is not a title. parse-pptx names a slide with no title placeholder
 * "Slide N", and parse-pdf/pdfOcr name pages "Page N"; the deck's subject is in the slide's text.
 */
test("a deck whose first slide has no title is named by the slide's text, not 'Slide 1'", () => {
  const title = firstPageTitle(doc([
    { id: "s1", pageNumber: 1, sourceOrder: 1, heading: "Slide 1", text: "Photosynthesis\nHow plants make food from light" },
    { id: "s2", pageNumber: 2, sourceOrder: 2, heading: "Light reactions", text: "Chlorophyll absorbs light." },
  ]));
  assert.equal(title, "Photosynthesis");
});

test("'Page 1' from the PDF parser is skipped for the page's real title", () => {
  const title = firstPageTitle(doc([
    { id: "p1", pageNumber: 1, sourceOrder: 0, heading: "Page 1", text: "Heat Transfer Basics. Conduction moves heat through a solid." },
  ]));
  assert.equal(title, "Heat Transfer Basics");
});

test("a text that begins with a 'Slide 1' line gives the line after it", () => {
  const title = firstPageTitle(doc([
    { id: "s1", pageNumber: 1, sourceOrder: 1, text: "Slide 1:\nBinary Search Trees\nKeys stay ordered." },
  ]));
  assert.equal(title, "Binary Search Trees");
});

test("only placeholders on page 1 is no title, so the caller names the subject from the document", () => {
  assert.equal(firstPageTitle(doc([{ id: "s1", pageNumber: 1, sourceOrder: 1, heading: "Slide 1", text: "Slide 1" }])), "");
  assert.equal(firstPageTitle(doc([{ id: "s1", pageNumber: 1, sourceOrder: 1, heading: "Untitled", text: "" }])), "");
  assert.equal(firstPageTitle(doc([{ id: "s1", pageNumber: 1, sourceOrder: 1, heading: "Title slide", text: "Pages 1-3 (selected area)" }])), "");
});
