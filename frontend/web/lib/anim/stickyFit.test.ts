import { test } from "node:test";
import assert from "node:assert/strict";
import { stickyFit } from "../canvas/stickyFit";
import { textWidth } from "../canvas/layout";

/** Where the last line of writing ends, below the note's top. */
const foot = (f: ReturnType<typeof stickyFit>) =>
  f.detail.length ? f.detailY + (f.detail.length - 1) * f.detailSize * f.detailLead + f.detailSize * 0.25 : f.labelY + ((f.label?.lines.length ?? 1) - 1) * (f.label?.size ?? 0) * f.labelLead + (f.label?.size ?? 0) * 0.25;

// The saved History board 2 and Economics board 3 notes (QA 2026-11-28) that ran off their paper.
const cases = [
  { label: "Estate privilege", detail: ["legal", "advantage"], rect: { x: 482, y: 134.95, w: 110.67, h: 86.1 }, size: 13 },
  { label: "Unequal obligations", detail: ["economic", "importance ≠", "status"], rect: { x: 823.3, y: 337.57, w: 110.67, h: 104.86 }, size: 13, detailSize: 11 },
  { label: "Forgone benefit", detail: ["next-best", "alternative"], rect: { x: 851, y: 261.95, w: 110, h: 86.1 }, size: 13 },
];

for (const c of cases) {
  test(`"${c.label}" keeps every word inside its note`, () => {
    const f = stickyFit(c.label, c.detail, c.rect, c.size, c.detailSize ?? 15);
    assert.ok(f.fits, "fits");
    assert.ok(foot(f) <= c.rect.y + c.rect.h - 10, `writing ends at ${foot(f).toFixed(1)} of ${c.rect.h}`);
    assert.equal(f.detail.join(" "), c.detail.join(" "), "no word dropped");
    assert.equal(f.label?.lines.join(" "), c.label, "title whole");
    for (const l of f.detail) assert.ok(textWidth(l, f.detailSize) <= c.rect.w - 24 + 0.5, `"${l}" within the paper`);
  });
}

test("a note with room keeps its sizes", () => {
  const f = stickyFit("Consumer", ["phone or holiday"], { x: 0, y: 0, w: 220, h: 120 }, 18, 15);
  assert.equal(f.label?.size, 18);
  assert.equal(f.detailSize, 15);
  assert.ok(f.labelY > 14 && f.detailY > f.labelY);
});

test("a title alone is centred in the paper", () => {
  const f = stickyFit("Worker", undefined, { x: 10, y: 100, w: 120, h: 70 }, 18);
  const mid = f.labelY - (f.label!.size * 0.9 - (f.label!.size * 1.15) / 2);
  assert.ok(Math.abs(mid - (100 + 14 + (70 - 26) / 2)) < 2, `centre at ${mid}`);
});
