import { canvasSentences } from "./plan";

/**
 * THE FULL BOARD (flag CANVAS_BLOCKS=on; owner, 2026-11-08: every concept taught on the board in full,
 * never cut, readable without the audio, and written at the moment Aria says it).
 *
 * A board's words as typed blocks. A block covers a run of the script's sentences (`s`..`e`), so what
 * is spoken is the script itself and the board can never drift from it. Code guarantees the promise:
 * a sentence no block covers becomes a paragraph of its own, and no text is ever shortened. Each block
 * is revealed in small units (a phrase, a step, a code line, a table row) timed to the words that say
 * them. Pure, unit-tested (lib/anim/boardBlocks.test.ts).
 */

export const BLOCK_KINDS = [
  "heading", "paragraph", "steps", "formula", "chemical_equation", "code", "trace_table", "table",
  "definition", "quote", "translation", "callout", "question", "answer_reveal", "you_asked",
  "visual_ref", "image", "legend",
] as const;
export type BoardBlockKind = (typeof BLOCK_KINDS)[number];

export const CALLOUTS = ["key_idea", "example", "mistake", "check", "remember"] as const;
export type CalloutKind = (typeof CALLOUTS)[number];

export type BoardBlock = {
  id: string;
  /** The board it belongs to: a section of the lesson notes. */
  section_id: string;
  kind: BoardBlockKind;
  /** The first and last sentence of the script this block says (0-based). */
  s: number;
  e: number;
  /** The full words on the board; **bold** marks a key term, $…$ inline maths. */
  board_text: string;
  /** Exactly what Aria says for this block: the script's own sentences, filled in by code. */
  spoken_text: string;
  callout?: CalloutKind;
  /** steps: each step in full. */
  items?: string[];
  /** formula: KaTeX. */
  tex?: string;
  /** formula: a "where" line for each symbol. */
  where?: string[];
  code?: string[];
  columns?: string[];
  rows?: string[][];
  /** quote: where it comes from. */
  source?: string;
  /** translation: the meaning, and how to say it. */
  translation?: string;
  pronunciation?: string;
  /** visual_ref, image: what to look at. */
  caption?: string;
};

