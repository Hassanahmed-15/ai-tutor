/**
 * The board host's layout core, tested as the iframe runs it.
 *
 * SANDBOX_LAYOUT_CORE is ES5 source text injected into the sandboxed board document (see
 * lib/anim/sandboxLayout.ts for why it cannot be a module there). These tests evaluate that exact
 * text, so what passes here is what places the student's labels — there is no TypeScript twin to
 * drift from it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SANDBOX_LAYOUT_CORE, SANDBOX_LAYOUT_HOST } from "./sandboxLayout";
import { AUTHORED_HEIGHT, AUTHORED_WIDTH, authoredRectIn, contentBox, pointInRect, toBoardSpaceThrough } from "../board/geometry";

type Box = { x: number; y: number; width: number; height: number };
type WordBox = { x0: number; x1: number; line: number };
type Step = { order: number; sentence: number; kind: string; parent: number; head: number };

interface Core {
  fitViewBox(content: Box | null, container: { width: number; height: number }, authored: { width: number; height: number }, options?: object): Box | null;
  writingPosition(words: string[], local: number): { index: number; fraction: number; count: number };
  writingEdge(boxes: WordBox[], position: { index: number; fraction: number }, settle: string | null): { line: number; x: number; done: boolean } | null;
  bestLineBreak(widths: number[], space: number): number;
  separateVertically(boxes: Box[], options?: object): number[];
  resolveTeachingSchedule(steps: Step[]): Array<{ sentence: number; key: number }>;
  boxDistance(x: number, y: number, box: Box): number;
  visiblePart(box: Box, authored: Box): Box | null;
  strokeExit(p: { x: number; y: number }, q: { x: number; y: number }, box: Box, gap: number, touch?: number): { x: number; y: number } | null;
  shrinkToClear(box: Box, anchor: string, p: { x: number; y: number }, gap: number, minScale: number): number | null;
  containerFitScale(box: Box, anchor: string, rect: Box, pad: number, minScale: number): number | null;
  rowClearScales(a: Box, anchorA: string, b: Box, anchorB: string, minGap: number, minScale: number): { a: number; b: number } | null;
}

const core = new Function(
  `${SANDBOX_LAYOUT_CORE}\nreturn { fitViewBox, writingPosition, writingEdge, bestLineBreak, separateVertically, resolveTeachingSchedule, boxDistance, visiblePart, strokeExit, shrinkToClear, containerFitScale, rowClearScales };`,
)() as Core;

const AUTHORED = { width: 1000, height: 560 };

test("the injected source is plain script: no template breaks, no module syntax", () => {
  for (const source of [SANDBOX_LAYOUT_CORE, SANDBOX_LAYOUT_HOST]) {
    assert.ok(!source.includes("`"), "a backtick would end the String.raw template early");
    assert.ok(!/\b(import|export)\s/.test(source), "no module syntax inside a classic <script>");
    assert.ok(!source.includes("</script"), "would close the sandbox's inline script");
  }
  // The host half must at least parse as a function body alongside the core.
  assert.doesNotThrow(() => new Function(`${SANDBOX_LAYOUT_CORE}\n${SANDBOX_LAYOUT_HOST}`));
});

/* ── Fitting the board to its pane ─────────────────────────────────────────── */

test("THE PDF COLUMN: a 16:9 drawing fills a near-square pane instead of letterboxing into it", () => {
  // The measured case: the split view gives the board ~772x690; the ink spans most of the frame.
  const ink = { x: 60, y: 38, width: 880, height: 470 };
  const pane = { width: 772, height: 690 };
  const fitted = core.fitViewBox(ink, pane, AUTHORED)!;
  assert.ok(Math.abs(fitted.width / fitted.height - pane.width / pane.height) < 1e-9, "viewBox has the pane's aspect");
  assert.ok(fitted.x <= ink.x && fitted.x + fitted.width >= ink.x + ink.width, "all ink stays inside horizontally");
  assert.ok(fitted.y <= ink.y && fitted.y + fitted.height >= ink.y + ink.height, "all ink stays inside vertically");
  // The drawing is now larger on screen than the old letterbox of the whole 1000x560 frame.
  const oldScale = Math.min(pane.width / AUTHORED.width, pane.height / AUTHORED.height);
  const newScale = pane.width / fitted.width;
  assert.ok(newScale > oldScale * 1.05, `drawn bigger than before (${newScale.toFixed(3)} vs ${oldScale.toFixed(3)})`);
  // Centred on the ink.
  assert.ok(Math.abs(fitted.x + fitted.width / 2 - (ink.x + ink.width / 2)) < 1e-6);
  assert.ok(Math.abs(fitted.y + fitted.height / 2 - (ink.y + ink.height / 2)) < 1e-6);
});

