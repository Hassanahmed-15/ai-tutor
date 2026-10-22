import type { SuprnotesContentBlock, SuprnotesLessonInput } from "../suprnotes";
import { looksLikeCode } from "../codeSpec";
import { contentStems } from "../sourceGrounding";
import type { CanvasPlanBeat } from "./types";

/**
 * WHAT A REFERENCE-MODE DOCUMENT LECTURE KNOWS ABOUT ITS DOCUMENT — pure, so it is unit-tested
 * (lib/anim/documentCanvas.test.ts).
 *
 * A PDF used "as a reference" is taught on the lesson canvas, exactly like a typed prompt; the only
 * difference is that the planner and every board also read the document. They used to see a gist:
 * the outline planner the first 40 blocks at 220 characters each, each slide up to 4 blocks picked
 * by matching the question's words. "explain me AVL code" kept only the stem "cod", which no code
 * listing contains, and the deletion routine (Figure 4.47) never reached the lecture.
 *
 * Here the whole document travels, page by page, and every code listing is rebuilt WHOLE. The parse
 * shreds a printed listing: one line per table row ("9 | if( t == nullptr )"), several lines run
 * together in a paragraph ("1 /** 2 * Return the height… 4 int height( AvlNode *t ) const 5 {"), a
 * lone "7" for a blank line, the caption glued to the last line ("40 } Figure 4.42 Insertion…").
 * A book numbers its lines, so the listing is read back by following 1, 2, 3… to its caption.
 */

export type DocumentListing = {
  /** 1-based, in reading order: what the planner and the boards call it ("listing 3"). */
  n: number;
  page: number;
  /** The printed caption ("Figure 4.47 Deletion in an AVL tree"), or "" when it has none. */
  caption: string;
  /** The code, one entry per printed line, without the line numbers. Indentation is lost in the parse. */
  lines: string[];
  /** The blocks it was rebuilt from. */
  blockIds: string[];
  /** For each printed line (index = line - 1), the block it was read from — so a lit line can be boxed on the PDF. */
  lineBlocks: string[];
};

/** A code board shows at most this many lines (lib/canvas/validate.ts keeps 18; two spare). */
export const CANVAS_CODE_LINES = 16;

const CAPTION = /\b(?:Figure|Fig\.|Listing|Program|Code|Algorithm)\s+\d+(?:\.\d+)*\b/;

/** A block's text with the parse's table separators removed — never a real `||`. */
function flatText(block: SuprnotesContentBlock): string {
  // A table or list block carries its content twice — as `text` and as its rows or items — so the
  // rows and items are read only when there is no text.
  const text = block.text?.trim() ? block.text : block.items?.length ? block.items.join("\n") : (block.rows ?? []).map((row) => row.join(" | ")).join("\n");
  return text.replace(/\r/g, "").replace(/(?<!\|)[ \t]*\|[ \t]*(?!\|)/g, " ");
}

/** Blocks in reading order: by page, then where they sit on it. */
function ordered(doc: SuprnotesLessonInput): SuprnotesContentBlock[] {
  // Several files uploaded together (lib/mergeSourceDocuments.ts) each start again at page 1.
  const files: string[] = [];
  for (const block of doc.contentBlocks ?? []) if (!files.includes(block.documentLabel ?? "")) files.push(block.documentLabel ?? "");
  return (doc.contentBlocks ?? [])
    .map((block, index) => ({ block, index, file: files.indexOf(block.documentLabel ?? "") }))
    .sort((a, b) => a.file - b.file || (a.block.pageNumber ?? 0) - (b.block.pageNumber ?? 0) || (a.block.sourceOrder ?? a.index) - (b.block.sourceOrder ?? b.index) || a.index - b.index)
    .map((entry) => entry.block);
}

/** One page of one file: merged uploads each start again at page 1. */
function sheetOf(block: SuprnotesContentBlock): string {
  return `${block.documentLabel ?? ""}#${block.pageNumber ?? 0}`;
}

function sameSheet(a: SuprnotesContentBlock, b: SuprnotesContentBlock): boolean {
  return sheetOf(a) === sheetOf(b);
}

/**
 * Reads "1 text 2 text … n text" back into lines. Each number must be the next one; the text between
 * two numbers is a line (empty for a blank line).
 */
