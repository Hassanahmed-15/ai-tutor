/**
 * Connector geometry: lines that cross labels, and lines that connect nothing.
 *
 * The board that prompted these drew a leader stroke from a state node straight through the words
 * "state = position", and hung grey curves that joined nothing at all. Every check this project had
 * was blind to both: the deterministic one measured only `<text>` against `<text>`, and the two
 * vision critics judge subject recognizability and textbook internal structure.
 *
 * A false positive here costs a regeneration, so the assertions below pin the NEGATIVE cases as
 * hard as the positive ones — a leader line that correctly ends at its label, an arrowhead, and a
 * filled shape behind a caption must all pass untouched.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  connectorCrossingIssue,
  danglingConnectorIssue,
  parseAnchors,
  parseConnectors,
  pathOnCurvePoints,
  segmentCrossesBox,
  parseArrowheads,
  arrowheadOnLabelIssue,
  CONNECTOR_RULES,
  type Box,
} from "../boardConnectorGeometry";

/** The label from the reported board, positioned as it rendered. */
const LABEL: Box = { text: "state = position", x: 300, y: 370, w: 130, h: 22 };

/* ── a stroke through a label ────────────────────────────────────────────── */

test("a line drawn through a label is caught", () => {
  // The exact failure: a vertical leader from the node above, straight down through the words.
  const through = { x1: 365, y1: 300, x2: 365, y2: 430 };
  assert.equal(segmentCrossesBox(through, LABEL), true);
  assert.match(connectorCrossingIssue([through], [LABEL]) ?? "", /runs straight through the label/);
});

test("the complaint names the label and the coordinates", () => {
  // "labels are wrong" tells a model nothing; the retry needs to know what to move.
  const issue = connectorCrossingIssue([{ x1: 365, y1: 300, x2: 365, y2: 430 }], [LABEL]) ?? "";
  assert.match(issue, /state = position/);
  assert.match(issue, /365,300/);
  assert.match(issue, /Route the line around the text/);
});

test("a leader line that STOPS at its label is not a crossing", () => {
  /*
   * The false positive that would matter most. A leader line is supposed to touch the thing it
   * names — flagging that would reject correct boards and make the check worse than useless.
   */
  const stopsAtEdge = { x1: 365, y1: 300, x2: 365, y2: 372 };
  assert.equal(segmentCrossesBox(stopsAtEdge, LABEL), false);
  assert.equal(connectorCrossingIssue([stopsAtEdge], [LABEL]), null);
});

test("a line passing cleanly beside a label is left alone", () => {
  assert.equal(segmentCrossesBox({ x1: 200, y1: 300, x2: 200, y2: 430 }, LABEL), false);
  assert.equal(segmentCrossesBox({ x1: 300, y1: 300, x2: 430, y2: 300 }, LABEL), false);
});

/* ── what counts as a connector ──────────────────────────────────────────── */

test("lines, polylines and stroked paths are all read", () => {
  const svg = [
    '<line x1="10" y1="10" x2="200" y2="10"/>',
    '<polyline points="10,50 200,50 200,120"/>',
    '<path d="M 10 200 L 200 200" fill="none"/>',
  ].join("");
  assert.equal(parseConnectors(svg).length, 4, "1 line + 2 polyline segments + 1 path segment");
});

test("a FILLED path is artwork, not a connector", () => {
  /*
   * Arrowheads are filled triangles sitting exactly on their label, and solid drawing legitimately
   * sits behind a caption. Treating either as a stroke would flag every correctly pointed arrow.
   */
  assert.equal(parseConnectors('<path d="M 10 10 L 200 10 L 200 80 Z" fill="#333"/>').length, 0);
});

test("hairlines are not connectors", () => {
  // An underline under a heading is not an arrow and may sit against text.
  const short = `<line x1="10" y1="10" x2="${10 + CONNECTOR_RULES.MIN_SEGMENT_LENGTH - 2}" y2="10"/>`;
  assert.equal(parseConnectors(short).length, 0);
});

test("curve control points are never treated as geometry", () => {
  /*
   * A cubic's handles routinely sit far from the curve they bend. Using them as vertices would
   * invent a stroke the board never draws and reject a crossing that is not there.
   */
  const points = pathOnCurvePoints("M 0 0 C 500 500 500 -500 100 0");
  assert.deepEqual(points, [[0, 0], [100, 0]], "only the on-curve endpoints survive");
});

test("relative path commands accumulate", () => {
  assert.deepEqual(pathOnCurvePoints("M 10 10 l 40 0 l 0 40"), [[10, 10], [50, 10], [50, 50]]);
});

