import test from "node:test";
import assert from "node:assert/strict";
import { buildPdfLessonPlan, groupBlocksIntoBeats } from "../pdfLessonPipeline";
import type { SuprnotesContentBlock } from "../suprnotes";

/**
 * Beats must follow the content, not the page breaks.
 *
 * These exist because the plan used to emit exactly one beat per source page, which produced two
 * reported failures: a one-page upload became a single-beat "lecture" no matter how much was on the
 * page, and generation died outright with "Couldn't build that lecture" whenever the model split a
 * dense page into the several beats it obviously needed.
 *
 * The extractor stamps a uniform page label ("Page 1") on every block, so `heading` cannot be used
 * as a boundary signal on its own — that detail is what the middle tests here pin down.
 */

/** A block shaped the way the PDF extractor really emits them. */
const B = (id: string, page: number, text: string): SuprnotesContentBlock => ({
  id,
  pageNumber: page,
  heading: `Page ${page}`,
  text,
  sourceOrder: 0,
});

test("a dense one-page guide splits into its steps rather than one mega-beat", () => {
  const blocks = [
    B("b1", 1, "HOL4 Installation Guide"),
    B("b2", 1, "Step 1: Install PolyML Download the source, run ./configure, then make."),
    B("b3", 1, "Step 2: Download HOL4 Clone the repository from GitHub with git clone."),
    B("b4", 1, "Step 3: Build HOL4 Run poly < tools/smart-configure.sml, then bin/build."),
    B("b5", 1, "Step 4: Verify the install Launch bin/hol and confirm the prompt appears."),
  ];
  const groups = groupBlocksIntoBeats(blocks);
  assert.ok(groups.length >= 3, `expected the steps to separate, got ${groups.length}`);
  assert.deepEqual(groups.flat().map((b) => b.id), blocks.map((b) => b.id));
});

test("numbered sub-sections (4. / 4b.) are recognised as boundaries", () => {
  const blocks = [
    B("a", 1, "4. Simpson's 1/3 Rule is a numerical integration method."),
    B("b", 1, "more body text about the rule"),
    B("c", 1, "4b. Derivation of Simpson's 1/3 Rule begins with the polynomial."),
    B("d", 1, "further derivation detail"),
  ];
  assert.equal(groupBlocksIntoBeats(blocks).length, 2);
});

test("a uniform page label is NOT mistaken for a section heading", () => {
  // Every block says "Page 1" and nothing is numbered: this is one idea, not five.
  const blocks = Array.from({ length: 5 }, (_, i) => B(`b${i}`, 1, "ordinary prose with no numbering"));
  assert.equal(groupBlocksIntoBeats(blocks).length, 1);
});

test("genuinely distinct per-block headings are still honoured", () => {
  const blocks: SuprnotesContentBlock[] = [
    { id: "a", pageNumber: 1, heading: "Introduction", text: "body" },
    { id: "b", pageNumber: 1, heading: "Introduction", text: "body" },
    { id: "c", pageNumber: 1, heading: "Method", text: "body" },
    { id: "d", pageNumber: 1, heading: "Method", text: "body" },
  ];
  assert.equal(groupBlocksIntoBeats(blocks).length, 2);
});

test("a beat never spans two pages", () => {
  const blocks = [B("a", 1, "Step 1: one"), B("b", 1, "x"), B("c", 2, "Step 2: two"), B("d", 2, "y")];
  for (const group of groupBlocksIntoBeats(blocks)) {
    assert.equal(new Set(group.map((b) => b.pageNumber)).size, 1);
  }
});

test("no block is ever dropped or reordered", () => {
  const blocks = Array.from({ length: 37 }, (_, i) =>
    B(`b${i}`, Math.floor(i / 9) + 1, `${i % 5 === 0 ? `Step ${i}: ` : ""}text`),
  );
  assert.deepEqual(groupBlocksIntoBeats(blocks).flat().map((b) => b.id), blocks.map((b) => b.id));
});

test("a headingless wall of blocks is divided rather than left whole", () => {
  const blocks = Array.from({ length: 16 }, (_, i) => B(`b${i}`, 1, "plain prose"));
  const groups = groupBlocksIntoBeats(blocks);
  assert.ok(groups.length >= 3, `expected a split, got ${groups.length}`);
  for (const group of groups) assert.ok(group.length <= 7);
});

test("a genuinely small page still yields one beat, not zero", () => {
  assert.equal(groupBlocksIntoBeats([B("a", 1, "t"), B("b", 1, "t")]).length, 1);
});

test("empty input yields no beats rather than throwing", () => {
  assert.deepEqual(groupBlocksIntoBeats([]), []);
});

test("blocks with no pageNumber are still grouped, not dropped", () => {
  const blocks: SuprnotesContentBlock[] = [
    { id: "x", sourceOrder: 0, text: "t" },
    { id: "y", sourceOrder: 1, text: "t" },
  ];
  assert.equal(groupBlocksIntoBeats(blocks).flat().length, 2);
});

test("a raw Figure 19.4 locator becomes the caption's concept title", () => {
  const blocks: SuprnotesContentBlock[] = [{
    id: "dell-p2",
    pageNumber: 2,
    sourceOrder: 1,
    heading: "Figure 19.4",
    text: "Figure 19.4 Deletion of node 2 with two children: (a) before and (b) after.",
  }];
  const plan = buildPdfLessonPlan(blocks, []);
  assert.equal(plan.beats[0]?.title, "Deletion of node 2 with two children");
});
