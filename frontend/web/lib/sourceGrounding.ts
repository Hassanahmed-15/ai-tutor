/**
 * IS THIS TEXT IN THE SOURCE?
 *
 * Strict source mode promises the student that everything taught comes from the pages they chose.
 * That promise was only a sentence in a prompt: the board model never saw the source at all, and a
 * strict lesson on a textbook's "Energy transfer" paragraph drew an invented leaf with its own
 * labels. A promise with no check is a hope, so this module is the check — deterministic, cheap,
 * and shared by every surface that must stay inside the source (the script, the board labels, the
 * chat answer).
 *
 * THE MEASURE. A piece of text is grounded when its CONTENT words — nouns, verbs, numbers; not
 * "the", "this", "so" — all occur in the source, after light stemming ("absorbs" ~ "absorb",
 * "leaves" ~ "leaf"). A handful of formula spellings are treated as the words they stand for
 * (CO2 = carbon dioxide), because a board writing "CO2" for a source that says "carbon dioxide" is
 * faithful. Teaching glue ("look", "means", "first") never counts against a sentence: explaining
 * the source in order needs those words, and none of them assert a fact.
 *
 * Deliberately lexical, not semantic. A paraphrase that swaps a source word for a synonym is
 * flagged — in strict mode the source's own word is the right one to use.
 */

/**
 * STRICT MEANS NOT ONE OUTSIDE WORD. A sentence, point, label or answer is outside the source as
 * soon as ONE of its content words is absent from it. This was two — "one stray word is paraphrase"
 * — and single outside words ("…which helps the plant grow") added up across a lesson into exactly
 * the outside teaching a strict student had ruled out. Shared by every strict check.
 */
export const STRICT_MISSING_LIMIT = 1;

/** The source a board or script must stay inside, for one beat. */
export type BeatSourceGrounding = {
  /** The beat's own source text (scopedBlockText), never the whole document. */
  text: string;
  /** A figure's labels as printed in the source's text layer, verbatim. */
  labels: string[];
  /** The figure caption, when the beat carries one. */
  caption?: string;
  /** Strict fidelity: only the source may be taught. Reference mode passes false. */
  strict: boolean;
  /**
   * The source's own figure for this beat, as a data URL (a crop of the page around the figure),
   * so the board can redraw THAT figure rather than an invented one. Optional: absent when the
   * beat has no figure or the page image is unavailable.
   */
  figureImage?: string;
};

const STOPWORDS = new Set(
  (
    "a an the and or but if then so as of to in on at by for from with without into onto over under up down out off " +
    "is are was were be been being am do does did done has have had having can could will would shall should may might must " +
    "it its it's this that these those there here their they them he she his her we our us you your i me my mine " +
    "what which who whom whose when where why how not no nor all any both each few more most other some such only own same " +
    "than too very just also again further once about against between through during before after above below while because " +
    "until whether either neither per via yet still even ever every much many lot lots one ones"
  ).split(/\s+/),
);

/**
 * Words that explain without asserting anything about the subject. A strict script that walks
 * through the source ("First, look at this part. It means…") needs them, and none of them adds a
 * fact the source lacks.
 */
const TEACHING_GLUE = new Set(
  (
    "look see let let's notice note now next first second third finally start begin end show shows shown showing " +
    "mean means meaning called call name named say says said tell tells told read reads word words sentence sentences " +
    "part parts piece pieces step steps page pages section source text book textbook figure diagram label labels labelled " +
    "labeled picture image drawing board line lines box arrow arrows point points here's thing things way ways idea ideas " +
    "together whole simply simple important key main really actually exactly clearly question questions answer answers " +
    "explain explains explained describe describes described remember recall think understand learn learning today " +
    "put puts go goes going come comes coming get gets make makes made take takes use uses used using"
  ).split(/\s+/),
);

/** Formula spellings a board may use for words the source writes out. */
const FORMULA_WORDS: Record<string, string[]> = {
  co2: ["carbon", "dioxide"],
  o2: ["oxygen"],
  h2o: ["water"],
  c6h12o6: ["glucose"],
  n2: ["nitrogen"],
  h2: ["hydrogen"],
};

