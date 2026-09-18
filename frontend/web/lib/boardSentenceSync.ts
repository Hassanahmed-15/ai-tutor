/**
 * Placing each board action on the sentence that actually introduces it.
 *
 * WHY THIS EXISTS. A chalkboard op is revealed when the narration clock passes `op.at`, a 0-1
 * fraction of the beat. The model is told to tag every op with `group` = the index of the sentence
 * it supports, and `lib/blackboardGen.ts` rewrites `at = group / n` from that — so a correctly
 * tagged board is written exactly as it is spoken.
 *
 * The failure this fixes is what happens when the tag is missing. Nothing checked for it, so the op
 * silently kept whatever fraction the model had guessed, and it appeared at the wrong moment: the
 * teacher says "chlorophyll" at sentence four while the chlorophyll row was written during sentence
 * one. Unlike the React-animation path, which hard-rejects a board whose steps lack
 * `data-teach-sentence`, the chalkboard had no such guard — so the desync was invisible rather than
 * loud.
 *
 * The recovery is to read the op's own words. A row saying "Chlorophyll" belongs to the sentence
 * that says chlorophyll, and that is a decision this code can make on its own, deterministically,
 * without asking a model to try again.
 *
 * Everything here is pure. No client, no key, no network — so the placement rules are assertable.
 */

/** One op as far as placement cares: its text, and whatever the model tagged it with. */
export type PlaceableOp = {
  text?: unknown;
  group?: unknown;
};

export type SentenceSource = "group" | "inferred" | "inherited" | "none";

export type SentenceAssignment = {
  /** The sentence this op belongs to, or null when it could not be placed at all. */
  index: number | null;
  /** How it was decided — carried so the caller can tell a real tag from a rescued one. */
  source: SentenceSource;
};

export const SYNC_RULES = {
  /**
   * How many distinct sentences a board must spread across.
   *
   * Mirrors the React-animation guard in `lib/drawSanitize.ts`, which rejects a timeline using fewer
   * than three. A board whose every row lands on one sentence is not synchronised to the narration;
   * it is a board that appears all at once, which is the failure that started this.
   */
  MIN_DISTINCT_SENTENCES: 3,
  /**
   * Weight a match must reach before it counts.
   *
   * Above zero on purpose. Any two English sentences share something, and a match resting entirely
   * on common words would place rows confidently and wrongly — worse than admitting the op could
   * not be placed, because a wrong placement looks deliberate.
   */
  MIN_MATCH_SCORE: 0.35,
} as const;

/**
 * Words too common to identify anything.
 *
 * Deliberately short. The inverse-frequency weighting below already discounts whatever is common in
 * THIS script, which is the better filter — a word like "energy" is uninformative in a lecture about
 * energy and highly informative anywhere else, and only the script can say which.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from",
  "has", "have", "how", "in", "into", "is", "it", "its", "of", "on", "or", "so", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "to", "up", "was", "we", "what",
  "when", "where", "which", "while", "who", "why", "will", "with", "you", "your",
]);

/**
 * Crude stemming, so a board row does not have to echo the script's exact word form.
 *
 * "Absorbs" on the board and "absorbing" in the script are the same idea, and a student would never
 * accept that as a reason to draw the row at the wrong time. One suffix is enough here: board text
 * is short and deliberately plain.
 */