const MAX_BLOCKS = 60;
const str = (v: unknown) => (typeof v === "string" ? v.replace(/\r/g, "").trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** What a block without its own board_text shows, so nothing typed is ever lost. */
function textOf(kind: BoardBlockKind, r: Record<string, unknown>): string {
  const own = str(r.board_text);
  if (own) return own;
  if (kind === "steps") return strs(r.items).join(" ");
  if (kind === "formula" || kind === "chemical_equation") return str(r.tex);
  if (kind === "code") return strs(r.code).join("\n");
  if (kind === "table" || kind === "trace_table") return strs(r.columns).join(" | ");
  return str(r.caption);
}

/** The script's sentences s..e as one paragraph block. */
function paragraph(section: string, sentences: string[], s: number, e: number, id: string): BoardBlock {
  const text = sentences.slice(s, e + 1).join(" ");
  return { id, section_id: section, kind: "paragraph", s, e, board_text: text, spoken_text: text };
}

/** Plain blocks straight from the script: the fallback that still writes every word, in short paragraphs. */
export function plainBlocks(section: string, script: string): BoardBlock[] {
  const sentences = canvasSentences(script);
  const out: BoardBlock[] = [];
  for (let s = 0; s < sentences.length; s += 3) out.push(paragraph(section, sentences, s, Math.min(s + 2, sentences.length - 1), `p${s + 1}`));
  return out;
}

/**
 * The model's blocks made safe: unknown kinds become paragraphs, sentence numbers are clamped, what is
 * spoken is filled in from the script, and any sentence no block covers is written as a paragraph where
 * it belongs. `faults` counts what the model got wrong, so the writer can ask once more.
 */
export function validateBlocks(raw: unknown, section: string, script: string): { blocks: BoardBlock[]; faults: string[] } {
  const sentences = canvasSentences(script);
  const faults: string[] = [];
  const list = Array.isArray((raw as { blocks?: unknown })?.blocks) ? (raw as { blocks: unknown[] }).blocks : [];
  if (!list.length) faults.push("no blocks");
  const last = sentences.length - 1;
  const blocks: BoardBlock[] = [];
  list.slice(0, MAX_BLOCKS).forEach((item, i) => {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    let kind = r.kind as BoardBlockKind;
    if (!BLOCK_KINDS.includes(kind)) {
      faults.push(`block ${i + 1}: unknown kind "${String(r.kind)}"`);
      kind = "paragraph";
    }
    const s = Math.round(Number(r.s));
    const e = r.e === undefined ? s : Math.round(Number(r.e));
    if (!Number.isInteger(s) || s < 0 || s > last) {
      faults.push(`block ${i + 1}: sentence ${String(r.s)} does not exist`);
      return;
    }
    const end = Number.isInteger(e) ? Math.min(last, Math.max(s, e)) : s;
    const board_text = textOf(kind, r);
    if (!board_text) {
      faults.push(`block ${i + 1}: empty`);
      return;
    }
    const callout = CALLOUTS.includes(r.callout as CalloutKind) ? (r.callout as CalloutKind) : undefined;
    if (kind === "callout" && !callout) faults.push(`block ${i + 1}: callout without a type`);
    const opt = <T,>(key: string, value: T, has: boolean) => (has ? { [key]: value } : {});
    const items = strs(r.items), where = strs(r.where), code = Array.isArray(r.code) ? r.code.map((l) => String(l ?? "")) : [], columns = strs(r.columns);
    const rows = Array.isArray(r.rows) ? r.rows.map((row) => strs(row)).filter((row) => row.length) : [];
    blocks.push({
      id: `b${i + 1}`, section_id: section, kind, s, e: end, board_text,
      spoken_text: sentences.slice(s, end + 1).join(" "),
      ...(kind === "callout" ? { callout: callout ?? "key_idea" } : {}),
      ...opt("items", items, items.length > 0),
      ...opt("tex", str(r.tex), Boolean(str(r.tex))),
      ...opt("where", where, where.length > 0),
      ...opt("code", code, code.length > 0),
      ...opt("columns", columns, columns.length > 0),
      ...opt("rows", rows, rows.length > 0),
      ...opt("source", str(r.source), Boolean(str(r.source))),
      ...opt("translation", str(r.translation), Boolean(str(r.translation))),
      ...opt("pronunciation", str(r.pronunciation), Boolean(str(r.pronunciation))),
      ...opt("caption", str(r.caption), Boolean(str(r.caption))),
    });
  });
  // Every sentence is on the board: one no block covers is written where it belongs.
  const covered = new Set(blocks.flatMap((b) => Array.from({ length: b.e - b.s + 1 }, (_, i) => b.s + i)));
  const missing = sentences.map((_, i) => i).filter((i) => !covered.has(i));
  if (missing.length) faults.push(`sentences no block covers: ${missing.join(", ")}`);
  for (let i = 0; i < missing.length; ) {
    let j = i;
    while (missing[j + 1] === missing[j] + 1) j++;
    blocks.push(paragraph(section, sentences, missing[i], missing[j], `gap${missing[i] + 1}`));
    i = j + 1;
  }
  blocks.sort((a, b) => a.s - b.s);
  return { blocks, faults };
}

/** The smallest piece of a block that appears at once, and when: `at` is sentence number + fraction through it. */
export type RevealUnit = { key: string; text: string; at: number };

/** A paragraph cut at its punctuation into phrases of three words or more, never inside **bold** or $maths$. */
export function phrasesOf(text: string): string[] {
  const out: string[] = [];
  let piece = "";
  let bold = false;
  let maths = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    piece += c;
    if (text.startsWith("**", i)) {
      piece += "*";
      i++;
      bold = !bold;
    } else if (c === "$") maths = !maths;
    const atBreak = /[.,;:!?۔،؟]/.test(c) && /\s/.test(text[i + 1] ?? "") && !bold && !maths;
    if (atBreak && piece.trim().split(/\s+/).length >= 3) {
      out.push(piece);
      piece = "";
    }
  }
  if (piece.trim()) out.push(piece);
  return out;
}

