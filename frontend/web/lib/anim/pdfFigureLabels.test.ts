/**
 * A FIGURE'S LABELS, AS PRINTED.
 *
 * The strict board is told to write the source figure's labels verbatim, so the parser's reading of
 * them is the board's ground truth. Coordinates below are the real text-layer positions from page 1
 * of the Cambridge Checkpoint Science excerpt (pdf.js, scale 1, 620.8 × 914.5 pt): the palisade-cell
 * figure prints "cell surface membrane" on two lines, which the parser used to split into two labels.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { joinWrappedLabels, structurePdfPage, type PdfTextSpan } from "../pdfLessonPipeline";

const W = 620.787;
const H = 914.539;
const span = (text: string, x: number, top: number, width: number, fontSize: number): PdfTextSpan => ({ text, x, top, width, height: fontSize, fontSize });

const BODY = [
  span("The photosynthesis reaction needs a supply of energy to make it happen. This", 68, 296, 380, 11.5),
  span("energy comes from light. During photosynthesis, the plant’s leaves absorb the", 68, 310, 380, 11.5),
  span("energy of light. The energy is stored in the glucose that is made. The glucose is a", 68, 323, 380, 11.5),
  span("store of chemical potential energy.", 68, 337, 180, 11.5),
];
const LABELS = [
  span("cell wall", 108, 403, 36, 10.5),
  span("cell surface", 77, 442, 51, 10.5),
  span("membrane", 77, 454, 49, 10.5),
  span("cytoplasm", 119, 495, 46, 10.5),
  span("vacuole", 205, 524, 35, 10.5),
  span("chloroplast containing chlorophyll", 379, 528, 154, 10.5),
  span("nucleus", 290, 532, 36, 10.5),
];
const CAPTION = span("Photosynthesis happens inside the chloroplasts in a palisade cell like this one.", 68, 562, 356, 10.5);

test("a label printed over two lines is ONE label", () => {
  const blocks = structurePdfPage([...BODY, ...LABELS, CAPTION], 1, W, H);
  const labels = blocks.find((block) => block.role === "figure-labels");
  assert.equal(labels?.text, "Diagram labels: cell wall, cell surface membrane, cytoplasm, vacuole, chloroplast containing chlorophyll, nucleus");
  assert.ok(blocks.some((block) => block.text === CAPTION.text), "the caption stays its own paragraph");
});

test("labels on opposite sides of a figure are never joined, even when reading order interleaves them", () => {
  const joined = joinWrappedLabels([
    { text: "cell surface", x: 77, top: 442, width: 51, height: 10.5, fontSize: 10.5 },
    { text: "stoma", x: 480, top: 446, width: 30, height: 10.5, fontSize: 10.5 },
    { text: "membrane", x: 77, top: 454, width: 49, height: 10.5, fontSize: 10.5 },
    { text: "guard", x: 480, top: 470, width: 30, height: 10.5, fontSize: 10.5 },
  ]);
  assert.deepEqual(joined, ["cell surface membrane", "stoma", "guard"], "'guard' is 13 pt below 'stoma': a new label, not a wrap");
  assert.deepEqual(
    joinWrappedLabels([
      { text: "photo-", x: 100, top: 100, width: 30, height: 10, fontSize: 10 },
      { text: "synthesis", x: 100, top: 111, width: 40, height: 10, fontSize: 10 },
    ]),
    ["photosynthesis"],
    "a hyphenated wrap is rejoined without the hyphen",
  );
});

test("a narrow caption column is prose, not 'Diagram labels'", () => {
  // Page 6 of the excerpt: a caption set in a narrow side column, each line short and unpunctuated.
  const column = [
    span("Water vapour diffusing out", 446, 400, 118, 10.5),
    span("of plant leaves helps", 446, 413, 95, 10.5),
    span("to keep the", 446, 426, 52, 10.5),
    span("air moist.", 446, 440, 43, 10.5),
  ];
  const blocks = structurePdfPage([...BODY, ...column], 6, W, H);
  assert.ok(!blocks.some((block) => block.role === "figure-labels" && /Water vapour/.test(block.text ?? "")), JSON.stringify(blocks.map((b) => [b.role, b.text])));
  assert.ok(blocks.some((block) => /Water vapour diffusing out of plant leaves helps to keep the/.test(block.text ?? "")), "its words are kept as text");
});
