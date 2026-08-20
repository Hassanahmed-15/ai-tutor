/**
 * Reading a page region: the geometry, the limits, and what the model is asked for.
 *
 * The premise, measured on this repo's own AblationStudy_V3.pdf: page 4 declares 985 characters and
 * every one of them is a caption, while the three images those captions describe carry the content.
 * Text extraction cannot reach it, which is why these rules exist.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  pixelRect, isUsableRegion, planTranscription, assembleTranscript, TRANSCRIBE_PROMPT, OCR_RULES,
  type PageRegion,
} from "../pdfOcr";

/* ── geometry ────────────────────────────────────────────────────────────── */

test("a rectangle drawn on a thumbnail maps onto the full-size render", () => {
  /*
   * The reason the rect is normalised rather than in pixels. The selector draws on a ~300px
   * thumbnail; the server renders the page at OCR resolution. Passing pixels means cropping the
   * wrong part of the page the moment either size changes.
   */
  const half = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };
  assert.deepEqual(pixelRect(half, 1000, 2000), { x: 250, y: 1000, width: 500, height: 500 });
  // Same fraction, a different render size — still the same fraction of the page.
  assert.deepEqual(pixelRect(half, 2000, 4000), { x: 500, y: 2000, width: 1000, height: 1000 });
});

test("a drag that runs off the page is clamped, not rejected", () => {
  // Dragging past the edge is a normal thing to do with a mouse.
  const over = pixelRect({ x: 0.8, y: 0.9, width: 0.5, height: 0.5 }, 1000, 1000);
  assert.equal(over.x, 800);
  assert.ok(over.x + over.width <= 1000, `crop runs off the page: ${over.x + over.width}`);
  assert.ok(over.y + over.height <= 1000);
});

test("a drag upward or leftward still selects what it covers", () => {
  // Negative width/height comes from dragging bottom-right to top-left — a real selection.
  const backwards = pixelRect({ x: 0.75, y: 0.75, width: -0.5, height: -0.5 }, 1000, 1000);
  assert.deepEqual(backwards, { x: 250, y: 250, width: 500, height: 500 });
});

test("a crop never has zero or negative size", () => {
  for (const rect of [
    { x: 0.5, y: 0.5, width: 0, height: 0 },
    { x: 1, y: 1, width: 0.5, height: 0.5 },
    { x: Number.NaN, y: 0.5, width: 0.2, height: 0.2 },
  ]) {
    const px = pixelRect(rect, 800, 600);
    assert.ok(px.width > 0 && px.height > 0, `degenerate crop from ${JSON.stringify(rect)}`);
  }
});

test("a stray click is not a selection", () => {
  assert.equal(isUsableRegion(undefined), false);
  assert.equal(isUsableRegion({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 }), false);
  assert.equal(isUsableRegion({ x: 0.1, y: 0.1, width: 0.4, height: 0.3 }), true);
});

/* ── what gets read ──────────────────────────────────────────────────────── */

test("a drawn region wins: only that part is read", () => {
  const regions: PageRegion[] = [{ page: 4, rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.4 } }];
  const plan = planTranscription([2, 4, 6], regions);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].page, 4);
  assert.ok(plan[0].rect, "the region was dropped, so the whole page would be read instead");
});

test("no region means the SELECTED pages are read in full", () => {
  const plan = planTranscription([6, 2, 2, 4], []);
  assert.deepEqual(plan.map((p) => p.page), [2, 4, 6], "pages should be de-duplicated and ordered");
  assert.ok(plan.every((p) => !p.rect));
});

test("whole document with nothing drawn reads NOTHING", () => {
  /*
   * The cost rule. An empty selection means "use the whole document", and a vision call per page
   * over a thirty-page paper buys no precision — that request is already served by the existing
   * whole-document lecture.
   */
  assert.deepEqual(planTranscription([], []), []);
});

test("a stray click does not turn into a whole-page read of the wrong page", () => {
  // The click is discarded, and the fallback is the student's page selection — not the clicked page.
  const plan = planTranscription([2, 3], [{ page: 9, rect: { x: 0.5, y: 0.5, width: 0.0001, height: 0.0001 } }]);
  assert.deepEqual(plan.map((p) => p.page), [2, 3]);
});

test("the number of pages read is capped", () => {
  const many = Array.from({ length: 40 }, (_, i) => i + 1);
  assert.equal(planTranscription(many, []).length, OCR_RULES.MAX_PAGES);

  const manyRegions: PageRegion[] = many.map((page) => ({ page, rect: { x: 0, y: 0, width: 1, height: 1 } }));
  assert.equal(planTranscription([], manyRegions).length, OCR_RULES.MAX_PAGES);
});

/* ── what the model is asked ─────────────────────────────────────────────── */

test("the model is told to TRANSCRIBE, never to summarise", () => {
  /*
   * The distinction the whole fix rests on. A model shown a formula and asked about it writes a
   * description, and a description of a formula is not a formula — which is the original complaint
   * in a different costume.
   */
  assert.match(TRANSCRIBE_PROMPT, /Transcribe everything visible/i);
  assert.match(TRANSCRIBE_PROMPT, /Do not summarise/i);
  assert.match(TRANSCRIBE_PROMPT, /LaTeX/);
  assert.match(TRANSCRIBE_PROMPT, /subscript/i);
  assert.match(TRANSCRIBE_PROMPT, /illegible/i, "guessing at unreadable content must be forbidden");
});

/* ── assembling the passage ──────────────────────────────────────────────── */

test("the transcript says which page each piece came from", () => {
  const out = assembleTranscript([
    { page: 4, text: "Fig. 3 correlation matrix, Glucose 0.47" },
    { page: 7, rect: { x: 0, y: 0, width: 1, height: 1 }, text: "D_p(x,y) = ..." },
  ]);
  assert.match(out, /page 4/);
  assert.match(out, /page 7, selected region/);
  assert.match(out, /Glucose 0\.47/);
  assert.match(out, /D_p\(x,y\)/);
});

test("empty transcriptions are dropped, and all-empty yields nothing", () => {
  // A blank crop must not become an empty "page N" heading that the lecture then tries to teach.
  assert.equal(assembleTranscript([{ page: 1, text: "   " }]), "");
  assert.equal(assembleTranscript([]), "");
  const mixed = assembleTranscript([{ page: 1, text: "" }, { page: 2, text: "real content" }]);
  assert.match(mixed, /page 2/);
  assert.doesNotMatch(mixed, /page 1/);
});

test("a runaway transcript is truncated rather than sent whole", () => {
  const huge = assembleTranscript([{ page: 1, text: "x".repeat(50_000) }]);
  assert.ok(huge.length <= OCR_RULES.MAX_TRANSCRIPT_CHARS + 40, `transcript was ${huge.length} chars`);
  assert.match(huge, /transcript truncated/);
});
