import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { alphaBounds, measureAsset, MIN_PAGE_FILL, pageOf } from "../../scripts/build-asset-catalogue.mjs";

/**
 * The catalogue build's measurement: where each asset ACTUALLY draws, in its own user units.
 *
 * ESM because the build script is an ES module with a CLI; it runs only when invoked directly, so
 * importing it here measures nothing on disk. The renderer is the real @resvg/resvg-js — the
 * arithmetic that maps pixels back to user units is exactly what a mock would hide.
 *
 * Each case is a real shape of the Bioicons catalogue: a small drawing on an A4 page (leaf.svg), a
 * viewBox with a negative origin and artwork running past it (the Erlenmeyer flask), a root whose
 * inch width/height disagree with its viewBox, and an empty file.
 */
const { Resvg } = createRequire(import.meta.url)("@resvg/resvg-js");
const svg = (attrs, body) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);

test("alphaBounds finds the drawn pixels and ignores faint haze", () => {
  const width = 8;
  const height = 6;
  const pixels = new Uint8Array(width * height * 4);
  const paint = (x, y, alpha) => (pixels[(y * width + x) * 4 + 3] = alpha);
  paint(2, 1, 255);
  paint(5, 4, 200);
  paint(7, 5, 3); // anti-aliasing haze
  assert.deepEqual(alphaBounds(pixels, width, height), { x0: 2, y0: 1, x1: 6, y1: 5 });
  assert.equal(alphaBounds(new Uint8Array(width * height * 4), width, height), null);
});

test("pageOf reads the viewBox with its origin, else the pixel size", () => {
  assert.deepEqual(pageOf(svg('viewBox="-120.5 -155.3 880.8 532.8"', ""), 1, 1), { x: -120.5, y: -155.3, w: 880.8, h: 532.8, fromViewBox: true });
  assert.deepEqual(pageOf(svg('width="300" height="200"', ""), 300, 200), { x: 0, y: 0, w: 300, h: 200, fromViewBox: false });
});

test("a small drawing on a big page measures as the drawing, and fills under the drop line", () => {
  // leaf.svg's shape: a 53x22 leaf at (70, 48) on a 210x297 page.
  const leaf = svg('viewBox="0 0 210 297" width="210mm" height="297mm"', '<ellipse cx="96.5" cy="59" rx="26.5" ry="11" fill="#2f6b2f"/>');
  const measured = measureAsset(leaf, Resvg);
  assert.ok(!measured.error, measured.error);
  const [x, y, w, h] = measured.bbox;
  near(x, 70, 0.6, "x");
  near(y, 48, 0.6, "y");
  near(w, 53, 1.2, "w");
  near(h, 22, 1.2, "h");
  assert.ok(measured.fill < MIN_PAGE_FILL, `fill ${measured.fill}`);
});

test("artwork past a negative-origin viewBox is measured, not clipped at the page", () => {
  // The flask: its page starts at -120.5,-155.3 and its neck is drawn above the page.
  const flask = svg(
    'viewBox="-120.5 -155.3 880.8 532.8"',
    '<rect x="-90" y="-500" width="800" height="870" fill="#ccc"/>',
  );
  const [x, y, w, h] = measureAsset(flask, Resvg).bbox;
  near(x, -90, 2, "x");
  near(y, -500, 2, "y (above the page)");
  near(w, 800, 3, "w");
  near(h, 870, 3, "h");
});

test("a root whose width/height disagree with its viewBox still maps linearly", () => {
  // mitochondria.svg's shape: inches that are not the viewBox's aspect.
  const odd = svg('width="1.73in" height="0.5in" viewBox="0 0 100 100"', '<rect x="10" y="60" width="30" height="20" fill="#333"/>');
  const [x, y, w, h] = measureAsset(odd, Resvg).bbox;
  near(x, 10, 0.3, "x");
  near(y, 60, 0.3, "y");
  near(w, 30, 0.5, "w");
  near(h, 20, 0.5, "h");
});

test("an empty or blank file is an error, never a box", () => {
  assert.ok(measureAsset("", Resvg).error);
  assert.equal(measureAsset(svg('viewBox="0 0 10 10"', ""), Resvg).error, "draws nothing");
});
