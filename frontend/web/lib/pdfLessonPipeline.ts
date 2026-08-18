import type { SuprnotesAsset, SuprnotesContentBlock } from "./suprnotes";

export type PdfTextSpan = {
  text: string;
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontName?: string;
};

export type PdfFigureRegion = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfDetectedFigure = {
  type: "photo" | "diagram" | "chart" | "graph" | "table" | "flowchart" | "illustration" | "formula" | "map" | "other";
  x: number;
  y: number;
  width: number;
  height: number;
  caption: string;
  description: string;
  focusRegions: PdfFigureRegion[];
  instructionalPriority: "high" | "medium" | "low";
  useInLesson: boolean;
  annotationNeeded: boolean;
};

type TextLine = {
  text: string;
  spans: PdfTextSpan[];
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  bold: boolean;
};

type PdfLessonPlanBeat = {
  id: string;
  title: string;
  objective: string;
  sourceBlockIds: string[];
  pageNumbers: number[];
  visualMode: string;
  recommendedVisual?: { type: string; assetId?: string; brief: string };
};

const BULLET_RE = /^(?:[-*•▪◦‣⁃]|\d+[.)]|[a-z][.)])\s+/i;
const FORMULA_RE = /(?:[=≈≠≤≥±∑∫√∞∆→←⇌^_]|[A-Za-z]\([^)]*\)\s*=|^\s*[\w().]+\s*[×÷]\s*[\w().]+\s*$)/;
const VISUAL_TYPES = new Set<PdfDetectedFigure["type"]>([
  "photo",
  "diagram",
  "chart",
  "graph",
  "table",
  "flowchart",
  "illustration",
  "formula",
  "map",
  "other",
]);

