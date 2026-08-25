import test from "node:test";
import assert from "node:assert/strict";
import { focusPassages, isPointingPhrase } from "../pdfFocus";
import type { SuprnotesLessonInput } from "../suprnotes";

/**
 * The question has to REACH retrieval.
 *
 * Grounding was already built and working — `focusPassages` found the right passages, and the
 * focused prompt overrides the survey contract in detail. None of it ran, because the client only
 * ever sent the page-chooser box as `focus`. A student who typed their question on the landing page
 * (the main way in) sent nothing, `focusPassages` was handed "", it returned null, retrieval was
 * skipped, and the whole-document contract produced a survey of the paper.
 *
 * These pin the two halves of that: an empty question can never ground, and a real one always does.
 */

const doc = {
  contentBlocks: [
    {
      id: "p2-b1",
      pageNumber: 2,
      heading: "3b. Derivation of Trapezoidal Rule",
      text: "I = (b-a) * [f(a) + f(b)] / 2 - (1/12) * f''(x) * (b-a)^3 gives the error term.",
    },
    {
      id: "p3-b1",
      pageNumber: 3,
      heading: "4. Simpson's 1/3 Rule",
      text: "Approximate f(x) with a parabola through three equally spaced points and integrate exactly.",
    },
    {
      id: "p1-b1",
      pageNumber: 1,
      heading: "Contents",
      text: "What is numerical integration? Newton-Cotes formulas overview and the trapezoid rule.",
    },
  ],
} as unknown as SuprnotesLessonInput;

test("THE BUG: an empty question cannot ground, so the lecture falls back to a survey", () => {
  assert.equal(focusPassages("", doc), null);
  assert.equal(focusPassages("   ", doc), null);
});

test("a real typed question grounds on the passage that answers it", () => {
  const focus = focusPassages("explain the error term for the trapezoidal rule", doc);
  assert.ok(focus, "a specific question must produce a focus");
  assert.equal(focus.passages[0].blockId, "p2-b1", "should land on the derivation, not the contents page");
});

test("a question about a different section lands on that section", () => {
  const focus = focusPassages("what is Simpson's 1/3 rule", doc);
  assert.ok(focus);
  assert.equal(focus.passages[0].blockId, "p3-b1");
});

test("a pointing phrase is recognised, so the region stays the subject", () => {
  // These carry no retrievable signal — the region or the transcript has to supply the subject.
  for (const phrase of ["explain this", "what is this", "this bit"]) {
    assert.ok(isPointingPhrase(phrase), `${JSON.stringify(phrase)} should be recognised as pointing`);
  }
  assert.ok(!isPointingPhrase("explain the error term for the trapezoidal rule"));
});

test("a named page pins the answer to that page", () => {
  const focus = focusPassages("explain the formula on page 3", doc);
  assert.ok(focus);
  assert.deepEqual(focus.pages, [3]);
  assert.ok(focus.passages.every((p) => p.pageNumber === 3));
});
