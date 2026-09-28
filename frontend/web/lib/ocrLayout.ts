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

/** The page's text lines, or null when Tesseract is unavailable or fails. */
export async function ocrLines(png: Buffer): Promise<OcrLine[] | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ocr-layout-"));
  try {
    const file = path.join(dir, "page.png");
    await writeFile(file, png);
    const tsv = await new Promise<string>((resolve, reject) => {
      execFile(TESSERACT, [file, "stdout", "--psm", "3", "tsv"], { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
    });
    return linesFromTsv(tsv);
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
