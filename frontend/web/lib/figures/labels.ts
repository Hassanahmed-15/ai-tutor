import type { Pt } from "./types";
import { fitText } from "./cuts";
import { trimToFit } from "../text/fit";

type Rect = { x: number; y: number; w: number; h: number };
export type LabelInput = { id: string; text: string; anchor: Pt; s: number };
export type PlacedLabel = {
  id: string;
  lines: string[];
  side: "left" | "right";
  /** Text position: x is the aligned edge, y the first line's baseline. */
  at: Pt;
  leader: Pt[];
  box: Rect;
  size: number;
  s: number;
};

/**
 * TEXTBOOK LABELS (boundary labelling — Bekos, Niedermann & Nöllenburg's survey; Barth et al.'s
 * readability study). Labels stand in columns in the margins beside the figure, each on the side its
 * part is nearer, in the same top-to-bottom order as their parts so no two leaders cross. Each leader
 * leaves its label horizontally, then runs straight to a dot on the part. Text sits outside the art,
 * never on it; a label too long for its margin wraps onto a second line.
 */
/** Label heights tried around each part: level first, then up and down in 17-unit steps. */
const DY_STEPS = [0, ...Array.from({ length: 12 }, (_, i) => [-(i + 1) * 17, (i + 1) * 17]).flat()];

