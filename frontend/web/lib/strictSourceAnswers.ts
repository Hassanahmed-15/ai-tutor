import { scopedBlockText, type ScopeBlock } from "./beatSourceScope";
import {
  contentStems,
  figureLabelsFromBlocks,
  sourceVocabulary,
  splitSentences,
  stem,
  sentenceIsGrounded,
  ungroundedTerms,
  type BeatSourceGrounding,
} from "./sourceGrounding";
import type { SourceScope } from "./sourceScope";

/**
 * STRICT SOURCE, EVERYWHERE A STUDENT CAN ASK.
 *
 * "Strictly from the source" used to bind one thing: the lecture script. Every other surface a
 * student can talk to during and after that lecture ignored it —
 *
 *   - the ask box (/api/explain) never received the scope, ran at temperature 0.7 under a prompt
 *     that asks for "a scientifically or technically credible diagram", and drew a fresh board from
 *     general knowledge;
 *   - the pen's "explain this region" (/api/ask-drawing) got the beat's title and script only — not
 *     one word of the document;
 *   - the voice tutor was told "answer from THIS whenever the question is about their material",
 *     which licenses general knowledge for every question that is not;
 *   - the one-slide summary and the post-lesson test were written from the generated scripts, so
 *     "no outside facts" certified whatever a script had already leaked.
 *
 * A student who chose strict and then asked one question got an answer from outside their document,
 * which is exactly the promise the mode makes and exactly the complaint that was reported.
 *
 * THIS MODULE IS WHAT THEY SHARE: building the beat's source on the client, the same rule text for
 * every prompt, a deterministic filter that removes the sentences of an answer the source does not
 * support, and a way to carry the rule to the live voice tutor through the one channel it already
 * sends (its document context), so the production voice hook itself does not have to change.
 *
 * Nothing here calls a model. Every check is lexical and runs in microseconds (lib/sourceGrounding),
 * so strict answers cost no extra latency — and an answer the document does not cover now skips the
 * 20-60 s animation it used to pay for.
 */

/** The only fidelity that fences answers in. Reference mode keeps today's behaviour. */
export function isStrictScope(scope: SourceScope | null | undefined): boolean {
  return scope?.fidelity === "strict";
}

/** What the answer says when the document does not cover the question. Written by code, not the model. */
export const NOT_COVERED_LINE = "Your document doesn't cover that.";

/** A beat's own source rarely exceeds a page; this keeps a malformed request from carrying a book. */
const MAX_BEAT_SOURCE_CHARS = 6_000;
/** Same ceiling lib/lessonChatContext.ts and the routes apply to a document context. */
const MAX_DOCUMENT_CONTEXT_CHARS = 30_000;

const clean = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

type SourceBlock = ScopeBlock & { role?: string };

function documentBlocks(sourceDocument: unknown): SourceBlock[] {
  const blocks = (sourceDocument as { contentBlocks?: unknown } | null)?.contentBlocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.filter(
    (block): block is SourceBlock => Boolean(block) && typeof block === "object" && typeof (block as { id?: unknown }).id === "string",
  );
}

/**
 * The source ONE beat was written from, built where the document already is (the browser).
 *
 * Mirrors what the progressive worker and scripts/eval-boards.mjs hand the board generator, so a
 * question asked about a beat is held to the same text, labels and caption as the beat's own board:
 *   - text: `scopedBlockText` over the beat's `sourceBlockIds` — never the whole document;
 *   - labels: the "Diagram labels:" block from the PDF's text layer, verbatim. The vision model's
 *     region labels are model text, not source text, and are never used;
 *   - caption: the short paragraph that follows those labels, when there is one.
 *
 * Null when the beat names no blocks that exist — a beat without provenance has no source to hold
 * an answer to, and inventing one from the whole document would widen the scope silently.
 */
export function beatSourceGroundingFor(
  sourceDocument: unknown,
  sourceBlockIds: string[] | undefined,
  strict: boolean,
): BeatSourceGrounding | null {
  if (!sourceBlockIds?.length) return null;
  const blocks = documentBlocks(sourceDocument);
  const text = scopedBlockText(blocks, sourceBlockIds);
  if (!text) return null;
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const own = sourceBlockIds.map((id) => byId.get(id)).filter((block): block is SourceBlock => Boolean(block));
  const labels = figureLabelsFromBlocks(own);
  const labelsAt = own.findIndex((block) => block.role === "figure-labels");
  const following = labelsAt >= 0 ? own[labelsAt + 1] : undefined;
  const captionText = clean(following?.text);
  const caption = following?.role === "paragraph" && captionText && captionText.length <= 200 ? captionText : undefined;
  return { text: text.slice(0, MAX_BEAT_SOURCE_CHARS), labels, ...(caption ? { caption } : {}), strict };
}

