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
  return pages.length > 1 ? `Pages ${pages[0]}-${pages[pages.length - 1]}` : `Page ${pages[0] ?? 1}`;
}

function partitionBlocks(blocks: SuprnotesContentBlock[], target: number): SuprnotesContentBlock[][] {
  if (target <= 1) return [blocks];
  const weights = blocks.map((block) =>
    Math.max(80, clean(block.text, 10_000).length + (block.items ?? []).join(" ").length + (block.rows ?? []).flat().join(" ").length)
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  const groups: SuprnotesContentBlock[][] = [];
  let cursor = 0;
  let remainingWeight = total;
  for (let groupIndex = 0; groupIndex < target && cursor < blocks.length; groupIndex += 1) {
    const groupsRemaining = target - groupIndex;
    const desired = remainingWeight / groupsRemaining;
    const group: SuprnotesContentBlock[] = [];
    let groupWeight = 0;
    while (cursor < blocks.length) {
      const blocksAfter = blocks.length - (cursor + 1);
      if (group.length && groupWeight >= desired && blocksAfter >= groupsRemaining - 1) break;
      group.push(blocks[cursor]);
      groupWeight += weights[cursor];
      remainingWeight -= weights[cursor];
      cursor += 1;
      if (blocks.length - cursor < groupsRemaining - 1) break;
    }
    if (group.length) groups.push(group);
  }
  if (cursor < blocks.length) groups[groups.length - 1].push(...blocks.slice(cursor));
  return groups;
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
 * Builds a complete semantic plan from the PDF. Content stays in source order, but pages are
 * divided into teachable concepts rather than becoming screenshot slides.
 */
export function buildPdfLessonPlan(blocks: SuprnotesContentBlock[], assets: SuprnotesAsset[]) {
  const orderedBlocks = [...blocks].sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  const totalText = orderedBlocks.reduce((sum, block) =>
    sum + clean(block.text, 10_000).length + (block.items ?? []).join(" ").length + (block.rows ?? []).flat().join(" ").length, 0);
  const desiredTeachingBeats = Math.max(
    Math.min(10, orderedBlocks.length),
    Math.min(20, orderedBlocks.length, Math.ceil(totalText / 1_100)),
  );
  const groups = partitionBlocks(orderedBlocks, Math.max(1, desiredTeachingBeats));
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

    const shouldCheckpoint = offset > 0 && offset < groups.length - 1 && (offset + 1) % 5 === 0;
    if (shouldCheckpoint) {
      beats.push({
        id: `pdf-${beats.length + 1}`,
        title: "Pause and connect",
        objective: "Check whether the learner can connect the preceding PDF concepts before continuing, without introducing new source content.",
        sourceBlockIds: [],
        pageNumbers: pageGroup,
        visualMode: "checkpoint",
      });
    }
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