test("ink never touches the pane edge: there is always a margin", () => {
  const ink = { x: 100, y: 100, width: 800, height: 400 };
  const fitted = core.fitViewBox(ink, { width: 1600, height: 800 }, AUTHORED)!;
  assert.ok(ink.x - fitted.x >= 14 && fitted.x + fitted.width - (ink.x + ink.width) >= 14);
  assert.ok(ink.y - fitted.y >= 14 && fitted.y + fitted.height - (ink.y + ink.height) >= 14);
});

test("a board that drew one small thing is not blown up past the zoom ceiling", () => {
  const ink = { x: 450, y: 250, width: 100, height: 60 };
  const pane = { width: 1100, height: 620 };
  const fitted = core.fitViewBox(ink, pane, AUTHORED)!;
  const authoredScale = Math.min(pane.width / AUTHORED.width, pane.height / AUTHORED.height);
  assert.ok(pane.width / fitted.width <= authoredScale * 1.4 + 1e-9, "at most 1.4x the whole-frame scale");
  assert.ok(Math.abs(fitted.width / fitted.height - pane.width / pane.height) < 1e-9);
});

test("nothing measured, or a zero-sized pane, leaves the board as authored", () => {
  assert.equal(core.fitViewBox(null, { width: 800, height: 600 }, AUTHORED), null);
  assert.equal(core.fitViewBox({ x: 0, y: 0, width: 0, height: 10 }, { width: 800, height: 600 }, AUTHORED), null);
  assert.equal(core.fitViewBox({ x: 0, y: 0, width: 100, height: 100 }, { width: 0, height: 600 }, AUTHORED), null);
});

test("ONE MALFORMED SHAPE CANNOT SHRINK THE BOARD: ink is measured only where it can be seen", () => {
  // Measured on a real cached board: points="315,231 303,224 303,2317" ("231" + 7 as a string)
  // reported a 2,000-unit-tall arrowhead, the fitted viewBox grew to 75,000 x 42,000 and the whole
  // board became a speck in the middle of its pane.
  const frame = { x: 0, y: 0, width: 1000, height: 560 };
  const runaway = core.visiblePart({ x: 303, y: 224, width: 12, height: 2093 }, frame)!;
  assert.ok(runaway.y + runaway.height <= 560 * 1.04 + 1e-9, "cut at the frame's bleed");
  const fitted = core.fitViewBox(runaway, { width: 1100, height: 620 }, AUTHORED)!;
  assert.ok(fitted.height < 700, `the fit stays board-sized (${fitted.height.toFixed(0)})`);
  // Ink inside the frame is untouched; a horizontal line (zero height) is still ink.
  assert.deepEqual(core.visiblePart({ x: 100, y: 100, width: 50, height: 20 }, frame), { x: 100, y: 100, width: 50, height: 20 });
  assert.deepEqual(core.visiblePart({ x: 100, y: 300, width: 200, height: 0 }, frame), { x: 100, y: 300, width: 200, height: 0 });
  // Wholly outside: not ink at all.
  assert.equal(core.visiblePart({ x: 1400, y: 100, width: 50, height: 50 }, frame), null);
});

/* ── Words clear of the strokes that meet them ──────────────────────────────── */

test("A LABEL PRINTED THROUGH ITS OWN LEADER: the leader is trimmed back to just outside the words", () => {
  // Measured on a cached palisade-cell board: "surface membrane" at x=35 ran to x=185 in the
  // embedded font, and its leader started at x=172 — inside the words.
  const label = { x: 35, y: 474, width: 150, height: 24 };
  const exit = core.strokeExit({ x: 172, y: 488 }, { x: 265, y: 488 }, label, 6)!;
  assert.equal(exit.x, 191, "starts 6 beyond the last letter");
  assert.equal(exit.y, 488, "and stays level: the leader keeps its direction");
  // A sloped leader keeps its slope.
  const sloped = core.strokeExit({ x: 170, y: 480 }, { x: 370, y: 580 }, label, 6)!;
  assert.ok(Math.abs((sloped.y - 480) / (sloped.x - 170) - 0.5) < 1e-9);
});

