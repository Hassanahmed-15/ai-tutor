/**
 * The saving is easy; not losing a figure while making it is the hard part. These tests pin the
 * fail-open behaviour, because the expensive mistake here is silent — a beat written without the
 * figure it was supposed to teach from still reads perfectly well.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { figureScope, type FigureScopeInput } from "../figureDetectionScope";

/** A normal page of a paper: rasterised, vision on, text present, artwork present. */
const FIGURE_PAGE: FigureScopeInput = {
  hasGraphics: true,
  hasImage: true,
  visionAvailable: true,
  hasText: true,
};

test("a page with artwork is sent to the detector", () => {
  assert.equal(figureScope(FIGURE_PAGE), "detect");
});

test("a definitely text-only page skips the vision call", () => {
  // The whole point: 43% of a real paper, 100% of a prose-only PDF.
  assert.equal(figureScope({ ...FIGURE_PAGE, hasGraphics: false }), "skip-text-only");
});

test("an UNDETERMINED page is detected, never skipped", () => {
  // Fail open. Losing a figure is invisible in the output; one extra call is not.
  assert.equal(figureScope({ ...FIGURE_PAGE, hasGraphics: null }), "detect");
});

test("a scanned page with no text keeps the whole page when vision is unavailable", () => {
  assert.equal(
    figureScope({ hasGraphics: true, hasImage: true, visionAvailable: false, hasText: false }),
    "whole-page",
  );
});

test("an undetermined page with no text still keeps the whole page", () => {
  assert.equal(
    figureScope({ hasGraphics: null, hasImage: true, visionAvailable: false, hasText: false }),
    "whole-page",
  );
});

test("a genuinely blank page is NOT shipped as a full-page figure of nothing", () => {
  // No text and nothing drawn — a section divider or a trailing empty page.
  assert.equal(
    figureScope({ hasGraphics: false, hasImage: true, visionAvailable: false, hasText: false }),
    "skip-text-only",
  );
});

test("no rasterised image means there is nothing to send or keep", () => {
  assert.equal(figureScope({ ...FIGURE_PAGE, hasImage: false }), "none");
});

test("with vision off, a text page with artwork falls through rather than inventing a figure", () => {
  assert.equal(
    figureScope({ hasGraphics: true, hasImage: true, visionAvailable: false, hasText: true }),
    "none",
  );
});
