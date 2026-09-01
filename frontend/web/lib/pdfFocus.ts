import type { SuprnotesContentBlock, SuprnotesLessonInput } from "./suprnotes";
import type { PlanOutline } from "./planPrompt";
import { LECTURE_SHAPES, shapeInstructions } from "./fullDocumentContext";

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
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "confused", "could", "do", "does", "explain", "for",
  "from", "give", "how", "i", "in", "is", "it", "its", "me", "of", "on", "or", "page", "pages",
  "please", "shown", "slide", "slides", "that", "the", "their", "there", "these", "they", "this",
  "to", "understand", "was", "what", "when", "where", "which", "why", "with", "work", "working", "you", "your",
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
      .filter((t) => (t.length > 2 || /^\d+$/.test(t)) && !STOPWORDS.has(t)),
  )];
}

const SOURCE_OBJECT = /\b(example|worked\s+example|case|exercise|problem|equation|formula|proof|derivation|algorithm|figure|diagram|chart|table|code|snippet)\b/i;
const SINGLE_SOURCE_OBJECT = /\b(?:this|that|particular|specific|selected|highlighted|following|above|below)\b[^.!?]{0,50}\b(?:example|case|exercise|problem|equation|formula|proof|derivation|algorithm|figure|diagram|chart|table|code|snippet)\b/i;

type TranscriptSegment = {
  pageNumber?: number;
  sourceIndex: number;
  text: string;
};

/** Split a page-labelled OCR transcript into paragraphs while retaining the source block id that
 * `blocksFromTranscript` assigns to that page. */
function transcriptSegments(transcript: string): TranscriptSegment[] {
  const source = (transcript ?? "").trim();
  if (!source) return [];
  const marker = /^---\s*page\s+(\d+)(?:[^-]*)---\s*$/gim;
  const matches = [...source.matchAll(marker)];
  const parts = matches.length > 0
    ? matches.map((match, index) => ({
        pageNumber: Number(match[1]),
        sourceIndex: index,
        body: source.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? source.length).trim(),
      }))
    : [{ pageNumber: undefined, sourceIndex: 0, body: source }];

  return parts.flatMap((part) => {
    let paragraphs = part.body.split(/\n\s*\n+/).map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
    // Some OCR responses use only soft line breaks. Build sentence-sized paragraphs rather than
    // treating a whole page, including the next section, as the student's requested passage.
    if (paragraphs.length <= 1 && part.body.length > 900) {
      const sentences = part.body.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
      paragraphs = [];
      for (let index = 0; index < sentences.length; index += 3) {
        paragraphs.push(sentences.slice(index, index + 3).join(" ").trim());
      }
    }
    return paragraphs.map((text) => ({ pageNumber: part.pageNumber, sourceIndex: part.sourceIndex, text }));
  });
}

function transcriptScore(text: string, question: string, questionTerms: string[], want: Wanted): number {
  const hay = text.toLowerCase();
  let score = 0;
  for (const term of questionTerms) {
    const root = stem(term);
    if (hay.includes(root)) score += 2;
  }
  // Deletion questions are often worded with "delete" while the book says "remove", or vice
  // versa. This is a relationship, not broad semantic guessing, and keeps the algorithm local.
  if (questionTerms.some((term) => /^(?:delet|remov)/.test(stem(term))) && /\b(?:delet|remov)\w*/.test(hay)) score += 4;
  const numberedNode = question.toLowerCase().match(/\b(\d+)\s+(?:child\s+)?node\s+(?:delet|remov)\w*/);
  if (numberedNode && new RegExp(`(?:delet\\w*\\s+(?:of\\s+)?node\\s+${numberedNode[1]}|node\\s+${numberedNode[1]}[^.]{0,40}(?:delet|remov))`, "i").test(text)) score += 10;
  if (/\b(?:two|2)[-\s]+child(?:ren)?\b/i.test(question) && /\btwo\s+children\b/i.test(text)) score += 8;
  if (want === "figure" && /\b(?:fig(?:ure)?|diagram|graph|chart)\b/.test(hay)) score += 3;
  if (want === "formula" && (MATH_CHARS.test(text) || MATH_SHAPE.test(text))) score += 3;
  if (want === "table" && /\|[^\n]+\||\btable\b/.test(hay)) score += 3;
  return score;
}