function clean(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function median(values: number[]): number {
  if (!values.length) return 11;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lineFromSpans(spans: PdfTextSpan[]): TextLine {
  const ordered = [...spans].sort((a, b) => a.x - b.x);
  let text = "";
  let previousEnd = ordered[0]?.x ?? 0;
  for (const span of ordered) {
    const gap = span.x - previousEnd;
    if (text && gap > Math.max(1.5, span.fontSize * 0.18) && !text.endsWith(" ")) text += " ";
    text += span.text;
    previousEnd = span.x + span.width;
  }
  const x = Math.min(...ordered.map((span) => span.x));
  const right = Math.max(...ordered.map((span) => span.x + span.width));
  return {
    text: clean(text),
    spans: ordered,
    x,
    top: Math.min(...ordered.map((span) => span.top)),
    width: Math.max(0, right - x),
    height: Math.max(...ordered.map((span) => span.height)),
    fontSize: Math.max(...ordered.map((span) => span.fontSize)),
    bold: ordered.some((span) => /bold|black|semibold|demi/i.test(span.fontName ?? "")),
  };
}

function buildLines(spans: PdfTextSpan[]): TextLine[] {
  const rows: PdfTextSpan[][] = [];
  const ordered = spans
    .filter((span) => clean(span.text))
    .sort((a, b) => a.top - b.top || a.x - b.x);

  for (const span of ordered) {
    const tolerance = Math.max(2.5, span.fontSize * 0.38);
    const row = rows.find((candidate) => {
      const rowTop = candidate.reduce((sum, item) => sum + item.top, 0) / candidate.length;
      return Math.abs(rowTop - span.top) <= tolerance;
    });
    if (row) row.push(span);
    else rows.push([span]);
  }

  return rows
    .map(lineFromSpans)
    .filter((line) => line.text)
    .sort((a, b) => a.top - b.top || a.x - b.x);
}

function orderReadingFlow(lines: TextLine[], pageWidth: number, pageHeight: number): TextLine[] {
  if (lines.length < 8) return lines;
  const bodySize = median(lines.map((line) => line.fontSize).filter((size) => size > 0));
  const header = lines.filter(
    (line) =>
      line.top < pageHeight * 0.18 &&
      (line.width > pageWidth * 0.55 || line.fontSize >= bodySize * 1.25)
  );
  const footer = lines.filter((line) => line.top > pageHeight * 0.93);
  const fixed = new Set([...header, ...footer]);
  const body = lines.filter((line) => !fixed.has(line));
  const left = body.filter((line) => line.x < pageWidth * 0.48);
  const right = body.filter((line) => line.x >= pageWidth * 0.48);
  const columnLike =
    left.length >= 3 &&
    right.length >= 3 &&
    body.filter((line) => line.width < pageWidth * 0.58).length >= body.length * 0.7;
  if (!columnLike) return lines;
  return [
    ...header.sort((a, b) => a.top - b.top || a.x - b.x),
    ...left.sort((a, b) => a.top - b.top || a.x - b.x),
    ...right.sort((a, b) => a.top - b.top || a.x - b.x),
    ...footer.sort((a, b) => a.top - b.top || a.x - b.x),
  ];
}

function tableCells(line: TextLine): string[] {
  if (line.spans.length < 2) return [];
  const cells: string[] = [];
  let current = "";
  let previousEnd = line.spans[0].x;
  for (const span of line.spans) {
    const gap = span.x - previousEnd;
    if (current && gap > Math.max(18, span.fontSize * 2.2)) {
      cells.push(clean(current, 260));
      current = "";
    }
    current += `${current ? " " : ""}${span.text}`;
    previousEnd = span.x + span.width;
  }
  if (current) cells.push(clean(current, 260));
  return cells.length >= 2 ? cells : [];
}

function blockBBox(lines: TextLine[], pageWidth: number, pageHeight: number) {
  const left = Math.min(...lines.map((line) => line.x));
  const top = Math.min(...lines.map((line) => line.top));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  const bottom = Math.max(...lines.map((line) => line.top + line.height));
  return {
    x: clamp01(left / pageWidth),
    y: clamp01(top / pageHeight),
    width: clamp01((right - left) / pageWidth),
    height: clamp01((bottom - top) / pageHeight),
  };
}

/**
 * Turns positioned PDF text into semantic blocks while preserving page and reading order.
 * Each block remains small enough to reach the lecture prompt without truncating a whole page.
 */
export function structurePdfPage(
  spans: PdfTextSpan[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number
): SuprnotesContentBlock[] {
  const lines = orderReadingFlow(buildLines(spans), pageWidth, pageHeight);
  if (!lines.length) return [];
  const bodySize = median(
    lines
      .filter((line) => line.text.length >= 24)
      .map((line) => line.fontSize)
  );
  const blocks: SuprnotesContentBlock[] = [];
  let sectionHeading = `Page ${pageNumber}`;
  let pending: TextLine[] = [];
  let pendingType: "paragraph" | "list" | "formula" | "table" = "paragraph";
  let serial = 0;

  const flush = () => {
    if (!pending.length) return;
    serial += 1;
    const id = `p${pageNumber}-b${serial}`;
    const bbox = blockBBox(pending, pageWidth, pageHeight);
    if (pendingType === "table") {
      const rows = pending.map(tableCells).filter((row) => row.length >= 2);
      blocks.push({
        id,
        type: "table",
        heading: sectionHeading,
        columns: rows[0] ?? [],
        rows: rows.slice(1),
        text: rows.map((row) => row.join(" | ")).join("\n"),
        sourceOrder: 0,
        pageNumber,
        bbox,
        role: "table",
      });
    } else if (pendingType === "list") {
      const items = pending
        .map((line) => line.text.replace(BULLET_RE, "").trim())
        .filter(Boolean);
      blocks.push({
        id,
        type: "list",
        heading: sectionHeading,
        items,
        text: items.join("\n"),
        sourceOrder: 0,
        pageNumber,
        bbox,
        role: "list",
      });
    } else {
      const text = pending.map((line) => line.text).join(pendingType === "formula" ? "\n" : " ");
      blocks.push({
        id,
        type: pendingType,
        heading: sectionHeading,
        text: clean(text, 2200),
        sourceOrder: 0,
        pageNumber,
        bbox,
        role: pendingType,
      });
    }
    pending = [];
  };

  for (const line of lines) {
    const isHeading =
      line.text.length <= 150 &&
      (line.fontSize >= bodySize * 1.28 || (line.bold && line.fontSize >= bodySize * 1.08));
    const cells = tableCells(line);
    const nextType: "paragraph" | "list" | "formula" | "table" = cells.length >= 2
      ? "table"
      : BULLET_RE.test(line.text)
        ? "list"
        : FORMULA_RE.test(line.text) && line.text.length <= 240
          ? "formula"
          : "paragraph";

    if (isHeading) {
      flush();
      sectionHeading = line.text;
      continue;
    }

    const previous = pending[pending.length - 1];
    const gap = previous ? line.top - (previous.top + previous.height) : 0;
    const paragraphTooLarge = pending.reduce((sum, item) => sum + item.text.length, 0) > 1600;
    if (pending.length && (nextType !== pendingType || gap > Math.max(bodySize * 1.55, 18) || paragraphTooLarge)) {
      flush();
    }
    pendingType = nextType;
    pending.push(line);
  }
  flush();
  return blocks;
}

export function sanitizeDetectedFigures(raw: unknown): PdfDetectedFigure[] {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const candidates = Array.isArray(record.figures) ? record.figures : [];
  const figures: PdfDetectedFigure[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const x = Number(item.x);
    const y = Number(item.y);
    const width = Number(item.width);
    const height = Number(item.height);
    if (![x, y, width, height].every(Number.isFinite)) continue;
    if (width < 0.04 || height < 0.04) continue;
    const left = clamp01(x);
    const top = clamp01(y);
    const right = clamp01(x + width);
    const bottom = clamp01(y + height);
    if (right - left < 0.04 || bottom - top < 0.04) continue;
    const rawType = clean(item.type, 30).toLowerCase() as PdfDetectedFigure["type"];
    const focusRegions = Array.isArray(item.focusRegions)
      ? item.focusRegions.flatMap((region) => {
          if (!region || typeof region !== "object") return [];
          const rec = region as Record<string, unknown>;
          const rx = Number(rec.x);
          const ry = Number(rec.y);
          const rw = Number(rec.width);
          const rh = Number(rec.height);
          if (![rx, ry, rw, rh].every(Number.isFinite)) return [];
          return [{
            label: clean(rec.label, 80),
            x: clamp01(rx),
            y: clamp01(ry),
            width: clamp01(rw),
            height: clamp01(rh),
          }];
        }).filter((region) => region.label).slice(0, 8)
      : [];
    figures.push({
      type: VISUAL_TYPES.has(rawType) ? rawType : "other",
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      caption: clean(item.caption, 240),
      description: clean(item.description, 700),
      focusRegions,
      instructionalPriority: item.instructionalPriority === "high" || item.instructionalPriority === "medium"
        ? item.instructionalPriority
        : "low",
      useInLesson: item.useInLesson === true,
      annotationNeeded: item.annotationNeeded === true,
    });
  }

  // Remove near-duplicate boxes but keep separate figures. Multipart panels should already be
  // returned as one complete box by the vision prompt.
  return figures
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .filter((figure, index, all) => !all.slice(0, index).some((other) => {
      const xOverlap = Math.max(0, Math.min(figure.x + figure.width, other.x + other.width) - Math.max(figure.x, other.x));
      const yOverlap = Math.max(0, Math.min(figure.y + figure.height, other.y + other.height) - Math.max(figure.y, other.y));
      const overlap = xOverlap * yOverlap;
      const smaller = Math.min(figure.width * figure.height, other.width * other.height);
      return smaller > 0 && overlap / smaller > 0.88;
    }))
    .slice(0, 8);
}

function pageNumbersForBlocks(blockIds: string[], blocks: SuprnotesContentBlock[]): number[] {
  const wanted = new Set(blockIds);
  return [...new Set(blocks.filter((block) => wanted.has(block.id)).map((block) => block.pageNumber).filter((page): page is number => typeof page === "number"))];
}

function titleForGroup(group: SuprnotesContentBlock[], pages: number[]): string {
  const heading = group.map((block) => clean(block.heading, 100)).find((value) => value && !/^Page \d+$/i.test(value));
  if (heading) return heading;

  /**
   * Fall back to the beat's own opening line before falling back to the page number.
   *
   * Beats are sub-page now, so several on one page would otherwise all be called "Page 1" — which
   * tells a student nothing and makes the lecture outline unreadable. The first line of the first
   * block is what a reader would call the section ("Step 2: Download HOL4"), so it is a far better
   * name than the sheet of paper it happened to be printed on.
   */
  /**
   * Skip blocks whose text cannot name anything.
   *
   * Figure labels leak into the text layer as fragments like "?" (a query point in a scatter plot)
   * or a bare axis number, and using one as a beat title produces an outline entry literally called
   * "?". Requiring a couple of word characters is enough to pass over them and reach the first
   * block that actually says something.
   */
  const meaningful = group.find((block) => {
    const text = clean(block.text, 100);
    return text && /[A-Za-z]{3,}/.test(text);
  });
  const opening = clean(meaningful?.text ?? group[0]?.text, 100);
  if (opening) {
    // Prefer the first sentence; a whole paragraph is not a title.
    //
    // A colon deliberately does NOT end the title: "Step 2: Download HOL4" splits at the colon into
    // the bare label "Step 2", which is exactly as uninformative as the "Page 1" this replaces.
    // Keeping the clause after it is what makes the outline readable.
    const firstLine = opening.split(/(?<=[.?!])\s|\s{2,}/)[0]?.trim() ?? opening;
    const candidate = firstLine.length >= 3 && firstLine.length <= 80 ? firstLine : opening.slice(0, 80).trim();
    if (candidate) return candidate.replace(/[.:;,]\s*$/, "");
  }
  return pages.length > 1 ? `Pages ${pages[0]}-${pages[pages.length - 1]}` : `Page ${pages[0] ?? 1}`;
}

function isInstructionalAsset(asset: SuprnotesAsset): boolean {
  if (!asset.teachingUse || typeof asset.teachingUse !== "object") return false;
  const use = asset.teachingUse as Record<string, unknown>;
  return use.useInLesson === true && (use.instructionalPriority === "high" || use.instructionalPriority === "medium");
}

function wantsAnimatedDiagram(group: SuprnotesContentBlock[], index: number): boolean {
  const text = group.map((block) => `${block.heading ?? ""} ${block.text ?? ""} ${(block.items ?? []).join(" ")}`).join(" ").toLowerCase();
  const visualTerms = /\b(?:process|cycle|flow|pathway|mechanism|structure|system|inside|stage|step|reaction|equation|convert|transfer|movement|compare|difference|relationship|cause|effect|graph|chart|table|cell|organ|molecule|circuit|timeline|map)\b/;
  return visualTerms.test(text) || index % 2 === 0;
}

function selectAnimatedGroups(groups: SuprnotesContentBlock[][]): Set<number> {
  const target = Math.min(8, Math.max(Math.min(4, groups.length), Math.round(groups.length * 0.5)));
  const selected = new Set<number>();
  if (groups.length) selected.add(0);
  while (selected.size < target) {
    let best: { index: number; score: number } | null = null;
    for (let index = 0; index < groups.length; index += 1) {
      if (selected.has(index)) continue;
      const group = groups[index];
      const nearest = Math.min(...Array.from(selected, (chosen) => Math.abs(chosen - index)));
      const score =
        (wantsAnimatedDiagram(group, index) ? 50 : 0) +
        (group.some((block) => block.type === "table" || block.type === "formula") ? 24 : 0) +
        Math.min(30, nearest * 9);
      if (!best || score > best.score) best = { index, score };
    }
    if (!best) break;
    selected.add(best.index);
  }
  return selected;
}


/**
 * Divide ordered blocks into teaching beats.
 *
 * WHY THIS IS NOT ONE-BEAT-PER-PAGE ANY MORE. It used to group strictly by `pageNumber`, which made
 * the plan a function of where the PDF happened to break rather than of what it teaches. That has
 * two failure modes, and both were reported:
 *
 *  1. A one-page upload became a ONE-BEAT lecture no matter how much was on it. A single page of
 *     an install guide with four distinct steps, or a page deriving Simpson's 1/3 Rule across
 *     sixteen blocks, collapsed into a single beat — the whole lesson, in one breath.
 *  2. Generation failed outright. `applyPdfPlanMetadata` requires the model to return EXACTLY the
 *     planned beat count, so when a page held obviously separable ideas the model would return
 *     several beats, the count would mismatch, and the request died as "Couldn't build that
 *     lecture" — after the student had already waited through the upload.
 *
 * Page boundaries still matter (a new page usually IS a new idea, and never merging across pages
 * keeps citations honest), so they remain a hard split. Within a page we additionally split on
 * headings, because a heading is the document's own statement that a new idea starts here.
 *
 * Splitting is bounded on both ends. A beat needs enough substance to be worth teaching, so groups
 * below MIN_BLOCKS_PER_BEAT are merged back into the previous one; and a page with no headings but
 * a lot of blocks is divided evenly rather than left as a single wall, since "no heading" usually
 * means the author's structure is visual rather than absent.
 */
const MIN_BLOCKS_PER_BEAT = 2;
const MAX_BLOCKS_PER_BEAT = 7;

/**
 * Recognises a block that starts a new idea.
 *
 * `heading` alone is not the signal it looks like. The PDF extractor stamps a PAGE LABEL — literally
 * "Page 1" — onto every block of a page, so testing it either makes every block a boundary or none
 * of them, and neither reflects the document. The structure of an unstyled PDF usually survives in
 * the TEXT instead: "Step 3:", "4b.", "Chapter 2 —". Those enumerators are what a reader uses to see
 * where one idea ends, so they are what this looks for.
 *
 * A distinct per-block heading, when the extractor provides one, is still honoured — it is a
 * stronger signal than any pattern. The page-label case is excluded by the caller, which only trusts
 * `heading` when it actually varies within the page.
 */
const ENUMERATOR = /^\s*(?:step\s+\d+|part\s+\d+|chapter\s+\d+|section\s+\d+|\d+[a-z]?[.)]|[ivx]+[.)]|[a-z][.)])\s*[:.\-\u2014]?\s+/i;

