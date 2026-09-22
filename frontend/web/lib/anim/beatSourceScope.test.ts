/**
 * Which pages a beat is written from, and how many beats a lecture has.
 *
 * Both rules failed silently in production — a beat written from the wrong pages still reads
 * fluently, and a lecture with twelve sections still works, so neither shows up as an error. These
 * tests pin the two behaviours that were actually wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { beatCountForDepth, scopedBlockText, type ScopeBlock } from "../beatSourceScope";

const BLOCKS: ScopeBlock[] = [
  { id: "b1", heading: "Introduction", text: "Linear regression fits a line to data.", pageNumber: 1 },
  { id: "b2", heading: "Least squares", text: "Minimise the sum of squared residuals.", pageNumber: 4 },
  { id: "b3", heading: "Overfitting", text: "A model can memorise noise instead of signal.", pageNumber: 9 },
];

test("a beat sees only the blocks it was planned from", () => {
  /*
   * The drift bug: every beat used to receive the whole document, so a beat about page 9 read
   * pages 1 and 4 first and wrote about those instead.
   */
  const scoped = scopedBlockText(BLOCKS, ["b3"]);
  assert.match(scoped, /memorise noise/);
  assert.doesNotMatch(scoped, /fits a line/, "page 1 leaked into a page 9 beat");
  assert.doesNotMatch(scoped, /squared residuals/, "page 4 leaked into a page 9 beat");
});

test("several blocks are joined in the order given, each labelled with its page", () => {
  const scoped = scopedBlockText(BLOCKS, ["b1", "b3"]);
  assert.match(scoped, /\[page 1\]/);
  assert.match(scoped, /\[page 9\]/);
  // The label exists so a beat cannot attribute page 9's content to page 2.
  assert.ok(scoped.indexOf("[page 1]") < scoped.indexOf("[page 9]"), "blocks lost their source order");
});

test("no block ids means no scope, so the caller can fall back", () => {
  /*
   * "" is load-bearing, not an empty edge case: it is how a topic-only beat tells the caller to use
   * the unscoped text. Returning the whole document here would reintroduce the drift above.
   */
  assert.equal(scopedBlockText(BLOCKS, []), "");
  assert.equal(scopedBlockText(BLOCKS, undefined), "");
});

test("ids that match nothing fall back rather than inventing content", () => {
  assert.equal(scopedBlockText(BLOCKS, ["does-not-exist"]), "");
});

test("a block with no text contributes nothing rather than an empty paragraph", () => {
  const blocks: ScopeBlock[] = [{ id: "b1", text: "", pageNumber: 2 }, ...BLOCKS.slice(2)];
  const scoped = scopedBlockText(blocks, ["b1", "b3"]);
  assert.doesNotMatch(scoped, /\[page 2\]/);
  assert.match(scoped, /memorise noise/);
});

test("depth decides the beat count, and a document obeys it like a typed topic does", () => {
  /*
   * The regression: the topic path honoured depth while the document path took a flat 12 blocks, so
   * an uploaded PDF ran twelve sections however concise the student asked for. One function now
   * serves both, which is what stops them drifting apart again.
   */
  assert.equal(beatCountForDepth("concise"), 6);
  assert.equal(beatCountForDepth("balanced"), 8);
  assert.equal(beatCountForDepth("deep"), 10);
  // An unknown or missing depth is balanced, never the old 12.
  assert.equal(beatCountForDepth(undefined), 8);
  assert.equal(beatCountForDepth("something-else"), 8);
  assert.ok(beatCountForDepth("concise") < beatCountForDepth("deep"));
});

test("a lecture from a dragged area is scoped to that area, not the whole page", async () => {
  const { blocksForSelection } = await import("../beatSourceScope");
  // The BST notes: page 1 is Node + insert, page 2 is remove(); the student boxed remove's two-children case.
  const blocks = [
    { id: "p1-b1", pageNumber: 1, heading: "Insert", text: "void BST::insert(int d, Node*& p) { if (p == NULL) p = new Node(d); }" },
    { id: "p2-b1", pageNumber: 2, heading: "Deleting a node", text: "remove first searches for the node holding d, then handles three cases." },
    { id: "p2-b2", pageNumber: 2, heading: "Deleting a node", text: "Node* s = p->right; while (s->left != NULL) s = s->left; p->data = s->data; remove(s->data, p->right);" },
    { id: "p2-b3", pageNumber: 2, heading: "Complexity", text: "Every operation runs in O(h) time on the height of the tree." },
    { id: "ocr-p2-0", pageNumber: 2, heading: "Page 2 (selected area)", text: "Node* s = p->right; while (s->left != NULL) s = s->left; p->data = s->data;" },
  ];
  const ids = blocksForSelection(blocks, { pages: [2], transcript: "Node* s = p->right; while (s->left != NULL) s = s->left; p->data = s->data; remove(s->data, p->right);" });
  assert.ok(ids.includes("ocr-p2-0"), "the crop's own block leads");
  assert.ok(ids.includes("p2-b2"), "the page block that holds the same code");
  assert.ok(!ids.includes("p1-b1"), "another page is never pulled in");
  assert.ok(!ids.includes("p2-b3"), "an unrelated block on the same page is left out");
  // Nothing matches → the selected page, never the whole document.
  assert.deepEqual(blocksForSelection(blocks.slice(0, 4), { pages: [2], transcript: "zzzz qqqq" }), ["p2-b1", "p2-b2", "p2-b3"]);
});
