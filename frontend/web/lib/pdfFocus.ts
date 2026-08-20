import type { SuprnotesContentBlock, SuprnotesLessonInput } from "./suprnotes";

/**
 * Find the passage a student's question is actually about.
 *
 * THE BUG THIS EXISTS FOR. Upload a KNN paper, ask "explain the formula on page 7", and you got a
 * general lecture about KNN. The formula was never quoted — not because parsing missed it, but
 * because nothing pointed at it: the student's prompt was folded into the topic string, and every
 * block of a thirty-page paper was handed to the model with equal weight. Given a topic and a pile
 * of context, writing the broad lecture is the reasonable thing to do.
 *
 * WHY NOT EMBEDDINGS. The blocks already carry `pageNumber` and their text. When a student names a
 * page that is a stronger and more literal signal than any cosine similarity, and it costs nothing:
 * no embedding call per upload, no vector store, no added latency, and — because this is a pure
 * function over data that is already in memory — every rule here is unit-testable and deterministic.
 * If paraphrase-heavy questions ever prove this insufficient, an embedding pass slots in behind
 * `rankBlocks` without touching anything else.
 *
 * NULL IS A FIRST-CLASS RESULT. A vague question ("teach me this paper") must NOT be pinned to
 * whichever block happened to score highest, or grounding would narrow every upload into a lecture
 * about one paragraph. When nothing scores, this returns null and the caller keeps today's
 * behaviour.
 */

export type FocusPassage = {
  blockId: string;
  pageNumber?: number;
  heading?: string;
  /** The block's own words. Quoted verbatim into the prompt — paraphrase is how a formula gets lost. */
  text: string;
  score: number;
};

export type PdfFocus = {
  /** The student's question, exactly as they wrote it. */
  question: string;
  /** Pages the question named, if any. */
  pages: number[];
  passages: FocusPassage[];
  /**
   * Set when the question names a page the document does not have — the student selected pages 1-3
   * and asked about page 7. Reported rather than silently ignored, because silently answering a
   * different question is exactly what was being complained about.
   */
  missingPages: number[];
};

export const FOCUS_RULES = {
  /** Enough to carry a formula plus the lines that define its terms; few enough to stay pinned. */
  MAX_PASSAGES: 4,
  /** Below this a match is coincidence — a shared word like "the model" — and null is more honest. */
  MIN_SCORE: 2,
  MAX_PASSAGE_CHARS: 1800,
  /**
   * A transcript is allowed more room than a retrieved block: it is one contiguous reading of what
   * the student pointed at, and truncating a formula's definitions off the end of it defeats the
   * point of having read them.
   */
  OCR_PASSAGE_BUDGET: 4,
} as const;

