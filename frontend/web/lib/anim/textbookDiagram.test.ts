import test from "node:test";
import assert from "node:assert/strict";
import { textbookDiagramKey, textbookPrompt } from "../canvas/textbookPrompt";

test("a verified diagram is remembered under one key, whatever the wording's case, filler or part order", () => {
  const a = textbookDiagramKey("A labelled diagram of the human heart", ["Left ventricle", "Aorta", "Right atrium"]);
  const b = textbookDiagramKey("the human heart", ["aorta", "right atrium", "left ventricle"]);
  assert.equal(a, b);
  assert.match(a, /^asset-[0-9a-f]{32}$/);
  // A different subject or a different set of parts is a different diagram.
  assert.notEqual(a, textbookDiagramKey("the human lungs", ["aorta", "right atrium", "left ventricle"]));
  assert.notEqual(a, textbookDiagramKey("the human heart", ["aorta", "right atrium"]));
});

test("the image model is told the parts to show, the textbook conventions, and any corrections", () => {
  const prompt = textbookPrompt("A frontal section of the human heart.", ["aorta", "septum"], ["the left ventricle wall must be thicker"]);
  assert.match(prompt, /aorta; septum/);
  assert.match(prompt, /standard colour conventions/);
  assert.match(prompt, /correct these: the left ventricle wall must be thicker/);
  assert.doesNotMatch(textbookPrompt("A volcano", []), /must clearly show|rejected/);
});
