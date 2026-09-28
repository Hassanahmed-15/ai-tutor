/**
 * A SCANNED PAGE'S PARAGRAPHS ARE PLACED WHERE THEIR LINES ARE.
 *
 * Laid out like the Weiss BST page that broke it: a main column with a margin note beside it, whose
 * short lines ("disconnect the tree") use only words the main paragraph also contains.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { linesFromTsv, locateBlocks, type OcrLine } from "../ocrLayout";

const line = (y: number, x: number, width: number, text: string): OcrLine => ({
  x,
  y,
  width,
  height: 0.012,
  tokens: text.toLowerCase().split(/\s+/).filter((token) => token.length >= 2),
});

const MAIN = "The hardest operation is remove. Once we have found the node to be removed, we need to consider several possibilities. The problem is that the removal of a node may disconnect parts of the tree.";
const NOTE = "The remove operation is difficult because nonleaf nodes hold the tree together and we do not want to disconnect the tree.";

const LINES = [
  line(0.583, 0.09, 0.62, "the hardest operation is remove once we have found the node to be"),
  line(0.603, 0.06, 0.65, "removed we need to consider several possibilities the problem is that the"),
  line(0.623, 0.06, 0.65, "removal of node may disconnect parts of the tree"),
  line(0.585, 0.74, 0.09, "the remove"),
  line(0.600, 0.74, 0.15, "operation is difficult"),
  line(0.616, 0.74, 0.12, "because nonleaf"),
  line(0.631, 0.74, 0.14, "nodes hold the tree"),
  line(0.647, 0.74, 0.14, "together and we do"),
  line(0.662, 0.74, 0.08, "not want to"),
  line(0.677, 0.74, 0.15, "disconnect the tree"),
];

test("a margin note and the paragraph beside it each get their own column", () => {
  const [main, note] = locateBlocks([{ text: MAIN }, { text: NOTE }], LINES);
  assert.ok(main && note);
  assert.ok(main.x < 0.1 && main.x + main.width < 0.72, "the main box stays in the main column");
  assert.ok(note.x > 0.7, "the note box stays in the margin");
  assert.ok(note.y < 0.586 && note.y + note.height > 0.688, "the note keeps its first and last lines");
  assert.ok(main.y < 0.584 && main.y + main.height > 0.634, "the main paragraph keeps all three lines");
});

test("a paragraph the scan does not carry gets no box", () => {
  const [, missing] = locateBlocks([{ text: MAIN }, { text: "Hash tables store keys in buckets indexed by a hash function." }], LINES);
  assert.equal(missing, undefined);
});

test("tesseract TSV becomes page-normalised lines", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t1000\t2000\t-1\t",
    "5\t1\t1\t1\t1\t1\t100\t200\t50\t20\t96\tBinary",
    "5\t1\t1\t1\t1\t2\t160\t202\t60\t20\t96\tsearch",
  ].join("\n");
  const [only] = linesFromTsv(tsv);
  assert.deepEqual(only.tokens, ["binary", "search"]);
  assert.equal(only.x, 0.1);
  assert.equal(only.y, 0.1);
  assert.equal(only.width, 0.12);
});

test("a scanned page keeps its transcript's reading order once its blocks have boxes", async () => {
  const { applyGlobalSourceOrder } = await import("../pdfLessonPipeline");
  const block = (id: string, sourceOrder: number, y?: number) =>
    ({ id, type: "paragraph", heading: "Page 1", text: id, pageNumber: 1, sourceOrder, ...(y === undefined ? {} : { bbox: { x: 0, y, width: 1, height: 0.05 } }) });
  // The margin note sits level with the paragraph; the second note could not be placed at all.
  const blocks = [block("ocr-p1-0-2", 3, 0.58), block("ocr-p1-0-0", 1, 0.28), block("ocr-p1-0-4", 5, 0.59), block("ocr-p1-0-5", 6), block("ocr-p1-0-3", 4, 0.7), block("ocr-p1-0-1", 2, 0.52)];
  applyGlobalSourceOrder(blocks as never);
  assert.deepEqual(blocks.map((b) => b.id), ["ocr-p1-0-0", "ocr-p1-0-1", "ocr-p1-0-2", "ocr-p1-0-3", "ocr-p1-0-4", "ocr-p1-0-5"]);
});

test("a title cut from a sentence does not end on its connective", async () => {
  const { topicKeywords } = await import("../beatPresentation");
  assert.equal(topicKeywords("The remove operation is difficult because nonleaf nodes"), "The Remove Operation Is Difficult");
});

test("the transcriber's own picture stand-ins are not the book's text", async () => {
  const { structureTranscribedPage } = await import("../pdfOcr");
  const blocks = structureTranscribedPage("![Image: Binary search trees (a) before and (b) after the insertion of 6.]\n\nFigure 19.2 Binary search trees (a) before and (b) after the insertion of 6.\n\nThe hardest operation is remove.");
  assert.deepEqual(blocks.map((b) => b.kind), ["caption", "paragraph"]);
});
