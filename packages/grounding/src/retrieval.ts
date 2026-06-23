import type { Citation } from "@aria/lesson-graph";
import type { GroundedFact, Source, TopicCorpus } from "./types";
import binarySearchCorpus from "../../../content/cs-fundamentals/binary-search.json";

/**
 * MVP retrieval: an in-memory lookup over the seeded corpus (README content/ dir).
 * This is deliberately not a vector DB / embedding search — per README Section 8/9,
 * MVP scope is ONE subject seeded deeply, so exact-topic lookup is sufficient and
 * honest about what's actually implemented. Swapping this for real RAG over a larger
 * corpus is Phase 1 (README Section 8) and only requires changing this file.
 */
const corpusByTopic: Record<string, TopicCorpus> = {
  "binary-search": binarySearchCorpus as TopicCorpus,
};

export function getCorpus(topic: string): TopicCorpus | undefined {
  return corpusByTopic[topic];
}

export function listAvailableTopics(): string[] {
  return Object.keys(corpusByTopic);
}

function sourceFor(corpus: TopicCorpus, sourceId: string): Source | undefined {
  return corpus.sources.find((s) => s.sourceId === sourceId);
}

/** Turns a grounded fact into a Lesson Graph Citation (README's Citation type), resolving the source. */
export function toCitation(corpus: TopicCorpus, fact: GroundedFact): Citation {
  const source = sourceFor(corpus, fact.sourceId);
  return {
    sourceId: fact.sourceId,
    sourceTitle: source?.sourceTitle ?? "Unknown source",
    locator: source?.locator,
  };
}

/**
 * Confidence Scorer (README 7.2): MVP heuristic — a claim is "grounded" (confidence 1)
 * only if it corresponds to a fact actually present in the corpus; everything else
 * gets a low confidence score so the reasoning layer hedges rather than asserts.
 * This is intentionally simple (exact fact-id lookup, not semantic matching) — see
 * README Section 1 honesty clause: nothing here claims more accuracy than it has.
 */
export function confidenceForFact(corpus: TopicCorpus, factId: string): number {
  return corpus.facts.some((f) => f.id === factId) ? 1 : 0.3;
}
