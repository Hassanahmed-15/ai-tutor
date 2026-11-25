import { contentStems } from "./sourceGrounding";
import type { SuprnotesContentBlock, SuprnotesLessonInput } from "./suprnotes";

/**
 * WHAT ARIA IS READING FROM, EXACTLY (owner, 2026-11-25: "if a diagram is explained show that in a box,
 * and if lines are explained highlight them"). A strict lesson's PDF panel used to box the whole
 * paragraph a sentence came from; now each spoken sentence lights up only the printed lines it says,
 * and a sentence about a figure puts a box around the figure itself.
 *
 * Pure: the panel (components/teaching/PdfSourcePanel.tsx) calls it with the passage the planner tied to
 * the sentence (Beat.sentenceBlockIds) or the one it matched by words.
 */

export type FocusRect = { x: number; y: number; width: number; height: number };

export type SentenceFocus =
  /** The printed lines the sentence says, top to bottom. */
  | { kind: "lines"; pageNumber: number; blockId: string; rects: FocusRect[] }
  /** A figure the sentence explains: the box goes round the drawing. */
  | { kind: "figure"; pageNumber: number; blockId: string | null; rect: FocusRect };

const FIGURE_WORDS = /\b(?:figures?|fig\.|diagrams?|drawings?|pictures?|illustrat\w*|graphs?|charts?|images?|shown|shows|panel|labell?ed|on the left|on the right|before and after|\([ab]\))/i;

function clampRect(r: FocusRect | undefined | null): FocusRect | null {
  if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return null;
  const x = Math.max(0, Math.min(1, r.x));
  const y = Math.max(0, Math.min(1, r.y));
  return { x, y, width: Math.max(0.005, Math.min(1 - x, r.width)), height: Math.max(0.005, Math.min(1 - y, r.height)) };
}

function union(rects: FocusRect[], pad = 0): FocusRect | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.x)) - pad;
  const top = Math.min(...rects.map((r) => r.y)) - pad;
  const right = Math.max(...rects.map((r) => r.x + r.width)) + pad;
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + pad;
  return clampRect({ x: left, y: top, width: right - left, height: bottom - top });
}

const overlapShare = (want: Set<string>, text: string) => {
  const got = contentStems(text);
  if (!got.length || !want.size) return 0;
  return got.filter((w) => want.has(w)).length / Math.min(got.length, want.size);
};

/** The figure the sentence (or its caption block) is about, with where the drawing is on its page. */
function figureFor(doc: SuprnotesLessonInput, block: SuprnotesContentBlock | undefined, sentence: string, pages: number[]): { rect: FocusRect; pageNumber: number } | null {
  const said = new Set(contentStems(sentence));
  const isFigureBlock = Boolean(block && (block.role === "figure-labels" || block.role === "caption" || block.figureRegion));
  // A caption on a scanned page carries the box of the figure it captions (lib/ocrLayout.ts).
  if (block?.figureRegion && typeof block.pageNumber === "number") {
    const rect = clampRect(block.figureRegion);
    if (rect) return { rect, pageNumber: block.pageNumber };
  }
  // A figure's printed labels: the drawing is where they are.
  if (block?.role === "figure-labels" && block.labelRegions?.length && typeof block.pageNumber === "number") {
    const rect = union(block.labelRegions.map((l) => l.bbox), 0.02);
    if (rect) return { rect, pageNumber: block.pageNumber };
  }
  if (!isFigureBlock && !FIGURE_WORDS.test(sentence)) return null;
  // The detected figure on these pages whose caption, description or labels the sentence shares most with.
  const candidates = (doc.assets ?? []).filter((a) => typeof a.pageNumber === "number" && a.bbox && (pages.includes(a.pageNumber) || a.pageNumber === block?.pageNumber));
  let best: { rect: FocusRect; pageNumber: number; score: number } | null = null;
  for (const asset of candidates) {
    const rect = clampRect(asset.bbox as FocusRect);
    if (!rect) continue;
    const text = `${asset.caption ?? ""} ${asset.description ?? ""}`;
    const linked = block && (asset.sourceBlockIds ?? []).includes(block.id) ? 0.5 : 0;
    const score = overlapShare(said, text) + linked + (isFigureBlock && block && overlapShare(new Set(contentStems(block.text ?? "")), asset.caption ?? "") > 0.5 ? 0.6 : 0);
    if (score > (best?.score ?? 0.25)) best = { rect, pageNumber: asset.pageNumber as number, score };
  }
  return best ? { rect: best.rect, pageNumber: best.pageNumber } : null;
}

