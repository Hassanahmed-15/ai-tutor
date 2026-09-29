/**
 * THE BUILD SCREEN'S SLIDE LIST, ONE LINE PER SUBTOPIC.
 *
 * A subtopic taught in depth spans several boards with the same title (its concept passes), and the
 * list printed "Defining Overfitting" three times in a row (2026-09-29: "it can be … (3 boards) in
 * one line"). Consecutive rows with the same title become one row: its first and last slide numbers,
 * how many boards, and one status — ready when all are, active while any is being made, otherwise
 * queued, with how many are ready so far.
 */
export type SlideRowLike = { sequence: number; title: string; state?: string };

export type SlideGroup<T extends SlideRowLike> = {
  title: string;
  first: number;
  last: number;
  rows: T[];
  readyCount: number;
};

export function groupSlides<T extends SlideRowLike>(rows: T[]): Array<SlideGroup<T>> {
  const groups: Array<SlideGroup<T>> = [];
  for (const row of [...rows].sort((a, b) => a.sequence - b.sequence)) {
    const key = row.title.trim().toLowerCase();
    const open = groups[groups.length - 1];
    if (open && open.title.trim().toLowerCase() === key && row.sequence === open.last + 1) {
      open.rows.push(row);
      open.last = row.sequence;
    } else {
      groups.push({ title: row.title, first: row.sequence, last: row.sequence, rows: [row], readyCount: 0 });
    }
  }
  for (const g of groups) g.readyCount = g.rows.filter((r) => r.state === "ready").length;
  return groups;
}
