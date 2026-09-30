/**
 * STRICTLY FROM THE SOURCE, ENFORCED — the deterministic half of a strict lesson's script.
 *
 * "Strictly from the source means strictly from the source, not from outside." Before this module,
 * strict mode was one paragraph in the script prompt, and every other part of the prompt pushed the
 * other way: a 260-360 word budget against a 75-word section, a "mechanism" rung demanding causal
 * steps, a repetition gate that asked for "NEW information", the learner's interests and an
 * adaptation note asking for "a concrete example". The model obeyed the majority. The reported
 * "Energy transfer" board was the result: a leaf, a cell and a glucose ring the page never showed,
 * narrated with sentences the page never said.
 *
 * The prompt now says one thing (lib/sourceScope.ts, lib/lessonLadder.ts "source" rung), and this
 * module CHECKS that it was done, with no model call:
 *
 *   - what one beat's source IS (its own blocks, their printed figure labels, the caption under the
 *     figure) — the same record the board generator is given, so script and board answer to one
 *     source (BeatSourceGrounding, lib/sourceGrounding.ts);
 *   - which sentences of a generated script bring in material the source lacks, and deleting them;
 *   - which "repeated" sentences are the source's own words, which the repetition gate must never
 *     delete (a "(part 2)" board or a Questions board legitimately re-reads the page);
 *   - which adaptation notes ask for outside content, which strict lessons drop;
 *   - that an uploaded source never gets a model-written quiz beat.
 *
 * Pure: no server imports, so the worker (server-only) and node:test share it. The measure itself —
 * content stems, formula spellings, teaching glue — lives in lib/sourceGrounding.ts and is shared
 * with the board's label check and the eval, so "grounded" means the same thing everywhere.
 */

import { pointsFromScript } from "./boardBrief";
import { scopedBlockText } from "./beatSourceScope";
import type { RepetitionFinding } from "./lessonRepetition";
import {
  contentStems,
  figureLabelsFromBlocks,
  labelIsGrounded,
  sourceVocabulary,
  splitSentences,
  STRICT_MISSING_LIMIT,
  sentenceIsGrounded,
  ungroundedTerms,
  type BeatSourceGrounding,
} from "./sourceGrounding";
import type { SuprnotesContentBlock } from "./suprnotes";

type SourceBlock = Pick<SuprnotesContentBlock, "id" | "text" | "heading" | "pageNumber" | "role" | "sourceOrder" | "bbox" | "type" | "items"> & { assetIds?: string[] };

/** A figure cropped from the page (parse-pdf's pdf-figure asset): only its caption is read here. */
type SourceFigureAsset = { id: string; caption?: string };

type NormalizedRect = { x: number; y: number; width: number; height: number };

/**
 * A text layer's typographic ligatures, undone.
 *
 * pdf text layers emit "ﬃ" as one code point and often put a space after it: the Cambridge page's
 * "diﬃ cult" and "diff erent". The model writes "difficult", so a grounding check against the raw
 * text calls a faithful sentence ungrounded, and the board's SOURCE block reads as misspelt. NFKD
 * turns the ligature into its letters; the split is then rejoined exactly as the plan's title
 * cleaner does (lib/pdfLessonPipeline.ts joinLigatureSplits), keeping real words like "if" and "off".
 */
export function cleanSourceText(text: string): string {
  const expanded = String(text ?? "").replace(/[ﬀ-ﬆ]/g, (ligature) => ligature.normalize("NFKD"));
  const standalone = /^(?:off|staff|stuff|cliff|bluff|puff|cuff|scoff|sniff|stiff|gruff|tariff|sheriff|if|hi-fi|sci-fi|wifi)$/i;
  return expanded.replace(/\b([A-Za-z-]*?(?:ff|fi|fl))\s(?=[a-z])/g, (match, word: string) => (standalone.test(word) ? match : word));
}

function clean(value: unknown): string {
  return typeof value === "string" ? cleanSourceText(value).replace(/\s+/g, " ").trim() : "";
}