/** Light stemming: enough to match "absorbs"/"absorb", "leaves"/"leaf", "stored"/"store". */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  const irregular: Record<string, string> = { leaves: "leaf", lives: "life", knives: "knife", children: "child", mice: "mouse", feet: "foot", teeth: "tooth", men: "man", women: "woman" };
  if (irregular[w]) return irregular[w];
  for (const [suffix, replacement] of [
    ["ational", "ate"], ["ization", "ize"], ["isation", "ise"], ["iveness", "ive"], ["fulness", "ful"],
    ["ically", "ic"], ["ation", "ate"], ["ness", ""], ["ment", ""], ["ingly", ""], ["edly", ""],
    ["ies", "y"], ["ied", "y"], ["ing", ""], ["ers", "er"], ["est", ""], ["ed", ""], ["ly", ""], ["es", ""], ["s", ""],
  ] as const) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, w.length - suffix.length) + replacement;
      break;
    }
  }
  // "stor" (stored) and "store" must meet; so must "absorb"/"absorbe".
  return w.replace(/e$/, "");
}

/**
 * Negative contractions become their two words before matching. Without this "doesn't" survived
 * as the non-word "doesn", so every spoken negation counted as one ungrounded content term against
 * the board labels and the eval metric (the strict script gate had its own copy of this fix).
 */