/**
 * The source a whole lecture was taught from, for the summary slide and the post-lesson test.
 *
 * The blocks the beats cite, in document order — which in a strict lecture is also lecture order.
 * When no beat cites a block (an older lecture, a deck), every block of the selected pages stands in:
 * those are still the pages the student chose, and nothing outside them.
 */
export function lectureSourceText(
  sourceDocument: unknown,
  beats: Array<{ sourceBlockIds?: string[] }>,
  maxChars = 16_000,
): string {
  const blocks = documentBlocks(sourceDocument);
  if (blocks.length === 0) return "";
  const taught = new Set(beats.flatMap((beat) => beat.sourceBlockIds ?? []));
  const ids = blocks.filter((block) => taught.size === 0 || taught.has(block.id)).map((block) => block.id);
  return scopedBlockText(blocks, ids).slice(0, maxChars);
}

/**
 * Accept a beat source at an API boundary.
 *
 * `strict` is NOT read from the payload: the route derives it from the sanitized source scope, so a
 * client cannot send a reference-mode scope with a strict flag (or the reverse) and get a mixture.
 */
export function sanitizeBeatSourceGrounding(value: unknown, strict: boolean): BeatSourceGrounding | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const text = typeof raw.text === "string" ? raw.text.trim().slice(0, MAX_BEAT_SOURCE_CHARS) : "";
  const labels = Array.isArray(raw.labels)
    ? raw.labels
        .filter((label): label is string => typeof label === "string")
        .map((label) => clean(label).slice(0, 120))
        .filter(Boolean)
        .slice(0, 40)
    : [];
  const caption = clean(raw.caption).slice(0, 400);
  if (!text && labels.length === 0) return null;
  return { text, labels, ...(caption ? { caption } : {}), strict };
}

/** A beat source as prompt text: the passage, then its figure's printed labels and caption. */
export function formatBeatSource(source: BeatSourceGrounding): string {
  const lines = [source.text.trim()];
  if (source.labels.length) lines.push(`Figure labels, as printed: ${source.labels.join(" · ")}`);
  if (source.caption) lines.push(`Figure caption: ${source.caption}`);
  return lines.filter(Boolean).join("\n");
}

/**
 * One grounding object from a beat's source plus the wider document, for vocabulary checks.
 *
 * An answer may quote any part of the student's document — a student reading page 2 asks about
 * page 3 — so the check's vocabulary is the document as well as the beat. Neither is model text.
 */
export function combinedSource(beatSource: BeatSourceGrounding | null, documentText: string): BeatSourceGrounding {
  return {
    text: [beatSource?.text ?? "", documentText].filter((part) => part.trim()).join("\n\n"),
    labels: beatSource?.labels ?? [],
    ...(beatSource?.caption ? { caption: beatSource.caption } : {}),
    strict: true,
  };
}

/**
 * The rule appended to the ask box's and the pen's system prompts in strict mode.
 *
 * APPENDED, so it is the last word: the base prompts ask for "a scientifically or technically
 * credible diagram" and "one concrete example", which are exactly the invitations strict forbids.
 * Covers the board brief as well as the answer, because the board is drawn from that brief.
 */
export const STRICT_ANSWER_RULES = `STRICTLY FROM THE SOURCE — this overrides every instruction above.
The student chose to learn ONLY from their own document. SOURCE in the message (and the CURRENT PART of it) is the only material you may use.
- "script": answer only with what SOURCE says, in SOURCE's own words wherever you can. Add no outside facts, examples, analogies, numbers, names, steps, applications or context — not even true ones, not even to be helpful. Depth comes from SOURCE itself: when SOURCE says a lot about the question (its passage, its figure and caption), explain all of that thoroughly and step by step; only when SOURCE says little is a short answer right.
- When SOURCE does not answer the question, set "covered": false and begin "script" with exactly "${NOT_COVERED_LINE}" Then, only if SOURCE says something close to what was asked, add one sentence saying what SOURCE does say. Never answer it from general knowledge, and never guess.
- "covered": true only when every sentence of "script" is stated in SOURCE.
- The board ("teachingPoint", "codeBrief", or the board's text): only what SOURCE describes or its figure shows. Use SOURCE's labels word for word. Name no part, label, arrow, value or example that SOURCE does not contain. A sparse board is correct. When SOURCE lists figure labels, the board redraws THAT figure with THOSE labels.
Return "covered" (true or false) in the JSON alongside everything else.`;

