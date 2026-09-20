/**
 * Turning a mark on the board into a question worth asking.
 *
 * The old path sent the WHOLE board as one image with "the student drew the attached image" — the
 * model had to guess which part was meant, and never received the board's own words.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { boundsOf, buildExplainRequest, classifyGesture, recentSelection } from "../board/selection";
import type { AnnotationStroke } from "../board/annotations";

const stroke = (id: string, pts: Array<[number, number]>, kind: "pen" | "highlight" = "pen", coveredText?: string): AnnotationStroke =>
  ({ id, kind, color: "#fbbf24", width: 0.004, points: pts.map(([x, y]) => ({ x, y })), coveredText });

test("THE CROP: the region is the mark, not the whole board", () => {
  const s = stroke("a", [[0.4, 0.4], [0.5, 0.45], [0.45, 0.5]]);
  const b = boundsOf([s])!;
  assert.ok(b.width < 0.25 && b.height < 0.25, `should be a crop, got ${b.width}x${b.height}`);
  assert.ok(b.x > 0.3 && b.y > 0.3, "positioned where the student marked");
});

test("the crop is padded, so a mark is never flush against the edge", () => {
  const b = boundsOf([stroke("a", [[0.5, 0.5], [0.52, 0.5]])])!;
  assert.ok(b.x < 0.5 && b.y < 0.5, "padding extends left and up");
  assert.ok(b.width > 0.02, "and gives the model something around the mark");
});

test("padding never escapes the board", () => {
  const b = boundsOf([stroke("a", [[0, 0], [1, 1]])])!;
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1 && b.y + b.height <= 1);
});

test("a mark made minutes ago is not part of what the student just pointed at", () => {
  const old = stroke("old", [[0.05, 0.05], [0.1, 0.08]]);
  const now = stroke("now", [[0.8, 0.8], [0.85, 0.83]]);
  const selected = recentSelection([old, now]);
  assert.deepEqual(selected.map((s) => s.id), ["now"]);
});

test("marks drawn together are one selection", () => {
  const a = stroke("a", [[0.5, 0.5], [0.55, 0.52]]);
  const b = stroke("b", [[0.54, 0.53], [0.58, 0.55]]);
  assert.equal(recentSelection([a, b]).length, 2);
});

test("the gesture is read from the shape, because it changes the question", () => {
  const underline = stroke("u", [[0.2, 0.5], [0.45, 0.505], [0.6, 0.5]]);
  assert.equal(classifyGesture([underline]), "underline");

  const circle = stroke("c", [[0.5, 0.4], [0.6, 0.45], [0.55, 0.55], [0.48, 0.48], [0.5, 0.41]]);
  assert.equal(classifyGesture([circle]), "circle");

  const highlighted = stroke("h", [[0.2, 0.5], [0.5, 0.5]], "highlight");
  assert.equal(classifyGesture([highlighted]), "highlight");
});

test("THE WORDS: board text under the mark leads the question, because it is the only certain part", () => {
  const s = stroke("a", [[0.3, 0.5], [0.6, 0.5]], "pen", "squared residuals");
  const req = buildExplainRequest([s], { conceptTitle: "Measuring error", currentSentence: "We square each gap." })!;
  assert.match(req.question, /squared residuals/);
  assert.match(req.question, /Measuring error/, "the lesson position is included");
  assert.match(req.question, /We square each gap/, "so is what she had just said");
  assert.equal(req.selectedText, "squared residuals");
});

test("with no board text, the question still says what was marked and asks about the crop", () => {
  const req = buildExplainRequest([stroke("a", [[0.5, 0.5], [0.6, 0.6]])], {})!;
  assert.match(req.question, /crop/);
  assert.equal(req.selectedText, "");
});

test("the question asks about the selection, not the whole board", () => {
  const req = buildExplainRequest([stroke("a", [[0.5, 0.5], [0.6, 0.6]])], {})!;
  assert.match(req.question, /not about the whole board/i);
});

test("nothing marked yields no request rather than an empty one", () => {
  assert.equal(buildExplainRequest([], {}), null);
});
