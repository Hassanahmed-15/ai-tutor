/**
 * NO WRITING ON WRITING (owner, 2026-10-21: "the most important bug fix is no overlapping text on the
 * board"). Layout places every mark from estimated text sizes; the real board can still differ (fonts,
 * KaTeX, labels the writer put near each other, a line drawn through a label). This is the last word:
 * it reads what is really on the live board and moves a free label to the nearest clear spot.
 *
 * The method is the cartographers' one (Imhof 1975; Christensen, Marks & Shieber 1995 — label
 * placement as a search over candidate positions with a cost): hard rules first (never on other
 * writing, never off the board), then the cheapest candidate by distance moved, lines crossed and
 * shapes covered. Structured writing (equations, code, tables, headings, a word inside its own shape)
 * never moves: its position carries meaning. A free label is the one that gives way.
 *
 * Pure geometry, in board units (the 1000 × 560 board). The DOM side is components/canvas/TextDeconflict.tsx.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export type Writing = {
  id: number;
  box: Box;
  /** A free label that may give way. */
  movable: boolean;
  /** Drawn order: when two free labels collide, the later one moves. */
  order: number;
  /** A label inside its own shape: it stays there unless it is on other writing and nothing free can move. */
  lastResort?: boolean;
};

export type Scene = {
  writings: Writing[];
  /** Sampled points along the board's lines and outlines (its own unit's lines left out per writing). */
  ink: Array<{ owner: number | null; pts: Point[] }>;
  /** Filled shapes a moved label should not land on. */
  fills: Box[];
  bounds: Box;
};

export type Move = { id: number; dx: number; dy: number };

/** Clear space kept between two pieces of writing. */
const GAP = 3;
/** How far a label may travel to get off other writing / off a line through it. */
const MAX_FOR_OVERLAP = 130;
const MAX_FOR_INK = 34;

export function overlapArea(a: Box, b: Box, gap = 0): number {
  const ix = Math.min(a.x + a.w, b.x + b.w) + gap - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) + gap - Math.max(a.y, b.y);
  return ix > 0 && iy > 0 ? ix * iy : 0;
}

/** The same test the QA checker makes: boxes shrunk 8%, more than 2 units of overlap each way. */
export function writingsCollide(a: Box, b: Box): boolean {
  const s = (q: Box, k: number) => ({ x: q.x + q.w * k, y: q.y + q.h * k, w: q.w * (1 - 2 * k), h: q.h * (1 - 2 * k) });
  const p = s(a, 0.08), q = s(b, 0.08);
  const ix = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
  const iy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
  return ix > 2 && iy > 2;
}

/**
 * Stricter than the checker's test, for deciding what moves: two pieces of writing that merely TOUCH
 * read as one ("(0, 3)" sat on an axis's "4" by 1.4 units, under the checker's 2-unit tolerance, for
 * a whole board; playback QA 2026-10-21). Boxes shrunk 4%, any overlap past half a unit each way.
 */
export function writingsTouch(a: Box, b: Box): boolean {
  const s = (q: Box, k: number) => ({ x: q.x + q.w * k, y: q.y + q.h * k, w: q.w * (1 - 2 * k), h: q.h * (1 - 2 * k) });
  const p = s(a, 0.04), q = s(b, 0.04);
  const ix = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
  const iy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
  return ix > 0.5 && iy > 0.5;
}

/** Lines through the middle of a box (its outer 20% is allowed to touch, as in the QA checker). */
export function inkThrough(box: Box, ink: Scene["ink"], self: number): number {
  const x0 = box.x + box.w * 0.2, x1 = box.x + box.w * 0.8, y0 = box.y + box.h * 0.2, y1 = box.y + box.h * 0.8;
  let n = 0;
  for (const line of ink) {
    if (line.owner === self) continue;
    if (line.pts.some((p) => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1)) n++;
  }
  return n;
}

const shift = (b: Box, dx: number, dy: number): Box => ({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
const inside = (b: Box, r: Box) => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;

/** Candidate offsets nearest first; up/down before sideways (a label read in a line keeps its line). */
function candidates(max: number): Point[] {
  const out: Point[] = [];
  for (let r = 6; r <= max; r += 6) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 10));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      out.push({ x: Math.round(r * Math.sin(a)), y: Math.round(-r * Math.cos(a)) });
    }
  }
  return out;
}
const RINGS_OVERLAP = candidates(MAX_FOR_OVERLAP);
const RINGS_INK = candidates(MAX_FOR_INK);