test("a stroke that only passes near the words, or would be eaten whole, is left alone", () => {
  const label = { x: 100, y: 100, width: 120, height: 24 };
  assert.equal(core.strokeExit({ x: 90, y: 110 }, { x: 10, y: 110 }, label, 6), null, "end outside the box");
  assert.equal(core.strokeExit({ x: 110, y: 110 }, { x: 240, y: 110 }, label, 6), null, "clearing would remove most of it");
  // An end 8 px clear — the contract's spacing — is not touched even with a touch margin.
  assert.equal(core.strokeExit({ x: 228, y: 110 }, { x: 400, y: 110 }, label, 8, 5), null);
});

test("an arrow that ends up TOUCHING its words (a wider face ate the planned gap) is pulled clear", () => {
  // Cached starch board: text x 76..352 in the embedded face, arrow tail at 356 (planned gap 24).
  const words = { x: 76, y: 173, width: 276, height: 28 };
  assert.equal(core.strokeExit({ x: 356, y: 188 }, { x: 428, y: 207 }, words, 8), null, "without a touch margin it is 'outside'");
  const exit = core.strokeExit({ x: 356, y: 188 }, { x: 428, y: 207 }, words, 8, 5)!;
  assert.ok(Math.abs(exit.x - 360) < 1e-9, "moved to 8 beyond the last letter");
});

test("an arrow curving out of its words shrinks the words from their free edge, within a floor", () => {
  const words = { x: 45, y: 190, width: 290, height: 28 };
  // Anchored at the start: an end near the right edge is cleared by a small shrink.
  const scale = core.shrinkToClear(words, "start", { x: 320, y: 205 }, 6, 0.86)!;
  assert.ok(Math.abs(words.x + words.width * scale - (320 - 6)) < 1e-9);
  // An end near the anchored edge, or deep in the words, cannot be cleared this way.
  assert.equal(core.shrinkToClear(words, "start", { x: 60, y: 205 }, 6, 0.86), null);
  assert.equal(core.shrinkToClear(words, "start", { x: 200, y: 205 }, 6, 0.86), null);
  assert.equal(core.shrinkToClear(words, "end", { x: 60, y: 205 }, 6, 0.86)! < 1, true);
});

test("WORDS OVERRUNNING THEIR BOX: a step name is brought back inside its pill from its anchor", () => {
  // Cached board: "Structured" at x=644 in a pill x 626..738, ~99 wide at 18px in the embedded face.
  const pill = { x: 626, y: 126, width: 112, height: 62 };
  const words = { x: 644, y: 137, width: 99, height: 22 };
  const scale = core.containerFitScale(words, "start", pill, 4.5, 0.8)!;
  assert.ok(Math.abs(words.x + words.width * scale - (738 - 4.5)) < 1e-9, "ends at the pill's inner edge");
  // Centred words shrink about their centre, to the nearer inner edge.
  const centred = core.containerFitScale({ x: 600, y: 137, width: 160, height: 22 }, "middle", { x: 610, y: 126, width: 150, height: 62 }, 4, 0.8)!;
  assert.ok(Math.abs(160 * centred - 2 * Math.min(680 - 614, 756 - 680)) < 1e-9);
  // Already inside: nothing to do. Far too big for the box: it is not really their box.
  assert.equal(core.containerFitScale({ x: 640, y: 137, width: 80, height: 22 }, "start", pill, 4.5, 0.8), null);
  assert.equal(core.containerFitScale({ x: 640, y: 137, width: 300, height: 22 }, "start", pill, 4.5, 0.8), null);
});