/** The beat's own blocks, in the document's reading order. */
/**
 * NARRATION THAT POINTS AT THE DOCUMENT INSTEAD OF TEACHING IT.
 *
 * A strict lecture shows the passage being taught boxed on the student's PDF, so the teacher saying
 * "This section discusses…", "Next, the source turns to I." or "As shown on page 3, …" is noise —
 * and the second one read out a bare heading. The prompt forbids it; this is the guarantee. A
 * pointer phrase is cut from its sentence and the sentence kept when real content remains ("This
 * section discusses related work on imbalance." → "Related work on imbalance."); a sentence that was
 * only a pointer ("Next, the source turns to I.") is dropped.
 */
const POINTER_OPENERS: RegExp[] = [
  /^(?:next|now|then)[,:]?\s+(?:the\s+)?(?:source|paper|document|text|pdf|author|authors|notes)\s+(?:turns|moves|goes|shifts)\s+(?:on\s+)?to\s+/i,
  /^(?:in\s+)?(?:this|the\s+next|the\s+following|the\s+previous|that)\s+(?:section|part|page|paragraph|passage|slide|board)(?:\s+of\s+the\s+(?:paper|document|source|text|pdf))?,?\s+(?:we\s+)?(?:looks\s+at|focuses\s+on|deals\s+with|turns\s+to|is\s+about|talks\s+about|goes\s+over|look\s+at|see|[a-z]+s)\s+/i,
  // ("…[a-z]+s" is any present-tense verb: the model found "compares" and "highlights" once the
  // listed ones were ruled out, so the subject — "this section/board/part/page" — is what's matched.)
  /^(?:in|within|on)\s+this\s+(?:section|part|page|paragraph|passage|slide|board),?\s+/i,
  /^(?:the|this|your)\s+(?:source|paper|document|text|pdf|author|authors)\s+(?:says|states|notes|explains|describes|shows|mentions|argues|points\s+out|tells\s+us)(?:\s+that)?,?\s+/i,
  /^(?:as\s+(?:shown|stated|described|noted|mentioned)\s+)?(?:on|in)\s+page\s+\d+,?\s+/i,
  /^(?:according\s+to\s+the\s+(?:source|paper|document|text|pdf)),?\s+/i,
];
const POINTER_INLINE = /,?\s*(?:as\s+(?:shown|stated|described|noted)\s+)?(?:on|in)\s+page\s+\d+(?:\s+of\s+the\s+(?:paper|document|source|pdf))?/gi;

export function withoutSourcePointers(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence;
    for (const opener of POINTER_OPENERS) rest = rest.replace(opener, "");
    rest = rest.replace(POINTER_INLINE, "").trim();
    if (rest === sentence) {
      kept.push(sentence);
      continue;
    }
    // What is left must still say something: three words, not a bare heading like "I." or "E.".
    if ((rest.match(/[A-Za-z]{2,}/g) ?? []).length < 3) continue;
    kept.push(rest.charAt(0).toUpperCase() + rest.slice(1));
  }
  return kept.join(" ");
}

export function beatSourceBlocks<T extends SourceBlock>(blocks: T[], sourceBlockIds?: string[]): T[] {
  if (!sourceBlockIds?.length) return [];
  const wanted = new Set(sourceBlockIds);
  return blocks
    .filter((block) => wanted.has(block.id))
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (a.block.sourceOrder ?? a.index) - (b.block.sourceOrder ?? b.index) || a.index - b.index)
    .map(({ block }) => block);
}

/** A labels block that names a real figure: two or more labels with letters in them, not "3". */
function figureLabelsBlock<T extends SourceBlock>(own: T[]): T | undefined {
  return own.find((block) => block.role === "figure-labels" && figureLabelsFromBlocks([block]).filter((label) => /[A-Za-z]{2,}/.test(label)).length >= 2);
}

/**
 * THE SOURCE ONE BEAT IS ALLOWED TO USE — for its script, and handed unchanged to its board.
 *
 * `text` is the beat's own blocks (scopedBlockText), never the document; `labels` are the figure's
 * labels as PRINTED in the text layer ("Diagram labels:" block), never the vision model's region
 * names; `caption` is the short paragraph printed right after the labels ("Photosynthesis happens
 * inside the chloroplasts in a palisade cell like this one."), which is what the figure is OF.
 *
 * Null when the beat has no source of its own (a typed-topic lecture, or a beat planned without
 * blocks): the caller then passes nothing rather than an empty source that would forbid everything.
 */
