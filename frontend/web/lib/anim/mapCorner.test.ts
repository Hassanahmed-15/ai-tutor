import { test } from "node:test";
import assert from "node:assert/strict";
import { clearOfPill, MAP_PILL, pillCovers, writingArea } from "../canvas/mapCorner";
import { fitView } from "../canvas/camera";
import { PANEL_H, PANEL_W } from "../canvas/types";

const board = { x: 0, y: 0, w: PANEL_W, h: PANEL_H };
const area = writingArea(board);

test("the open 16-board grid's footprint covered the writing at the player's size", () => {
  const box = { w: 1440, h: 800 };
  // The grid was about 150 × 90 px in the same corner (QA screenshots 2026-11-28).
  assert.ok(pillCovers(fitView(board, box.w / box.h, 0.035), area, box, { w: 150, h: 90, inset: 12 }));
});

test("the folded pill is kept off the writing at the player's usual sizes", () => {
  for (const box of [{ w: 1440, h: 800 }, { w: 1280, h: 680 }, { w: 1180, h: 760 }, { w: 1600, h: 760 }, { w: 390, h: 640 }]) {
    const view = fitView(board, box.w / box.h, 0.035);
    assert.ok(!pillCovers(clearOfPill(view, area, box), area, box), `pill on the writing at ${box.w}×${box.h}`);
  }
});

test("a view that puts the pill on the writing is pulled back only as much as needed", () => {
  // A tight crop (the sticky-note lean): the board's bottom-left corner reaches the screen corner.
  const box = { w: 1200, h: 700 };
  const w = 900;
  const view = { x: area.x - 4, y: area.y + area.h - (w * box.h) / box.w + 6, w, h: (w * box.h) / box.w };
  assert.ok(pillCovers(view, area, box));
  const out = clearOfPill(view, area, box);
  assert.ok(!pillCovers(out, area, box));
  assert.ok(out.w / view.w <= 1.2 && out.w > view.w);
  assert.ok(Math.abs(out.w / out.h - view.w / view.h) < 1e-9, "same aspect");
});

test("a view already clear is returned as it is", () => {
  const box = { w: 1440, h: 800 };
  const view = fitView(board, box.w / box.h, 0.2);
  assert.equal(clearOfPill(view, area, box), view);
  assert.equal(MAP_PILL.inset, 12);
});