export function placeLabels(items: LabelInput[], fig: Rect, area: Rect, measure: (text: string, size: number) => number, size = 17, obstacles: Array<{ id: string; box: Rect; circle?: { cx: number; cy: number; r: number } }> = []): PlacedLabel[] {
  const cx = fig.x + fig.w / 2;
  // Each label takes the side and height whose leader is shortest WITHOUT passing another part on the
  // way in (the circuit's "Fuse" leader crossed the variable resistor). Columns are not forced to
  // balance: a label moved across the figure for symmetry drags its leader through the art.
  const CLEAR = 14;
  const edgeX = (side: "left" | "right") => (side === "left" ? fig.x - 14 : fig.x + fig.w + 14);
  const choice = new Map<LabelInput, { side: "left" | "right"; dy: number }>();
  // Every candidate leader (either margin, several heights) is scored: its length, how far it bends,
  // and — heavily — how much of the drawing it crosses. The cleanest wins; when none is perfectly
  // clear, the one that crosses least still beats the nearest side (audit 2026-10-17: "Electron
  // transfer" ran straight through the sodium atom).
  const crossings = (item: LabelInput, from: Pt) =>
    items.filter((o) => o !== item && distanceToSegment(o.anchor, from, item.anchor) < CLEAR).length * 3 +
    obstacles.filter((o) => o.id !== item.id && (o.circle ? segmentHitsCircle(from, item.anchor, o.circle) : segmentHitsBox(from, item.anchor, o.box, 3))).length;
  for (const item of items) {
    const near: "left" | "right" = item.anchor.x < cx ? "left" : "right";
    const far: "left" | "right" = near === "left" ? "right" : "left";
    let best: { side: "left" | "right"; dy: number; cost: number } | null = null;
    for (const side of [near, far]) for (const dy of DY_STEPS) {
      const from = { x: edgeX(side), y: item.anchor.y + dy };
      // A label may sit a little above the stage area (the heading is higher still) to clear the art.
      if (from.y < area.y - 20 || from.y > area.y + area.h) continue;
      const cost = Math.abs(from.x - item.anchor.x) + Math.abs(dy) * 1.5 + (side === far ? 80 : 0) + crossings(item, from) * 400;
      if (!best || cost < best.cost) best = { side, dy, cost };
    }
    choice.set(item, best ?? { side: near, dy: 0 });
  }
  const left = items.filter((i) => choice.get(i)!.side === "left");
  const right = items.filter((i) => choice.get(i)!.side === "right");
  const gap = 10;
  const roomOf = (side: "left" | "right") => Math.max(60, side === "left" ? fig.x - area.x - 28 : area.x + area.w - (fig.x + fig.w) - 28);
  // NO LABEL IS CUT FIRST: the type gets smaller (to a floor) until every label fits its margin in at
  // most two lines and each column fits the stage's height. Both columns share the size. Only a label
  // still too long at the floor is fitted — ended at a natural break and recorded, so the board writer
  // rewrites it to fit (owner, 2026-10-17: "no text has been cut").
  const floor = Math.max(12, size - 4);
  const fits = (s: number) =>
    ([["left", left], ["right", right]] as const).every(([side, list]) => {
      const fitted = list.map((item) => fitLines(item.text, s, roomOf(side), measure));
      const tall = fitted.reduce((t, f) => t + f.lines.length * s * 1.25, 0) + Math.max(0, list.length - 1) * 2;
      return fitted.every((f) => f.cut === undefined) && tall <= area.h + 20;
    });
  let used = size;
  while (used > floor && !fits(used)) used -= 1;
  const lineH = used * 1.25;
  const out: PlacedLabel[] = [];
  for (const [side, list] of [["left", left], ["right", right]] as const) {
    const room = roomOf(side);
    const placed = [...list].map((item) => {
      const f = fitLines(item.text, used, room, measure);
      // Recorded with the characters its two lines hold; meanwhile it ends at a natural break.
      const lines = f.cut === undefined ? f.lines : wrap(fitText(item.text, f.cut), used, room, measure);
      const w = Math.max(...lines.map((l) => measure(l, used)));
      return { item, lines, w, h: lines.length * lineH, y: item.anchor.y + choice.get(item)!.dy - (lines.length * lineH) / 2 };
    }).sort((a, b) => a.y - b.y);
    // A column never leaves the stage: its gaps close up when it is tall, and it may use the strip
    // just above the stage only when it cannot fit inside it (a label pushed above the stage top
    // overprinted the heading).
    const sumH = placed.reduce((t, p) => t + p.h, 0);
    const g = placed.length > 1 ? Math.max(2, Math.min(gap, (area.h - sumH) / (placed.length - 1))) : gap;
    const top = sumH + g * Math.max(0, placed.length - 1) > area.h ? area.y - 20 : area.y;
    // Stack downwards without overlap, pull back up if the column ran past the bottom, then down again
    // so nothing rises above the top.
    for (let i = 0; i < placed.length; i++) placed[i].y = Math.max(placed[i].y, top, i ? placed[i - 1].y + placed[i - 1].h + g : -Infinity);
    for (let i = placed.length - 1; i >= 0; i--) placed[i].y = Math.min(placed[i].y, (i < placed.length - 1 ? placed[i + 1].y - g : area.y + area.h) - placed[i].h);
    for (let i = 0; i < placed.length; i++) placed[i].y = Math.max(placed[i].y, top, i ? placed[i - 1].y + placed[i - 1].h + g : -Infinity);
    for (const p of placed) {
      const edge = side === "left" ? fig.x - 14 : fig.x + fig.w + 14;
      const mid = p.y + p.h / 2;
      const start = { x: side === "left" ? edge + 6 : edge - 6, y: mid };
      const elbow = { x: side === "left" ? edge + 18 : edge - 18, y: mid };
      out.push({
        id: p.item.id,
        lines: p.lines,
        side,
        at: { x: edge, y: p.y + used * 0.95 },
        leader: [start, elbow, p.item.anchor],
        box: { x: side === "left" ? edge - p.w : edge, y: p.y, w: p.w, h: p.h },
        size: used,
        s: p.item.s,
      });
    }
  }
  // Two leaders on one side that still cross trade label slots (a column is ordered by slot, so a
  // swap uncrosses them); a few passes settle it.
  for (let pass = 0; pass < 4; pass++) {
    let swapped = false;
    for (const side of ["left", "right"] as const) {
      const col = out.filter((l) => l.side === side);
      for (let i = 0; i < col.length; i++) for (let j = i + 1; j < col.length; j++) {
        const a = col[i], b = col[j];
        if (!leadersCross(a.leader, b.leader)) continue;
        const [ea, eb] = [a.leader[2], b.leader[2]];
        const slotA = { at: a.at, start: a.leader[0], elbow: a.leader[1], y: a.box.y }, slotB = { at: b.at, start: b.leader[0], elbow: b.leader[1], y: b.box.y };
        Object.assign(a, { at: slotB.at, leader: [slotB.start, slotB.elbow, ea], box: { ...a.box, y: slotB.y } });
        Object.assign(b, { at: slotA.at, leader: [slotA.start, slotA.elbow, eb], box: { ...b.box, y: slotA.y } });
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return out;
}

function wrap(text: string, size: number, maxW: number, measure: (t: string, s: number) => number): string[] {
  if (measure(text, size) <= maxW) return [text];
  const words = text.split(/\s+/);
  let first = "";
  for (const w of words) {
    const next = first ? `${first} ${w}` : w;
    if (measure(next, size) > maxW && first) break;
    first = next;
  }
  const rest = text.slice(first.length).trim();
  return rest ? [first, rest] : [first];
}

/**
 * A label's lines at this size: at most two, each within the margin. A text whose second line would
 * run past the margin is ended at a natural break, and `cut` says how many characters it kept (the
 * room the rewrite pass is given); a single word wider than the margin cannot be helped by a cut.
 */
function fitLines(text: string, size: number, maxW: number, measure: (t: string, s: number) => number): { lines: string[]; cut?: number } {
  const lines = wrap(text, size, maxW, measure);
  const ok = (l: string[]) => l.length < 2 || measure(l[1], size) <= maxW;
  if (ok(lines)) return { lines };
  let n = text.length - 1;
  while (n > 6 && !ok(wrap(trimToFit(text, n), size, maxW, measure))) n--;
  return { lines: wrap(trimToFit(text, n), size, maxW, measure), cut: n };
}

/** Do two leaders cross? Used by tests and by layout QA. */
export function leadersCross(a: Pt[], b: Pt[]): boolean {
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) return true;
  return false;
}
function segmentsCross(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(r, s, p), d2 = d(r, s, q), d3 = d(p, q, r), d4 = d(p, q, s);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Does the segment a→b pass through the box (inflated by pad), ignoring its final 10 units? */
function segmentHitsBox(a: Pt, b: Pt, box: Rect, pad: number): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const end = Math.max(0, 1 - 10 / len);
  for (let t = 0; t <= end; t += Math.min(0.02, end / 4 || 0.02)) {
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (x > box.x - pad && x < box.x + box.w + pad && y > box.y - pad && y < box.y + box.h + pad) return true;
  }
  return false;
}

/** Does a→b pass through the circle (ignoring its final 10 units, where it reaches its own part)? */
function segmentHitsCircle(a: Pt, b: Pt, c: { cx: number; cy: number; r: number }): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const end = { x: b.x - ((b.x - a.x) / len) * 10, y: b.y - ((b.y - a.y) / len) * 10 };
  return distanceToSegment({ x: c.cx, y: c.cy }, a, end) < c.r + 1;
}
