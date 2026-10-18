import test from "node:test";
import assert from "node:assert/strict";
import { cardSideView, fitText, restSpot, textRows, underlineY } from "../canvas/renderFit";
import { textWidth } from "../canvas/layout";
import { fitView } from "../canvas/camera";

/* ── fitText: smaller first, then a second line, never a cut ─────────────────────────────── */

test("text that fits stays one line at its size", () => {
  assert.deepEqual(fitText("Energy", 300, 21, 15), { lines: ["Energy"], size: 21 });
});

test("text a little too wide is set smaller, on one line", () => {
  const text = "Kinetic energy of the falling ball";
  const room = textWidth(text, 21) * 0.9;
  const fit = fitText(text, room, 21, 15);
  assert.equal(fit.lines.length, 1);
  assert.ok(fit.size < 21 && fit.size >= 15);
  assert.ok(textWidth(fit.lines[0], fit.size) <= room);
});

test("text far too wide goes onto two lines, and keeps every word", () => {
  const text = "The gravitational potential energy of a 2 kg mass is −18 J measured from infinity";
  const fit = fitText(text, 330, 21, 16);
  assert.equal(fit.lines.length, 2);
  assert.equal(fit.lines.join(" "), text);
  for (const line of fit.lines) assert.ok(textWidth(line, fit.size) <= 330);
});

test("text that cannot fit even on two lines keeps all its words at the floor", () => {
  const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen";
  const fit = fitText(text, 120, 17, 13);
  assert.equal(fit.size, 13);
  assert.equal(fit.lines.join(" "), text, "no word dropped, no ellipsis");
  assert.ok(!fit.lines.join(" ").includes("…"));
});

test("a column title keeps its rule: one line down to 17 px, then two lines from 17 px", () => {
  const title = "Makkah's protected sanctuary and its pilgrims";
  const room = textWidth(title, 17) * 0.8;
  const fit = fitText(title, room, 23, 13, 2, 17, 17);
  assert.equal(fit.lines.length, 2);
  assert.equal(fit.size, 17);
});

/* ── underline rows ──────────────────────────────────────────────────────────────────────── */

test("a two-line card gets two underlines, each below its own line's glyphs", () => {
  // Two tspans of a note at 21 px, 27 px apart; the card's box is padded to 90 px tall.
  const rows = textRows([
    { x: 60, y: 140, w: 220, h: 28.5, under: underlineY(161, 21) },
    { x: 60, y: 167, w: 180, h: 28.5, under: underlineY(188, 21) },
  ]);
  assert.equal(rows.length, 2, "two lines, not round(90 / 30) = 3");
  for (const [i, baseline] of [161, 188].entries()) {
    const y = rows[i].under;
    assert.ok(y > baseline + 21 * 0.22, "below the descenders");
    assert.ok(y < baseline + 21 * 1.28 - 21 * 0.75, "above the next line's ascenders");
  }
  assert.equal(rows[1].x1, 240, "as long as its own line");
});

test("runs of one line (a title and its coloured parts) are one row", () => {
  const rows = textRows([
    { x: 10, y: 100, w: 50, h: 20 },
    { x: 64, y: 101, w: 40, h: 19 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].x0, 10);
  assert.equal(rows[0].x1, 104);
  assert.ok(rows[0].under >= 120, "a box without a baseline is underlined below it");
});

/* ── the camera beside a task card ───────────────────────────────────────────────────────── */

test("with a card open the board fills the space left of the card's column", () => {
  const board = { x: 0, y: 0, w: 1000, h: 560 };
  const box = { w: 1280, h: 720 };
  const view = cardSideView(board, box, 348)!;
  assert.ok(view);
  const px = box.w / view.w;
  const boardPx = board.w * px;
  const old = fitView({ x: 0, y: 0, w: 1520, h: 560 }, box.w / box.h, 0.035);
  assert.ok(boardPx > (board.w * box.w) / old.w * 1.1, "at least 10% larger than the old framing");
  assert.ok((board.x - view.x) * px >= 0, "the board's left edge on screen");
  assert.ok((board.x + board.w - view.x) * px <= box.w - 348 + 0.5, "the board's right edge left of the card");
  assert.ok((board.y - view.y) * px >= -0.5 && (board.y + board.h - view.y) * px <= box.h + 0.5, "the board whole, top to bottom");
  assert.ok(Math.abs(view.w / view.h - box.w / box.h) < 1e-6, "the view keeps the screen's aspect");
});

test("on a phone-width canvas the old framing stays (the card covers the board anyway)", () => {
  assert.equal(cardSideView({ x: 0, y: 0, w: 1000, h: 560 }, { w: 400, h: 700 }, 348), null);
});

/* ── Dot's resting spot ──────────────────────────────────────────────────────────────────── */

const BOARD = { x: 0, y: 0, w: 1200, h: 700 };

test("Dot rests in her corner when nothing is under her", () => {
  const raw = { x: 1100, y: 600 };
  assert.deepEqual(restSpot(raw, 164, BOARD, [{ x: 0, y: 0, w: 300, h: 100 }]), { at: raw, scale: 1 });
});

test("Dot moves off writing to the nearest clear spot", () => {
  const raw = { x: 1100, y: 600 };
  const busy = [{ x: 900, y: 500, w: 300, h: 200 }];
  const { at, scale } = restSpot(raw, 164, BOARD, busy);
  assert.equal(scale, 1);
  const half = 82;
  for (const r of busy) assert.ok(!(at.x + half > r.x && at.x - half < r.x + r.w && at.y + half > r.y && at.y - half < r.y + r.h), "clear of the writing");
});

test("on a board full of writing she never rests in the middle of it", () => {
  // An exam board: rows of text across the whole board, a narrow gap between rows.
  const busy = Array.from({ length: 12 }, (_, i) => ({ x: 20, y: 10 + i * 58, w: 1160, h: 46 }));
  const { at, scale } = restSpot({ x: 1100, y: 600 }, 164, BOARD, busy);
  assert.ok(scale < 1, "smaller");
  const half = (164 * scale) / 2;
  const inCorner = (at.x - half <= BOARD.x + 1 || at.x + half >= BOARD.x + BOARD.w - 1) && (at.y - half <= BOARD.y + 1 || at.y + half >= BOARD.y + BOARD.h - 1);
  assert.ok(inCorner, "in a corner of the frame");
});