function stem(word: string): string {
  for (const suffix of ["ing", "es", "ed", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

/** The meaningful words of a phrase, stemmed and de-duplicated. */
function terms(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
      .map(stem),
  )];
}

/**
 * How much each word narrows things down, within this script.
 *
 * A word in one sentence out of eight identifies that sentence; a word in all eight identifies
 * nothing. Weighting by inverse frequency is what makes "chlorophyll" beat "plant" in a lecture
 * where every sentence mentions plants — which is exactly the case that matters, because a board
 * about photosynthesis repeats its subject on every row.
 */
function inverseFrequency(sentences: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    for (const term of terms(sentence)) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  const weights = new Map<string, number>();
  for (const [term, count] of counts) weights.set(term, 1 / count);
  return weights;
}

/**
 * The sentence a piece of board text belongs to, or null when nothing meaningfully matches.
 *
 * Ties go to the EARLIEST sentence. A term introduced in sentence two and referred to again in
 * sentence six should be written when it is introduced — that is when the student first needs to
 * see it, and the later mention then lands on a row already on the board.
 */
export function inferSentenceForText(text: string, sentences: string[]): number | null {
  const wanted = terms(typeof text === "string" ? text : "");
  if (wanted.length === 0 || sentences.length === 0) return null;

  const weights = inverseFrequency(sentences);
  let bestIndex: number | null = null;
  let bestScore = 0;

  sentences.forEach((sentence, index) => {
    const present = new Set(terms(sentence));
    let score = 0;
    for (const term of wanted) {
      if (present.has(term)) score += weights.get(term) ?? 0;
    }
    // Strictly greater, so an equal score leaves the earlier sentence in place.
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= SYNC_RULES.MIN_MATCH_SCORE ? bestIndex : null;
}

/** A model-supplied tag, if it is genuinely a number. */
function taggedSentence(group: unknown, sentenceCount: number): number | null {
  /*
   * `null` is NOT zero here.
   *
   * `Number(null)` is 0, which is finite — so a null tag used to pass the old check and pin its op
   * to sentence 0, writing it at the very start of the beat. An absent tag has to be treated as
   * absent, or the rescue below never runs for the ops that most need it.
   */
  if (group === null || group === undefined || group === "") return null;
  const value = typeof group === "number" ? group : Number(group);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(sentenceCount - 1, Math.floor(value)));
}

/**
 * Decide which sentence every op belongs to.
 *
 * The order of preference is the order of confidence: what the model said, then what the op's own
 * words say, then what the op before it was placed on.
 *
 * MONOTONIC BY CONSTRUCTION. A board is written top to bottom as it is spoken, so an op may never be
 * placed earlier than the op above it. Without this a mid-board row whose wording happens to echo
 * the opening sentence would jump to the top of the timeline and be written before the rows it comes
 * after — visibly out of order, and worse than the imprecision it was trying to fix.
 */
export function assignOpSentences(ops: PlaceableOp[], sentences: string[]): SentenceAssignment[] {
  const sentenceCount = Math.max(1, sentences.length);
  const assignments: SentenceAssignment[] = [];
  let floor = 0;

  for (const op of ops) {
    const tagged = taggedSentence(op?.group, sentenceCount);
    let index: number | null = tagged;
    let source: SentenceSource = tagged === null ? "none" : "group";

    if (index === null) {
      const inferred = inferSentenceForText(typeof op?.text === "string" ? op.text : "", sentences);
      if (inferred !== null) {
        index = inferred;
        source = "inferred";
      }
    }

    /*
     * Nothing to go on: inherit from the op before.
     *
     * An arrow or a shape carries no words of its own, and a row whose wording is entirely common
     * words cannot be placed either. Both belong with what they sit under — an arrow is drawn with
     * the row it points at, not at a moment of its own.
     */
    if (index === null && assignments.length > 0) {
      const previous = assignments[assignments.length - 1].index;
      if (previous !== null) {
        index = previous;
        source = "inherited";
      }
    }

    if (index !== null) {
      index = Math.max(floor, index);
      floor = index;
    }

    assignments.push({ index, source });
  }

  return assignments;
}

/**
 * What is still wrong with this board's timing, in words the retry loop can hand back to the model.
 *
 * Returns null when the board is genuinely sentence-synchronised. The two failures worth
 * regenerating for are an op nobody could place, and a board that piles everything onto one or two
 * sentences — which renders as the whole board appearing at once, the complaint this began with.
 */
export function boardSyncIssue(assignments: SentenceAssignment[], sentenceCount: number): string | null {
  if (assignments.length === 0) return null;

  const unplaced = assignments.filter((entry) => entry.index === null).length;
  if (unplaced > 0) {
    return `${unplaced} board op(s) could not be matched to any spoken sentence; give every op a literal "group" equal to the index of the sentence it supports`;
  }

  /*
   * A one-sentence script cannot be spread across three, and demanding it would reject a board that
   * is already as synchronised as it can be. The rule applies only where it can be satisfied.
   */
  const reachable = Math.min(SYNC_RULES.MIN_DISTINCT_SENTENCES, Math.max(1, sentenceCount));
  const distinct = new Set(assignments.map((entry) => entry.index)).size;
  if (distinct < reachable) {
    return `the board is front-loaded: its actions land on only ${distinct} spoken sentence(s). Spread them across at least ${reachable} different sentences using literal "group" values, and never assign the whole board to sentence 0`;
  }

  return null;
}

/* ── React animations: is each label tagged to the sentence that says it? ─── */

export type LabelMismatch = {
  /** The label as it reads on the board. */
  text: string;
  /** The sentence the model tagged it with. */
  tagged: number;
  /** The sentence whose words it actually matches. */
  spoken: number;
};

/**
 * Plain wording of a JSX text element: nested tags and `{expressions}` removed.
 *
 * A computed value such as `{value.toFixed(2)}` cannot be matched against speech, so it is dropped
 * rather than guessed at; whatever literal words sit around it still place the label.
 */
function jsxTextContent(inner: string): string {
  return inner
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Labels whose `data-teach-sentence` disagrees with the sentence that actually says them.
 *
 * WHY. The generator already rejects a timeline that is missing its tags or piles them onto one
 * sentence, but it never checked that a tag is RIGHT. A board can carry perfectly spread tags and
 * still write "Chlorophyll" during sentence 0 when the teacher only reaches chlorophyll at sentence
 * 3 — which is the out-of-sync lecture students actually see.
 *
 * Deliberately lenient, because a false rejection costs a full regeneration:
 *   - A label whose words cannot be confidently placed (numbers, axis ticks, "A", "t = 0") is
 *     skipped, never flagged.
 *   - A tag is accepted whenever the tagged sentence shares a distinctive word with the label, even
 *     if another sentence matches better — a term said in two sentences may be written at either.
 *   - Only EARLY labels are reported: a label written before the teacher reaches it. That is the
 *     desync students notice ("chlorophyll" on the board a sentence before anyone says it). A label
 *     written after its mention is usually a deliberate recap caption ("Clear direction", "Value
 *     fast") whose short paraphrase only loosely matches the sentence it echoes; measured on the
 *     cached lectures, flagging those rejected more good boards than it caught.
 *   - The board's first label is its title, and a title belongs at the start whatever it matches.
 * Only a label tagged to a sentence that never mentions it, while a LATER sentence clearly does, is
 * reported.
 */
export function reactLabelMismatches(code: string, sentences: string[]): LabelMismatch[] {
  if (sentences.length < 2) return [];
  const weights = inverseFrequency(sentences);
  const sentenceTerms = sentences.map((sentence) => new Set(terms(sentence)));
  const mismatches: LabelMismatch[] = [];

  let isTitle = true;
  for (const match of code.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const tag = /data-teach-sentence\s*=\s*(?:["'](\d+)["']|\{\s*(\d+)\s*\})/.exec(match[1]);
    if (!tag) continue;
    if (isTitle) {
      isTitle = false;
      continue;
    }
    const tagged = Math.min(sentences.length - 1, Number(tag[1] ?? tag[2]));
    const text = jsxTextContent(match[2]);
    const spoken = inferSentenceForText(text, sentences);
    if (spoken === null || spoken <= tagged) continue;

    const labelTerms = terms(text);
    // Words the label shares with the tagged sentence count for it only if they say something about
    // THIS script — a word in every sentence does not locate anything.
    const supportsTag = labelTerms.some(
      (term) => sentenceTerms[tagged].has(term) && (weights.get(term) ?? 0) >= 1 / Math.max(2, sentences.length / 2),
    );
    if (!supportsTag) mismatches.push({ text, tagged, spoken });
  }
  return mismatches;
}

/**
 * The retry-loop reason for a board whose labels appear before they are spoken, or null if it is fine.
 *
 * One stray label is tolerated: regenerating a whole animation to move one word costs far more than
 * the word is worth, and the rest of the board is still in step. Two or more is a board that is
 * genuinely out of sync with the voice.
 */
export function reactLabelSyncIssue(code: string, sentences: string[]): string | null {
  const mismatches = reactLabelMismatches(code, sentences);
  if (mismatches.length < 2) return null;
  const examples = mismatches
    .slice(0, 4)
    .map((m) => `"${m.text.slice(0, 40)}" is tagged data-teach-sentence=${m.tagged} but is spoken in sentence [${m.spoken}]`)
    .join("; ");
  return `labels appear on the board before the teacher says them: ${examples}. Set each text element's data-teach-sentence to the numbered sentence that actually mentions it, and keep its shape on the same sentence`;
}