/** Every word, lightly normalised: the small words count here, they hold a run of text together. */
const runWords = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map((w) => w.replace(/(ies|es|s|ed|ing)$/, "").slice(0, 7));

/**
 * The lines of a passage one sentence says. A sentence is matched as a STRETCH of the passage — the run of
 * its words that shares most with the sentence, measured both ways (Dice), so a line that only repeats one
 * word ("…does not have a parent") is taken only when the sentence really runs on into it. Returns the
 * line indexes the stretch covers (at most six), or none when nothing in the passage says it.
 */
export function linesSaid(lines: NonNullable<SuprnotesContentBlock["lines"]>, sentence: string): number[] {
  const want = runWords(sentence);
  if (want.length < 2 || !lines.length) return [];
  const need = new Map<string, number>();
  for (const w of want) need.set(w, (need.get(w) ?? 0) + 1);
  const words: Array<{ w: string; line: number }> = lines.flatMap((line, i) => runWords(line.text).map((w) => ({ w, line: i })));
  // Content words must be shared too: a run of "the … of … a" says nothing.
  const content = new Set(contentStems(sentence).map((w) => w.slice(0, 5)));
  let best: { from: number; to: number; score: number } | null = null;
  for (let from = 0; from < words.length; from++) {
    const have = new Map<string, number>();
    let shared = 0;
    let meaningful = 0;
    for (let to = from; to < words.length && to - from < want.length * 2 + 8; to++) {
      const w = words[to].w;
      const n = (have.get(w) ?? 0) + 1;
      have.set(w, n);
      if (n <= (need.get(w) ?? 0)) {
        shared++;
        if (content.has(w.slice(0, 5))) meaningful++;
      }
      const score = (2 * shared) / (to - from + 1 + want.length);
      if (meaningful >= Math.min(2, content.size) && score > (best?.score ?? 0.34)) best = { from, to, score };
    }
  }
  if (!best) return [];
  const first = words[best.from].line;
  const last = Math.min(words[best.to].line, first + 5);
  return Array.from({ length: last - first + 1 }, (_, k) => first + k);
}

/**
 * Where the PDF panel marks the sentence being spoken: the figure it explains, or the lines it says, or
 * null (the panel then keeps the whole passage's box, as before). `blockId` is the passage the sentence
 * is about; `pages` the pages of the board, for a figure the planner did not tie to a block.
 */
export function sentenceFocus(doc: SuprnotesLessonInput | null | undefined, blockId: string | null | undefined, sentence: string, pages: number[] = []): SentenceFocus | null {
  if (!doc || !sentence.trim()) return null;
  const block = blockId ? (doc.contentBlocks ?? []).find((b) => b.id === blockId) : undefined;
  const figure = figureFor(doc, block, sentence, pages);
  // A sentence about a figure — its caption block, its labels, or "the diagram shows…" with a matching
  // drawing — boxes the drawing. A sentence that only quotes the caption's prose still reads as lines.
  if (figure && (!block?.lines?.length || block.role === "caption" || block.role === "figure-labels" || FIGURE_WORDS.test(sentence))) {
    return { kind: "figure", pageNumber: figure.pageNumber, blockId: block?.id ?? null, rect: figure.rect };
  }
  if (!block || typeof block.pageNumber !== "number" || !block.lines?.length) return null;
  const picked = linesSaid(block.lines, sentence);
  if (!picked.length) return null;
  const rects = picked.map((i) => clampRect(block.lines![i].bbox)).filter((r): r is FocusRect => r !== null);
  return rects.length ? { kind: "lines", pageNumber: block.pageNumber, blockId: block.id, rects } : null;
}
