/**
 * THE BOOK'S OWN FIGURES FOR ONE PART OF THE LESSON, AND WHICH ONE IS BEING TALKED ABOUT.
 *
 * Two sources of a figure's place on the page:
 *   - a text-layer PDF prints the figure's labels as text ("Diagram labels:" block, with each
 *     label's position) — the figure is the labels' extent, and each label can light up;
 *   - a scanned page has no text layer, but its figure CAPTION was placed (lib/ocrLayout.ts) and
 *     carries the figure's region above it (`figureRegion`). No labels: the drawing is shown whole.
 *
 * Pure, so the choice of figure is tested exactly (lib/anim/sourceFigures.test.ts).
 */
import { contentStems } from "./sourceGrounding";

export type FigureBox = { x: number; y: number; width: number; height: number };
export type SourceFigure = {
  pageNumber: number;
  crop: FigureBox;
  labels: Array<{ text: string; bbox: FigureBox }>;
  /** The printed caption, when the figure was found from one ("Figure 19.3 Deletion of node 5…"). */
  caption?: string;
};

type FigureBlock = {
  id: string;
  role?: string;
  text?: string;
  pageNumber?: number;
  bbox?: FigureBox;
  labelRegions?: Array<{ text: string; bbox: FigureBox }>;
  figureRegion?: FigureBox;
};

/** Every printed figure among a part's source blocks, in reading order. */
export function sourceFiguresFor(blocks: FigureBlock[], sourceBlockIds: string[] | undefined): SourceFigure[] {
  if (!sourceBlockIds?.length) return [];
  const order = new Map(sourceBlockIds.map((id, index) => [id, index]));
  const own = blocks.filter((block) => order.has(block.id) && typeof block.pageNumber === "number");
  own.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const figures: SourceFigure[] = [];
  for (const block of own) {
    const pageNumber = block.pageNumber as number;
    if (block.role === "figure-labels" && block.bbox && block.labelRegions?.length) {
      // The labels' extent, widened to take in the drawing they surround.
      const b = block.bbox;
      const padX = Math.max(0.03, b.width * 0.08);
      const padY = Math.max(0.03, b.height * 0.12);
      const x = Math.max(0, b.x - padX);
      const y = Math.max(0, b.y - padY);
      figures.push({
        pageNumber,
        crop: { x, y, width: Math.min(1, b.x + b.width + padX) - x, height: Math.min(1, b.y + b.height + padY) - y },
        labels: block.labelRegions,
      });
    } else if (block.figureRegion && block.figureRegion.width > 0 && block.figureRegion.height > 0) {
      figures.push({ pageNumber, crop: block.figureRegion, labels: [], caption: (block.text ?? "").trim() });
    }
  }
  return figures;
}

/** "Figure 19.3" → "19.3". */
function figureNumber(caption: string | undefined): string | null {
  return caption?.match(/^\s*fig(?:ure|\.)?\s*(\d+(?:\.\d+)*)/i)?.[1] ?? null;
}

/**
 * Which figure goes with what Aria is saying now. A sentence that names a figure by number ("This
 * is illustrated in Figure 19.3") picks it outright; otherwise the figure whose caption shares the
 * most words with the sentence, when it shares at least two ("deletion", "node", "child"). A
 * sentence about neither keeps the figure already showing, so the board does not flicker.
 */
export function activeFigureIndex(figures: SourceFigure[], sentence: string, previous: number): number {
  if (figures.length <= 1) return 0;
  const byNumber = figures.findIndex((figure) => {
    const number = figureNumber(figure.caption);
    return number !== null && new RegExp(`\\bfig(?:ure|\\.)?\\s*${number.replace(/\./g, "\\.")}(?!\\d)`, "i").test(sentence);
  });
  if (byNumber >= 0) return byNumber;
  const said = new Set(contentStems(sentence));
  let best = -1;
  let bestScore = 1;
  figures.forEach((figure, index) => {
    const words = new Set(contentStems([figure.caption ?? "", ...figure.labels.map((label) => label.text)].join(" ")).filter((stem) => !/^\d+$/.test(stem)));
    const score = [...words].filter((stem) => said.has(stem)).length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best >= 0 ? best : Math.min(Math.max(0, previous), figures.length - 1);
}
