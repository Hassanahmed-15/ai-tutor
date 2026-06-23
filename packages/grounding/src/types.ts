/** A single source document the corpus cites back to (README 7.2). */
export interface Source {
  sourceId: string;
  sourceTitle: string;
  locator?: string;
}

/** One grounded factual claim, traceable to a source. This is what the Confidence Scorer checks claims against. */
export interface GroundedFact {
  id: string;
  statement: string;
  sourceId: string;
}

export interface TopicCorpus {
  topic: string;
  subject: string;
  sources: Source[];
  facts: GroundedFact[];
}