test('TWO LABELS RUN TOGETHER ("minoritymajority"): they give way from their free edges', () => {
  // Cached board: "minority" at 143 (~79 wide) and "majority" at 218, both start-anchored, 18px.
  const a = { x: 143, y: 380, width: 79, height: 22 };
  const b = { x: 218, y: 380, width: 77, height: 22 };
  const scales = core.rowClearScales(a, "start", b, "start", 2.7, 0.86)!;
  assert.equal(scales.b, 1, "a start-anchored right label cannot give way leftward");
  assert.ok(Math.abs(b.x - (a.x + a.width * scales.a) - 2.7) < 1e-9, "the left one ends 0.15em short of the right one");
  // End-anchored on the right: both give way, together.
  const both = core.rowClearScales(a, "start", { x: 218, y: 380, width: 77, height: 22 }, "end", 2.7, 0.86)!;
  assert.ok(both.a < 1 && both.b < 1);
  // Clear already, or too entangled to fix by shrinking.
  assert.equal(core.rowClearScales({ ...a, width: 60 }, "start", b, "start", 2.7, 0.86), null);
  assert.equal(core.rowClearScales({ ...a, width: 140 }, "start", b, "start", 2.7, 0.86), null);
});

/* ── Handwriting on real word boundaries ───────────────────────────────────── */

const WORDS = ["chloroplast", "containing", "chlorophyll"];
// Measured-looking extents: one line, ~0.53em per character at 20px, a space between words.
const BOXES: WordBox[] = [
  { x0: 710, x1: 827, line: 0 },
  { x0: 832, x1: 938, line: 0 },
  { x0: 710, x1: 827, line: 1 },
];

test("the hand moves forward through the words and ends on the last one, finished", () => {
  let previous = -1;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const p = core.writingPosition(WORDS, t);
    const along = p.index + p.fraction;
    assert.ok(along >= previous - 1e-9, `never moves backwards (t=${t.toFixed(2)})`);
    previous = along;
  }
  const end = core.writingPosition(WORDS, 1);
  assert.equal(end.index, 2);
  assert.equal(end.fraction, 1);
  const start = core.writingPosition(WORDS, 0);
  assert.deepEqual([start.index, start.fraction], [0, 0]);
});

test('THE "chlo" BUG: a paused hand finishes its word instead of freezing mid-word', () => {
  const midFirstWord = core.writingPosition(WORDS, 0.12);
  assert.equal(midFirstWord.index, 0);
  assert.ok(midFirstWord.fraction > 0 && midFirstWord.fraction < 1, "genuinely mid-word");
  const moving = core.writingEdge(BOXES, midFirstWord, null)!;
  assert.ok(moving.x > BOXES[0].x0 && moving.x < BOXES[0].x1, "while moving, the ink edge is inside the word");
  const settled = core.writingEdge(BOXES, midFirstWord, "word")!;
  assert.equal(settled.x, BOXES[0].x1, "settled: the whole word is written");
  assert.equal(settled.line, 0);
});

test("an explicit settle finishes the whole line; a wrapped label's second line is its own", () => {
  const position = { index: 0, fraction: 0.3 };
  const line = core.writingEdge(BOXES, position, "line")!;
  assert.equal(line.x, BOXES[1].x1, "finishes through the last word on line one");
  assert.equal(line.line, 0);
  const onSecond = core.writingEdge(BOXES, { index: 2, fraction: 0.5 }, "line")!;
  assert.equal(onSecond.line, 1);
  assert.equal(onSecond.x, BOXES[2].x1);
  assert.equal(onSecond.done, true, "the last word finished means the label is done");
});

test("a word not yet started is not settled into view", () => {
  const edge = core.writingEdge(BOXES, { index: 1, fraction: 0 }, "word")!;
  assert.equal(edge.x, BOXES[1].x0, "the next word stays unwritten");
});

/* ── Wrapping a label instead of truncating it ─────────────────────────────── */

test("a long source label wraps at the word boundary that makes the two lines most even", () => {
  // chloroplast | containing | chlorophyll at ~10.6 px per character
  const k = core.bestLineBreak([117, 106, 117], 5);
  const lines = [WORDS.slice(0, k).join(" "), WORDS.slice(k).join(" ")];
  assert.equal(k, 2);
  assert.deepEqual(lines, ["chloroplast containing", "chlorophyll"]);
  // Five words: whatever break it picks, no other break makes the longer line shorter.
  const widths = [117, 106, 117, 60, 60];
  const longest = (k: number) => {
    const first = widths.slice(0, k).reduce((a, b) => a + b, 0) + 5 * (k - 1);
    const second = widths.slice(k).reduce((a, b) => a + b, 0) + 5 * (widths.length - k - 1);
    return Math.max(first, second);
  };
  const chosen = core.bestLineBreak(widths, 5);
  for (let k = 1; k < widths.length; k++) assert.ok(longest(chosen) <= longest(k) + 1e-9, `break ${chosen} vs ${k}`);
});

