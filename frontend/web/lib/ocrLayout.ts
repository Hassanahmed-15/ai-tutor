/**
 * WHERE ON A SCANNED PAGE EACH PARAGRAPH SITS.
 *
 * A scanned page has no text layer, so its paragraphs come from the vision transcription
 * (lib/pdfOcr.ts `blocksFromTranscript`) — with no position. The source panel can only box a
 * passage it can place, so a strict lesson on a scanned textbook lit the whole page with a yellow
 * edge and drew no box and no arrow to the board, while a text-layer PDF got both.
 *
 * Tesseract reads the same page image for line POSITIONS only (its words are never taught — the
 * vision transcript stays the text). Each transcribed paragraph is placed where the lines carrying
 * its words are. It runs beside the vision call, which is several times slower, so it adds no wait;
 * without the binary it returns null and the page keeps its old edge marker.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type NormalisedBox = { x: number; y: number; width: number; height: number };
export type OcrLine = NormalisedBox & { tokens: string[] };

const TESSERACT = process.env.TESSERACT_BINARY ?? "tesseract";
const TIMEOUT_MS = 20_000;

function tokens(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").match(/[a-z0-9]+/g) ?? []).filter((token) => token.length >= 2);
}

/** Tesseract TSV → text lines, in page-normalised coordinates. Pure, so it is tested directly. */
export function linesFromTsv(tsv: string): OcrLine[] {
  const rows = tsv.split("\n").slice(1).map((row) => row.split("\t"));
  const pageRow = rows.find((row) => row[0] === "1");
  const pageWidth = Number(pageRow?.[8]);
  const pageHeight = Number(pageRow?.[9]);
  if (!(pageWidth > 0 && pageHeight > 0)) return [];
  const lines = new Map<string, { left: number; top: number; right: number; bottom: number; words: string[] }>();
  for (const row of rows) {
    if (row[0] !== "5" || !row[11]?.trim()) continue;
    const key = `${row[2]}:${row[3]}:${row[4]}`;
    const left = Number(row[6]);
    const top = Number(row[7]);
    const right = left + Number(row[8]);
    const bottom = top + Number(row[9]);
    const line = lines.get(key) ?? { left, top, right, bottom, words: [] };
    line.left = Math.min(line.left, left);
    line.top = Math.min(line.top, top);
    line.right = Math.max(line.right, right);
    line.bottom = Math.max(line.bottom, bottom);
    line.words.push(row[11]);
    lines.set(key, line);
  }
  return [...lines.values()].map((line) => ({
    x: line.left / pageWidth,
    y: line.top / pageHeight,
    width: (line.right - line.left) / pageWidth,
    height: (line.bottom - line.top) / pageHeight,
    tokens: tokens(line.words.join(" ")),
  }));
}

/**
 * The regions Tesseract's layout pass found to be PICTURES, not text: it reports each as a word
 * with no characters. On a scanned textbook these are the drawings — a tree, a circuit — and they
 * are the only place a scan says where its figures are.
 */
export function graphicsFromTsv(tsv: string): NormalisedBox[] {
  const rows = tsv.split("\n").slice(1).map((row) => row.split("\t"));
  const pageRow = rows.find((row) => row[0] === "1");
  const pageWidth = Number(pageRow?.[8]);
  const pageHeight = Number(pageRow?.[9]);
  if (!(pageWidth > 0 && pageHeight > 0)) return [];
  return rows
    .filter((row) => row[0] === "5" && row.length >= 12 && !row[11]?.trim())
    .map((row) => ({ x: Number(row[6]) / pageWidth, y: Number(row[7]) / pageHeight, width: Number(row[8]) / pageWidth, height: Number(row[9]) / pageHeight }))
    // A stray rule or speck is not a figure.
    .filter((box) => box.width * box.height >= 0.01 && box.width >= 0.08 && box.height >= 0.04);
}

export type OcrPageLayout = { lines: OcrLine[]; graphics: NormalisedBox[] };

/** The page's text lines, or null when Tesseract is unavailable or fails. */
export async function ocrLines(png: Buffer): Promise<OcrLine[] | null> {
  return (await ocrPageLayout(png))?.lines ?? null;
}