/**
 * Find the OCR paragraphs that answer a specific typed question.
 *
 * Selecting two pages is not the same as asking about everything on those pages. Previously the
 * entire 12k-character transcript became one focus passage, so a question about two-child deletion
 * also taught one-child deletion and the following C++ implementation section. The top matching
 * paragraph and its preceding caption carry the exact answer without opening that scope back up.
 */
function focusedTranscriptSegments(question: string, transcript: string): TranscriptSegment[] {
  const segments = transcriptSegments(transcript);
  if (segments.length <= 1 || isPointingPhrase(question)) return segments;
  const questionTerms = terms(question);
  if (questionTerms.length === 0) return segments;
  const want = wantedKind(question);
  const ranked = segments
    .map((segment, index) => ({ segment, index, score: transcriptScore(segment.text, question, questionTerms, want) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0];
  if (!best || best.score < FOCUS_RULES.MIN_SCORE) return segments;
  const singleObject = SINGLE_SOURCE_OBJECT.test(question);

  const chosen = new Set<number>([best.index]);
  // Captions/figure titles immediately precede the explanatory paragraph and often contain the
  // exact operation name. Do not include an arbitrary preceding paragraph: for a worked-example
  // request that pulled an unrelated definition into an otherwise exact answer.
  const previous = segments[best.index - 1];
  const previousLooksLikeCaption = previous
    && previous.text.length <= 280
    && /^(?:fig(?:ure)?|table|worked\s+example|example|diagram|chart|equation|formula)\b/i.test(previous.text);
  const previousScore = previous ? transcriptScore(previous.text, question, questionTerms, want) : 0;
  if (
    previous?.pageNumber === best.segment.pageNumber
    && (previousLooksLikeCaption || previousScore >= Math.max(FOCUS_RULES.MIN_SCORE, best.score * 0.6))
  ) {
    chosen.add(best.index - 1);
  }
  const next = segments[best.index + 1];
  if (
    !singleObject
    &&
    next?.pageNumber === best.segment.pageNumber
    && transcriptScore(next.text, question, questionTerms, want) >= FOCUS_RULES.MIN_SCORE
  ) {
    chosen.add(best.index + 1);
  }
  if (!singleObject) {
    for (const candidate of ranked.slice(1)) {
      if (chosen.size >= FOCUS_RULES.MAX_PASSAGES) break;
      if (candidate.segment.pageNumber !== best.segment.pageNumber) continue;
      if (candidate.score < Math.max(FOCUS_RULES.MIN_SCORE, best.score * 0.6)) continue;
      chosen.add(candidate.index);
    }
  }
  return [...chosen].sort((a, b) => a - b).map((index) => segments[index]);
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
  const pointing = isPointingPhrase(question);
  const parsed = transcriptSegments(text);
  // A pointing phrase refers to the whole crop/page the student selected. Preserve the original
  // line structure (titles, table rows, formula lines) and the larger OCR budget in this branch.
  const selected = pointing
    ? [{
        pageNumber: parsed[0]?.pageNumber ?? pages[0],
        sourceIndex: parsed[0]?.sourceIndex ?? 0,
        text,
      }]
    : focusedTranscriptSegments(question, text);
  const selectedPages = [...new Set([
    ...pages,
    ...selected.map((segment) => segment.pageNumber).filter((page): page is number => typeof page === "number"),
  ])].sort((a, b) => a - b);
  return {
    question: (question ?? "").trim() || "Explain what is shown here.",
    pages: selectedPages,
    missingPages: [],
    passages: selected.slice(0, FOCUS_RULES.OCR_PASSAGE_BUDGET).map((segment, index) => ({
      blockId: typeof segment.pageNumber === "number" ? `ocr-p${segment.pageNumber}-${segment.sourceIndex}` : "ocr-transcript",
      pageNumber: segment.pageNumber ?? pages[0],
      heading: "Read from the page",
      text: segment.text.slice(0, pointing
        ? FOCUS_RULES.MAX_PASSAGE_CHARS * FOCUS_RULES.OCR_PASSAGE_BUDGET
        : FOCUS_RULES.MAX_PASSAGE_CHARS),
      score: Number.MAX_SAFE_INTEGER - index,
    })),
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
  const chosen = usablePages.length > 0 && !SOURCE_OBJECT.test(q)
    ? ranked
    : ranked.filter((r) => r.score >= FOCUS_RULES.MIN_SCORE);

  if (chosen.length === 0) return null;

  return {
    question: q,
    pages: usablePages,
    missingPages,
    passages: chosen.slice(0, SINGLE_SOURCE_OBJECT.test(q) ? 1 : FOCUS_RULES.MAX_PASSAGES).map(({ block, score }) => ({
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
    "- Answer only the student's exact question. Stop when it is answered; do not append nearby sections, background surveys, implementation details, or alternative methods.",
    "- Every factual statement must be supported by the quoted passage or the explicitly retrieved supporting context. If the upload does not say it, omit it.",
    "- Reproduce the passage EXACTLY — every symbol, subscript and term. Never paraphrase a formula.",
    "- Open on it, then unpack it: what each symbol means, why it is that shape, what it computes.",
    "- Use the rest of the document only where it explains a term used here.",
    focus.missingPages.length
      ? `- The student also mentioned page ${focus.missingPages.join(", ")}, which is not in what they uploaded. Say so plainly in the opening rather than inventing its contents.`
      : "",
  ].filter(Boolean).join("\n");
}

/** Raw document labels identify where content appeared, not what a student will learn. */
export function isWeakSlideTitle(title: string): boolean {
  const cleanTitle = (title ?? "").replace(/\s+/g, " ").trim();
  return !cleanTitle
    || /^(?:fig(?:ure)?|table|chart|diagram|page|slide)\s*[#.]?\s*[\divxlcdm.-]+[:.]?$/i.test(cleanTitle)
    || !/[A-Za-z]{3,}/.test(cleanTitle);
}

/** A deterministic concept title for the focused lecture, used only when the model returns a raw
 * source label such as "Figure 19.4". Prefer the source's own caption wording over inventing one. */
export function focusedLectureTitle(focus: PdfFocus | null): string {
  if (!focus) return "Focused explanation";
  const source = focus.passages.map((passage) => passage.text).join("\n");
  const caption = source.match(/\b(?:fig(?:ure)?|table|chart|diagram)\s*[#.]?\s*[\divxlcdm.-]+\s*[:.-]?\s*([^\n.]{8,120})/i)?.[1]
    ?.replace(/\s*\([a-z]\)\s*(?:before|after)[\s\S]*$/i, "")
    .replace(/\s*[:;]\s*$/, "")
    .trim();
  if (caption && /[A-Za-z]{3,}/.test(caption)) {
    return caption.charAt(0).toUpperCase() + caption.slice(1);
  }

  const cleanedQuestion = focus.question
    .replace(/^\s*(?:i\s+(?:am|'m)\s+(?:confused|unsure)(?:\s+about)?|please|can\s+you|could\s+you)\s*[,.:;-]?\s*/i, "")
    .replace(/^\s*(?:explain|tell\s+me|how\s+does|how\s+do|what\s+is)\s+/i, "")
    .replace(/\?+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const candidate = cleanedQuestion || focus.passages[0]?.heading || "Focused explanation";
  const clipped = candidate.length <= 72 ? candidate : `${candidate.slice(0, 69).trim()}...`;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
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
  /** The approved plan for this exact question. It structures the answer, never broadens it. */
  outline?: PlanOutline;
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
  const { base, focus, documentJson, outline, contextSection = "", retryGuidance = "" } = args;
  const focusedPlan = outline?.subtopics.length
    ? [
        "QUESTION-SPECIFIC APPROVED PLAN:",
        ...outline.subtopics.map((subtopic, index) => `${index + 1}. ${subtopic.title} — ${subtopic.caption}`),
        "Follow these steps in order. Every step must answer the exact question above; do not add any topic outside this plan.",
        "This focused plan overrides ordinary 10-12 beat, intro, recap, checkpoint, and whole-document outline rules.",
      ].join("\n")
    : "";
  return [
    focusPromptSection(focus),
    "",
    focusedPlan,
    focusedPlan ? "" : null,
    contextSection,
    contextSection ? "" : null,
    base,
    "The permitted source excerpt is below. It is evidence for the answer above, not a syllabus to cover:",
    documentJson,
    "",
    ...shapeInstructions(LECTURE_SHAPES.conciseAnswer),
    "Use ONLY facts in the quoted focus passage and explicitly retrieved supporting context. The rest of the subject and your own background knowledge are out of scope. If the permitted source does not support a detail, omit it rather than filling the gap.",
    "Every beat title must name the precise concept or step being taught. Never use a raw source locator such as 'Figure 19.4', 'Page 2', 'Slide 3', or 'Overview' as a title.",
    "Every symbol, subscript, index and operator in the passage must appear in the lecture exactly as written — reproducing it wrongly is worse than omitting it.",
    "Where retrieved context defines a term used by the passage, use only that definition; do not teach the retrieved passage as another topic.",
    "Use a provided asset only when it is the passage itself or the figure it refers to, via its assetId. Otherwise build whiteboard SVG diagram beats from the passage's own content.",
    /*
     * The 130-word floor that used to live here is gone, and its removal is the point.
     *
     * It was added because an early focused lecture came back at 83 words per beat and was rejected
     * by the depth guard — so the prompt was made to demand more. That reasoning held while a
     * "focused" answer still meant a four-to-seven beat mini-lecture. It stopped holding once a
     * focused request became a direct ANSWER: someone asking how many professors are in a list is
     * owed a number, not five hundred words leading to one. The length rules now come from
     * `shapeInstructions` above, and the depth guard was taught the same shape so the two cannot
     * disagree again.
     */
    `Answer now.${retryGuidance}`,
  ].join("\n");
}


/**
 * Is this a POINTING phrase rather than a subject?
 *
 * "Explain me this", "what is this", "explain this part" — once a student has drawn a box round
 * something, that is what they type, and it is deixis: it refers to the region, it does not name a
 * topic. Treating it as one produced a lecture literally titled "explain me this", with the build
 * screen announcing "Designing a live lesson on explain me this…", which is exactly what was
 * reported. The phrase is still the question; it is just not the subject.
 */
export function isPointingPhrase(text: string): boolean {
  // Apostrophes are removed, not spaced: "what's" must tokenise as "whats", or the stray "s"
  // survives the filter and the phrase looks like it names something.
  const t = (text ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return true;
  // Strip the words that only point or instruct; whatever is left is the subject, if anything is.
  const rest = t
    .split(" ")
    .filter((w) => !POINTING_WORDS.has(w))
    .join(" ")
    .trim();
  return rest.length === 0;
}

const POINTING_WORDS = new Set([
  "a", "about", "and", "bit", "can", "could", "describe", "detail", "diagram", "explain", "figure",
  "formula", "here", "highlighted", "image", "in", "is", "it", "me", "more", "of", "on", "one",
  "part", "please", "portion", "region", "section", "selected", "shown", "table", "tell", "that",
  "the", "these", "this", "to", "us", "what", "whats", "you",
  /*
   * Fillers and abbreviations, added after "just explain me this eg" slipped through.
   *
   * Every word above was already stripped from that phrase — "explain", "me", "this" — leaving only
   * "just" and "eg", which was enough to make it look like it named a subject. The lecture was then
   * titled "just explain me this eg". A list like this only works if it covers the words people
   * actually pad a request with, not only the ones that do the pointing.
   *
   * "eg" and "ie" appear because the tokeniser strips punctuation, so "e.g." arrives split; the bare
   * forms are what survive when someone types them without dots.
   */
  "just", "eg", "ie", "quickly", "simply", "briefly", "kindly", "pls", "plz", "now", "again",
  "thing", "stuff", "also", "some", "little", "bit", "give",
]);

/**
 * A short subject line taken from what was actually READ.
 *
 * Used as the lecture's topic when the student's words only point. Prefers the first substantial
 * line of the passage — in a transcript that is usually the heading or the formula itself, which is
 * a far better name for the lesson than either the pointing phrase or the file's title.
 */
export function subjectFromFocus(focus: PdfFocus | null): string {
  if (!focus || focus.passages.length === 0) return "";
  return subjectFromTranscript(focus.passages[0].text);
}

/**
 * The same, straight from a transcript.
 *
 * Exported separately because the CLIENT needs it too: the upload screen sets the lecture's topic
 * before any of this reaches the server, and that topic is what the build screen shows. Fixing only
 * the server left "Designing a live lesson on explain me this…" on screen while the lecture
 * underneath was correctly about the region.
 */
export function subjectFromTranscript(transcript: string): string {
  const body = (transcript ?? "")
    .split(/\n+/)
    .filter((line) => !/^\s*(-{2,}|`{3})/.test(line) && !/^\s*(page|slide)\s+\d+/i.test(line))
    // Scaffolding is dropped BEFORE punctuation is trimmed: stripping the leading dashes first
    // turned "--- page 4, selected region ---" into an ordinary line, and it became the title.
    .map((line) => line.replace(/^[-*#>\s]+/, "").trim())
    .filter((line) => line.length > 3);
  /*
   * Prefer a line that reads like a HEADING over one that reads like data.
   *
   * Taking the first line outright titled a lecture "Pregnancies Glucose BloodPressure
   * SkinThickness Insulin BMI DiabetesPedigreeFunction Age Outcome" — the correlation matrix's
   * header row, which is the first thing in that transcript and a terrible name for a lesson. A
   * heading is short, mostly words, and not a row of figures.
   */
  /*
   * Markup is not a subject.
   *
   * A transcribed table begins with its own scaffolding, so this happily returned
   * `egin{array}{l|l|l|}` and the screen announced "Designing a live lesson on
   * egin{array}{l|l|l|}…". A line that is mostly braces, pipes and backslashes is structure, not
   * a name for anything.
   */
  const candidates = body.filter((line) => {
    if (!/[a-z]/i.test(line)) return false;
    if (/^\s*\\(begin|end|hline|documentclass)/i.test(line)) return false;
    // A pipe-delimited row is a row. Its symbol ratio is low enough to pass the test below,
    // and "| Model | Accuracy |" is no better a lecture title than the markup around it.
    if (/^\s*\|.*\|\s*$/.test(line)) return false;
    const symbols = (line.match(/[\\{}|_^&$]/g) ?? []).length;
    return symbols <= line.length * 0.18;
  });
  const score = (line: string): number => {
    const words = line.split(/\s+/).length;
    const digits = (line.match(/\d/g) ?? []).length;
    let n = 0;
    if (line.length >= 8 && line.length <= 70) n += 3;
    if (words <= 8) n += 2;
    if (digits === 0) n += 2;
    else if (digits <= 3) n += 1;
    if (/[:—-]/.test(line)) n += 1;
    return n;
  };
  const first = candidates.slice()
    // Stable: among equally heading-like lines, the earliest wins, which is usually the real title.
    .map((line, i) => ({ line, i, n: score(line) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)[0]?.line ?? "";
  const tidy = first.replace(/[ 	]+/g, " ").trim();
  return tidy.length > 90 ? `${tidy.slice(0, 90).trimEnd()}…` : tidy;
}