test("one word cannot wrap", () => {
  assert.equal(core.bestLineBreak([200], 5), -1);
  assert.equal(core.bestLineBreak([], 5), -1);
});

/* ── The heading band and colliding labels ─────────────────────────────────── */

test("THE TITLE STACK: a subtitle placed through its title's descenders is pushed clear", () => {
  // 32px title at baseline 70 (box 41..80), subtitle 20px placed by guesswork at baseline 92.
  const title = { x: 56, y: 41.2, width: 390, height: 38.7 };
  const subtitle = { x: 56, y: 74, width: 480, height: 24.2 };
  const dy = core.separateVertically([title, subtitle], { gap: 1, allowLift: true, minTop: 10 });
  const titleBottom = title.y + dy[0] + title.height;
  const subtitleTop = subtitle.y + dy[1];
  assert.ok(subtitleTop >= titleBottom + 1 - 1e-9, "the two boxes no longer overlap");
  assert.ok(dy[0] <= 0, "the title rises into the room above it rather than the subtitle sinking alone");
  assert.ok(title.y + dy[0] >= 10 - 1e-9, "but never above the band's top");
});

test("labels side by side are left alone; only true collisions move, downward", () => {
  const left = { x: 56, y: 300, width: 200, height: 24 };
  const right = { x: 710, y: 300, width: 200, height: 24 };
  assert.deepEqual(core.separateVertically([left, right], { gap: 0 }), [0, 0]);
  const upper = { x: 710, y: 300, width: 200, height: 24 };
  const lower = { x: 720, y: 310, width: 150, height: 24 };
  const dy = core.separateVertically([lower, upper], { gap: 0 });
  assert.equal(dy[1], 0, "the upper label stays put");
  assert.ok(lower.y + dy[0] >= upper.y + upper.height - 1e-9, "the lower one moves below it");
});

test("a push that would run off the bottom is given back", () => {
  const upper = { x: 710, y: 480, width: 200, height: 24 };
  const lower = { x: 710, y: 490, width: 200, height: 24 };
  const dy = core.separateVertically([upper, lower], { gap: 0, maxBottom: 520 });
  assert.ok(lower.y + dy[1] + lower.height <= 520 + 1e-9);
});

/* ── When each step really happens ─────────────────────────────────────────── */

const rank = (eff: Array<{ sentence: number; key: number }>) =>
  eff.map((e, i) => ({ ...e, i })).sort((a, b) => a.sentence - b.sentence || a.key - b.key || a.i - b.i).map((e) => e.i);

test("THE LEADER THAT CAME EARLY: a label group rides with the text it contains", () => {
  // Measured on a real board: <g label sentence=3> leader + dot + <text sentence=6/> </g>.
  const steps: Step[] = [
    { order: 14, sentence: 6, kind: "diagram", parent: -1, head: -1 }, // the iodine stain
    { order: 15, sentence: 3, kind: "label", parent: -1, head: -1 }, // the leader group
    { order: 16, sentence: 6, kind: "label", parent: 1, head: -1 }, // "Iodine drop"
  ];
  const eff = core.resolveTeachingSchedule(steps);
  assert.equal(eff[1].sentence, 6, "the leader waits for its words");
  assert.ok(eff[1].key < eff[2].key, "and draws just before them");
  assert.ok(eff[0].key < eff[1].key, "after the part it points at");
});

test("nothing is scheduled before the group it sits in", () => {
  const steps: Step[] = [
    { order: 5, sentence: 2, kind: "diagram", parent: -1, head: -1 },
    { order: 2, sentence: 1, kind: "write", parent: 0, head: -1 },
  ];
  const eff = core.resolveTeachingSchedule(steps);
  assert.deepEqual(rank(eff), [0, 1]);
  assert.equal(eff[1].sentence, 2);
});

test("THE ARROW INTO BLANK PAPER: an arrow waits until what it points at is on the board", () => {
  const steps: Step[] = [
    { order: 1, sentence: 0, kind: "write", parent: -1, head: -1 },
    { order: 2, sentence: 1, kind: "arrow", parent: -1, head: 2 }, // points at the leaf...
    { order: 7, sentence: 3, kind: "diagram", parent: -1, head: -1 }, // ...drawn two sentences later
  ];
  const eff = core.resolveTeachingSchedule(steps);
  assert.equal(eff[1].sentence, 3);
  assert.deepEqual(rank(eff), [0, 2, 1], "leaf first, then the arrow into it");
});

