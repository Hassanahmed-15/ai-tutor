import type { SuprnotesContentBlock } from "./suprnotes";

/**
 * A FIGURE'S CROP TAKES ITS LABELS WITH IT (owner, 2026-11-25: "crop precisely"). A figure's labels are often
 * live text laid over or beside the drawing, not part of its image — the ear figure of a hearing fact sheet.
 * They used to be handed to the figure detector and the cropper as body text ("not a figure"; "never grow
 * across it"), so every crop stopped short of them and the board showed a drawing with its words cut off.
 *
 * - `blockingTextRegions`: the text the detector must not call a figure and the cropper must not grow into —
 *   the page's prose, never a figure's labels or its caption.
 * - `withFigureLabels`: a detected figure grown to take in every label that sits on it or touches it, and its
 *   own "Figure N" caption, so the crop is the whole figure as printed.
 * Pure; all boxes are fractions of the page (0..1).
 */

export type Box = { x: number; y: number; width: number; height: number };

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

/** Boxes that overlap once `a` is grown by `mx`, `my`. */
function near(a: Box, b: Box, mx: number, my: number): boolean {
  return b.x < right(a) + mx && right(b) > a.x - mx && b.y < bottom(a) + my && bottom(b) > a.y - my;
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

const CAPTION = /^\s*(?:fig(?:ure)?\.?|diagram|image|table)\s*\d+[a-z]?\b/i;

/** A printed line that labels a figure: short, not a sentence, not a caption. */
export function isLabelLine(text: string, box: Box): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || CAPTION.test(t)) return false;
  const words = t.split(" ").length;
  // A label names a part: a few words, no clause — "response to speech, the principal way" is prose.
  return words <= 5 && t.length <= 40 && !/[.!?;:]$/.test(t) && !/[,;]/.test(t) && box.width < 0.4;
}

/** A one-line block that continues a paragraph column: the same left edge, right above or below a prose block. */
function continuesProse(block: SuprnotesContentBlock, blocks: SuprnotesContentBlock[]): boolean {
  const b = block.bbox;
  if (!b) return false;
  return blocks.some((o) => o !== block && o.bbox && (o.lines?.length ?? 0) >= 1 && !(o.lines ?? []).every((l) => isLabelLine(l.text, l.bbox))
    && Math.abs(o.bbox.x - b.x) < 0.012
    && (Math.abs(o.bbox.y - (b.y + b.height)) < 0.03 || Math.abs(b.y - (o.bbox.y + o.bbox.height)) < 0.03));
}

/** Every line of the block is a label: a column of short names beside a drawing, not a paragraph's line. */
function labelBlock(block: SuprnotesContentBlock, blocks: SuprnotesContentBlock[] = []): boolean {
  const lines = block.lines ?? [];
  return lines.length > 0 && lines.every((l) => isLabelLine(l.text, l.bbox)) && !(lines.length === 1 && continuesProse(block, blocks));
}

/**
 * A page's labels, with their boxes: a figure-labels block's labels, and the lines of blocks made only of label
 * lines. A short line inside a PARAGRAPH is not a label — a narrow column's "allows us to hear distinct
 * conversations" pulled the brain figure's crop into the prose beside it (hearing fact sheet, 2026-11-25) —
 * unless it lies on the figure itself (`onFigure`), where it can only be the figure's own writing.
 */
export function labelLines(blocks: SuprnotesContentBlock[], onFigure?: Box): Box[] {
  const out: Box[] = [];
  for (const block of blocks) {
    if (block.role === "figure-labels") {
      for (const l of block.labelRegions ?? []) out.push(l.bbox);
      if (!block.labelRegions?.length && block.bbox) out.push(block.bbox);
      continue;
    }
    const whole = labelBlock(block, blocks);
    for (const line of block.lines ?? []) {
      if (!isLabelLine(line.text, line.bbox)) continue;
      if (whole || (onFigure && near(onFigure, line.bbox, 0, 0))) out.push(line.bbox);
    }
  }
  return out;
}

/** The page's prose: what the figure detector must not call a figure and the cropper must not grow across. */
export function blockingTextRegions(blocks: SuprnotesContentBlock[]): Box[] {
  const out: Box[] = [];
  for (const block of blocks) {
    if (!block.bbox || block.role === "figure-labels" || block.role === "caption" || CAPTION.test(block.text ?? "")) continue;
    // A block that is only label lines (a column of short names beside a drawing) belongs to the figure.
    if (labelBlock(block, blocks)) continue;
    out.push(block.bbox);
  }
  return out;
}

/**
 * The figure grown to its labels and caption: every label line on or touching it (within ~2.5% of the page),
 * again for labels that touch those (a callout column), then its caption just above or below. Never grows
 * past half the page in either direction, so one stray label cannot turn a figure into the page.
 */
export function withFigureLabels(figure: Box, blocks: SuprnotesContentBlock[]): Box {
  const labels = labelLines(blocks, figure);
  let box = { ...figure };
  for (let pass = 0; pass < 3; pass++) {
    let grew = false;
    for (const l of labels) {
      if (!near(box, l, 0.025, 0.018)) continue;
      const next = union(box, l);
      if (next.width > figure.width + 0.5 || next.height > figure.height + 0.5) continue;
      if (next.x !== box.x || next.y !== box.y || next.width !== box.width || next.height !== box.height) { box = next; grew = true; }
    }
    if (!grew) break;
  }
  // Its own caption ("Figure 2: …") directly below or above, across the figure's width.
  for (const block of blocks) {
    const text = (block.text ?? "").trim();
    if (!block.bbox || !(block.role === "caption" || CAPTION.test(text))) continue;
    const c = block.bbox;
    const overlapsX = c.x < right(box) && right(c) > box.x;
    const below = c.y >= bottom(box) - 0.01 && c.y - bottom(box) < 0.05;
    const above = bottom(c) <= box.y + 0.01 && box.y - bottom(c) < 0.05;
    if (overlapsX && (below || above) && c.height < 0.08) box = union(box, c);
  }
  return box;
}
