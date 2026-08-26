import test from "node:test";
import assert from "node:assert/strict";
import { buildGroundedImageCallouts, sanitizeFocusRegions } from "../imageCalloutGen";
import { focusRegionsInsidePixelCrop, type PdfDetectedFigure } from "../pdfLessonPipeline";
import { rebaseGroundedCallout } from "../suprnotes";

test("PDF focus regions are rebased from page pixels into crop-normalized coordinates", () => {
  const figure: PdfDetectedFigure = {
    type: "diagram",
    x: 0.2,
    y: 0.3,
    width: 0.5,
    height: 0.4,
    caption: "Deletion cases",
    description: "A diagram",
    instructionalPriority: "high",
    useInLesson: true,
    annotationNeeded: true,
    focusRegions: [{ label: "inorder successor", x: 0.2, y: 0.25, width: 0.1, height: 0.2 }],
  };
  const [region] = focusRegionsInsidePixelCrop(
    figure,
    { x: 150, y: 560, width: 600, height: 900 },
    1000,
    2000,
  );
  assert.ok(Math.abs(region.x - 0.25) < 1e-9);
  assert.ok(Math.abs(region.y - (240 / 900)) < 1e-9);
  assert.ok(Math.abs(region.width - (50 / 600)) < 1e-9);
  assert.ok(Math.abs(region.height - (160 / 900)) < 1e-9);
});

test("invalid or unverified focus regions never become arrows", () => {
  assert.deepEqual(sanitizeFocusRegions([
    { label: "outside", x: 0.9, y: 0.2, width: 0.2, height: 0.1 },
    { label: "zero", x: 0.2, y: 0.2, width: 0, height: 0.1 },
  ]), []);
  assert.deepEqual(buildGroundedImageCallouts([{ group: 0, regionIndex: 0 }], [], 2, { x: 50, y: 53, w: 52, h: 48 }), []);
});

test("callouts use the verified region label and reject guessed indexes", () => {
  const regions = sanitizeFocusRegions([
    { label: "Gray central area", x: 0.2, y: 0.2, width: 0.4, height: 0.45 },
    { label: "Control buttons", x: 0.74, y: 0.04, width: 0.2, height: 0.12 },
  ]);
  const callouts = buildGroundedImageCallouts([
    { text: "wrong model label", group: 0, regionIndex: 0 },
    { text: "also wrong", group: 1, regionIndex: 1 },
    { text: "clamp me", group: 1, regionIndex: 99 },
    { text: "duplicate", group: 1, regionIndex: 1 },
  ], regions, 2, { x: 50, y: 53, w: 52, h: 48 });

  assert.deepEqual(callouts.map((callout) => callout.text), ["Gray central area", "Control buttons"]);
  assert.equal(callouts.every((callout) => callout.grounded === true), true);
  assert.equal(callouts[0].labelX, 8);
  assert.equal(callouts[1].labelX, 92);
  assert.ok(callouts[0].x < 50);
  assert.ok(callouts[1].x > 50);
});

test("a grounded target keeps its relative image position when the board resizes the image", () => {
  const rebased = rebaseGroundedCallout(
    { kind: "callout", text: "Control buttons", x: 73.6, y: 42.5, grounded: true, at: 0.4 },
    { x: 55, y: 55, w: 62, h: 50 },
    { x: 50, y: 53, w: 52, h: 48 },
  );
  assert.ok(rebased);
  assert.ok(Math.abs(rebased.x - 65.6) < 1e-9);
  assert.ok(Math.abs(rebased.y - 41) < 1e-9);
});
