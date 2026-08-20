import type { SuprnotesLessonInput } from "./suprnotes";

/**
 * Retrieval over an uploaded document, blended between the question and the selected region.
 *
 * WHAT THIS IS FOR. A student draws a box round a formula and asks "explain this". The region's
 * transcript is the SUBJECT — that part is settled, and pinned verbatim by `lib/pdfFocus.ts`. What
 * is missing is everything the region depends on: the paragraph that defines its symbols, the table
 * whose values it computes, the figure it refers to. Those live elsewhere in the document, and a
 * lecture that teaches a formula without them teaches half of it.
 *
 * WHY THE RANKING IS BLENDED. Once someone has drawn a box, their question is usually two words —
 * "explain this" carries almost no signal, and ranking on it alone retrieves nothing useful. The
 * region's own text is the far stronger query, so both are used: the question says what they want
 * done, the region says what about.
 *
 * ONE SHAPE FOR BOTH FORMATS. PDF content blocks and PowerPoint slide text both reduce to
 * `{ id, label, text }` here, which is what makes "it works for decks too" true by construction
 * rather than by a second code path that drifts.
 *
 * Everything in this file is pure arithmetic. No client, no key, no network.
 */

export type RagChunk = {
  id: string;
  /** "page 7", "slide 3" — quoted into the prompt so the lecture can say where something came from. */
  label: string;
  text: string;
};

export type RankedChunk = RagChunk & { score: number };

export const RAG_RULES = {
  /** How many chunks accompany the region. Enough to define its terms, few enough to stay support. */
  TOP_K: 6,
  /**
   * How much the REGION's own text drives retrieval versus the typed question.
   *
   * Weighted toward the region because "explain this" is what people actually type once they have
   * drawn a box, and ranking on those two words retrieves noise.
   */
  REGION_WEIGHT: 0.65,
  /** Above this cosine, two chunks are saying the same thing and only the better one is kept. */
  DUPLICATE_AT: 0.92,
  /** Below this, a chunk is unrelated and padding the prompt with it only dilutes the subject. */
  MIN_SCORE: 0.12,
  MIN_CHUNK_CHARS: 40,
} as const;

/** Cosine similarity. Returns 0 for mismatched or zero-length vectors rather than NaN. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

const clean = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * Everything in the document that could be retrieved, in one shape.
 *
 * A PDF arrives as content blocks carrying page numbers; a text-only deck arrives as one string of
 * "Slide N:" sections. Both become the same list, so retrieval never needs to know which it has.
 */
export function chunksFrom(
  sourceDocument: SuprnotesLessonInput | null,
  slideContext: string,
): RagChunk[] {
  const blocks = sourceDocument?.contentBlocks ?? [];
  if (blocks.length > 0) {
    return blocks
      .map((block, index): RagChunk => {
        const body = [
          block.heading,
          block.text,
          ...(block.items ?? []),
          ...(block.rows ?? []).map((row) => row.join(" ")),
        ]
          .filter(Boolean)
          .join("\n");
        const where = typeof block.pageNumber === "number" ? `page ${block.pageNumber}` : `section ${index + 1}`;
        return { id: block.id || `block-${index}`, label: where, text: clean(body) };
      })
      .filter((chunk) => chunk.text.length >= RAG_RULES.MIN_CHUNK_CHARS);
  }

  // A deck with no embedded images reaches generation as slide text rather than a source document.
  if (slideContext.trim()) {
    return slideContext
      .split(/\n(?=Slide\s+\d+\s*:)/i)
      .map((section, index): RagChunk => {
        const match = section.match(/^Slide\s+(\d+)\s*:/i);
        return {
          id: `slide-${match?.[1] ?? index + 1}`,
          label: `slide ${match?.[1] ?? index + 1}`,
          text: clean(section),
        };
      })
      .filter((chunk) => chunk.text.length >= RAG_RULES.MIN_CHUNK_CHARS);
  }

  return [];
}

/**
 * Rank chunks against the question and the region, and keep the best few.
 *
 * `regionVec` may be null (no region drawn), in which case the question alone drives it — the
 * ordinary "teach me this document, focusing on X" case.
 */
export function rankChunks(
  chunks: RagChunk[],
  chunkVectors: number[][],
  queryVector: number[] | null,
  regionVector: number[] | null,
  excludeIds: Set<string> = new Set(),
): RankedChunk[] {
  if (chunks.length === 0 || chunkVectors.length !== chunks.length) return [];
  if (!queryVector && !regionVector) return [];

  const w = regionVector && queryVector ? RAG_RULES.REGION_WEIGHT : regionVector ? 1 : 0;

  const scored: RankedChunk[] = chunks
    .map((chunk, index) => {
      const vec = chunkVectors[index];
      const fromRegion = regionVector ? cosine(vec, regionVector) : 0;
      const fromQuery = queryVector ? cosine(vec, queryVector) : 0;
      return { ...chunk, score: w * fromRegion + (1 - w) * fromQuery };
    })
    .filter((chunk) => !excludeIds.has(chunk.id) && chunk.score >= RAG_RULES.MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  /*
   * Drop near-duplicates.
   *
   * Papers repeat themselves — an abstract, an introduction and a conclusion often say the same
   * sentence three ways. Without this the top-k is three copies of one idea and the terms the region
   * actually needs are pushed out of the prompt.
   */
  const kept: RankedChunk[] = [];
  const keptVectors: number[][] = [];
  for (const chunk of scored) {
    if (kept.length >= RAG_RULES.TOP_K) break;
    const vec = chunkVectors[chunks.findIndex((c) => c.id === chunk.id)];
    if (keptVectors.some((seen) => cosine(seen, vec) >= RAG_RULES.DUPLICATE_AT)) continue;
    kept.push(chunk);
    keptVectors.push(vec);
  }
  return kept;
}

/**
 * The supporting-context section of the prompt.
 *
 * Explicitly SUPPORT, not syllabus. Without saying so, a model handed six extra passages treats
 * them as more material to cover and the lecture drifts back into a survey — which is the failure
 * this whole feature exists to correct.
 */
export function contextPromptSection(chunks: RankedChunk[]): string {
  if (chunks.length === 0) return "";
  const body = chunks.map((c) => `[${c.label}] ${c.text}`).join("\n\n");
  return [
    "SUPPORTING CONTEXT from elsewhere in the same document, retrieved because it relates to what",
    "the student asked about:",
    body,
    "",
    "Use this ONLY to explain the passage above — to define a term it uses, supply a value it refers",
    "to, or name the figure it points at. Do not teach these passages in their own right, and do not",
    "add beats to cover them. If one is not needed, ignore it.",
  ].join("\n");
}