export function beatSourceGrounding(
  blocks: SourceBlock[],
  sourceBlockIds: string[] | undefined,
  strict: boolean,
  assets: SourceFigureAsset[] = [],
): BeatSourceGrounding | null {
  const own = beatSourceBlocks(blocks, sourceBlockIds);
  if (own.length === 0) return null;
  const text = cleanSourceText(scopedBlockText(own, own.map((block) => block.id)));
  const labels = figureLabelsFromBlocks(own).map(cleanSourceText);
  if (!text.trim() && labels.length === 0) return null;
  const at = own.findIndex((block) => block.role === "figure-labels");
  const after = at >= 0 ? own[at + 1] : undefined;
  const captionText = after && (after.role === undefined || after.role === "paragraph") ? clean(after.text) : "";
  const caption = captionText && captionText.length <= 200 ? captionText : figureAssetCaption(own, assets, text);
  return { text, labels, ...(caption ? { caption } : {}), strict };
}

/**
 * A scanned page has no text layer, so no "Diagram labels:" block — and a strict board told "the
 * source prints no figure" drew a title and nothing else over a page that is mostly trees. The
 * figures ARE known: parse-pdf crops them as assets linked to the beat's blocks. Their caption is
 * vision text, so it is used only when every content word of it is already in the beat's own OCR'd
 * text — it then says "there is a figure, and this is what it is of" without adding a word.
 */
function figureAssetCaption(own: SourceBlock[], assets: SourceFigureAsset[], text: string): string | undefined {
  if (!assets.length || !text.trim()) return undefined;
  const linked = new Set(own.flatMap((block) => block.assetIds ?? []));
  const vocab = sourceVocabulary(text);
  for (const asset of assets) {
    if (!linked.has(asset.id)) continue;
    const caption = clean(asset.caption);
    if (caption && caption.length <= 200 && labelIsGrounded(caption, vocab)) return caption;
  }
  return undefined;
}

/**
 * Where the beat's figure sits on its page, for cropping the page image down to it.
 *
 * The labels block's box IS the figure's box to a good approximation — labels are printed around
 * the drawing they name — and it is the only region the text layer vouches for. A block with a
 * single stray label ("3", a numbered step picked up as a label) is not a figure.
 */