function startsNewIdea(
  block: SuprnotesContentBlock,
  headingIsMeaningful: boolean,
  previousHeading: string | null,
): boolean {
  // A heading marks a boundary only where it CHANGES. Consecutive blocks sharing one heading are
  // that section's body, so treating each as a fresh start would shatter the section into
  // single-block beats rather than keeping it whole.
  if (headingIsMeaningful) {
    const heading = (block.heading ?? "").trim();
    if (heading && heading !== previousHeading) return true;
  }
  const text = (block.text ?? "").trimStart();
  if (!text) return false;
  // Headings and titles are their own boundary regardless of numbering.
  if (block.type === "heading") return true;
  return ENUMERATOR.test(text);
}

export function groupBlocksIntoBeats(orderedBlocks: SuprnotesContentBlock[]): SuprnotesContentBlock[][] {
  // 1. Page boundaries are absolute: a beat never spans two pages.
  const pages: SuprnotesContentBlock[][] = [];
  const pageIndex = new Map<number | string, number>();
  for (const block of orderedBlocks) {
    const pageKey = typeof block.pageNumber === "number" ? block.pageNumber : `s${block.sourceOrder ?? 0}`;
    let idx = pageIndex.get(pageKey);
    if (idx === undefined) {
      idx = pages.length;
      pageIndex.set(pageKey, idx);
      pages.push([]);
    }
    pages[idx].push(block);
  }

  const groups: SuprnotesContentBlock[][] = [];
  for (const page of pages) {
    // 2. Split on the document's own structure.
    //    `heading` is only trusted when it VARIES within the page — a value repeated on every
    //    block is the extractor's page label ("Page 1"), which says nothing about where ideas
    //    begin. When it is uniform, the enumerators in the text carry the structure instead.
    const headings = new Set(page.map((b) => (b.heading ?? "").trim()).filter(Boolean));
    const headingIsMeaningful = headings.size > 1;

    let sections: SuprnotesContentBlock[][] = [];
    let previousHeading: string | null = null;
    for (const block of page) {
      const boundary = startsNewIdea(block, headingIsMeaningful, previousHeading);
      previousHeading = (block.heading ?? "").trim() || previousHeading;
      if (!sections.length || (boundary && sections[sections.length - 1].length)) {
        sections.push([block]);
      } else {
        sections[sections.length - 1].push(block);
      }
    }

    // 3. No headings but plenty of material: divide evenly rather than emit one oversized beat.
    if (sections.length === 1 && sections[0].length > MAX_BLOCKS_PER_BEAT) {
      const blocks = sections[0];
      const partCount = Math.ceil(blocks.length / MAX_BLOCKS_PER_BEAT);
      const perPart = Math.ceil(blocks.length / partCount);
      sections = [];
      for (let i = 0; i < blocks.length; i += perPart) sections.push(blocks.slice(i, i + perPart));
    }

    // 4. Merge back anything too thin to stand alone as a beat.
    //
    //    A section that OPENED with an explicit boundary is exempt. When a page is a list of short
    //    numbered steps, every section is one block, and merging them on size alone would undo the
    //    split entirely and hand back the single mega-beat this function exists to prevent. An
    //    unlabelled fragment carries no such claim, so it still merges.
    const openedExplicitly = new Set<SuprnotesContentBlock[]>();
    for (const section of sections) {
      if (section.length && startsNewIdea(section[0], headingIsMeaningful, null)) {
        openedExplicitly.add(section);
      }
    }
    for (const section of sections) {
      const previous = groups[groups.length - 1];
      const canMerge =
        previous &&
        !openedExplicitly.has(section) &&
        section.length < MIN_BLOCKS_PER_BEAT &&
        previous.length + section.length <= MAX_BLOCKS_PER_BEAT &&
        // Only merge within the same page, so the page-boundary rule above still holds.
        previous[0]?.pageNumber === section[0]?.pageNumber;
      if (canMerge) previous.push(...section);
      else groups.push(section);
    }
  }

  return groups;
}