/**
 * The live voice tutor in a lesson whose document is a REFERENCE: specific when asked about the
 * document, free to go past it otherwise — and code is always fair game on a programming topic.
 */
export const REFERENCE_VOICE_RULES = `THE DOCUMENT IS A REFERENCE, NOT A FENCE.
- A question about the document itself — "what does this paragraph mean", "what is (b) in figure 19.3", "what does this code do" — is answered specifically from the document: its words, its figure, its code. Answer exactly that question; do not drift into the rest of the chapter.
- Anything beyond it — "why", "give me another example", "how would I code this", a related topic it does not cover — is answered fully from your own knowledge. Say in a few words when you are going beyond the document ("your notes don't show this, but…"), then teach it properly.
- On a programming topic, explain the code: the document's own code when it has it; otherwise describe a clear implementation step by step, and use show_board with visual_mode code_walkthrough when the student wants to see it.`;

/**
 * The live voice tutor's version of the same rule.
 *
 * Speech cannot be filtered sentence by sentence after the fact the way a typed answer can, so this
 * is the only guard on what Aria says aloud — hence the explicit list of the ways a helpful tutor
 * wanders off the page ("another example", "in real life", "fun fact").
 */
export const STRICT_VOICE_RULES = `STRICTLY FROM THE SOURCE — this overrides every other instruction, including the ones about examples and depth.
The student chose to learn ONLY from their own document. Everything you say about the subject must come from SOURCE below, and from the document text for each part that you are given as the lecture moves.
- Say only what SOURCE says. Use its own words and its own examples. Add no outside facts, examples, analogies, numbers, names, dates, applications, real-life uses or fun facts — not even true ones, not even to be helpful.
- If the student asks something SOURCE does not cover, say plainly that their document doesn't cover it. If SOURCE says something close, say what it does say. Never answer from general knowledge and never guess.
- "Give me another example", "go deeper", "where is this used": offer only what SOURCE contains; if it contains none, say so in one sentence.
- Rephrasing the document more simply is fine; adding to it is not. When you are unsure whether something is in SOURCE, leave it out.
- show_board: ask only for what SOURCE describes or its figure shows, named with SOURCE's own labels.`;

/**
 * Conversation words an answer needs that assert nothing about the subject — including the words for
 * finding one's way around the lesson ("next the lesson moves on to…"), which the ask box must still
 * answer in strict mode.
 */
const ANSWER_TALK = [
  "yes", "right", "correct", "wrong", "good", "great", "close", "almost", "nearly", "asked", "ask", "asking", "wondering",
  "document", "notes", "lesson", "lecture", "topic", "chapter", "cover", "covers", "covered", "covering",
  "move", "moves", "moving", "earlier", "later", "already", "talked", "discussed", "sure",
];

/**
 * The pen answer describes the student's own marks back before it teaches ("you circled the word
 * chloroplast"). Those words describe the student's drawing, not the subject, so they are allowed.
 */
export const BOARD_TALK = [
  "here", "see", "shows", "show", "showing", "illustrates", "illustrated", "notice", "look", "looking", "appears",
  "drawn", "draw", "drawing", "board", "picture", "diagram", "figure", "arrow", "arrows", "highlighted",
  "first", "next", "then", "now", "finally", "step", "steps", "part", "parts", "takeaway",
];

/**
 * A board answer walks the student through the drawing ("notice the arrow here…"). Those words point
 * at the board rather than assert anything about the subject, so they do not count against a
 * sentence — without them the strict check deleted "Figure 19.3 illustrates the deletion of node 5,
 * which has one child", a sentence taken from the document's own caption, and the walk-through
 * shrank to a line or two.
 */
export const PEN_TALK = [
  "drew", "drawn", "draw", "circle", "circled", "circling", "mark", "marked", "marking", "highlight", "highlighted",
  "underline", "underlined", "sketch", "sketched", "wrote", "written", "write", "attempt", "attempted", "tried",
  "selected", "select", "selection", "crop", "cropped", "area", "region", "around", "pointing", "pointed",
];

/**
 * A sentence that says the document does not cover something — code states that once, itself.
 *
 * The document has to be the subject ("your notes don't mention…", "it doesn't say…"): a bare "not"
 * would also catch a fact the source states in the negative ("glucose is not made at night, the
 * text says"), and deleting that would delete source content.
 */
