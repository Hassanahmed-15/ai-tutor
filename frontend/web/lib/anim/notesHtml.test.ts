import test from "node:test";
import assert from "node:assert/strict";
import { inlineHtml, notesFileName, notesHtml } from "../notes/notesHtml";
import { BLOCK_FIXTURES } from "../canvas/blockFixtures";
import type { BoardBlock } from "../canvas/blocks";

test("the notes hold every block in full, with the student's questions under their section", () => {
  const blocks = BLOCK_FIXTURES[0].spec.blocks as BoardBlock[];
  const html = notesHtml({ title: "Speed — Lesson 1 of 2", subject: "Physics", date: "2026-11-09", sections: [{ title: "Speed", blocks }], asked: [{ index: 0, question: "Why divide?", answer: "Because speed is per second." }] });
  for (const text of ["is how far something travels", "Sara", "distance = 100", "where:", "Common mistake", "You asked", "Why divide?", "Because speed is per second."]) assert.ok(html.includes(text), text);
  assert.ok(html.includes("katex"), "maths is typeset");
});

test("nothing typed by a model or a student can become page code; Urdu runs right to left", () => {
  assert.equal(inlineHtml("<script>x</script> **a**"), "&lt;script&gt;x&lt;/script&gt; <strong>a</strong>");
  const urdu = BLOCK_FIXTURES[1].spec.blocks as BoardBlock[];
  const html = notesHtml({ title: "<b>x</b>", date: "2026-11-09", sections: [{ title: "فعل", blocks: urdu }], asked: [{ index: 0, question: "<img src=x>", answer: "" }] });
  assert.ok(!html.includes("<img src=x>"));
  assert.ok(html.includes('dir="rtl"'));
});

test("the file name says what it is", () => {
  assert.equal(notesFileName("Osmosis — Lesson 1 of 2", "Biology", "2026-11-09"), "Aria-Notes_Biology_Osmosis_Lesson1_2026-11-09.pdf");
  assert.equal(notesFileName("Sets and Venn diagrams", undefined, "2026-11-09"), "Aria-Notes_Sets-and-Venn-diagrams_2026-11-09.pdf");
});