function expandNegations(text: string): string {
  return text
    .replace(/\bcan['’]t\b/g, "can not")
    .replace(/\bwon['’]t\b/g, "will not")
    .replace(/\bshan['’]t\b/g, "shall not")
    .replace(/\b([a-z]+)n['’]t\b/g, "$1 not");
}

function words(text: string): string[] {
  return (expandNegations(text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")).match(/[a-z0-9]+(?:['’][a-z]+)?/g) ?? [])
    .map((word) => word.replace(/['’](?:s|re|ll|ve|d|t)$/, ""));
}

/** The content stems of a text: stopwords and teaching glue removed, formulas expanded. */
export function contentStems(text: string): string[] {
  const out: string[] = [];
  for (const word of words(text)) {
    // Own keys only: "constructor" (a word C++ notes use) found Object.prototype's and threw.
    if (Object.hasOwn(FORMULA_WORDS, word)) {
      out.push(...FORMULA_WORDS[word].map(stem));
      continue;
    }
    if (STOPWORDS.has(word) || TEACHING_GLUE.has(word)) continue;
    if (/^\d+$/.test(word)) {
      out.push(word);
      continue;
    }
    if (word.length < 2) continue;
    out.push(stem(word));
  }
  return out;
}

/** Every stem the source contains, including its labels and caption. */
export function sourceVocabulary(source: string | BeatSourceGrounding): Set<string> {
  const text = typeof source === "string" ? source : [source.text, ...source.labels, source.caption ?? ""].join("\n");
  const vocab = new Set<string>();
  for (const word of words(text)) {
    vocab.add(word);
    vocab.add(stem(word));
  }
  // A source that writes "carbon dioxide" licenses "CO2", and the reverse.
  for (const [formula, expansion] of Object.entries(FORMULA_WORDS)) {
    const stems = expansion.map(stem);
    if (vocab.has(formula)) stems.forEach((value) => vocab.add(value));
    if (stems.every((value) => vocab.has(value))) vocab.add(formula);
  }
  return vocab;
}

/** The content terms of `text` that the source never uses. Empty means grounded. */
export function ungroundedTerms(text: string, vocab: Set<string>): string[] {
  const missing = new Set<string>();
  for (const value of contentStems(text)) {
    if (!vocab.has(value)) missing.add(value);
  }
  return [...missing];
}

/**
 * A board label is grounded when every content word in it is a source word. A label with no content
 * words at all ("→", "1", "?") is treated as grounded: it asserts nothing.
 */
export function labelIsGrounded(label: string, vocab: Set<string>): boolean {
  return ungroundedTerms(label, vocab).length === 0;
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export type SentenceGrounding = { sentence: string; missing: string[] };

/**
 * The sentences of a script that bring in content the source does not have. A sentence is flagged
 * when `tolerance` or more of its content terms are absent from the source — one stray word
 * ("so the leaf *gains* energy") is paraphrase, two or more is new material.
 */
export function ungroundedSentences(script: string, source: string | BeatSourceGrounding, tolerance = 2): SentenceGrounding[] {
  const vocab = sourceVocabulary(source);
  return splitSentences(script)
    .map((sentence) => ({ sentence, missing: ungroundedTerms(sentence, vocab) }))
    .filter((entry) => entry.missing.length >= tolerance);
}

/** Share of a script's content terms that occur in the source, 0..1. For measuring, not gating. */
export function groundingRatio(script: string, source: string | BeatSourceGrounding): number {
  const vocab = sourceVocabulary(source);
  const stems = contentStems(script);
  if (stems.length === 0) return 1;
  return stems.filter((value) => vocab.has(value)).length / stems.length;
}

/**
 * A figure's labels, verbatim from the text layer's "Diagram labels:" block (pdfLessonPipeline
 * emits one per figure). The vision model's own region labels are never used: they are model text,
 * not source text.
 */
export function figureLabelsFromBlocks(blocks: Array<{ text?: string; role?: string }>): string[] {
  const labels: string[] = [];
  for (const block of blocks) {
    if (block.role !== "figure-labels") continue;
    const body = (block.text ?? "").replace(/^\s*Diagram labels:\s*/i, "");
    for (const label of body.split(/\s*,\s*/)) {
      const value = label.trim();
      if (value && !labels.includes(value)) labels.push(value);
    }
  }
  return labels;
}

/**
 * IS THIS SENTENCE INSIDE THE SOURCE — by CONTENT, not by vocabulary.
 *
 * "Not one outside word" turned every explanation into a reading: explaining needs ordinary words
 * ("in other words", "the plant uses this to…") that no textbook paragraph happens to contain, so
 * the gate deleted the explaining and left the page read aloud. What strict mode forbids is new
 * CONTENT: facts, technical terms, numbers, names, examples. So a sentence is outside the source when
 *   - it states a number the source does not, or
 *   - it names something technical the source does not (a long or scientific-looking word, or a
 *     capitalised name), or
 *   - more than a third of its content words are the source's absent — i.e. it is mostly new material.
 * Everyday explaining words below that share are allowed.
 */
export function sentenceIsGrounded(text: string, vocab: Set<string>): boolean {
  // Hyphenated words are judged part by part: "blue-black" is two source words, not one long term.
  const words = text.match(/[A-Za-z][A-Za-z'’]*|\d+(?:[.,]\d+)?/g) ?? [];
  const firstWord = words[0] ?? "";
  for (const word of words) {
    const lower = word.toLowerCase().replace(/['’]s$/, "");
    const stemmed = stem(lower);
    if (vocab.has(lower) || vocab.has(stemmed)) continue;
    if (STOPWORDS.has(lower) || TEACHING_GLUE.has(lower)) continue;
    // A number the source does not state. The vocabulary holds "19.3" as "19" and "3", so a number is
    // judged by its parts — otherwise every "Figure 19.3" in an answer failed against a source that
    // says "Figure 19.3".
    if (/^\d/.test(word)) {
      if (word.split(/[.,]/).every((part) => vocab.has(part))) continue;
      return false;
    }
    if (/^[A-Z]/.test(word) && word !== firstWord && lower.length > 2) return false; // a name
    // A technical term. Length alone used to decide it, which failed ordinary explaining words —
    // "connecting", "identified", "effectively" — and deleted correct walk-through sentences from
    // strict answers. Inflected everyday forms still count toward the missing share below.
    if ((lower.length >= 10 && !/(?:ing|ed|ly|ment|ments|ness)$/.test(lower)) || /(?:ase|ose|ide|ine|phyll|plast|cyte|ism|osis|ation|ology|gen|ium|ions?)$/.test(lower) && lower.length >= 7) return false;
  }
  const stems = contentStems(text);
  if (stems.length === 0) return true;
  const missing = stems.filter((value) => !vocab.has(value)).length;
  return missing <= Math.max(1, Math.floor(stems.length / 3));
}