export function numberedLines(stream: string): string[] {
  const text = stream.replace(/\s+/g, " ").trim();
  const start = /^1(?=\s|$)/.exec(text);
  if (!start) return [];
  const lines: string[] = [];
  let pos = start[0].length;
  for (let n = 2; ; n++) {
    const next = new RegExp(`(?:^|\\s)${n}(?=\\s|$)`, "g");
    next.lastIndex = pos;
    const found = next.exec(text);
    if (!found) {
      lines.push(text.slice(pos).trim());
      break;
    }
    lines.push(text.slice(pos, found.index).trim());
    pos = found.index + found[0].length;
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/** Every code listing in the document, rebuilt whole, in reading order. */
/**
 * THE LISTINGS A CODE QUESTION NAMES. "Explain the code for a single rotation" was answered with all
 * six listings of an AVL chapter — node, height, insert, balance, double rotation, delete — in nine
 * boards (PDF bench, 2026-10-18). The question's words are matched against each listing's caption
 * and the names in its code ("rotateWithLeftChild" → rotate, with, left, child): the best-matching
 * listings are the answer. A question that names nothing in particular ("explain the code") gets all.
 */
const GENERIC_CODE_WORDS = /^(?:expla|code|codes|codin|routi|funct|metho|progr|imple|algor|works|work|does|what|how|show|tell|about|this|that|the|for|and|with|step|steps|line|lines|each|happe|write|writt)$/;
export function listingsAsked(question: string, listings: DocumentListing[]): DocumentListing[] {
  const stem = (w: string) => w.toLowerCase().slice(0, 5);
  const asked = [...new Set((question.match(/[A-Za-z]{4,}/g) ?? []).map(stem).filter((w) => !GENERIC_CODE_WORDS.test(w)))];
  if (!asked.length || listings.length <= 1) return listings;
  const words = (l: DocumentListing) => new Set(`${l.caption} ${l.lines.join(" ")}`.replace(/([a-z])([A-Z])/g, "$1 $2").match(/[A-Za-z]{4,}/g)?.map(stem) ?? []);
  const sets = listings.map(words);
  // A word in half the listings or more is the document's subject, not a pick: "explain me AVL tree
  // coding" was narrowed to the four listings whose captions say "tree", dropping the node and height code.
  const picking = asked.filter((a) => sets.filter((w) => w.has(a)).length * 2 < listings.length);
  const scored = listings.map((l, i) => ({ l, score: picking.filter((a) => sets[i].has(a)).length }));
  const best = Math.max(...scored.map((x) => x.score));
  // Only a clear pick narrows the answer: the best listings must match more of the question than the rest.
  const picked = scored.filter((x) => x.score === best).map((x) => x.l);
  return best >= 1 && picked.length < listings.length && scored.some((x) => x.score < best) ? picked : listings;
}

export function documentListings(doc: SuprnotesLessonInput | null | undefined): DocumentListing[] {
  if (!doc) return [];
  const blocks = ordered(doc);
  const listings: Omit<DocumentListing, "n">[] = [];
  const used = new Set<string>();

  // 1. Numbered listings: a block that starts at line 1, and the blocks on its page that carry on
  //    numbering until its caption.
  for (let i = 0; i < blocks.length; i++) {
    const first = flatText(blocks[i]).replace(/\s+/g, " ").trim();
    if (!/^1\s+\S/.test(first)) continue;
    const page = blocks[i].pageNumber ?? 0;
    const parts: string[] = [];
    const ids: string[] = [];
    const starts: Array<{ id: string; from: number }> = [];
    let caption = "";
    let j = i;
    for (; j < blocks.length && sameSheet(blocks[j], blocks[i]); j++) {
      const text = flatText(blocks[j]).replace(/\s+/g, " ").trim();
      const from = Number(/^(\d+)/.exec(text)?.[1] ?? NaN);
      if (Number.isFinite(from)) starts.push({ id: blocks[j].id, from });
      if (j > i && (!/^\d+(?:\s|$)/.test(text) || /^1\s+\S/.test(text))) break;
      const at = text.search(CAPTION);
      ids.push(blocks[j].id);
      if (at >= 0) {
        parts.push(text.slice(0, at));
        caption = text.slice(at).trim().slice(0, 120);
        j++;
        break;
      }
      parts.push(text);
    }
    const lines = numberedLines(parts.join(" "));
    if (lines.length >= 3 && looksLikeCode(lines.join("\n"))) {
      // A printed line belongs to the last block that starts at or before its number.
      const lineBlocks = lines.map((_, k) => [...starts].reverse().find((st) => st.from <= k + 1)?.id ?? ids[0]);
      listings.push({ page, caption, lines, blockIds: ids, lineBlocks });
      ids.forEach((id) => used.add(id));
      i = j - 1;
    }
  }

  // 2. Unnumbered listings: consecutive code blocks on one page, kept line for line.
  for (let i = 0; i < blocks.length; i++) {
    if (used.has(blocks[i].id) || !looksLikeCode(flatText(blocks[i]))) continue;
    const page = blocks[i].pageNumber ?? 0;
    const ids: string[] = [];
    const lines: string[] = [];
    const lineBlocks: string[] = [];
    let j = i;
    for (; j < blocks.length && sameSheet(blocks[j], blocks[i]) && !used.has(blocks[j].id); j++) {
      const text = flatText(blocks[j]);
      if (j > i && !looksLikeCode(text) && !/[{};]\s*$/.test(text.trim())) break;
      ids.push(blocks[j].id);
      const own = text.split("\n").map((l) => l.replace(/\s+$/, ""));
      lines.push(...own);
      lineBlocks.push(...own.map(() => blocks[j].id));
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const captionAt = lines.length ? lines[lines.length - 1].search(CAPTION) : -1;
    let caption = "";
    if (captionAt >= 0) {
      caption = lines[lines.length - 1].slice(captionAt).trim().slice(0, 120);
      lines[lines.length - 1] = lines[lines.length - 1].slice(0, captionAt).replace(/\s+$/, "");
    }
    if (lines.filter((l) => l.trim()).length >= 3) {
      listings.push({ page, caption, lines, blockIds: ids, lineBlocks: lineBlocks.slice(0, lines.length) });
      ids.forEach((id) => used.add(id));
    }
    i = j - 1;
  }

  return listings
    .sort((a, b) => blocks.findIndex((x) => x.id === a.blockIds[0]) - blocks.findIndex((x) => x.id === b.blockIds[0]))
    .map((listing, index) => ({ ...listing, n: index + 1 }));
}

/** A listing (or lines from..to of it, 1-based) written out for a prompt, its printed numbers kept. */
export function listingText(listing: DocumentListing, from = 1, to = listing.lines.length): string {
  const a = Math.max(1, Math.min(from, listing.lines.length));
  const b = Math.max(a, Math.min(to, listing.lines.length));
  return listing.lines.slice(a - 1, b).map((line, i) => `${String(a + i).padStart(2)}  ${line}`).join("\n");
}

/**
 * The longest line of code a board gets from the document before its indentation. A code board keeps
 * 72 characters a line (lib/canvas/validate.ts cuts the rest off) and the board model indents up to
 * three levels: "AvlNode( const Comparable & ele, AvlNode *lt, AvlNode *rt, int h = 0 )" lost its ")".
 */
export const BOARD_CODE_CHARS = 58;

/** A line too long for a code board, broken after a comma (else a space) — never inside a word. */
export function wrapCodeLine(line: string, max = BOARD_CODE_CHARS): string[] {
  const parts: string[] = [];
  let rest = line.trim();
  // A line only a little too long is left whole rather than leave a stray ")" on a line of its own.
  while (rest.length > max && !(rest.length <= max + 8 && rest.length - lastBreak(rest, max) < 12)) {
    const cut = lastBreak(rest, max);
    if (cut <= max / 3) break;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}

/** Where to break a long line: after a comma, else before && or ||, else at a space. */
function lastBreak(text: string, max: number): number {
  const window = text.slice(0, max + 1);
  const comma = window.lastIndexOf(", ") + 1;
  if (comma > max / 3) return comma;
  const logic = Math.max(window.lastIndexOf(" && "), window.lastIndexOf(" || "));
  if (logic > max / 3) return logic;
  return window.lastIndexOf(" ");
}

/** The lines a code board would show for lines from..to of a listing: wrapped, without a leading comment block. */
export function boardCodeLines(listing: DocumentListing, from = 1, to = listing.lines.length): string[] {
  const range = listing.lines.slice(Math.max(0, from - 1), Math.max(from, to));
  const skip = leadingCommentLines({ ...listing, lines: range });
  return range.slice(skip).flatMap((line) => wrapCodeLine(line));
}

/**
 * Code boards in a document plan that could not show their code: one names more lines than a board
 * holds (lib/canvas/validate.ts keeps 18 and cuts the rest — the end of remove(), with its call to
 * balance, was lost), or names no listing at all. Each is a reason the plan is written again.
 */
export function overlongCodeBoards(doc: SuprnotesLessonInput, beats: Array<Pick<CanvasPlanBeat, "id" | "stage" | "source">>): string[] {
  const listings = documentListings(doc);
  if (!listings.length) return [];
  return beats.flatMap((beat) => {
    if (beat.stage !== "code") return [];
    const listing = beat.source?.listing ? listings.find((l) => l.n === beat.source!.listing) : undefined;
    if (!listing) return [`${beat.id} is a code board but its "source" names no LISTING number — name the listing it shows`];
    const [from, to] = beat.source?.lines ?? [1, listing.lines.length];
    const shown = boardCodeLines(listing, from, to).length;
    return shown > CANVAS_CODE_LINES + 1
      ? [`${beat.id} shows LISTING ${listing.n} lines ${from} to ${to}: ${shown} lines on the board, more than the ${CANVAS_CODE_LINES} a code board holds — teach that listing on consecutive code boards, each naming its "lines" (split where a function ends, or between complete statements)`]
      : [];
  });
}

/**
 * EVERY LINE OF A LISTING THAT IS TAUGHT IS SHOWN. A long listing is split over consecutive code
 * boards, each naming its "lines"; an AVL chapter's insert listing was split and its last piece never
 * got a board, so "Balancing after insertion" stopped mid-function (PDF bench, 2026-10-18). For each
 * listing a code board shows, the printed lines no board covers are named, so the plan is sent back.
 */
export function listingGaps(doc: SuprnotesLessonInput, beats: Array<Pick<CanvasPlanBeat, "id" | "stage" | "source">>): string[] {
  const listings = documentListings(doc);
  const shown = new Map<number, Array<[number, number]>>();
  for (const beat of beats) {
    if (beat.stage !== "code" || !beat.source?.listing) continue;
    const listing = listings.find((l) => l.n === beat.source!.listing);
    if (!listing) continue;
    const range = beat.source.lines ?? [1, listing.lines.length];
    shown.set(listing.n, [...(shown.get(listing.n) ?? []), range]);
  }
  const gaps: string[] = [];
  for (const [n, ranges] of shown) {
    const listing = listings.find((l) => l.n === n)!;
    // A blank line or a lone brace left off is no gap.
    const missing = listing.lines.map((text, i) => ({ line: i + 1, text })).filter(({ line, text }) => text.trim() && !/^[{}\s;]*$/.test(text) && !ranges.some(([a, b]) => line >= a && line <= b));
    if (!missing.length) continue;
    const spans: Array<[number, number]> = [];
    for (const { line } of missing) { const last = spans[spans.length - 1]; if (last && line === last[1] + 1) last[1] = line; else spans.push([line, line]); }
    gaps.push(`LISTING ${n} lines ${spans.map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`)).join(", ")} are on no code board — the student would see the routine stop mid-way: give them a code board (the next one after the board showing the lines before them), naming its "lines"`);
  }
  return gaps;
}

/**
 * A LISTING THE LESSON MUST SHOW IS ON A BOARD. "explain me AVL tree coding" was outlined with the
 * rotations and deletion, and the plan taught insertion and one rotation (PDF bench, 2026-10-19). For a
 * plan that teaches code, each wanted listing no code board shows is named, so the plan is sent back.
 */
export function listingsLeftOut(doc: SuprnotesLessonInput, beats: Array<Pick<CanvasPlanBeat, "stage" | "source">>, wanted: DocumentListing[]): string[] {
  if (!beats.some((b) => b.stage === "code")) return [];
  const shown = new Set(beats.filter((b) => b.stage === "code").map((b) => b.source?.listing));
  const out = wanted.filter((l) => !shown.has(l.n));
  return out.length ? [`LISTING${out.length === 1 ? "" : "S"} ${out.map((l) => `${l.n}${l.caption ? ` (${l.caption})` : ""}`).join(", ")} ${out.length === 1 ? "is" : "are"} on no code board — the student asked for this code: give ${out.length === 1 ? "it its" : "each its"} own code board${out.length === 1 ? "" : "s"}, in the document's order`] : [];
}

/** Two short texts' likeness, 0..1: shared character pairs (Dice). */
function likeness(a: string, b: string): number {
  const pairs = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  let shared = 0;
  for (const [k, n] of pa) shared += Math.min(n, pb.get(k) ?? 0);
  const total = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * shared) / total;
}

/**
 * THE BOARD'S CODE IS THE DOCUMENT'S CODE. The board model copies the listing and indents it, and
 * once in a while changes a token while copying ("right{ rt }" became "right{ lt }"). Each line it
 * wrote that is not in the listing is matched to the listing's line it was copied from — the next
 * few in order, and close enough to be that line — and takes that line's exact text, keeping the
 * model's indentation. Lines it wrapped its own way, and blank lines, are left as they are.
 */
export function faithfulCodeLines(modelLines: string[], listing: DocumentListing, from = 1, to = listing.lines.length): { lines: string[]; fixed: number } {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const source = listing.lines.slice(Math.max(0, from - 1), Math.max(from, to)).flatMap((line) => [norm(line), ...wrapCodeLine(line).map(norm)]).filter(Boolean);
  const exact = new Set(source);
  let at = 0;
  let fixed = 0;
  const lines = modelLines.map((line) => {
    const text = norm(line);
    if (!text) return line;
    const found = source.indexOf(text, at);
    if (exact.has(text)) {
      if (found >= 0) at = found + 1;
      return line;
    }
    let best = -1;
    let score = 0;
    for (let i = at; i < Math.min(source.length, at + 6); i++) {
      const s = likeness(text, source[i]);
      if (s > score) [best, score] = [i, s];
    }
    if (best < 0 || score < 0.8) return line;
    at = best + 1;
    fixed++;
    return `${line.match(/^\s*/)?.[0] ?? ""}${source[best]}`;
  });
  return { lines, fixed };
}

/** Lines from..to of a listing for a code board: its printed numbers, long lines already broken. */
export function boardListingText(listing: DocumentListing, from = 1, to = listing.lines.length): string {
  const a = Math.max(1, Math.min(from, listing.lines.length));
  const b = Math.max(a, Math.min(to, listing.lines.length));
  return listing.lines
    .slice(a - 1, b)
    .flatMap((line, i) => wrapCodeLine(line).map((part, k) => `${k === 0 ? String(a + i).padStart(2) : "  "}  ${k === 0 ? part : `    ${part}`}`))
    .join("\n");
}

/** One line per listing: what the planner is told it must not lose. */
export function listingIndex(listings: DocumentListing[]): string {
  return listings
    .map((l) => `- Listing ${l.n} (page ${l.page}${l.caption ? `, "${l.caption}"` : ""}): ${l.lines.length} lines — ${firstCodeLine(l)}`)
    .join("\n");
}

function firstCodeLine(listing: DocumentListing): string {
  const line = listing.lines.find((l) => l.trim() && !/^\s*(?:\/\*\*?|\*|\/\/|#)/.test(l)) ?? listing.lines[0] ?? "";
  return line.trim().slice(0, 80);
}

/** A short line with its digits removed: a running head reads the same on every page it is printed on. */
function headKey(text: string): string {
  return text.replace(/[\d.]+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Not teaching text: running heads and footers ("144 | Chapter 4 Trees", "4.4 AVL Trees | 155" —
 * short lines repeated across pages), and the stray letters of a diagram's labels ("X Y Z", "k k 2 1").
 */
function isNoise(text: string, runningHeads: Set<string>): boolean {
  const t = text.trim();
  if (t.length < 4) return true;
  if (/^(?:before|after|before after)$/i.test(t)) return true;
  if (/^here is the transcription/i.test(t)) return true;
  if (/^\\xymatrix/.test(t)) return true;
  if (t.length < 30 && !/[=<>+*/]/.test(t) && t.split(/\s+/).every((tok) => tok.length <= 2)) return true;
  return t.length < 60 && runningHeads.has(headKey(t));
}

/** Short lines printed on two or more pages: the book's running heads. */
function runningHeadsOf(doc: SuprnotesLessonInput): Set<string> {
  const seen = new Map<string, Set<number>>();
  for (const block of doc.contentBlocks ?? []) {
    const text = flatText(block).trim();
    if (text.length >= 60) continue;
    const key = headKey(text);
    seen.set(key, (seen.get(key) ?? new Set()).add(block.pageNumber ?? 0));
  }
  return new Set([...seen].filter(([, pages]) => pages.size >= 2).map(([key]) => key));
}

export type PageSummary = { page: number; heading: string; gist: string; chars: number; listings: number[] };

/**
 * Each page of the document, as the strict planner is told it must cover them: its heading, the
 * start of what it says, how much it says (running heads and stray diagram labels left out), and
 * the code listings printed on it. A page with real content is a page the lecture has to teach.
 */
export function documentPageMap(doc: SuprnotesLessonInput): PageSummary[] {
  const heads = runningHeadsOf(doc);
  const listings = documentListings(doc);
  const inListing = new Set(listings.flatMap((l) => l.blockIds));
  const pages = new Map<number, PageSummary>();
  for (const block of ordered(doc)) {
    const n = block.pageNumber;
    if (typeof n !== "number") continue;
    const entry = pages.get(n) ?? { page: n, heading: "", gist: "", chars: 0, listings: listings.filter((l) => l.page === n).map((l) => l.n) };
    pages.set(n, entry);
    if (inListing.has(block.id)) {
      entry.chars += 200;
      continue;
    }
    const text = flatText(block).replace(/\s+/g, " ").trim();
    if (isNoise(text, heads)) continue;
    const h = (block.heading ?? "").trim();
    if (!entry.heading && h && !/^(?:page|slide)\s+\d+$/i.test(h)) entry.heading = h.slice(0, 60);
    if (entry.gist.length < 110) entry.gist = `${entry.gist} ${text}`.trim().slice(0, 110);
    entry.chars += text.length;
  }
  return [...pages.values()].sort((a, b) => a.page - b.page);
}

/** A page with enough on it that a lecture covering the document must teach it. */
/**
 * THE DOCUMENT'S SECTIONS, as an outline must cover them: its real headings (not the parser's "Page
 * N" markers or figure captions), and for a heading that names nothing ("Activity 1.1", "Questions")
 * the words that follow it, so "Activity 1.1: testing a leaf for starch" can be matched.
 */
export function documentSections(doc: SuprnotesLessonInput): string[] {
  // Parser headings are noisy: the same heading on every block under it, running page headers
  // ("6 1Plants"), bullet lines and symbol runs. One section per distinct, real heading.
  const junk = (h: string) =>
    h.length < 4 || h.length > 80
    || /^(?:page \d+|figure\b|fig\.|table\b|contents|references|bibliography|index)/i.test(h)
    || /^[•·*\-–—]/.test(h) || /^[a-z]/.test(h)
    || (/\d[A-Za-z]|[A-Za-z]\d/.test(h) && !/^\d+(?:\.\d+)*\.?\s/.test(h))
    || (h.match(/[A-Za-z]{3,}/g) ?? []).length < (/^[A-Z][a-z]{3,}/.test(h) ? 1 : 2)
    || (h.replace(/[\w\s.,:;'’()&?!\-–—/]/g, "").length > h.length * 0.2);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of doc.contentBlocks ?? []) {
    const h = (b.heading ?? "").replace(/\s+/g, " ").trim();
    if (!h || seen.has(h.toLowerCase())) continue;
    seen.add(h.toLowerCase());
    if (junk(h)) continue;
    const generic = /^(?:activity|practical|question|questions|exercise|example|task|summary|check your|end of|worked example)\b/i.test(h);
    out.push(generic ? `${h}: ${(b.text ?? "").replace(/\s+/g, " ").split(" ").slice(0, 8).join(" ")}`.trim() : h);
  }
  // A code chapter's sections are its listings: "Node declaration for AVL trees", "Deletion in an AVL tree".
  for (const l of documentListings(doc)) {
    const name = l.caption.replace(/^(?:figure|fig\.|listing)\s*[\d.]+\s*/i, "").trim();
    if (name.length >= 6 && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, 30);
}

/**
 * THE QUESTION'S KEY WORDS THE DOCUMENT NEVER USES. Asked "What happens in the Calvin cycle?" of a
 * photosynthesis chapter that never mentions it, strict mode retitled the chapter's own content "the
 * Calvin cycle" — wrong science, in the student's own document's name (PDF bench, 2026-10-18). A word
 * of the question (four letters or more, not a question word) found nowhere in the document is named,
 * so the lecture says plainly that the document does not cover it.
 */
const QUESTION_WORDS = new Set("what which when where why how does do did is are was were happen happens happened explain describe tell about mean means work works between difference different compare their there this that these those with from into your notes document page pages section chapter".split(" "));
/*
 * Asking for the CODE is asked of the listings. "explain me AVL tree coding" of a chapter whose last
 * pages are C++ was told "your document does not mention coding" — the pages say "code", never
 * "coding" (owner, 2026-10-18, AVL Tree.pdf). A document with listings has what such a word asks for.
 */
const CODE_WORDS = /^(?:cod(?:e|es|ed|ing)|program(?:s|med|ming)?|implement(?:s|ed|ing|ation|ations)?|routines?|functions?|pseudo-?code|listings?|snippets?|syntax)$/i;
export function termsNotInDocument(question: string, doc: SuprnotesLessonInput): string[] {
  const text = (doc.contentBlocks ?? []).map((b) => [b.heading, b.text, ...(b.items ?? [])].filter(Boolean).join(" ")).join(" ").toLowerCase();
  // The word's root, so "store" finds "storing" and "fertilisers" finds "fertiliser".
  const stem = (w: string) => { const l = w.toLowerCase().replace(/(?:ies|es|s)$/, ""); return l.slice(0, Math.max(4, l.length - 2)); };
  // And the stemmer the strict checks use, so "coding" finds "code" (both "cod").
  const stems = new Set(contentStems(text));
  const hasCode = documentListings(doc).length > 0;
  return [...new Set((question.match(/[A-Za-z][A-Za-z-]{3,}/g) ?? []).filter((w) => !QUESTION_WORDS.has(w.toLowerCase())))]
    .filter((w) => !text.includes(stem(w)))
    .filter((w) => !contentStems(w).some((s) => stems.has(s)))
    .filter((w) => !(hasCode && CODE_WORDS.test(w)));
}

export function substantivePages(doc: SuprnotesLessonInput): number[] {
  return documentPageMap(doc).filter((p) => p.chars >= 150 || p.listings.length > 0).map((p) => p.page);
}

/**
 * The substantive pages no board teaches — a board teaches the pages it names, the pages of its
 * passages, and the page of its listing. Empty when the plan covers the whole selection.
 */
export function uncoveredPages(doc: SuprnotesLessonInput, beats: Array<Pick<CanvasPlanBeat, "source">>): number[] {
  const byId = new Map((doc.contentBlocks ?? []).map((b) => [b.id, b]));
  const listings = documentListings(doc);
  const taught = new Set<number>();
  for (const beat of beats) {
    for (const p of beat.source?.pages ?? []) taught.add(p);
    for (const id of beat.source?.blocks ?? []) {
      const p = byId.get(id)?.pageNumber;
      if (typeof p === "number") taught.add(p);
    }
    const listing = beat.source?.listing ? listings.find((l) => l.n === beat.source!.listing) : undefined;
    if (listing) taught.add(listing.page);
  }
  return substantivePages(doc).filter((p) => !taught.has(p));
}

/**
 * The whole document as the planner reads it: every page in order, marked [page N], with its
 * headings, its prose, and every code listing whole. Over `budget` characters, prose is trimmed
 * evenly — every page keeps its start — and headings and listings are never cut.
 */
export function documentForCanvas(doc: SuprnotesLessonInput | null | undefined, budget = 60_000, options: { blockIds?: boolean } = {}): string {
  if (!doc) return "";
  const listings = documentListings(doc);
  const listingOf = new Map<string, DocumentListing>();
  for (const l of listings) l.blockIds.forEach((id) => listingOf.set(id, l));
  const runningHeads = runningHeadsOf(doc);
  type Piece = { kind: "fixed" | "prose"; text: string };
  const pieces: Piece[] = [];
  let sheet = "";
  let heading = "";
  let label = "";
  for (const block of ordered(doc)) {
    const listing = listingOf.get(block.id);
    if (block.documentLabel && block.documentLabel !== label) {
      label = block.documentLabel;
      pieces.push({ kind: "fixed", text: `\n=== File: ${label} ===` });
    }
    if (sheetOf(block) !== sheet) {
      sheet = sheetOf(block);
      const page = block.pageNumber ?? 0;
      pieces.push({ kind: "fixed", text: `\n[page ${page}]` });
    }
    if (listing) {
      if (listing.blockIds[0] === block.id) {
        const ids = options.blockIds ? ` {${listing.blockIds.join(", ")}}` : "";
        pieces.push({ kind: "fixed", text: `LISTING ${listing.n}${listing.caption ? ` — ${listing.caption}` : ""}${ids} (${listing.lines.length} lines, printed numbers on the left):\n${listingText(listing)}` });
      }
      continue;
    }
    const text = flatText(block).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (isNoise(text, runningHeads)) continue;
    const h = (block.heading ?? "").trim();
    if (h && !/^(?:page|slide)\s+\d+$/i.test(h) && h !== heading) {
      heading = h;
      pieces.push({ kind: "fixed", text: `## ${h}` });
    }
    // Strict mode names each passage, so a board can say which ones it teaches and the PDF can box them.
    pieces.push({ kind: "prose", text: options.blockIds ? `{${block.id}} ${text}` : text });
  }
  const fixed = pieces.filter((p) => p.kind === "fixed").reduce((t, p) => t + p.text.length + 1, 0);
  const prose = pieces.filter((p) => p.kind === "prose");
  const total = prose.reduce((t, p) => t + p.text.length + 1, 0);
  let cap = Infinity;
  if (fixed + total > budget) {
    // The largest per-block cap that fits the budget: short blocks stay whole, long ones are cut.
    const room = Math.max(0, budget - fixed);
    let lo = 40;
    let hi = Math.max(40, ...prose.map((p) => p.text.length));
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (prose.reduce((t, p) => t + Math.min(p.text.length, mid) + 2, 0) <= room) lo = mid;
      else hi = mid - 1;
    }
    cap = lo;
  }
  return pieces
    .map((p) => (p.kind === "prose" && p.text.length > cap ? `${p.text.slice(0, cap).replace(/\s+\S*$/, "")} …` : p.text))
    .join("\n")
    .trim();
}

/** The text of some pages, for one board: what it teaches from, capped. */
export function documentPagesText(doc: SuprnotesLessonInput | null | undefined, pages: number[], budget = 12_000): string {
  if (!doc || pages.length === 0) return "";
  const wanted = new Set(pages);
  const subset: SuprnotesLessonInput = { ...doc, contentBlocks: (doc.contentBlocks ?? []).filter((b) => wanted.has(b.pageNumber ?? -1)) };
  return documentForCanvas(subset, budget);
}

/**
 * How many boards the document's long listings add when each is taught on consecutive boards of at
 * most CANVAS_CODE_LINES lines. Leading comment lines are not counted: a board may leave the doc
 * comment out and say it instead.
 */
export function extraBoardsForListings(listings: DocumentListing[]): number {
  return listings.reduce((extra, l) => {
    const body = l.lines.length - leadingCommentLines(l);
    return extra + Math.max(0, Math.ceil(body / CANVAS_CODE_LINES) - 1);
  }, 0);
}

function leadingCommentLines(listing: DocumentListing): number {
  let n = 0;
  let inBlock = false;
  for (const line of listing.lines) {
    const t = line.trim();
    if (inBlock) {
      n++;
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("/*")) {
      n++;
      inBlock = !t.includes("*/");
      continue;
    }
    if (t.startsWith("//") || /^#(?!include|define|pragma|import)/.test(t) || !t) {
      n++;
      continue;
    }
    break;
  }
  return n;
}

/**
 * What one board of a reference-mode PDF lesson reads, beyond the typed prompt's board request: the
 * pages it teaches from and, on a code board, the document's own listing (or its planned lines) to
 * copy. lib/canvas/progressive.ts adds these lines to the board's spec request.
 */
export function documentBoardLines(doc: SuprnotesLessonInput, beat: Pick<CanvasPlanBeat, "stage" | "source">): string[] {
  const out: string[] = [];
  const listing = beat.source?.listing ? documentListings(doc).find((l) => l.n === beat.source!.listing) : undefined;
  if (beat.stage === "code" && listing) {
    const [from, to] = beat.source?.lines ?? [1, listing.lines.length];
    out.push(
      "",
      `THE CODE ON THIS BOARD is the student's own listing — LISTING ${listing.n}${listing.caption ? ` (${listing.caption})` : ""}, printed lines ${from} to ${to}, below. Copy it EXACTLY into "lines": the same statements, names, operators and comments, in the same order, in its own language (set "language" to it). The printed numbers on the left are not code. A long line is already broken in two below (its second part has no number): keep it as two lines, the second indented one level more. Its indentation was lost when the PDF was read, so indent it as the code is structured (4 spaces per level). You may leave out a comment block at its very top; change nothing else. Then walk through it with "steps" — one per sentence of the script, in order — and "groups" as usual.`,
      boardListingText(listing, from, to),
    );
  }
  const pages = beat.source?.pages?.length ? beat.source.pages : listing ? [listing.page] : [];
  const text = documentPagesText(doc, pages, 12_000);
  if (text) out.push("", `What the student's document says on ${pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(", ")}`} — draw THIS (its own example, values and labels), not a generic version:`, text);
  return out;
}

/**
 * The names a listing is about, weighted: what it DEFINES ("void remove(", "struct AvlNode") counts
 * most, its caption's words next, and what it only calls ("rotateWithLeftChild( t );") least — so a
 * board about the rotation routine is matched to the rotation listing, not to balance(), which calls it.
 */
function listingNames(listing: DocumentListing): Map<string, number> {
  const code = listing.lines.filter((l) => !/^\s*(?:\/\*|\*|\/\/)/.test(l));
  const names = new Map<string, number>();
  const add = (name: string, weight: number) => names.set(name, Math.max(names.get(name) ?? 0, weight));
  for (const line of code) {
    const defined = line.match(/^\s*(?:(?:static|const|inline|virtual|template\s*<[^>]*>)\s+)*[\w:<>]+[\s*&]+(\w+)\s*\(/) ?? line.match(/\b(?:struct|class)\s+(\w+)/);
    if (defined && !/^(?:if|while|for|switch|return)$/.test(defined[1])) add(defined[1], 4);
    for (const call of line.match(/\b[A-Za-z_]\w*(?=\s*\()/g) ?? []) if (!/^(?:if|while|for|switch|return|max|min|sizeof)$/.test(call)) add(call, 1);
  }
  for (const word of listing.caption.toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!/^(?:figure|routine|perform|tree|trees|node)$/.test(word)) add(word, 2);
  return names;
}

/** What a board talks about, as words: "rotateWithLeftChild" also reads as "rotate with left child". */
function boardWords(text: string): string {
  const spaced = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${text} ${spaced}`.toLowerCase();
}

/**
 * EVERY CODE BOARD OF A DOCUMENT LESSON SHOWS A LISTING. The plan names it ("source": {"listing": 6,
 * "lines": [7, 17]}); when a plan comes back without that — seen once, after the plan was sent back
 * to split a long listing — the board was written with nothing to copy and invented its own code
 * (a template, #include <utility>). A code board without a listing is matched to the listing whose
 * function names its title, brief and script use; boards in a row on the same listing share it out
 * in order, each piece cut where a statement ends.
 */
export function assignListings<T extends Pick<CanvasPlanBeat, "stage" | "title" | "brief" | "script" | "source">>(doc: SuprnotesLessonInput, beats: T[]): { beats: T[]; assigned: number } {
  const listings = documentListings(doc);
  if (!listings.length) return { beats, assigned: 0 };
  let assigned = 0;
  const out = beats.map((beat) => {
    if (beat.stage !== "code" || (beat.source?.listing && listings.some((l) => l.n === beat.source!.listing))) return beat;
    const said = boardWords(`${beat.title} ${beat.brief} ${beat.script}`);
    // The title is the outline's part, named after what the document names: it counts twice.
    const titled = boardWords(beat.title);
    let best: DocumentListing | undefined;
    let score = 0;
    for (const listing of listings) {
      let s = 0;
      for (const [name, weight] of listingNames(listing)) {
        // "rotateWithLeftChild" counts when said as written or as words ("rotate with left child");
        // "remove" when said as "removes" or "removing".
        const plain = name.toLowerCase();
        const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
        const named = (text: string) => new RegExp(`\\b${plain}`).test(text) || (spaced !== plain && text.includes(spaced));
        if (named(said)) s += weight;
        if (named(titled)) s += weight;
      }
      if (s > score) [best, score] = [listing, s];
    }
    if (!best) return beat;
    assigned++;
    return { ...beat, source: { pages: beat.source?.pages?.length ? beat.source.pages : [best.page], listing: best.n } };
  });
  // Boards in a row given the same listing, none with its lines: each takes the next piece.
  for (let i = 0; i < out.length; ) {
    const n = out[i].stage === "code" ? out[i].source?.listing : undefined;
    let j = i + 1;
    while (n && j < out.length && out[j].stage === "code" && out[j].source?.listing === n) j++;
    const run = out.slice(i, j);
    const listing = n ? listings.find((l) => l.n === n) : undefined;
    if (listing && run.length > 1 && run.every((b) => !b.source?.lines)) {
      const cuts = splitListing(listing, run.length);
      run.forEach((b, k) => (out[i + k] = { ...b, source: { ...b.source!, lines: cuts[k] } }));
    }
    i = j;
  }
  return { beats: out, assigned };
}

/** A listing cut into `parts` pieces of about equal size, each ending where a statement ends. */
export function splitListing(listing: DocumentListing, parts: number): Array<[number, number]> {
  const first = leadingCommentLines(listing) + 1;
  const last = listing.lines.length;
  const size = (last - first + 1) / parts;
  const pieces: Array<[number, number]> = [];
  let start = 1;
  for (let k = 1; k < parts; k++) {
    const target = Math.round(first - 1 + size * k);
    // The nearest line at or after the target where a statement ends and the next is not its else.
    let cut = target;
    for (let d = 0; d < 6; d++) {
      const ok = (n: number) => n >= start && n < last && /[;}]\s*(?:\/\/.*)?$|^\s*$/.test(listing.lines[n - 1]) && !/^\s*(?:else|\{|:)/.test(listing.lines[n] ?? "");
      if (ok(target + d)) { cut = target + d; break; }
      if (ok(target - d)) { cut = target - d; break; }
    }
    pieces.push([start, cut]);
    start = cut + 1;
  }
  pieces.push([start, last]);
  return pieces;
}