export function sourceFigureRegion(blocks: SourceBlock[], sourceBlockIds?: string[]): { pageNumber: number; bbox: NormalizedRect } | null {
  const block = figureLabelsBlock(beatSourceBlocks(blocks, sourceBlockIds));
  if (!block?.bbox || typeof block.pageNumber !== "number") return null;
  const { x, y, width, height } = block.bbox;
  if (![x, y, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) return null;
  // A box this small cannot hold a labelled drawing worth showing (under ~1% of the page).
  if (width * height < 0.01) return null;
  return { pageNumber: block.pageNumber, bbox: { x, y, width, height } };
}

/**
 * The pixel rectangle to crop: the figure's normalised box grown by `margin` of its own size on
 * every side (labels sit at the drawing's edge, so the drawing's outer strokes lie just beyond the
 * label box), clamped to the page.
 */
export function expandedCropRect(bbox: NormalizedRect, pageWidthPx: number, pageHeightPx: number, margin = 0.08): { x: number; y: number; width: number; height: number } {
  const left = Math.max(0, bbox.x - bbox.width * margin);
  const top = Math.max(0, bbox.y - bbox.height * margin);
  const right = Math.min(1, bbox.x + bbox.width * (1 + margin));
  const bottom = Math.min(1, bbox.y + bbox.height * (1 + margin));
  const x = Math.floor(left * pageWidthPx);
  const y = Math.floor(top * pageHeightPx);
  return {
    x,
    y,
    width: Math.max(1, Math.min(pageWidthPx - x, Math.ceil((right - left) * pageWidthPx))),
    height: Math.max(1, Math.min(pageHeightPx - y, Math.ceil((bottom - top) * pageHeightPx))),
  };
}

/** How many words the beat's own source says — block bodies only; headings and page labels are provenance. */
export function sourceWordCount(blocks: SourceBlock[], sourceBlockIds?: string[]): number {
  return beatSourceBlocks(blocks, sourceBlockIds)
    .map((block) => clean(block.text).replace(/^Diagram labels:\s*/i, ""))
    .join(" ")
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

/**
 * The beat's source, as something that can be SPOKEN — the strict lesson's floor.
 *
 * Used when the model failed outright, or when the grounding gate deleted every sentence it wrote:
 * in strict mode the one script that is certainly faithful is the source itself. Page labels and
 * repeated headings are dropped (the title card already names the section), and a figure's labels
 * are read as what they are.
 */
export function sourceScriptFromBlocks(blocks: SourceBlock[], sourceBlockIds?: string[]): string {
  const sentences = beatSourceBlocks(blocks, sourceBlockIds).map((block) => {
    const body = clean([block.text, ...(block.items ?? [])].filter(Boolean).join(" "));
    if (!body) return "";
    if (block.role === "figure-labels") {
      const labels = figureLabelsFromBlocks([{ text: body, role: "figure-labels" }]);
      return labels.length ? `The diagram is labelled: ${labels.join(", ")}.` : "";
    }
    return /[.!?:]$/.test(body) ? body : `${body}.`;
  });
  return sentences.filter(Boolean).join(" ");
}

/**
 * For a board built from the source's own "Questions" box: the earlier sections on the same page(s),
 * which is where the source's answers live. The script names the part that answers each question,
 * so it has to be allowed to see — and quote — those parts; it still may not answer beyond them.
 */
export function questionAnswerBlockIds(
  plan: Array<{ sequence: number; sourceBlockIds?: string[] }>,
  sequence: number,
  blocks: SourceBlock[],
): string[] {
  const pageOf = new Map(blocks.map((block) => [block.id, block.pageNumber]));
  const current = plan.find((beat) => beat.sequence === sequence);
  const pages = new Set((current?.sourceBlockIds ?? []).map((id) => pageOf.get(id)).filter((page): page is number => typeof page === "number"));
  if (pages.size === 0) return [];
  return plan
    .filter((beat) => beat.sequence < sequence)
    .flatMap((beat) => beat.sourceBlockIds ?? [])
    .filter((id) => pages.has(pageOf.get(id) as number));
}

/** The source's sentences, split generously so each printed question counts as its own sentence. */
function sourceSentences(sourceText: string): string[] {
  return cleanSourceText(sourceText)
    .replace(/\[page \d+\]/gi, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?:])\s+/))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Is this script sentence the source's own sentence, lightly reworded?
 *
 * Measured against ONE source sentence at a time, so a script cannot pass by scattering source words
 * across an invented claim: either it overlaps a single source sentence strongly both ways (Dice
 * over content stems ≥ 0.7), or nearly every content word it has (≥ 85%, at least three) comes
 * from that one sentence — which is what reading a printed question aloud looks like.
 */
export function isNearVerbatimSource(sentence: string, sourceText: string): boolean {
  const mine = new Set(contentStems(sentence));
  if (mine.size === 0) return false;
  for (const candidate of sourceSentences(sourceText)) {
    const theirs = new Set(contentStems(candidate));
    if (theirs.size === 0) continue;
    let shared = 0;
    for (const word of mine) if (theirs.has(word)) shared += 1;
    if ((2 * shared) / (mine.size + theirs.size) >= 0.7) return true;
    if (mine.size >= 3 && shared / mine.size >= 0.85) return true;
  }
  return false;
}

/**
 * The repetition findings a STRICT beat may act on.
 *
 * Two kinds are set aside. A sentence that is the beat's own source, near-verbatim, is never
 * "repetition" — the source is authoritative, and a Questions board or a "(part 2)" board re-reads
 * it by design; deleting it would drop required source content. And a whole-board overlap is not
 * actionable here: its only remedy is "rewrite with a different structure", which in a strict lesson
 * can only be met by inventing material. Sentence-level repeats of OTHER sections stay flagged, so
 * scope bleed (the Energy-transfer board re-teaching the Photosynthesis paragraph) is still caught.
 */