test("an arrow whose target is already drawn keeps its own time", () => {
  const steps: Step[] = [
    { order: 1, sentence: 0, kind: "diagram", parent: -1, head: -1 },
    { order: 4, sentence: 2, kind: "arrow", parent: -1, head: 0 },
  ];
  const eff = core.resolveTeachingSchedule(steps);
  assert.deepEqual(eff[1], { sentence: 2, key: 4 });
});

test("an arrow group's own label moves with the held arrow", () => {
  const steps: Step[] = [
    { order: 2, sentence: 1, kind: "arrow", parent: -1, head: 2 },
    { order: 3, sentence: 1, kind: "label", parent: 0, head: -1 },
    { order: 9, sentence: 4, kind: "diagram", parent: -1, head: -1 },
  ];
  const eff = core.resolveTeachingSchedule(steps);
  assert.deepEqual(rank(eff), [2, 0, 1]);
});

/* ── Marks stay on the drawing when the board is fitted ────────────────────── */

test("the authored frame's on-screen rectangle follows the live viewBox", () => {
  // Unfitted, authored viewBox in a pane of the same aspect: the frame IS the pane.
  const same = authoredRectIn({ x: 0, y: 0, width: 1000, height: 560 }, { x: 0, y: 0, width: 1000, height: 560 });
  assert.deepEqual(same, { x: 0, y: 0, width: 1000, height: 560 });
  // Unfitted in a tall pane: exactly the old letterbox (contentBox).
  const letterbox = authoredRectIn({ x: 0, y: 0, width: 1000, height: 560 }, { x: 0, y: 0, width: 772, height: 690 });
  const old = contentBox(772, 690);
  for (const k of ["x", "y", "width", "height"] as const) assert.ok(Math.abs(letterbox[k] - old[k]) < 1e-9, k);
  // Fitted: viewBox 100,-50 800x700 into an 800x700 pane — the frame is offset and unscaled.
  const fitted = authoredRectIn({ x: 100, y: -50, width: 800, height: 700 }, { x: 0, y: 0, width: 800, height: 700 });
  assert.deepEqual(fitted, { x: -100, y: 50, width: AUTHORED_WIDTH, height: AUTHORED_HEIGHT });
});

test("a mark maps to the same authored point before and after the pane changes shape", () => {
  const authoredPoint = { x: 612, y: 244 }; // a label's dot, in authored units
  const board = { x: authoredPoint.x / AUTHORED_WIDTH, y: authoredPoint.y / AUTHORED_HEIGHT };
  for (const [viewBox, pane] of [
    [{ x: 29, y: -93, width: 816, height: 726 }, { x: 12, y: 44, width: 772, height: 690 }],
    [{ x: -24, y: 14, width: 923, height: 512 }, { x: 0, y: 0, width: 1076, height: 596 }],
  ] as const) {
    const frame = authoredRectIn(viewBox, pane);
    const px = { x: frame.x + board.x * frame.width, y: frame.y + board.y * frame.height };
    // The same pixel, read back through the frame, is the same board point.
    const back = toBoardSpaceThrough(px.x, px.y, frame);
    assert.ok(Math.abs(back.x - board.x) < 1e-9 && Math.abs(back.y - board.y) < 1e-9);
    // And that pixel is where the viewBox actually draws the authored point.
    const scale = Math.min(pane.width / viewBox.width, pane.height / viewBox.height);
    const drawnX = pane.x + (pane.width - viewBox.width * scale) / 2 + (authoredPoint.x - viewBox.x) * scale;
    const drawnY = pane.y + (pane.height - viewBox.height * scale) / 2 + (authoredPoint.y - viewBox.y) * scale;
    assert.ok(Math.abs(drawnX - px.x) < 1e-6 && Math.abs(drawnY - px.y) < 1e-6);
  }
});

test("a mark is on the board when it is inside the visible pane", () => {
  const pane = { x: 10, y: 10, width: 100, height: 50 };
  assert.equal(pointInRect(50, 30, pane), true);
  assert.equal(pointInRect(5, 30, pane), false);
  assert.equal(pointInRect(50, 61, pane), false);
});
