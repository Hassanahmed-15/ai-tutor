/**
 * A BIG LESSON BECOMES LESSON 1, 2… (flag CANVAS_LESSON_SERIES=on; owner, 2026-11-08: one lesson is about
 * 10–15 minutes, two or three new ideas).
 *
 * A course lesson's plan (lib/curriculum/lessonSpec.ts) is a list of ideas, one per spec board. Taught
 * properly (lib/teaching/courseOrders.ts) each idea takes two or three boards, so more than three ideas
 * no longer fit one lesson. They are shared out over the fewest lessons that hold them, as evenly as
 * possible, and never between two ideas that teach the same syllabus outcome when another place to cut
 * exists — an idea is never split, and an outcome is taught in one lesson where it can be.
 *
 * Pure, unit-tested (lib/anim/lessonSeries.test.ts).
 */

export function lessonSeriesOn(): boolean {
  return process.env.CANVAS_LESSON_SERIES === "on";
}

/** New ideas one lesson teaches (CANVAS_LESSON_IDEAS, default 3). */
export function ideasPerLesson(): number {
  const n = Number(process.env.CANVAS_LESSON_IDEAS);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 3;
}

export type SeriesPart = {
  /** 1-based. */
  part: number;
  /** Positions of the plan's ideas (spec boards) this lesson teaches, in order. */
  ideas: number[];
  /** The syllabus outcome numbers those ideas teach. */
  outcomeRefs: number[];
  titles: string[];
};

type Idea = { title: string; outcomeRefs: number[] };

/** Every way to cut n ideas into k lessons of 1..max ideas each (n is at most 8 in a course plan). */
function compositions(n: number, k: number, max: number): number[][] {
  if (k === 1) return n >= 1 && n <= max ? [[n]] : [];
  const out: number[][] = [];
  for (let first = 1; first <= Math.min(max, n - (k - 1)); first++) {
    for (const rest of compositions(n - first, k - 1, max)) out.push([first, ...rest]);
  }
  return out;
}

/** The lessons a plan of ideas is taught in: one lesson when it fits. */
export function splitIntoLessons(ideas: Idea[], max = ideasPerLesson()): SeriesPart[] {
  const n = ideas.length;
  const part = (index: number, from: number, to: number): SeriesPart => {
    const slice = ideas.slice(from, to);
    return { part: index + 1, ideas: slice.map((_, j) => from + j), outcomeRefs: [...new Set(slice.flatMap((s) => s.outcomeRefs))].sort((a, b) => a - b), titles: slice.map((s) => s.title) };
  };
  if (n <= max) return [part(0, 0, n)];
  const k = Math.ceil(n / max);
  // A cut between two ideas that share an outcome splits that outcome over two lessons.
  const shares = (i: number) => ideas[i - 1].outcomeRefs.some((r) => ideas[i].outcomeRefs.includes(r));
  let best: { sizes: number[]; cost: number } | null = null;
  for (const sizes of compositions(n, k, max)) {
    let at = 0;
    let straddles = 0;
    for (const size of sizes.slice(0, -1)) {
      at += size;
      if (shares(at)) straddles++;
    }
    // Even lessons first; among equals, the bigger lessons come first (a series slows down, never up).
    const spread = Math.max(...sizes) - Math.min(...sizes);
    const cost = straddles * 100 + spread * 10;
    const frontier = (a: number[], b: number[]) => a.findIndex((x, i) => x !== b[i]);
    if (!best || cost < best.cost || (cost === best.cost && (() => { const i = frontier(sizes, best.sizes); return i >= 0 && sizes[i] > best.sizes[i]; })())) best = { sizes, cost };
  }
  const parts: SeriesPart[] = [];
  let from = 0;
  best!.sizes.forEach((size, i) => {
    parts.push(part(i, from, from + size));
    from += size;
  });
  return parts;
}

/** The lesson to open: the first one not finished (an unfinished lesson is taught again, from its start). */
export function nextPart(progress: { parts: number; titles: string[][]; completed: number[] } | null, titles: string[][]): number {
  if (!progress || progress.parts !== titles.length || JSON.stringify(progress.titles) !== JSON.stringify(titles)) return 1;
  for (let p = 1; p <= titles.length; p++) if (!progress.completed.includes(p)) return p;
  return titles.length;
}