const DENIAL_VERB = String.raw`(?:do(?:es)?n['’]?t|do(?:es)? not|isn['’]?t|is not|never)\s+(?:\w+\s+)?(?:cover|covers|covered|mention|mentions|mentioned|say|says|said|explain|explains|explained|discuss|discusses|discussed|include|includes|included|address|addresses|addressed|talk|talks|go|goes|describe|describes|described)\b`;
const COVERAGE_DENIAL = new RegExp(
  String.raw`\b(?:document|source|notes?|text|pages?|book|textbook|material|pdf|slides?|lesson|section|passage)\b[^.?!]*?\b${DENIAL_VERB}|^(?:but\s+|however,?\s+|unfortunately,?\s+)?(?:it|they|this|that)\s+${DENIAL_VERB}`,
  "i",
);

export type GroundedAnswer = {
  /** What the student hears and reads. */
  script: string;
  /** False when the document does not answer the question: skip the board, say so plainly. */
  covered: boolean;
  /** Sentences removed because the source does not support them. Logged, never shown. */
  dropped: string[];
};

/**
 * Keep only the sentences of an answer that the source supports.
 *
 * A sentence stays when fewer than two of its content words are missing from the source — one stray
 * word is paraphrase, two or more is new material (the same tolerance as the script audit in
 * lib/sourceGrounding). Sentences the model wrote to say "the document doesn't cover this" are
 * removed and replaced by NOT_COVERED_LINE, once, so the student never hears a hedge like "your
 * notes don't mention it, but in general…" followed by the general knowledge strict forbids.
 *
 * The answer is "not covered" when the model says so, or when nothing it wrote survives. Then the
 * answer is NOT_COVERED_LINE plus at most two surviving sentences — what the source does say.
 */
export function groundAnswer(
  script: string,
  source: string | BeatSourceGrounding,
  options: { modelCovered?: boolean; extraAllowed?: string[] } = {},
): GroundedAnswer {
  const vocab = sourceVocabulary(source);
  for (const word of [...ANSWER_TALK, ...(options.extraAllowed ?? [])]) {
    vocab.add(word.toLowerCase());
    vocab.add(stem(word));
  }
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sentence of splitSentences(script)) {
    if (sentence.toLowerCase() === NOT_COVERED_LINE.toLowerCase() || COVERAGE_DENIAL.test(sentence)) continue;
    if (!sentenceIsGrounded(sentence, vocab)) dropped.push(sentence);
    else kept.push(sentence);
  }
  const covered = options.modelCovered !== false && kept.length > 0;
  if (covered) return { script: kept.join(" "), covered, dropped };
  return { script: [NOT_COVERED_LINE, ...kept.slice(0, 2)].join(" "), covered: false, dropped };
}

/** True when a piece of board text (a label, a note line) brings in two or more non-source words. */
export function boardTextIsUngrounded(text: string, source: string | BeatSourceGrounding): boolean {
  return !sentenceIsGrounded(text, sourceVocabulary(source));
}

/**
 * The sentences of a document most relevant to an answer, in document order, within a budget.
 *
 * WHY. The answer board is held to its source by the board generator (fillReactAnimationOps'
 * sourceByBeatId). Handing it the whole 30k-character document would cost seconds of prefill on
 * every question; handing it only the beat's text would reject an answer that quoted the next page.
 * So it gets the beat's text plus the few document sentences that share the answer's content words.
 * Deterministic and cheap: word overlap, no model.
 *
 * Sentences already inside `exclude` (the beat's own text) are skipped so nothing is sent twice.
 */
