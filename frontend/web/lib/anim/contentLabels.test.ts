/**
 * A TREE'S NODE VALUES ARE WRITTEN, ITS CALLOUTS ARE NOT.
 *
 * The sandbox hides every "label" step; a node's value tagged "label" must survive that.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { keepContentLabels } from "../board/contentLabels";

const BOARD = `
<rect x="0" y="0" width="1000" height="560" fill="#fbfbf8" />
<rect x="220" y="312" width="130" height="44" rx="22" />
<circle cx="500" cy="475" r="28" />
<text x="285" y="341" textAnchor="middle" data-teach-order={4} data-teach-kind="label" data-teach-sentence={7}>5</text>
<text x="500" y="482" textAnchor="middle" data-teach-kind="label">root</text>
<text x={640} y={120} data-teach-kind="label">stray callout</text>
<text x="56" y="70" data-teach-kind="write">Binary Search Trees</text>`;

test("a value inside a node or cell is re-tagged write", () => {
  const out = keepContentLabels(BOARD);
  assert.match(out, /data-teach-kind="write" data-teach-sentence=\{7\}>5</);
  assert.match(out, /data-teach-kind="write">root</);
});

test("a label beside a part, and the full-board background, change nothing", () => {
  const out = keepContentLabels(BOARD);
  assert.match(out, /data-teach-kind="label">stray callout</, "the background rect is not a node");
  assert.equal(keepContentLabels(`<text x="10" y="10" data-teach-kind="label">a</text>`), `<text x="10" y="10" data-teach-kind="label">a</text>`);
});

test("a label placed by an expression is left as written", () => {
  const code = `<rect x="0" y="0" width="100" height="40" /><text x={cx} y={cy} data-teach-kind="label">v</text>`;
  assert.equal(keepContentLabels(code), code);
});