test("malformed path data degrades quietly", () => {
  // A parser throwing inside a critic would fail a lecture over its own bug.
  assert.deepEqual(pathOnCurvePoints(""), []);
  assert.deepEqual(pathOnCurvePoints("banana"), []);
  assert.equal(parseConnectors('<path d="M" fill="none"/>').length, 0);
});

/* ── connectors that connect nothing ─────────────────────────────────────── */

test("a stroke with an end in empty space is reported", () => {
  // The grey curves on the reported board: drawn, but making no claim about anything.
  const anchors = parseAnchors('<circle cx="100" cy="100" r="30"/>');
  const dangling = { x1: 100, y1: 100, x2: 600, y2: 420 };
  assert.match(danglingConnectorIssue([dangling], [], anchors) ?? "", /ends in empty space at 600,420/);
});

test("a stroke joining two nodes is fine", () => {
  const anchors = parseAnchors('<circle cx="100" cy="100" r="30"/><circle cx="400" cy="100" r="30"/>');
  assert.equal(danglingConnectorIssue([{ x1: 128, y1: 100, x2: 372, y2: 100 }], [], anchors), null);
});

test("a stroke joining a node to its label is fine", () => {
  // Node to caption is the most common legitimate connector on any diagram.
  const anchors = parseAnchors('<circle cx="365" cy="280" r="28"/>');
  assert.equal(danglingConnectorIssue([{ x1: 365, y1: 306, x2: 365, y2: 366 }], [LABEL], anchors), null);
});

test("a rect counts as something to attach to", () => {
  const anchors = parseAnchors('<rect x="80" y="80" width="60" height="40"/>');
  assert.equal(anchors.length, 1);
  assert.equal(danglingConnectorIssue([{ x1: 110, y1: 100, x2: 160, y2: 100 }], [], anchors), null);
});

test("a board with nothing to attach to accuses no one", () => {
  // With no labels and no shapes, "unattached" is not a judgement that can fairly be made.
  assert.equal(danglingConnectorIssue([{ x1: 0, y1: 0, x2: 300, y2: 300 }], [], []), null);
});

test("the dangling complaint says what an arrow is for", () => {
  const anchors = parseAnchors('<circle cx="100" cy="100" r="30"/>');
  const issue = danglingConnectorIssue([{ x1: 100, y1: 100, x2: 600, y2: 420 }], [], anchors) ?? "";
  assert.match(issue, /must join two named things/);
  assert.match(issue, /direction must state the relation/);
});

/* ── the arrowhead, which is filled and so escapes the stroke checks ─────── */

test("an arrowhead printed on a label is caught", () => {
  /*
   * The defect a screenshot found AFTER the stroke checks were in place: the line stopped short of
   * "next state" while its solid head sat on the words. Filled paths are skipped as artwork, so
   * every line-based check passed a board whose arrow was plainly obscuring its own target.
   */
  const svg = '<polygon points="360,376 380,382 360,388" fill="#111"/>';
  const heads = parseArrowheads(svg);
  assert.equal(heads.length, 1, "the arrowhead was not found at all");
  assert.match(arrowheadOnLabelIssue(heads, [LABEL]) ?? "", /arrowhead is printed on top of the label/);
});

test("an arrowhead clear of the text is fine", () => {
  const heads = parseArrowheads('<polygon points="120,120 140,126 120,132" fill="#111"/>');
  assert.equal(arrowheadOnLabelIssue(heads, [LABEL]), null);
});

test("a large filled shape is artwork, not an arrowhead", () => {
  // A filled organ or leaf must never be mistaken for an arrowhead, or the filled-path exemption
  // stops doing the job it exists for.
  const big = '<polygon points="300,370 500,370 500,470 300,470" fill="#0a0"/>';
  assert.equal(parseArrowheads(big).length, 0);
});

test("arrowhead detection survives a stray id attribute", () => {
  /*
   * A word boundary here is load-bearing: `/d\s*=/` without one matches the `d` inside `id="..."`
   * and reads the identifier as path geometry. This caught exactly that, after the boundaries were
   * silently stripped to backspace characters and the whole function quietly matched nothing.
   */
  const svg = '<path id="head1" d="M 360 376 L 380 382 L 360 388 Z" fill="#111"/>';
  const heads = parseArrowheads(svg);
  assert.equal(heads.length, 1);
  assert.ok(Math.abs(heads[0].x - 370) < 12, `head x was ${heads[0].x}`);
});
