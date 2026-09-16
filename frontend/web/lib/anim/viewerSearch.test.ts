/**
 * Finding text across a PDF page's positioned runs.
 *
 * pdf.js hands back text as a sequence of RUNS with their own transform/width, not one string — a
 * search has to walk them as if they were continuous prose (the way a reading eye sees the page)
 * while still being able to translate a hit back into a rect on a specific run. Every test here is
 * a shape that trips up the naive "search each run separately" approach: a word split across two
 * runs, a query that only exists once the runs are joined, multiple hits on one page.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { searchPage, type TextItem } from "../viewerSearch";

/** A minimal text run: given a string, a width, and where it sits (origin bottom-left, PDF's own
 *  convention — matched exactly by the real pdf.js output this type stands in for). */
function run(str: string, x: number, y: number, width = str.length * 6, height = 10, hasEOL = false): TextItem {
  return { str, transform: [1, 0, 0, 1, x, y], width, height, hasEOL };
}

test("finds a query wholly contained in one run", () => {
  const items = [run("The quick brown fox", 0, 100)];
  const matches = searchPage(items, 1, "quick");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].pageNumber, 1);
});

test("search is case-insensitive", () => {
  const items = [run("Photosynthesis converts light energy", 0, 100)];
  assert.equal(searchPage(items, 1, "PHOTOSYNTHESIS").length, 1);
  assert.equal(searchPage(items, 1, "PhotoSynthesis").length, 1);
});

test("a word split across two runs (kerning, a font change mid-word) is still found", () => {
  // pdf.js commonly emits "gradi" + "ent" as two runs for one word when a font or kerning
  // adjustment falls mid-word — the exact case a naive per-run search misses entirely.
  const items = [run("The gradi", 0, 100), run("ent descends", 60, 100)];
  const matches = searchPage(items, 1, "gradient");
  assert.equal(matches.length, 1, "a match straddling a run boundary must still be found");
});

test("a query that only exists once runs are joined is found, and never inside one run alone", () => {
  const items = [run("back", 0, 100), run("prop", 30, 100), run("agation", 60, 100)];
  assert.equal(searchPage(items, 1, "backpropagation").length, 1);
  // And a substring that happens to span exactly two of the three runs is found too — the joined
  // string is what is searched, not any single run's own text.
  assert.equal(searchPage(items, 1, "propagation").length, 1);
});

test("multiple matches on one page are all found, each with its own rect", () => {
  const items = [run("cat sat on the cat mat with the cat", 0, 100)];
  const matches = searchPage(items, 1, "cat");
  assert.equal(matches.length, 3);
  // Each occurrence gets a distinct index within the page, in the order found.
  assert.deepEqual(matches.map((m) => m.indexOnPage), [0, 1, 2]);
});

test("hasEOL inserts a real word boundary — text across a line break does not glue into one word", () => {
  const items = [run("end of line", 0, 100, undefined, undefined, true), run("newstart", 0, 88)];
  // "linenewstart" must NOT be found — that string only exists if the EOL boundary is ignored.
  assert.equal(searchPage(items, 1, "linenewstart").length, 0);
  // But each side of the boundary is still findable on its own.
  assert.equal(searchPage(items, 1, "line").length, 1);
  assert.equal(searchPage(items, 1, "newstart").length, 1);
});

test("no match returns an empty array, not an error", () => {
  const items = [run("The quick brown fox", 0, 100)];
  assert.deepEqual(searchPage(items, 1, "elephant"), []);
});

test("an empty or whitespace-only query matches nothing", () => {
  const items = [run("Some real text here", 0, 100)];
  assert.deepEqual(searchPage(items, 1, ""), []);
  assert.deepEqual(searchPage(items, 1, "   "), []);
});

test("a match's rect lands on the run it starts in, scaled to the query's own width", () => {
  // 6px/char in this fixture's `run()` helper — a 3-letter match inside a longer run should report
  // roughly 3 characters of width, not the whole run's width.
  const items = [run("introduction", 10, 50)];
  const matches = searchPage(items, 1, "duct");
  assert.equal(matches.length, 1);
  const { rect } = matches[0];
  assert.ok(rect.width > 0 && rect.width < 12 * 6, "match rect should be narrower than the whole run");
  assert.equal(rect.height, 10);
});

test("an empty page (no text runs) produces no matches, not a crash", () => {
  assert.deepEqual(searchPage([], 1, "anything"), []);
});