export function relevantSourceExcerpt(documentText: string, focus: string, maxChars = 2_500, exclude = ""): string {
  const text = documentText.trim();
  if (!text) return "";
  const wanted = new Set(contentStems(focus));
  if (wanted.size === 0) return "";
  const excluded = clean(exclude).toLowerCase();
  const sentences = text
    .split(/\n+/)
    .flatMap((paragraph) => splitSentences(paragraph))
    .map((sentence, index) => ({ sentence, index }))
    .filter(({ sentence }) => !(excluded && excluded.includes(clean(sentence).toLowerCase())));
  const scored = sentences
    .map((entry) => ({ ...entry, score: new Set(contentStems(entry.sentence).filter((value) => wanted.has(value))).size }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen: typeof scored = [];
  let used = 0;
  for (const entry of scored) {
    const cost = entry.sentence.length + 1;
    if (used + cost > maxChars) continue;
    chosen.push(entry);
    used += cost;
  }
  return chosen
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence)
    .join(" ");
}

/*
 * THE IN-BAND HEADER FOR THE LIVE VOICE TUTOR.
 *
 * The Gemini Live hook (lib/useGeminiLiveTutor.ts) forwards a fixed set of strings — topic, beat
 * context, lesson context, document context — to the session-token route, which builds Aria's system
 * instruction, and to /api/explain when she draws. It has no field for a source scope, and that hook
 * is production voice code that is frozen until the Voice Lab validates its replacement.
 *
 * So the strict rule rides at the head of the one string it already carries: the document context.
 * The header is written for a model to read as-is (a surface that never parses it still sees a plain
 * "strict" instruction first), and for code to parse back out exactly (lib/geminiLiveContract.ts and
 * app/api/explain/route.ts do), so the rule becomes a proper system instruction rather than prose
 * buried at the top of a document.
 */
const STRICT_HEADER = "SOURCE FIDELITY: STRICT";
const PART_OPEN = "CURRENT PART'S SOURCE TEXT:";
const PART_LABELS = "CURRENT PART'S FIGURE LABELS:";
const PART_CAPTION = "CURRENT PART'S FIGURE CAPTION:";
const PART_END = "END OF CURRENT PART'S SOURCE.";
const DOCUMENT_OPEN = "THE STUDENT'S DOCUMENT:";

/** Prefix a document context with the strict rule and the current part's source. */
export function withStrictSourceHeader(documentContext: string, beatSource: BeatSourceGrounding | null): string {
  const lines = [
    `${STRICT_HEADER} — teach and answer ONLY from the student's document below. Add no outside facts, examples, analogies or numbers, and say plainly when the document does not cover a question.`,
  ];
  if (beatSource && (beatSource.text.trim() || beatSource.labels.length)) {
    lines.push(PART_OPEN, beatSource.text.trim());
    if (beatSource.labels.length) lines.push(`${PART_LABELS} ${beatSource.labels.map(clean).join(" | ")}`);
    if (beatSource.caption) lines.push(`${PART_CAPTION} ${clean(beatSource.caption)}`);
    lines.push(PART_END);
  }
  lines.push(DOCUMENT_OPEN);
  const header = `${lines.join("\n")}\n`;
  // The routes cut at 30k characters; the header must survive that cut, so the document yields.
  return header + documentContext.slice(0, Math.max(0, MAX_DOCUMENT_CONTEXT_CHARS - header.length));
}

export type StrictSourceHeader = {
  strict: boolean;
  /** The part on screen when the context was read, or null when the header carried none. */
  beatSource: BeatSourceGrounding | null;
  /** The document context with the header removed — what the prompt should call the document. */
  document: string;
};

/** Read the header back out. A context without one is returned untouched, not strict. */
export function readStrictSourceHeader(documentContext: string): StrictSourceHeader {
  if (!documentContext.startsWith(STRICT_HEADER)) return { strict: false, beatSource: null, document: documentContext };
  const marker = `\n${DOCUMENT_OPEN}\n`;
  const documentAt = documentContext.indexOf(marker);
  const header = documentAt >= 0 ? documentContext.slice(0, documentAt) : documentContext;
  const document = documentAt >= 0 ? documentContext.slice(documentAt + marker.length) : "";

  let beatSource: BeatSourceGrounding | null = null;
  const openMarker = `\n${PART_OPEN}\n`;
  const openAt = header.indexOf(openMarker);
  if (openAt >= 0) {
    const endAt = header.indexOf(`\n${PART_END}`, openAt);
    let body = header.slice(openAt + openMarker.length, endAt >= 0 ? endAt : undefined);
    let caption = "";
    const captionAt = body.lastIndexOf(`\n${PART_CAPTION} `);
    if (captionAt >= 0) {
      caption = clean(body.slice(captionAt + PART_CAPTION.length + 2));
      body = body.slice(0, captionAt);
    }
    let labels: string[] = [];
    const labelsAt = body.lastIndexOf(`\n${PART_LABELS} `);
    if (labelsAt >= 0) {
      labels = body
        .slice(labelsAt + PART_LABELS.length + 2)
        .split("|")
        .map(clean)
        .filter(Boolean);
      body = body.slice(0, labelsAt);
    }
    const text = body.trim();
    if (text || labels.length) beatSource = { text, labels, ...(caption ? { caption } : {}), strict: true };
  }
  return { strict: true, beatSource, document };
}

/**
 * What the voice tutor is told when the lecture moves to a new part, in strict mode.
 *
 * Its system instruction is fixed for the life of the socket, so the part it was opened on goes
 * stale as the lecture plays. This rides on the per-part context update the player already sends.
 */
/**
 * The same per-part text for a REFERENCE lesson, framed as a reference rather than a fence.
 *
 * Strict lessons sent Aria each part's own document text as the lecture moved; reference lessons
 * sent nothing, so a question about "this paragraph" or "figure 19.3" was answered from the whole
 * document at best — and the strict voice was the one that felt right. Same channel, looser rule.
 */
export function referenceVoicePartContext(beatSource: BeatSourceGrounding | null): string {
  if (!beatSource) return "";
  return `\nThe document's own text for this part (a reference: answer questions about it from here, and explain beyond it freely):\n${formatBeatSource(beatSource)}`;
}

export function strictVoicePartContext(beatSource: BeatSourceGrounding | null): string {
  if (!beatSource) return "";
  return `\nThe document's own text for this part — in strict mode you teach and answer ONLY from the document, so add nothing it does not say:\n${formatBeatSource(beatSource)}`;
}

/**
 * The post-lesson test, held to the source.
 *
 * Same boundary as the summary: the test was written from the scripts, so a leaked script produced
 * a question — and a model answer the student was graded against — about material their document
 * never contained. Appended last to the test prompt in strict mode.
 */
export const STRICT_TEST_RULES = `STRICTLY FROM THE SOURCE — this overrides the rules above.
The student chose to learn ONLY from their own document. SOURCE below is the boundary.
- Every question must be answerable from SOURCE alone. Every keyPoint and modelAnswer must be something SOURCE states, in SOURCE's own words wherever you can.
- No outside facts, examples or numbers, and no new situations to apply the idea to: "explain", "why" and "compare" questions about what SOURCE says are right; "what would happen if…" about a situation SOURCE does not describe is not.
- A lecture statement SOURCE does not support is not tested. Fewer questions are better than one from outside SOURCE — but write at least 3.`;

/** The part of a test question the grounding check reads (structural, so any bank shape fits). */
type GroundableQuestion = { prompt: string; rubric: { keyPoints: string[]; modelAnswer: string } };

/**
 * A strict test's questions, minus the ones the source cannot answer.
 *
 * A question goes when its prompt, or any sentence of its model answer, brings in two or more words
 * the source never uses — the student would be graded against material their document lacks.
 * Key points are filtered the same way; a question left with none goes too. Each kept question
 * carries `strictSource`, the few source sentences it is about, so "Explain this again" after a
 * wrong answer can be held to the same text (app/api/generate-remediation/route.ts).
 */
export function groundTestQuestions<Q extends GroundableQuestion>(
  questions: Q[],
  source: string,
): { kept: Array<Q & { strictSource: string }>; dropped: number } {
  const vocab = sourceVocabulary(source);
  const unsupported = (text: string) => !sentenceIsGrounded(text, vocab);
  const kept: Array<Q & { strictSource: string }> = [];
  for (const question of questions) {
    if (unsupported(question.prompt)) continue;
    if (splitSentences(question.rubric.modelAnswer).some(unsupported)) continue;
    const keyPoints = question.rubric.keyPoints.filter((point) => !unsupported(point));
    if (keyPoints.length === 0) continue;
    const focus = [question.prompt, question.rubric.modelAnswer, ...keyPoints].join(" ");
    kept.push({
      ...question,
      rubric: { ...question.rubric, keyPoints },
      strictSource: relevantSourceExcerpt(source, focus, 1_500),
    });
  }
  return { kept, dropped: questions.length - kept.length };
}

/** A remediation's source, when the question came from a strict test (see groundTestQuestions). */
export function strictSourceOfQuestion(question: unknown): string {
  const value = question && typeof question === "object" ? (question as { strictSource?: unknown }).strictSource : undefined;
  return typeof value === "string" ? value.trim().slice(0, 3_000) : "";
}

/** The remediation mini-lesson's version of the rule: its base prompt asks for "one concrete example". */
export const STRICT_REMEDIATION_RULES = `STRICTLY FROM THE SOURCE — this overrides the rules above, including "give one concrete example".
The student chose to learn ONLY from their own document. SOURCE below is the only material you may teach from.
- Correct the misunderstanding using only what SOURCE says, in its own words wherever you can. Use SOURCE's own example if it has one; never invent one.
- No outside facts, examples, analogies or numbers, on the board or in the script. A shorter beat is correct.`;
