import { fitText } from "./renderFit";
import { textWidth, wrap } from "./layout";

/**
 * A STICKY NOTE HOLDS ALL ITS WORDS (QA 2026-11-28: "legal advantage", "economic importance ≠ status" and
 * "next-best alternative" ran out of the foot of their notes). The note's rectangle comes from the layout, but
 * the note writes its title bolder and narrower than the layout measured it, so a title that wrapped pushed the
 * detail past the paper. Here the title and the detail are fitted together to the note as drawn: the same sizes
 * when they fit, else both smaller (the detail re-wrapped at each size), never cut — then centred in the paper
 * below its tape. Pure (lib/anim/stickyFit.test.ts).
 */
export type StickyFit = {
  label: { lines: string[]; size: number } | null;
  detail: string[];
  detailSize: number;
  /** The first line's baseline of the title, and of the detail. */
  labelY: number;
  detailY: number;
  /** Line pitch, in em: title, detail. */
  labelLead: number;
  detailLead: number;
  /** False only when even the smallest sizes could not hold it (then it is the smallest try). */
  fits: boolean;
};

const LABEL_LEAD = 1.15;
const DETAIL_LEAD = 1.27;
/** The title is drawn at weight 800: about 6% wider than the measure. */
const BOLD = 1.06;
/** Paper kept clear: under the tape, and over the folded corner. */
const TOP = 12;
const FOOT = 10;
const SIDE = 12;
const GAP = 6;

export function stickyFit(label: string | undefined, detail: string[] | undefined, rect: { x: number; y: number; w: number; h: number }, labelSize: number, detailSize = 15): StickyFit {
  const words = (detail ?? []).join(" ").replace(/\s+/g, " ").trim();
  const innerW = Math.max(20, rect.w - SIDE * 2);
  const room = Math.max(10, rect.h - TOP - FOOT);
  // Every pair of sizes, largest first: the title kept as large as it can be, the detail never larger than the
  // title by more than a point (a 10 px title over 15 px detail read upside down).
  type Attempt = Omit<StickyFit, "labelY" | "detailY"> & { height: number; score: number };
  let best: Attempt | null = null;
  let smallest: Attempt | null = null;
  for (let ls = labelSize; ls >= Math.min(labelSize, 10); ls--) {
    const fit = label ? fitText(label, innerW / BOLD, ls, Math.max(10, ls - 1), 3) : null;
    const labelH = fit ? fit.lines.length * fit.size * LABEL_LEAD : 0;
    const titleWide = (fit?.lines ?? []).every((l) => textWidth(l, fit!.size) * BOLD <= innerW + 0.5);
    for (let ds = Math.min(detailSize, (fit?.size ?? detailSize) + 1); ds >= Math.min(detailSize, 9); ds--) {
      const lines = words ? wrap(words, ds, innerW, 99) : [];
      const detailH = lines.length ? (fit ? GAP : 0) + ds * (DETAIL_LEAD * lines.length - (DETAIL_LEAD - LABEL_LEAD)) : 0;
      const height = labelH + detailH;
      const fits = titleWide && lines.every((l) => textWidth(l, ds) <= innerW + 0.5) && height <= room;
      const attempt = { label: fit, detail: lines, detailSize: ds, labelLead: LABEL_LEAD, detailLead: DETAIL_LEAD, fits, height, score: (fit?.size ?? 0) + (lines.length ? ds * 0.9 : 0) };
      smallest = attempt;
      if (fits && (!best || attempt.score > best.score)) best = attempt;
      if (fits || !words) break;
    }
    // Same sizes, kept: nothing larger is left to find.
    if (best && best.label?.size === labelSize && best.detailSize === Math.min(detailSize, labelSize + 1)) break;
  }
  best ??= smallest;
  const b = best!;
  const start = rect.y + TOP + Math.max(0, (room - b.height) / 2);
  const labelY = start + (b.label ? b.label.size * 0.9 : 0);
  const labelH = b.label ? b.label.lines.length * b.label.size * LABEL_LEAD : 0;
  const detailY = start + labelH + (b.label ? GAP : 0) + b.detailSize * 0.9;
  return { label: b.label, detail: b.detail, detailSize: b.detailSize, labelY, detailY, labelLead: LABEL_LEAD, detailLead: DETAIL_LEAD, fits: b.fits };
}