export function strictRepetitionFindings(findings: RepetitionFinding[], ownSourceText: string): RepetitionFinding[] {
  return findings.filter((finding) => finding.kind !== "beat-overlap" && !isNearVerbatimSource(finding.sentence, ownSourceText));
}

const DANGLING_CONNECTIVE = /^(?:for (?:instance|example),?\s+|next,?\s+|then,?\s+|finally,?\s+|thus,?\s+|therefore,?\s+|consequently,?\s+|as a result,?\s+|additionally,?\s+|moreover,?\s+|furthermore,?\s+|also,?\s+|similarly,?\s+|in other words,?\s+|so,?\s+|hence,?\s+|likewise,?\s+|in addition,?\s+)/i;

/**
 * The script without `remove`, re-joined. A sentence that followed a removed one loses a leading
 * connective ("So…", "For example…"), which would otherwise hang off nothing.
 */
export function removeSentences(script: string, remove: Iterable<string>): { script: string; removed: string[] } {
  const offending = new Set(remove);
  if (offending.size === 0) return { script, removed: [] };
  const sentences = splitSentences(script);
  const removed: string[] = [];
  const kept: string[] = [];
  let previousRemoved = false;
  for (const sentence of sentences) {
    if (offending.has(sentence)) {
      removed.push(sentence);
      previousRemoved = true;
      continue;
    }
    kept.push(previousRemoved ? sentence.replace(DANGLING_CONNECTIVE, "").replace(/^[a-z]/, (c) => c.toUpperCase()) : sentence);
    previousRemoved = false;
  }
  return { script: kept.join(" "), removed };
}

/**
 * Negative contractions, spelled out for MEASURING only (the script itself is never rewritten).
 *
 * The shared tokenizer keeps "doesn't" as the non-word "doesn", which no source contains, so every
 * spoken negation counted as one outside word: "That energy doesn't disappear" was one paraphrase
 * away from deletion. Spelled out, "does not" is two stopwords.
 */