/** Words that match everything and therefore mean nothing for ranking. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "could", "do", "does", "explain", "for",
  "from", "give", "how", "i", "in", "is", "it", "its", "me", "of", "on", "or", "page", "pages",
  "please", "shown", "slide", "slides", "that", "the", "their", "there", "these", "they", "this",
  "to", "understand", "was", "what", "when", "where", "which", "why", "with", "you", "your",
]);

/** Characters that only turn up in mathematics. Cheap, and a formula is mostly made of them. */
const MATH_CHARS = /[=≈≠≤≥±×÷∑∏∫√∞∂∇→←⇒⇔∈∉⊂∪∩·^_|]/;
const MATH_SHAPE = /\b[a-zA-Z]\s*[('[]?\s*[a-zA-Z0-9,\s]*\s*[)\]']?\s*=|\b\d+\s*[+\-*/]\s*\d+/;

type Wanted = "formula" | "table" | "figure" | null;

/** What KIND of thing the question asks for, if it says so. */
export function wantedKind(question: string): Wanted {
  const q = question.toLowerCase();
  if (/\b(formula|equation|expression|derivation|notation)\b/.test(q)) return "formula";
  if (/\b(table|column|row)\b/.test(q)) return "table";
  if (/\b(figure|diagram|graph|chart|plot|image)\b/.test(q)) return "figure";
  return null;
}

/**
 * Page numbers named in the question.
 *
 * Handles the ways people actually write it — "page 7", "p.12", "pg 3", "pages 3-5", "slide 4",
 * "on 7 and 9". A bare number with no page word is deliberately NOT treated as a page: "explain
 * k=5" would otherwise pin the lecture to page 5.
 */
export function parsePageRefs(question: string): number[] {
  const found = new Set<number>();
  const q = question.toLowerCase();

  // "page 7", "pages 3-5", "pages 2, 4 and 6", "p.12", "pg 3", "slide 4"
  const re = /\b(?:pages?|pgs?|p{1,2}\.?|slides?)\s*([\d\s,\-–and]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const span = m[1];
    // Ranges first, so "3-5" becomes 3,4,5 rather than 3 and 5.
    const rangeRe = /(\d+)\s*[-–]\s*(\d+)/g;
    let r: RegExpExecArray | null;
    let rest = span;
    while ((r = rangeRe.exec(span)) !== null) {
      const from = Number(r[1]);
      const to = Number(r[2]);
      // A "range" spanning hundreds of pages is a misparse, not a request.
      if (to >= from && to - from <= 20) for (let p = from; p <= to; p++) found.add(p);
      rest = rest.replace(r[0], " ");
    }
    for (const n of rest.match(/\d+/g) ?? []) found.add(Number(n));
  }

  return [...found].filter((n) => Number.isInteger(n) && n > 0 && n < 10_000).sort((a, b) => a - b);
}

/**
 * Crude stemming, so a question does not have to echo the document's exact word forms.
 *
 * "How do I choose k?" found nothing against a section headed "Choosing k" — the words differ by a
 * suffix and a student is not going to guess which form the paper used. Stripping one suffix and
 * matching on the stem as a substring covers choose/choosing, formula/formulas, distance/distances
 * without dragging in a stemming library for six lines of work.
 */
function stem(word: string): string {
  for (const suffix of ["ing", "es", "ed", "s", "e"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  return word;
}

/** The question's meaningful words. */
function terms(question: string): string[] {
  return [...new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9\s.+-]/g, " ")
      .split(/\s+/)
      .map((t) => t.replace(/^[.+-]+|[.+-]+$/g, ""))
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  )];
}