/** The pieces of a block, in the order they are revealed. */
export function unitTexts(b: BoardBlock): string[] {
  switch (b.kind) {
    case "steps":
      return b.items?.length ? b.items : phrasesOf(b.board_text);
    case "code":
      return b.code?.length ? b.code : b.board_text.split("\n");
    case "table":
    case "trace_table":
      return b.rows?.length ? b.rows.map((r) => r.join(" ")) : phrasesOf(b.board_text);
    case "formula":
    case "chemical_equation":
      return [b.tex ?? b.board_text, ...(b.where ?? [])];
    case "visual_ref":
    case "image":
    case "legend":
    case "heading":
      return [b.board_text];
    default:
      return phrasesOf(b.board_text);
  }
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;
const clean = (w: string) => w.toLowerCase().replace(/[.'’-]+$/, "");
const wordsOf = (text: string) => (text.replace(/\*\*|\$|\\[a-z]+/gi, " ").match(WORD) ?? []).map(clean);
/** How long a word takes to say, by its vowel groups; a word in another script, by its letters. */
function wordWeight(w: string): number {
  const groups = w.match(/[aeiouy]+/gi)?.length ?? 0;
  return Math.max(1, groups || Math.ceil(w.length / 3));
}

/** Words the student would recognise a phrase by: numbers, and words of three letters or more. */
const SKIP = new Set("the and for are was were that this with from have has had but not you your they them then than its".split(" "));
const distinctive = (words: string[]) => words.filter((w) => /\d/.test(w) || (w.length >= 3 && !SKIP.has(w)));

/**
 * WHEN EACH PIECE IS SAID. Each piece's first distinctive words are looked for in what Aria says, in
 * order, so a phrase appears as she reaches it; a piece the words do not find (a formula said in words)
 * is placed between its neighbours by its length. Times only move forward. A word's time within its
 * sentence comes from how long the words before it take to say; the sentence's own progress is the
 * audio's clock, so the reveal follows what the student hears, and pauses when she pauses.
 */
export function revealUnits(b: BoardBlock): RevealUnit[] {
  const texts = unitTexts(b);
  const spoken = canvasSentences(b.spoken_text).flatMap((sentence, index) => {
    const words = wordsOf(sentence);
    const weights = words.map(wordWeight);
    const total = weights.reduce((x, y) => x + y, 0) || 1;
    let run = 0;
    return words.map((word, i) => {
      const at = b.s + index + run / total;
      run += weights[i];
      return { word, at };
    });
  });
  const end = b.e + 1;
  const found: Array<number | null> = [];
  let cursor = 0;
  for (const text of texts) {
    // Where she says this piece: the earliest stretch of speech holding the most of its words. One word is not
    // enough ("speed" is in every sentence of a lesson on speed), so a piece of several words needs two.
    const want = [...new Set(distinctive(wordsOf(text)))].slice(0, 8);
    const span = Math.max(8, want.length * 2);
    let best = 0;
    let hit = -1;
    for (let i = cursor; i < spoken.length; i++) {
      if (!want.includes(spoken[i].word)) continue;
      const score = new Set(spoken.slice(i, i + span).map((x) => x.word).filter((w) => want.includes(w))).size;
      if (score > best) { best = score; hit = i; }
    }
    // The stretch starts where the piece does, not at a stray word just before it with the same score.
    const scoreAt = (i: number) => new Set(spoken.slice(i, i + span).map((x) => x.word).filter((w) => want.includes(w))).size;
    if (hit >= 0) for (let i = hit + 1; i < Math.min(spoken.length, hit + span) && scoreAt(i) === best; i++) if (want.includes(spoken[i].word)) hit = i;
    if (hit >= 0 && best >= Math.min(2, want.length)) {
      found.push(spoken[hit].at);
      cursor = hit + 1;
    } else found.push(null);
  }
  // The first piece starts as the block does; pieces with no match share the room between their neighbours.
  const size = texts.map((t) => Math.max(1, t.length));
  const at: number[] = new Array(texts.length).fill(0);
  let i = 0;
  while (i < texts.length) {
    if (found[i] !== null) {
      at[i] = found[i]!;
      i++;
      continue;
    }
    let j = i;
    while (j < texts.length && found[j] === null) j++;
    const from = i === 0 ? b.s : at[i - 1];
    const to = j < texts.length ? found[j]! : end;
    const total = size.slice(i, j + 1).reduce((x, y) => x + y, 0);
    let run = 0;
    for (let k = i; k < j; k++) {
      at[k] = i === 0 && k === 0 ? b.s : from + ((to - from) * run) / total;
      run += size[k];
    }
    i = j;
  }
  for (let k = 1; k < at.length; k++) at[k] = Math.max(at[k], at[k - 1]);
  return texts.map((text, k) => ({ key: `${b.id}-${k}`, text, at: at[k] }));
}

/** How many of a block's pieces have been said by this moment of the board (sentence + progress). */
export function shownCount(units: RevealUnit[], clock: number): number {
  let n = 0;
  while (n < units.length && units[n].at <= clock) n++;
  return n;
}