export function expandContractions(text: string): string {
  return text
    .replace(/\bcan['’]t\b/gi, "can not")
    .replace(/\bwon['’]t\b/gi, "will not")
    .replace(/\bshan['’]t\b/gi, "shall not")
    .replace(/\b([a-z]+)n['’]t\b/gi, "$1 not");
}

/**
 * The script's sentences that bring in material the source lacks (two or more content words the
 * source never uses), minus any that are the source's own sentence reworded.
 */
export function ungroundedScriptSentences(script: string, source: BeatSourceGrounding): Array<{ sentence: string; missing: string[] }> {
  const vocab = sourceVocabulary(source);
  // By CONTENT (sentenceIsGrounded): everyday explaining words are allowed, new facts are not.
  return splitSentences(script)
    .map((sentence) => ({ sentence, missing: ungroundedTerms(expandContractions(sentence), vocab) }))
    .filter((entry) => !sentenceIsGrounded(expandContractions(entry.sentence), vocab) && !isNearVerbatimSource(entry.sentence, source.text));
}

/** The fields of a beat the student hears or reads, which a strict lesson must keep inside the source. */
export type GroundableBeat = {
  script: string;
  transitionIn?: string;
  points: string[];
  keyClaims?: string[];
  definitionTerm?: string;
  definitionMeaning?: string;
  slideKind?: string;
  checkpoint?: unknown;
};

/**
 * Deletes, never rewrites: every field of a beat reduced to what the source supports.
 *
 *   script          sentences with ≥2 non-source content words are removed; if nothing survives,
 *                   the script becomes the source's own text (`sourceScript`).
 *   transitionIn    spoken over the title card — replaced by the deterministic bridge if it asserts
 *                   anything the source does not (`fallbackTransition`; undefined on a continuation).
 *   keyClaims       every later board is shown these as ESTABLISHED, so one leaked claim becomes a
 *                   premise for the rest of the lecture. Zero tolerance: any non-source content word
 *                   drops the claim; with none left, the first grounded script sentences stand in.
 *   points          board text: zero tolerance; with none left, the opening of the grounded script.
 *   definition      the term must be a source term and its meaning a source statement, or both go.
 *   checkpoint      an uploaded source never carries a model-written quiz (its own Questions boards
 *                   do that), so any checkpoint is removed and the slide becomes a teaching slide.
 */
export function groundBeatToSource<T extends GroundableBeat>(
  beat: T,
  source: BeatSourceGrounding,
  options: { sourceScript: string; fallbackTransition?: string },
): { beat: T; removed: string[] } {
  const vocab = sourceVocabulary(source);
  const flagged = ungroundedScriptSentences(beat.script, source).map((entry) => entry.sentence);
  const pruned = removeSentences(beat.script, flagged);
  const script = pruned.script.trim() || options.sourceScript.trim() || beat.script;
  // A defined TERM must be the source's own word exactly; everything else is judged by content.
  const grounded = (text: string, exact = false) =>
    exact ? ungroundedTerms(expandContractions(text), vocab).length < STRICT_MISSING_LIMIT : sentenceIsGrounded(expandContractions(text), vocab);
  const firstSentences = splitSentences(script).slice(0, 2);
  const keyClaims = (beat.keyClaims ?? []).filter((claim) => grounded(claim));
  const points = beat.points.filter((point) => grounded(point));
  const definitionKept = Boolean(beat.definitionTerm && beat.definitionMeaning && grounded(beat.definitionTerm, true) && grounded(beat.definitionMeaning));
  const next: T = {
    ...beat,
    script,
    transitionIn: beat.transitionIn && !grounded(beat.transitionIn) ? options.fallbackTransition : beat.transitionIn,
    keyClaims: keyClaims.length ? keyClaims : firstSentences,
    points: points.length ? points : pointsFromScript(script),
    definitionTerm: definitionKept ? beat.definitionTerm : undefined,
    definitionMeaning: definitionKept ? beat.definitionMeaning : undefined,
  };
  const fields = next as GroundableBeat;
  if (fields.checkpoint !== undefined || fields.slideKind === "checkpoint") {
    fields.checkpoint = undefined;
    if (fields.slideKind === "checkpoint") fields.slideKind = "intro";
  }
  return { beat: next, removed: pruned.removed };
}

/**
 * The adaptation notes a strict lesson may act on: pacing, never content.
 *
 * "More worked and concrete examples", "add remediation and a concrete example" (sent automatically
 * on a wrong checkpoint answer), "deeper technical detail" and "adapt to what they asked" all ask the
 * next script for material the source does not contain. Simpler wording and smaller steps change
 * HOW the source is said, not WHAT — those stay.
 */
export function strictAdaptationNotes(notes: string[] | undefined): string[] {
  return (notes ?? []).filter((note) =>
    /\b(?:simpler language|smaller (?:conceptual )?steps|more slowly|slow(?:er)? (?:down|pace)|avoid unnecessary repetition)\b/i.test(note) &&
    !/\b(?:example|remediation|deeper|interests?|asked:)\b/i.test(note),
  );
}

/**
 * Is this beat a model-written checkpoint (quiz) beat?
 *
 * Never for an uploaded source. It carries its own questions — its "Questions" boxes become
 * their own beats, read as printed — and turning its third section into a model-written quiz replaced
 * source content with questions the source never asked (and, when the model left the hint out,
 * showed the student the pipeline's own instruction as the answer).
 *
 * And no longer for a typed topic either. Understanding is decided by the student's own "Got it"
 * button, never by a quiz slide: every third board being a model-written question made a short
 * answer longer and turned "Why does overfitting happen?" into a test. The signature stays so a
 * future opt-in can switch them back on per lesson.
 */
export function isCheckpointBeat(sequence: number, planLength: number, sourceType: string): boolean {
  void sequence;
  void planLength;
  void sourceType;
  return false;
}

/**
 * Does this beat need a generated board? A checkpoint slide never shows one — the player renders
 * the question slide in its place (LessonPlayer: `isCheckpoint ? <SlideStage/> : <BoardStage/>`) —
 * so generating one spent 20-55 s and an animation's cost on something no student saw, and held the
 * dispatch window back while it ran.
 */
export function beatNeedsBoard(beat: { slideKind?: string }): boolean {
  return beat.slideKind !== "checkpoint";
}
