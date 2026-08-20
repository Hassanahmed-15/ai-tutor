import type OpenAI from "openai";

/**
 * Embeddings for retrieval over an uploaded document.
 *
 * Computed at generation time, server-side. Nothing extra crosses the wire, there is one place
 * doing it, and it cannot go stale against a re-parse the way a cache would.
 *
 * 512 DIMENSIONS, not the default 1536. `text-embedding-3-small` supports shortening natively
 * (the vectors are trained so a prefix is still a good embedding), and a third of the size is a
 * third of the arithmetic on every comparison. For ranking a few dozen chunks of one document
 * against one question, the full width buys nothing measurable.
 */

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMENSIONS = 512;

export const EMBED_RULES = {
  /**
   * Ceiling on chunks embedded per lecture. A long book would otherwise send hundreds of chunks to
   * be embedded for one question, and the tail of a document is rarely what a focused question is
   * about.
   */
  MAX_CHUNKS: 120,
  /** Roughly 2000 tokens; longer chunks blur into an average of everything they contain. */
  MAX_CHARS_PER_CHUNK: 8_000,
} as const;

/**
 * Embed a batch of texts. Returns null if embedding is unavailable or fails.
 *
 * NULL RATHER THAN THROWING, because the caller has a working lexical fallback: a transient API
 * error must degrade retrieval, not turn a grounded lecture back into a generic one. That is the
 * exact regression this whole line of work exists to fix.
 */
export async function embedTexts(client: OpenAI, texts: string[]): Promise<number[][] | null> {
  const usable = texts.map((t) => (t ?? "").trim().slice(0, EMBED_RULES.MAX_CHARS_PER_CHUNK));
  if (usable.length === 0 || usable.every((t) => t.length === 0)) return null;

  try {
    const response = await client.embeddings.create({
      model: EMBED_MODEL,
      dimensions: EMBED_DIMENSIONS,
      // The API rejects an empty string; a placeholder keeps positions aligned with the input,
      // which matters because the caller maps results back to chunks by index.
      input: usable.map((t) => t || " "),
    });
    const vectors = response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
    return vectors.length === usable.length ? vectors : null;
  } catch {
    return null;
  }
}
