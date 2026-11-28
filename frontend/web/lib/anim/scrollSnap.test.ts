import { test } from "node:test";
import assert from "node:assert/strict";
import { followScrollTop, lineBands, type Band } from "../canvas/scrollSnap";

// A column of 30 px lines with 8 px between paragraphs every 3 lines (scroll coordinates).
const lines: Band[] = [];
for (let i = 0, y = 16; i < 24; i++) {
  lines.push({ top: y, bottom: y + 28 });
  y += 30 + (i % 3 === 2 ? 8 : 0);
}
const fade = 6;
const cut = (s: number) => lines.some((b) => b.top < s - 0.5 && b.bottom > s + 0.5);

test("runs of one line merge into one band; lines stay apart", () => {
  const bands = lineBands([{ top: 10, bottom: 38 }, { top: 12, bottom: 36 }, { top: 6, bottom: 20 }, { top: 40, bottom: 68 }]);
  assert.deepEqual(bands, [{ top: 6, bottom: 38 }, { top: 40, bottom: 68 }]);
});

test("following her, the column stops where no line is cut at the top", () => {
  const view = 400;
  for (let newest = 10; newest < 24; newest++) {
    const s = followScrollTop({ current: 0, newestBottom: lines[newest].bottom, view, bands: lines, fade, max: 2000 });
    if (s === null) continue;
    assert.ok(!cut(s), `stop ${s} cuts a line (newest line ${newest})`);
    assert.ok(lines[newest].bottom <= s + view, "the newest line is in view");
  }
});

test("the start of her sentence stays on the board when the newest piece fits under it", () => {
  const view = 400;
  const keepTop = lines[8].top;
  const s = followScrollTop({ current: 0, newestBottom: lines[18].bottom, view, bands: lines, keepTop, fade, max: 2000 })!;
  assert.ok(s <= keepTop - fade + 0.5, `sentence start at ${keepTop} scrolled past (${s})`);
  assert.ok(lines[18].bottom <= s + view);
  assert.ok(!cut(s));
});

test("near the end, the room under the last line still gives a clean stop", () => {
  const view = 400;
  const last = lines[lines.length - 1].bottom;
  const max = last + 26 + 44 - view;
  const s = followScrollTop({ current: 0, newestBottom: last, view, bands: lines, fade, max })!;
  assert.ok(s <= max && !cut(s), `end stop ${s} of ${max}`);
});

test("nothing to do when the newest piece is already in the upper part", () => {
  assert.equal(followScrollTop({ current: 0, newestBottom: 200, view: 400, bands: lines, fade }), null);
});