/**
 * The moves that take every free label off other writing (and, where a clear spot is close, off
 * lines). Returns only what moves; anything it cannot fix is left where it is.
 */
export function resolveWritings(scene: Scene): Move[] {
  const boxes = new Map(scene.writings.map((w) => [w.id, { ...w.box }]));
  const byId = new Map(scene.writings.map((w) => [w.id, w]));
  const moved = new Map<number, Point>();

  const othersClear = (id: number, b: Box) => {
    for (const w of scene.writings) if (w.id !== id && overlapArea(b, boxes.get(w.id)!, GAP) > 0) return false;
    return true;
  };
  const cost = (id: number, b: Box, d: Point) => {
    const fill = scene.fills.reduce((s, f) => s + overlapArea(b, f), 0) / Math.max(1, b.w * b.h);
    return Math.hypot(d.x, d.y) + 45 * inkThrough(b, scene.ink, id) + 30 * Math.min(1, fill) + (d.x !== 0 ? 4 : 0);
  };
  /** Put writing `id` somewhere clear; true when it found a place. */
  const place = (id: number, rings: Point[], needNoInk: boolean): boolean => {
    const b0 = boxes.get(id)!;
    let best: { d: Point; c: number } | null = null;
    for (const d of rings) {
      const b = shift(b0, d.x, d.y);
      if (!inside(b, scene.bounds) || !othersClear(id, b)) continue;
      if (needNoInk && inkThrough(b, scene.ink, id) > 0) continue;
      const c = cost(id, b, d);
      if (!best || c < best.c) best = { d, c };
      // Rings grow outwards: nothing further out can beat a clean spot this close.
      if (best.c <= Math.hypot(d.x, d.y) + 0.5) break;
    }
    if (!best) return false;
    boxes.set(id, shift(b0, best.d.x, best.d.y));
    const m = moved.get(id) ?? { x: 0, y: 0 };
    moved.set(id, { x: m.x + best.d.x, y: m.y + best.d.y });
    return true;
  };

  // 1. Free labels hanging off the board come back on (nearest spot inside).
  for (const w of scene.writings) {
    if (w.movable && !inside(boxes.get(w.id)!, scene.bounds)) {
      const b = boxes.get(w.id)!;
      const dx = Math.max(scene.bounds.x - b.x, Math.min(0, scene.bounds.x + scene.bounds.w - (b.x + b.w)));
      const dy = Math.max(scene.bounds.y - b.y, Math.min(0, scene.bounds.y + scene.bounds.h - (b.y + b.h)));
      boxes.set(w.id, shift(b, dx, dy));
      moved.set(w.id, { x: dx, y: dy });
    }
  }

  // 2. Writing on writing: the free label gives way (the later one when both are free).
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const ws = [...scene.writings].sort((a, b) => a.order - b.order);
    for (let i = 0; i < ws.length; i++)
      for (let j = i + 1; j < ws.length; j++) {
        const a = ws[i], b = ws[j];
        if (!writingsTouch(boxes.get(a.id)!, boxes.get(b.id)!)) continue;
        const movers = [...[b, a].filter((w) => w.movable), ...[b, a].filter((w) => !w.movable && w.lastResort)];
        for (const m of movers) if (place(m.id, RINGS_OVERLAP, false)) { changed = true; break; }
      }
    if (!changed) break;
  }

  // 3. A line through a free label: moved only if a clear spot is close by (it stays near its thing).
  for (const w of scene.writings) {
    if (!w.movable || inkThrough(boxes.get(w.id)!, scene.ink, w.id) === 0) continue;
    place(w.id, RINGS_INK, true);
  }

  return [...moved].filter(([, d]) => d.x !== 0 || d.y !== 0).map(([id, d]) => ({ id, dx: d.x, dy: d.y })).filter((m) => byId.has(m.id));
}

/** Writing still on writing after resolving (what the QA checker would report). */
export function remainingCollisions(scene: Scene, moves: Move[]): Array<[number, number]> {
  const d = new Map(moves.map((m) => [m.id, m]));
  const box = (w: Writing) => shift(w.box, d.get(w.id)?.dx ?? 0, d.get(w.id)?.dy ?? 0);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < scene.writings.length; i++)
    for (let j = i + 1; j < scene.writings.length; j++)
      if (writingsCollide(box(scene.writings[i]), box(scene.writings[j]))) out.push([scene.writings[i].id, scene.writings[j].id]);
  return out;
}