const blockText = (block: SuprnotesContentBlock): string =>
  [
    block.heading,
    block.text,
    ...(block.items ?? []),
    ...(block.rows ?? []).map((r) => r.join(" ")),
    ...(block.keyIdeas ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

/**
 * Score one block against the question.
 *
 * Term overlap, plus weighting for what was asked for: a question about a formula should prefer the
 * block that actually contains mathematics over the paragraph that merely says the word "formula".
 */
export function scoreBlock(block: SuprnotesContentBlock, questionTerms: string[], want: Wanted): number {
  const body = blockText(block);
  if (!body) return 0;
  const hay = body.toLowerCase();

  let score = 0;
  const head = (block.heading ?? "").toLowerCase();
  for (const term of questionTerms) {
    const root = stem(term);
    if (!hay.includes(root)) continue;
    // A term in the heading is worth more: headings name what a section is about.
    score += head.includes(root) ? 2 : 1;
  }

  if (want === "formula") {
    if (MATH_CHARS.test(body)) score += 3;
    if (MATH_SHAPE.test(body)) score += 2;
    if ((block.type ?? "").toLowerCase().includes("formula")) score += 3;
  }
  if (want === "table" && (block.rows?.length || (block.type ?? "").toLowerCase().includes("table"))) score += 3;
  if (want === "figure" && ((block.assetIds ?? []).length > 0 || /figure|fig\./i.test(body))) score += 3;

  return score;
}

/**
 * Build the focus from a TRANSCRIPT of the rendered page, when one was read.
 *
 * This outranks block retrieval and is not a refinement of it: retrieval searches `contentBlocks`,
 * which come from the text objects a PDF declares, and the content being asked about is frequently
 * not among them — a formula drawn as vector strokes or a figure pasted as an image leaves no text
 * object behind. Measured on this repo's AblationStudy_V3.pdf, page 4 declares 985 characters and
 * every one is a caption. Searching harder cannot find what was never there; reading the pixels can.
 */
export function focusFromTranscript(question: string, transcript: string, pages: number[] = []): PdfFocus | null {
  const text = (transcript ?? "").trim();
  if (!text) return null;
  return {
    question: (question ?? "").trim() || "Explain what is shown here.",
    pages: [...new Set(pages)].sort((a, b) => a - b),
    missingPages: [],
    passages: [{
      blockId: "ocr-transcript",
      pageNumber: pages[0],
      heading: "Read from the page",
      text: text.slice(0, FOCUS_RULES.MAX_PASSAGE_CHARS * FOCUS_RULES.OCR_PASSAGE_BUDGET),
      score: Number.MAX_SAFE_INTEGER,
    }],
  };
}

/**
 * The passages a question is about, or null when it is not about anything in particular.
 *
 * A named page HARD-FILTERS rather than merely boosting: if a student says page 7, an eloquent
 * paragraph on page 2 is not what they asked for, however well it scores.
 */
export function focusPassages(question: string, doc: SuprnotesLessonInput | null): PdfFocus | null {
  const q = (question ?? "").trim();
  if (!q || !doc) return null;

  const blocks = (doc.contentBlocks ?? []).filter((b) => blockText(b).length > 0);
  if (blocks.length === 0) return null;

  const pages = parsePageRefs(q);
  const availablePages = new Set(blocks.map((b) => b.pageNumber).filter((n): n is number => typeof n === "number"));
  const missingPages = pages.filter((p) => availablePages.size > 0 && !availablePages.has(p));
  const usablePages = pages.filter((p) => availablePages.has(p));

  const pool = usablePages.length > 0
    ? blocks.filter((b) => typeof b.pageNumber === "number" && usablePages.includes(b.pageNumber))
    : blocks;

  const want = wantedKind(q);
  const questionTerms = terms(q);

  const ranked = pool
    .map((block) => ({ block, score: scoreBlock(block, questionTerms, want) }))
    .sort((a, b) => b.score - a.score || (a.block.sourceOrder ?? 0) - (b.block.sourceOrder ?? 0));

  /*
   * When the student named a page that exists, EVERYTHING on that page is the answer, even if the
   * wording shares no vocabulary with it — "explain the formula on page 7" often has nothing in
   * common with the text of page 7 beyond the formula itself. Scoring only orders them.
   */
  const chosen = usablePages.length > 0
    ? ranked
    : ranked.filter((r) => r.score >= FOCUS_RULES.MIN_SCORE);

  if (chosen.length === 0) return null;

  return {
    question: q,
    pages: usablePages,
    missingPages,
    passages: chosen.slice(0, FOCUS_RULES.MAX_PASSAGES).map(({ block, score }) => ({
      blockId: block.id,
      pageNumber: block.pageNumber,
      heading: block.heading,
      text: blockText(block).slice(0, FOCUS_RULES.MAX_PASSAGE_CHARS),
      score,
    })),
  };
}

/**
 * The grounding block that goes at the TOP of the generation prompt.
 *
 * Verbatim, with page numbers, and stated as the subject of the lecture rather than as background —
 * "here is some context" is what produced a general lecture in the first place.
 */
export function focusPromptSection(focus: PdfFocus | null): string {
  if (!focus || focus.passages.length === 0) return "";

  const where = focus.pages.length ? ` (page ${focus.pages.join(", ")})` : "";
  const quoted = focus.passages
    .map((p, i) => {
      const page = typeof p.pageNumber === "number" ? ` — page ${p.pageNumber}` : "";
      return `[${i + 1}${page}] ${p.heading ? `${p.heading}\n` : ""}${p.text}`;
    })
    .join("\n\n");

  return [
    "THE STUDENT ASKED ABOUT ONE SPECIFIC THING. THIS IS THE LECTURE'S SUBJECT.",
    `Their question${where}: "${focus.question}"`,
    "",
    "The exact source passage they are asking about, copied from their document:",
    quoted,
    "",
    "Rules for this lecture, which override any general instruction to survey the topic:",
    "- The lecture is ABOUT this passage. Do not write a broad introduction to the wider subject.",
    "- Reproduce the passage EXACTLY — every symbol, subscript and term. Never paraphrase a formula.",
    "- Open on it, then unpack it: what each symbol means, why it is that shape, what it computes.",
    "- Use the rest of the document only where it explains a term used here.",
    focus.missingPages.length
      ? `- The student also mentioned page ${focus.missingPages.join(", ")}, which is not in what they uploaded. Say so plainly in the opening rather than inventing its contents.`
      : "",
  ].filter(Boolean).join("\n");
}

/**
 * The whole user message for a focused question.
 *
 * It lives here rather than in the route because a route file may only export HTTP handlers, and
 * this is the part most worth testing: the PDF contract elsewhere orders one beat per planned block
 * covering the document, which is right for "teach me this paper" and is precisely what turned
 * "explain the formula on page 7" into a survey. Grounding the passage does nothing while that
 * contract still demands complete coverage, so the override has to be explicit — and asserted.
 */
export function focusedUserMessage(args: {
  base: string;
  focus: PdfFocus;
  documentJson: string;
  /**
   * Passages retrieved from elsewhere in the same document because they relate to the region.
   *
   * The whole document is still below as reference, but a model handed a large JSON blob attends to
   * the top of it; these are the parts that actually define the region's terms, lifted out and put
   * next to it. See lib/ragRetrieve.ts.
   */
  contextSection?: string;
  retryGuidance?: string;
}): string {
  const { base, focus, documentJson, contextSection = "", retryGuidance = "" } = args;
  return [
    focusPromptSection(focus),
    "",
    contextSection,
    contextSection ? "" : null,
    base,
    "The student's own document is below. It is REFERENCE for the passage above, not a syllabus to cover:",
    documentJson,
    "",
    "Because the student asked about one specific thing, the lessonPlan/suggestedLecturePlan beat order and targetBeatCount DO NOT APPLY. Ignore them. Build the beats this explanation needs and no others.",
    "Six to ten beats, all of them about the passage above: state it exactly, then take it apart term by term, then show it working on a concrete example, then name what it is for and where it breaks down.",
    "Use only facts from the document. Every symbol, subscript, index and operator in the passage must appear in the lecture exactly as written — reproducing it wrongly is worse than omitting it.",
    "Where a term in the passage is defined elsewhere in the document, bring that definition in; do not survey the rest of the document beyond that.",
    "Use a provided asset only when it is the passage itself or the figure it refers to, via its assetId. Otherwise build whiteboard SVG diagram beats from the passage's own content.",
    /*
     * Depth, stated explicitly.
     *
     * The first focused lecture was rejected by the depth guard at 83 words per beat. Narrowing the
     * subject is not permission to say less about it — a focused question deserves MORE detail per
     * beat, not less, and the whole-document contract states this length while the focused one did
     * not. Matches the >=100-word average that guard enforces.
     */
    "Every teaching beat's script must be AT LEAST 130 spoken words, and 140-170 is better. Narrowing the subject means going deeper into it, not saying less: explain each symbol, each value and each relationship in full sentences, as a teacher speaking aloud. A beat under 130 words will be rejected.",
    `Build the complete focused lecture now.${retryGuidance}`,
  ].join("\n");
}
