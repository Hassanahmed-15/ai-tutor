import type { Mark, PanelLayout, Pt } from "./layout";

/*
 * The order of a board's text cards (owner, 2026-10-19: sticky notes are numbered so the student can
 * follow Aria from note to note). Notes joined into one chain or loop by arrows are numbered along the
 * arrows; otherwise in the order Aria first reaches them. Drawing only: nothing here changes the lesson.
 */

/** The text cards of a board, numbered in the order they appear (sentence, then top-to-bottom, left-to-right); none when there is only one. */
export function cardNumbersOf(layout: PanelLayout): Map<string, number> {
  const boxes = layout.marks.filter((m): m is Extract<Mark, { type: "box" }> => m.type === "box" && !m.icon);
  const out = new Map<string, number>(boxes.map((b) => [b.id, 0]));
  if (boxes.length < 2) return out;
  const taught = [...boxes].sort((a, b) => a.s - b.s || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  // Notes joined into ONE chain (or loop) by arrows are numbered along the arrows: numbers that ran
  // 1 → 3 → 2 against the arrows would teach the wrong order.
  const chain = arrowChain(layout, boxes);
  (chain ?? taught).forEach((b, i) => out.set(b.id, i + 1));
  return out;
}

/** The boxes in arrow order when the arrows link them all into one path or one loop; null otherwise. */
function arrowChain(layout: PanelLayout, boxes: Array<Extract<Mark, { type: "box" }>>): Array<Extract<Mark, { type: "box" }>> | null {
  const nearest = (p: Pt) => {
    let best: Extract<Mark, { type: "box" }> | null = null;
    let gap = 36;
    for (const b of boxes) {
      const dx = Math.max(b.rect.x - p.x, 0, p.x - (b.rect.x + b.rect.w));
      const dy = Math.max(b.rect.y - p.y, 0, p.y - (b.rect.y + b.rect.h));
      const d = Math.hypot(dx, dy);
      if (d < gap) [best, gap] = [b, d];
    }
    return best;
  };
  const next = new Map<string, string>();
  const into = new Map<string, number>();
  for (const m of layout.marks) {
    if (m.type !== "arrow") continue;
    const from = nearest(m.p0);
    const to = nearest(m.p1);
    if (!from || !to || from === to) continue;
    if (next.has(from.id) && next.get(from.id) !== to.id) return null;
    next.set(from.id, to.id);
  }
  for (const to of new Set(next.values())) into.set(to, [...next.values()].filter((v) => v === to).length);
  if ([...into.values()].some((n) => n > 1) || next.size < boxes.length - 1) return null;
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const start = boxes.find((b) => !into.has(b.id)) ?? [...boxes].sort((a, b) => a.s - b.s)[0];
  const order: Array<Extract<Mark, { type: "box" }>> = [];
  for (let at: string | undefined = start.id; at && !order.some((b) => b.id === at); at = next.get(at)) order.push(byId.get(at)!);
  return order.length === boxes.length ? order : null;
}