/**
 * Where each printed figure sits, found from its CAPTION: a textbook prints "Figure 19.3 …" directly
 * under the drawing, so the figure is what lies between that caption and the text above it —
 * tightened to the picture regions Tesseract marked there, when it marked any.
 *
 * Returns the figure's box keyed by the caption block's index. A caption with nothing above it but
 * text (a caption printed above a table, say) gets no box rather than a crop of prose.
 */
export function figureRegionsFromCaptions(
  blocks: Array<{ text: string; bbox?: NormalisedBox }>,
  layout: OcrPageLayout,
): Map<number, NormalisedBox> {
  const regions = new Map<number, NormalisedBox>();
  const prose = layout.lines.filter((line) => line.tokens.filter((token) => /[a-z]{3,}/.test(token)).length >= 2);
  blocks.forEach((block, index) => {
    const caption = block.bbox;
    if (!caption || !/^\s*fig(?:ure|\.)?\s*\d/i.test(block.text)) return;
    const left = caption.x - 0.12;
    const right = caption.x + caption.width + 0.12;
    const overlaps = (box: NormalisedBox) => box.x < right && box.x + box.width > left;
    // The nearest text above the caption bounds the figure: another caption, a paragraph, the running head.
    const ceiling = Math.max(
      0.03,
      ...prose.filter((line) => overlaps(line) && line.y + line.height <= caption.y - 0.004).map((line) => line.y + line.height),
    );
    const floor = caption.y - 0.004;
    if (floor - ceiling < 0.05) return;
    const pictures = layout.graphics.filter((box) => overlaps(box) && box.y + box.height / 2 > ceiling && box.y + box.height / 2 < floor);
    const pad = 0.015;
    // The drawing is at least as wide as its caption. Tesseract's picture regions only TIGHTEN that,
    // and only when together they span most of it: on a two-tree figure it marked the top of one
    // tree alone, and trusting that crop cut the other tree off.
    const span = pictures.length ? Math.max(...pictures.map((p) => p.x + p.width)) - Math.min(...pictures.map((p) => p.x)) : 0;
    const trusted = span >= caption.width * 0.8;
    const box = {
      x: Math.min(caption.x - 0.02, ...(trusted ? pictures.map((p) => p.x - pad) : [])),
      y: trusted ? Math.max(ceiling, Math.min(...pictures.map((p) => p.y)) - pad) : ceiling + 0.004,
      right: Math.max(caption.x + caption.width + (trusted ? pad : 0.08), ...(trusted ? pictures.map((p) => p.x + p.width + pad) : [])),
      // Down to the caption either way: the panel letters "(a)" "(b)" sit below the drawing's picture box.
      bottom: floor,
    };
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    regions.set(index, { x, y, width: Math.min(1, box.right) - x, height: Math.min(1, box.bottom) - y });
  });
  return regions;
}