/**
 * Builds a complete semantic plan from the PDF. Content stays in source order, but pages are
 * divided into teachable concepts rather than becoming screenshot slides.
 */
export function buildPdfLessonPlan(blocks: SuprnotesContentBlock[], assets: SuprnotesAsset[]) {
  const orderedBlocks = [...blocks].sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  // Teaching beats follow the CONTENT, not the page breaks — see groupBlocksIntoBeats.
  const groups: SuprnotesContentBlock[][] = groupBlocksIntoBeats(orderedBlocks);
  const beats: PdfLessonPlanBeat[] = [];
  const usedAssets = new Set<string>();
  const maximumImageBeats = Math.min(3, Math.max(1, Math.round(groups.length * 0.22)));
  const animatedGroups = selectAnimatedGroups(groups);

  for (let offset = 0; offset < groups.length; offset += 1) {
    const group = groups[offset];
    const sourceBlockIds = group.map((block) => block.id);
    const pageGroup = pageNumbersForBlocks(sourceBlockIds, orderedBlocks);
    const primaryAsset = assets.find((asset) =>
      !usedAssets.has(asset.id) &&
      isInstructionalAsset(asset) &&
      asset.sourceBlockIds?.some((id) => sourceBlockIds.includes(id))
    );
    const useImage = Boolean(primaryAsset) && usedAssets.size < maximumImageBeats && offset > 0;
    if (useImage && primaryAsset) usedAssets.add(primaryAsset.id);
    const hasTable = group.some((block) => block.type === "table");
    const hasFormula = group.some((block) => block.type === "formula");
    const title = titleForGroup(group, pageGroup);
    const useSvg = !useImage && animatedGroups.has(offset);
    beats.push({
      id: `pdf-${beats.length + 1}`,
      title,
      objective: `Teach these source blocks completely and in order${pageGroup.length ? ` from page${pageGroup.length > 1 ? "s" : ""} ${pageGroup.join("-")}` : ""}, connecting them as one coherent explanation.`,
      sourceBlockIds,
      pageNumbers: pageGroup,
      visualMode: useImage ? "provided_image" : useSvg ? "svg_diagram" : "paper_whiteboard",
      recommendedVisual: useImage && primaryAsset
        ? {
            type: "provided_image",
            assetId: primaryAsset.id,
            brief: `Use this exact cropped ${primaryAsset.visualType ?? "figure"} only because it materially supports this explanation. Add annotations only where the narration explicitly discusses a visible part.`,
          }
        : useSvg
          ? {
              type: "svg_diagram",
              brief: hasTable
                ? "Animate a clean whiteboard reconstruction of the exact table or comparison without changing its values."
                : "Build a content-specific premium whiteboard SVG in the same teaching sequence as a prompted lecture: write, draw, connect, label, and annotate progressively.",
            }
          : hasFormula
            ? { type: "paper_whiteboard", brief: "Write the exact formula and derive or explain each term progressively." }
            : { type: "paper_whiteboard", brief: "Use a sentence-synchronized marker board with concise source-grounded claims and relationships." },
    });
  }

  return {
    sourceType: "uploaded_pdf",
    strategy: "document_order_complete_coverage",
    targetBeatCount: beats.length,
    preserveSourceOrder: true,
    requireCompleteCoverage: true,
    contentBlockIds: orderedBlocks.map((block) => block.id),
    assetIds: [...usedAssets],
    beats,
  };
}

export function applyGlobalSourceOrder(blocks: SuprnotesContentBlock[]): void {
  blocks
    .sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0) || (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0))
    .forEach((block, index) => {
      block.sourceOrder = index;
    });
}

export function sourcePagesForAsset(asset: SuprnotesAsset, blocks: SuprnotesContentBlock[]): number[] {
  return pageNumbersForBlocks(asset.sourceBlockIds ?? [], blocks);
}
