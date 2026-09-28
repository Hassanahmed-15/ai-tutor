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

/** A figure the upload's detector cropped (parse-pdf's pdf-figure asset). */
type FigureAsset = {
  id: string;
  bbox?: FigureBox;
  caption?: string;
  pageNumber?: number;
  visualType?: string;
  sourceBlockIds?: string[];
  teachingUse?: unknown;
};

function overlapShare(a: FigureBox, b: FigureBox): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.width * a.height, b.width * b.height);
}

/**
 * Every printed figure a part teaches, in reading order: figures found from the page's own text
 * (labels, captions) first, then the pictures the upload's figure detector cropped for the part's
 * blocks — a photo or a drawing with no word labels (a textbook's apparatus diagram, a photo of a
 * tomato leaf) is a figure too, and used to never reach the board.
 */
export function sourceFiguresFor(blocks: FigureBlock[], sourceBlockIds: string[] | undefined, assets: FigureAsset[] = []): SourceFigure[] {
  if (!sourceBlockIds?.length) return [];
  const order = new Map(sourceBlockIds.map((id, index) => [id, index]));
  const own = blocks.filter((block) => order.has(block.id) && typeof block.pageNumber === "number");
  own.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const figures: SourceFigure[] = [];
  for (const block of own) {
    const pageNumber = block.pageNumber as number;
    // Two word labels at least: a lone heading or step number was once filed as "labels" (see
    // structurePdfPage), and an upload parsed then still carries it.
    const wordLabels = (block.labelRegions ?? []).filter((label) => /[A-Za-z]{2,}/.test(label.text)).length;
    if (block.role === "figure-labels" && block.bbox && wordLabels >= 2) {
      // The labels' extent, widened to take in the drawing they surround.
      const b = block.bbox;
      const padX = Math.max(0.03, b.width * 0.08);
      const padY = Math.max(0.03, b.height * 0.12);
      const x = Math.max(0, b.x - padX);
      const y = Math.max(0, b.y - padY);
      figures.push({
        pageNumber,
        crop: { x, y, width: Math.min(1, b.x + b.width + padX) - x, height: Math.min(1, b.y + b.height + padY) - y },
        labels: block.labelRegions ?? [],
      });
    } else if (block.figureRegion && block.figureRegion.width > 0 && block.figureRegion.height > 0) {
      figures.push({ pageNumber, crop: block.figureRegion, labels: [], caption: cleanCaption(block.text) });
    }
  }
  const wanted = new Set(sourceBlockIds);
  for (const asset of assets) {
    const use = (asset.teachingUse ?? {}) as { kind?: string; useInLesson?: boolean };
    const box = asset.bbox;
    if (use.kind !== "pdf-figure" || use.useInLesson === false || typeof asset.pageNumber !== "number" || !box) continue;
    // A table is text in a grid, read on the page itself; a whole-page "figure" is the page.
    // Taller than 60% of the page, or over 30% of it, is a slice of the page rather than a figure.
    if (/table/i.test(asset.visualType ?? "") || box.width * box.height > 0.3 || box.height > 0.6 || box.width * box.height < 0.01) continue;
    if (!(asset.sourceBlockIds ?? []).some((id) => wanted.has(id))) continue;
    if (figures.some((figure) => figure.pageNumber === asset.pageNumber && overlapShare(figure.crop, box) > 0.5)) continue;
    /*
     * A picture, not a slice of the page. The detector's box can be loose: on the Cambridge page it
     * took a tall strip holding the section heading, the activity banner and half an apparatus.
     * A real figure holds little of the page's text; one whose area is more than 12% covered by
     * the page's own text blocks is a crop of the page, and is not shown.
     */
    const textCover = blocks
      // Prose only: a photo's own caption or a label sits inside its crop and is part of the figure.
      .filter((block) => block.pageNumber === asset.pageNumber && block.bbox && block.role !== "figure-labels" && !block.figureRegion && (block.text ?? "").length > 120)
      .reduce((sum, block) => {
        const b = block.bbox as FigureBox;
        const w = Math.min(b.x + b.width, box.x + box.width) - Math.max(b.x, box.x);
        const h = Math.min(b.y + b.height, box.y + box.height) - Math.max(b.y, box.y);
        return w > 0 && h > 0 ? sum + w * h : sum;
      }, 0);
    if (textCover > box.width * box.height * 0.12) continue;
    /*
     * Only a picture the book CAPTIONED. "illustration from page 2" is the pipeline's placeholder,
     * written when the detector found no caption — and those were the loose crops (a strip of the
     * Cambridge page: a heading, a banner, half an apparatus). A printed caption means the book
     * set the figure apart, and the detector's box around it can be trusted.
     */
    const caption = /\bfrom (?:page|slide) \d+$/i.test(asset.caption ?? "") ? "" : cleanCaption(asset.caption);
    if (!caption || !/[A-Za-z]{3,}.*\s.*[A-Za-z]{3,}/.test(caption)) continue;
    figures.push({ pageNumber: asset.pageNumber, crop: box, labels: [], caption });
  }
  return figures;
}

/** A caption as the student reads it: no transcription escapes ("Figure 19.3 \\ \\ Deletion…"). */
function cleanCaption(text: string | undefined): string {
  return (text ?? "").replace(/\\\\+|(^|\s)\\(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
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