/** The page's text lines and picture regions, or null when Tesseract is unavailable or fails. */
export async function ocrPageLayout(png: Buffer): Promise<OcrPageLayout | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ocr-layout-"));
  try {
    const file = path.join(dir, "page.png");
    await writeFile(file, png);
    /*
     * THE RESOLUTION, SAID OUT LOUD FOR A HIGH-RES RENDER. The upload's 400 DPI page (PyMuPDF) says
     * 96 DPI in its metadata, so Tesseract took its text for giant type and read 24 lines of a
     * 39-line page — both margin notes lost, and with them their boxes. A PNG's width is its only
     * honest clue: a page is about 8.5 in wide. A low-res render (144 DPI, pdf.js) reads best with
     * no hint at all — a hint there dropped every line — so it is given none.
     */
    const width = png.length >= 24 ? png.readUInt32BE(16) : 0;
    const dpi = Math.round(width / 8.5);
    const hint = dpi >= 250 ? ["--dpi", String(dpi)] : [];
    const tsv = await new Promise<string>((resolve, reject) => {
      execFile(TESSERACT, [file, "stdout", ...hint, "--psm", "3", "tsv"], { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
    });
    return { lines: linesFromTsv(tsv), graphics: graphicsFromTsv(tsv) };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Lines belong to one paragraph when they share a column and nearly touch vertically. */
function adjacent(a: NormalisedBox, b: NormalisedBox, lineHeight: number): boolean {
  const overlapsHorizontally = a.x < b.x + b.width && b.x < a.x + a.width;
  const gap = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return overlapsHorizontally && gap <= lineHeight * 2.5;
}

/** The largest group of mutually adjacent lines (a paragraph is one block of lines, in one column). */
function largestGroup(own: OcrLine[], lineHeight: number): OcrLine[] {
  const groups: OcrLine[][] = [];
  for (const line of [...own].sort((a, b) => a.y - b.y)) {
    const touching = groups.filter((group) => group.some((other) => adjacent(line, other, lineHeight)));
    const merged = [line, ...touching.flat()];
    for (const group of touching) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  const weight = (group: OcrLine[]) => group.reduce((n, line) => n + line.tokens.length, 0);
  return groups.reduce((a, b) => (weight(b) > weight(a) ? b : a), [] as OcrLine[]);
}

function boundsOf(lines: OcrLine[], pad = 0): NormalisedBox {
  const left = Math.max(0, Math.min(...lines.map((line) => line.x)) - pad);
  const top = Math.max(0, Math.min(...lines.map((line) => line.y)) - pad);
  const right = Math.min(1, Math.max(...lines.map((line) => line.x + line.width)) + pad);
  const bottom = Math.min(1, Math.max(...lines.map((line) => line.y + line.height)) + pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A box for each block from the lines that carry its words, or undefined where none can be trusted.
 *
 * A line's candidates are the blocks holding at least 60% of its words. A line with one clear
 * candidate is placed at once. A short line of common words ("disconnect the tree") fits several
 * paragraphs equally well — assigned by words alone, a margin note's lines went to the main
 * paragraph beside it, splitting both. So an ambiguous line goes to the candidate whose clearly
 * placed lines it TOUCHES (same column, next line). Each block keeps its largest group of adjacent
 * lines, which drops a stray match elsewhere on the page.
 */
export function locateBlocks(blocks: Array<{ text: string }>, lines: OcrLine[]): Array<NormalisedBox | undefined> {
  const blockTokens = blocks.map((block) => new Set(tokens(block.text)));
  const readable = lines.filter((line) => line.tokens.length >= 2);
  if (!readable.length) return blocks.map(() => undefined);
  const lineHeight = readable.map((line) => line.height).sort((a, b) => a - b)[Math.floor(readable.length / 2)];
  const assigned: OcrLine[][] = blocks.map(() => []);
  const ambiguous: Array<{ line: OcrLine; candidates: number[] }> = [];

  for (const line of readable) {
    const shares = blockTokens.map((set) => line.tokens.filter((token) => set.has(token)).length / line.tokens.length);
    const top = Math.max(...shares);
    // A paragraph's last line is often a hyphen tail ("dled automatically"): a weaker match is kept
    // as a candidate, but only ever placed next to lines already placed.
    if (top < 0.5) continue;
    const candidates = shares.flatMap((share, index) => (share >= top - 0.15 && share >= 0.5 ? [index] : []));
    if (candidates.length === 1 && top >= 0.6) assigned[candidates[0]].push(line);
    else ambiguous.push({ line, candidates });
  }

  // Anchors grow from the clear lines outwards, so an ambiguous line can never pull a paragraph into
  // another column — it joins only a paragraph it touches, and each placement may place the next.
  let pending = ambiguous;
  for (let changed = true; changed && pending.length; ) {
    changed = false;
    const anchors = assigned.map((own) => largestGroup(own, lineHeight));
    pending = pending.filter(({ line, candidates }) => {
      const touching = candidates.filter((index) => anchors[index].some((other) => adjacent(line, other, lineHeight)));
      if (touching.length !== 1) return true;
      assigned[touching[0]].push(line);
      changed = true;
      return false;
    });
  }

  return assigned.map((own, index) => {
    const group = largestGroup(own, lineHeight);
    if (!group.length) return undefined;
    // Too little of the paragraph was found to say where it is.
    const found = group.reduce((n, line) => n + line.tokens.filter((token) => blockTokens[index].has(token)).length, 0);
    if (found < Math.min(6, blockTokens[index].size * 0.4)) return undefined;
    return boundsOf(group, 0.004);
  });
}
