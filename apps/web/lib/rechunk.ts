import type { Beat } from "./lessonContent";
import { splitNarrationSentences } from "./voice";

/**
 * Breaks a beat's full script into 2-3 short, punchy chunks for the ADHD track's
 * attention-recovery flow — "one idea per screen" instead of one long paragraph. Reuses
 * splitNarrationSentences (already used for sentence-level narration cueing) rather than
 * re-implementing sentence splitting.
 */
export function rechunkBeat(beat: Beat): string[] {
  const sentences = splitNarrationSentences(beat.script);
  if (sentences.length <= 1) return sentences;

  const targetChunks = sentences.length <= 3 ? sentences.length : sentences.length <= 6 ? 3 : 4;
  const perChunk = Math.ceil(sentences.length / targetChunks);

  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += perChunk) {
    chunks.push(sentences.slice(i, i + perChunk).join(" "));
  }
  return chunks;
}
