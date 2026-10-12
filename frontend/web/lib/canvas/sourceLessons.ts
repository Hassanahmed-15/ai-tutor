import type { SuprnotesContentBlock, SuprnotesLessonInput } from "../suprnotes";
import type { CanvasPlanBeat } from "./types";
import { canvasSentences } from "./plan";
import { CANVAS_CODE_LINES, documentBoardLines, documentForCanvas, documentListings, documentPageMap, listingIndex } from "./documentContext";
import { ungroundedScriptSentences } from "../strictSourceScript";
import { contentStems } from "../sourceGrounding";
import { videoTranscriptStretch } from "../youtube/videoSource";

/**
 * LESSONS TAUGHT STRICTLY FROM A SOURCE, ON THE CANVAS — a PDF in "strictly from the source" mode,
 * and a YouTube video (built strictly since it was added). Pure, so it is unit-tested
 * (lib/anim/documentCanvas.test.ts).
 *
 * They used to run on the ordinary boards, whose strict override asked for "a sparse board" and
 * deleted any word the page lacked — the boards looked thinner than a typed prompt's, and the PDF
 * box followed a word-overlap guess. Now they are planned and drawn exactly like a typed prompt
 * (the same prompts, stages and renderers); the student's rule (2026-10-10) is that STRICT LIMITS
 * WHAT IS TAUGHT, NEVER HOW WELL IT IS DRAWN. What is new here is only what makes it strict:
 *
 *   - the planner reads the whole source, each passage tagged with its block id, and every board
 *     says which passages it teaches and which passage each sentence is about;
 *   - before any board is drawn, every spoken sentence is checked against its passages (the same
 *     lexical gate the ordinary strict lecture used) and a sentence that brings in outside material
 *     is deleted — before the board exists, so each board's sentence numbers stay right;
 *   - the beat carries its block ids, so the PDF panel boxes the passage being spoken.
 */

type LessonPart = { id: string; title: string; sourceBlockIds: string[]; startSec?: number; endSec?: number };

/* ── strict PDF ───────────────────────────────────────────────────────────────────────────────── */

/** The most boards a strict lecture on a whole document may have (lib/canvas/plan.ts keeps 24). */
export const MAX_SOURCE_BOARDS = 24;

/** One line per page with something on it: what the planner must cover. */
function pageMapText(doc: SuprnotesLessonInput): string {
  return documentPageMap(doc)
    .filter((p) => p.chars >= 150 || p.listings.length)
    .map((p) => `- page ${p.page}${p.heading ? ` — ${p.heading}` : ""}${p.listings.length ? ` (code: LISTING ${p.listings.join(", ")})` : ""}: ${p.gist}${p.gist.length >= 110 ? "…" : ""}`)
    .join("\n");
}

/** The planner's section for a strict PDF lesson: the rules, the code listings, the whole document with block ids. */
export function strictPlanSection(doc: SuprnotesLessonInput, question: string | null): string {
  const listings = documentListings(doc);
  const lines = [
    "THE STUDENT'S DOCUMENT — this lesson is taught STRICTLY FROM IT. It is printed in full at the end of this request, page by page; every passage starts with its id in braces, like {p3-b2}.",
    "- Everything Aria SAYS comes from the document: its facts, terms, steps, examples, numbers and code. Never add an example, analogy, application, story, history or fact the document does not state — not even a true one. Explain in plain words using the document's own terms and connect one idea to the next: the connecting words are yours, the content is the document's.",
    "- Animate it as richly as any lesson: choose the stage that shows each idea best — flow, graph, equation, compare, scene, code, or an illustration of a physical thing the document describes — drawn with the document's OWN example, values and labels. Strict limits what is taught, never how well it is drawn.",
    question
      ? `- The student asked: "${question}". Answer exactly that, completely, from EVERY passage that bears on it (not only the first one), and nothing the question does not ask about. Use as many boards as the answer needs — one per distinct part of it, in the document's order — with no introduction or recap board.`
      : `- No question was asked: this lecture teaches ALL of the selected pages, in their order — every page in the PAGE MAP below is taught by at least one board (its "source.pages" names it), one board per section, idea or code listing, so nothing on any page is skipped. A long document gets as many boards as it needs (up to ${MAX_SOURCE_BOARDS}); a page that only continues the one before may share its board. No introduction or recap board the document does not have.\n\nPAGE MAP (the selected pages, in order):\n${pageMapText(doc)}`,
    "- Every board carries \"source\": {\"pages\": [its page numbers], \"blocks\": [the ids of EVERY passage it teaches from], \"listing\": the LISTING number it shows or null, \"lines\": [first, last] printed line numbers of that listing on this board, or null}, and \"sentenceBlocks\": [for EACH sentence of its script, in order, the id of the passage that sentence is about — exactly one id per sentence]. The student's PDF is open beside the board and boxes each passage while you speak about it.",
  ];
  if (listings.length) {
    lines.push(
      "",
      "CODE IN THE DOCUMENT — these are ALL its code listings:",
      listingIndex(listings),
      "- A board about code is a \"code\" board that shows the document's OWN listing, copied exactly, in its language — never rewritten in Python, never shortened into pseudo-code, never invented.",
      question
        ? "- A question about code is answered with ONLY the listings it is about. One that names an operation or routine (\"explain the deletion code\") is answered with that listing alone — code it merely calls (balance, a rotation) is mentioned in a sentence, not taught on boards of its own. Only a question that names no particular routine (\"explain the code\", \"the implementation\") is answered with every listing, in the document's order."
        : "- Every listing above is taught on a code board, in the document's order.",
      `- A board shows at most ${CANVAS_CODE_LINES} lines of code. A longer listing is taught on CONSECUTIVE code boards, split where one function ends or between two complete statements — never between an if or else and the line it controls, and never between a { and the lines it opens — each board naming its "lines". A board may leave out the comment block above a function (say what it says instead).`,
      "- A code board's script walks through its lines in order — what each part does and why — with 6 to 10 sentences, so every few lines get their own sentence.",
      "- NEVER say a line number aloud (\"line 27\"): each board numbers its own lines from 1. Name the code instead (\"the null check\", \"the call to balance\").",
    );
  }
  lines.push("", "THE DOCUMENT:", documentForCanvas(doc, 60_000, { blockIds: true }));
  return lines.join("\n");
}

/* ── video ────────────────────────────────────────────────────────────────────────────────────── */

/** The video's own plan: one part per chapter piece, in video order (lib/youtube/videoSource.ts). */
export function videoParts(doc: SuprnotesLessonInput): LessonPart[] {
  const plan = (doc.lessonPlan ?? doc.suggestedLecturePlan) as { beats?: unknown[] } | undefined;
  return (plan?.beats ?? [])
    .map((raw) => raw as Record<string, unknown>)
    .map((b, i) => ({
      id: typeof b.id === "string" ? b.id : `part-${i + 1}`,
      title: typeof b.title === "string" ? b.title : `Part ${i + 1}`,
      sourceBlockIds: Array.isArray(b.sourceBlockIds) ? b.sourceBlockIds.filter((v): v is string => typeof v === "string") : [],
      startSec: typeof b.startSec === "number" ? b.startSec : undefined,
      endSec: typeof b.endSec === "number" ? b.endSec : undefined,
    }))
    .filter((part) => part.sourceBlockIds.length > 0);
}

function clock(sec: number | undefined): string {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "?";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The video as the planner reads it: each part with its time, its key points (block ids in braces)
 * and what was said and shown in that stretch — trimmed evenly to the budget, key points never cut.
 */
export function videoForCanvas(doc: SuprnotesLessonInput, budget = 80_000): string {
  const parts = videoParts(doc);
  const byId = new Map((doc.contentBlocks ?? []).map((b) => [b.id, b]));
  const heads = parts.map((part, i) => {
    const points = part.sourceBlockIds.map((id) => byId.get(id)).filter((b): b is SuprnotesContentBlock => Boolean(b));
    return `PART b${i + 1} — ${part.title} [${clock(part.startSec)}–${clock(part.endSec)}]\nKey points:\n${points.map((b) => `{${b.id}} ${(b.text ?? "").replace(/\s+/g, " ").trim()}`).join("\n")}`;
  });
  const stretches = parts.map((part) => videoTranscriptStretch(doc, part.sourceBlockIds).replace(/\s+/g, " ").trim());
  const fixed = heads.reduce((t, h) => t + h.length + 40, 0);
  const room = Math.max(0, budget - fixed);
  const total = stretches.reduce((t, s) => t + s.length, 0);
  const share = total > room ? Math.floor(room / Math.max(1, stretches.length)) : Infinity;
  return heads
    .map((head, i) => {
      const said = stretches[i].length > share ? `${stretches[i].slice(0, share).replace(/\s+\S*$/, "")} …` : stretches[i];
      return said ? `${head}\nWhat the video says and shows in this stretch: ${said}` : head;
    })
    .join("\n\n");
}

/** The planner's section for a video lesson: exactly one board per part, strictly from it. */
export function videoPlanSection(doc: SuprnotesLessonInput): string {
  const parts = videoParts(doc);
  return [
    `THE VIDEO — the student has not watched it; this lesson teaches it STRICTLY. Exactly ${parts.length} board${parts.length === 1 ? "" : "s"}, b1 to b${parts.length}, one per PART below, in order. Each board teaches ALL the key points of its part, in order, and nothing from any other part.`,
    "- Everything Aria SAYS comes from the video: its facts, terms, steps, formulas, numbers, examples and code. Never add an example, analogy, application or fact the video does not state — not even a true one. Explain like a teacher: join the points, saying how each follows from the last; the connecting words are yours, the content is the video's.",
    "- Animate it as richly as any lesson: choose the stage that shows each part best — flow, graph, equation, compare, scene, code, or an illustration of a physical thing the video shows — drawn with the video's OWN example, values and labels. Strict limits what is taught, never how well it is drawn.",
    "- Code the video shows is shown on a \"code\" board exactly as written in the video, in its language.",
    "- Every board carries \"sentenceBlocks\": [for EACH sentence of its script, in order, the id of the key point that sentence teaches — exactly one id per sentence, from its own part].",
    "",
    videoForCanvas(doc),
  ].join("\n");
}

/* ── grounding the plan before any board is drawn ─────────────────────────────────────────────── */

/**
 * Words needed to explain CODE that a listing never prints ("pointer", "recursion", "returns").
 * They describe the document's own code; they bring in no outside fact.
 */
const CODE_WORDS = "code line lines function functions method routine call calls called calling return returns returned returning pointer pointers variable variables parameter parameters argument arguments reference references recursive recursion recursively loop loops condition conditions statement statements check checks checking value values null empty true false otherwise compare compares comparison assign assigns assigned store stores stored update updates updated declare declares declared type types field fields member members object objects class struct structure constructor constructors definition defines defined compute computes computed result results step steps";

function blockText(block: SuprnotesContentBlock): string {
  return [block.heading, block.text, ...(block.items ?? []), ...(block.rows ?? []).map((r) => r.join(" "))].filter(Boolean).join(" ");
}

/** "rotateWithLeftChild" also reads as "rotate With Left Child", "t->left" as "t left". */
function readable(text: string): string {
  return `${text} ${text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/->|::|_/g, " ")}`;
}

/** The blocks most like a sentence, best first (shared content stems). */
function closestBlocks(sentence: string, blocks: SuprnotesContentBlock[]): SuprnotesContentBlock[] {
  const said = new Set(contentStems(readable(sentence)));
  return blocks
    .map((block) => {
      const stems = new Set(contentStems(readable(blockText(block))));
      let score = 0;
      for (const s of said) if (stems.has(s)) score++;
      return { block, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.block);
}

export type GroundedPlan<T> = { beats: T[]; removed: number; log: string[] };

/**
 * What the code on a code board licenses Aria to say about it: the words its operators and calls
 * are read aloud as. "if( x < t->element )" is explained as "when x is smaller"; "findMin" as "the
 * minimum"; "t = …" as "t becomes …". None of these adds a fact the code does not state.
 */
const CODE_READINGS: Array<[RegExp, string]> = [
  [/<=/, "smaller less equal most"],
  [/>=/, "greater larger equal least"],
  [/[^-<]<[^<=]/, "smaller less lower before"],
  [/[^->]>[^>=]/, "greater larger bigger taller deeper more"],
  [/==/, "equal equals same"],
  [/!=/, "not different differs"],
  [/\bnull(?:ptr)?\b|\bNULL\b|\bNone\b/, "null empty nothing missing absent no none"],
  [/[^=!<>]=[^=]/, "assign assigns set sets becomes replace replaces copy copies store stores"],
  [/\bdelete\b|\bfree\b/, "free frees release releases removes deletes"],
  [/\bnew\b/, "create creates make makes allocate allocates new"],
  [/\breturn\b/, "return returns stop stops back hands"],
  [/\bmax\b|Max/, "maximum larger taller bigger"],
  [/\bmin\b|Min/, "minimum smallest smaller least"],
  [/\+\s*1\b/, "plus one add adds"],
  [/-\s*1\b/, "minus one negative"],
  [/->|\./, "field of its points"],
  [/&&/, "and both"],
  [/\|\|/, "or either"],
  [/\belse\b/, "otherwise else"],
  [/\bif\b/, "when whether if"],
  [/\bwhile\b|\bfor\b/, "while repeat repeats loop each"],
];

function codeReadings(text: string): string {
  return CODE_READINGS.filter(([re]) => re.test(text)).map(([, words]) => words).join(" ");
}

/** "$1.44 \log(N + 2)$" spoken as "1.44 log(N + 2)": a passage's own sentences, said aloud. */
function speakable(sentence: string): string {
  return sentence.replace(/\$([^$]*)\$/g, "$1").replace(/\\(log|ln|sin|cos|tan)\b/g, "$1").replace(/\\[a-zA-Z]+/g, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

type BeatGrounding = { ids: string[]; own: SuprnotesContentBlock[]; grounding: { text: string; labels: string[]; strict: boolean } };

/**
 * A board's passages — the ids the planner named that really exist (a video part's are fixed by the
 * part), plus its listing's, else its pages', else the passages its script is closest to — and the
 * text its sentences are checked against: those passages, the video's stretch, and on a code board
 * the code's readings and the words that explain code.
 */
function beatGrounding(doc: SuprnotesLessonInput, beat: Pick<CanvasPlanBeat, "stage" | "script" | "source">, index: number, mode: "strict" | "video"): BeatGrounding {
  const all = doc.contentBlocks ?? [];
  const byId = new Map(all.map((b) => [b.id, b]));
  let ids: string[];
  if (mode === "video") ids = videoParts(doc)[index]?.sourceBlockIds ?? [];
  else {
    const listing = beat.source?.listing ? documentListings(doc).find((l) => l.n === beat.source!.listing) : undefined;
    ids = (beat.source?.blocks ?? []).filter((id) => byId.has(id));
    if (listing) ids = [...new Set([...ids, ...listing.blockIds])];
    if (!ids.length && beat.source?.pages?.length) ids = all.filter((b) => beat.source!.pages.includes(b.pageNumber ?? -1)).map((b) => b.id);
    if (!ids.length) ids = closestBlocks(beat.script, all).slice(0, 3).map((b) => b.id);
  }
  const own = ids.map((id) => byId.get(id)).filter((b): b is SuprnotesContentBlock => Boolean(b));
  const stretch = mode === "video" ? videoTranscriptStretch(doc, ids) : "";
  const raw = [...own.map(blockText), stretch].join("\n");
  const text = readable(raw);
  return { ids, own, grounding: { text: beat.stage === "code" ? `${text}\n${CODE_WORDS}\n${codeReadings(raw)}` : text, labels: [], strict: true } };
}

/**
 * STRICT MEANS FROM THE DOCUMENT, not from the passages one board happened to name. A sentence
 * its board's passages do not support, but the selected document does ("This forces k1 to be k2's
 * left child" — said on a board that named page 4, printed on page 7), is kept: its passage joins
 * the board, so the PDF boxes it. Only what the whole document does not say is outside material.
 */
function documentGrounding(doc: SuprnotesLessonInput, mode: "strict" | "video", code: boolean): { text: string; labels: string[]; strict: boolean } {
  const transcript = mode === "video" ? ((doc.source as { transcript?: Array<[number, string]> } | undefined)?.transcript ?? []).map((entry) => entry[1]).join(" ") : "";
  const raw = [...(doc.contentBlocks ?? []).map(blockText), transcript].join("\n");
  const text = readable(raw);
  return { text: code ? `${text}\n${CODE_WORDS}\n${codeReadings(raw)}` : text, labels: [], strict: true };
}

/**
 * The sentences that bring in material the document does not contain — to be rewritten from their
 * passages (lib/canvas/progressive.ts) before groundSourcePlan deletes what still is not grounded.
 */
export function ungroundedInPlan(doc: SuprnotesLessonInput, beats: Array<Pick<CanvasPlanBeat, "id" | "stage" | "script" | "source">>, mode: "strict" | "video"): Array<{ beat: string; index: number; sentence: string; passages: string }> {
  const whole = { prose: documentGrounding(doc, mode, false), code: documentGrounding(doc, mode, true) };
  return beats.flatMap((beat, b) => {
    const { own, grounding } = beatGrounding(doc, beat, b, mode);
    const wholeDoc = beat.stage === "code" ? whole.code : whole.prose;
    const passages = own.map((x) => `{${x.id}} ${blockText(x).replace(/\s+/g, " ").trim()}`).join("\n").slice(0, 4000);
    return canvasSentences(beat.script)
      .map((sentence, index) => ({ beat: beat.id, index, sentence, passages }))
      .filter((x) => ungroundedScriptSentences(x.sentence, grounding).length > 0 && ungroundedScriptSentences(x.sentence, wholeDoc).length > 0);
  });
}

/** A passage the PDF panel can box: it has a place on the page. */
function boxable(block: SuprnotesContentBlock | undefined): boolean {
  return Boolean(block?.bbox && typeof block.pageNumber === "number");
}

/**
 * Every board of a strict PDF or video lesson, made strict before it is drawn:
 *
 *   1. its passages (beatGrounding);
 *   2. its sentences — each one that still brings in material its passages do not contain is
 *      deleted (lib/strictSourceScript.ts `ungroundedScriptSentences`); a board left with fewer than
 *      two speaks its passages' own sentences instead;
 *   3. one passage per remaining sentence for the PDF box — the planner's when it is one of the
 *      board's and can be boxed, else the closest one that can.
 */
export function groundSourcePlan<T extends Pick<CanvasPlanBeat, "id" | "stage" | "script" | "source" | "sentenceBlocks">>(
  doc: SuprnotesLessonInput,
  beats: T[],
  mode: "strict" | "video",
): GroundedPlan<T> {
  const all = doc.contentBlocks ?? [];
  const byId = new Map(all.map((b) => [b.id, b]));
  const whole = { prose: documentGrounding(doc, mode, false), code: documentGrounding(doc, mode, true) };
  const log: string[] = [];
  let removed = 0;

  const out = beats.map((beat, index) => {
    const grounded = beatGrounding(doc, beat, index, mode);
    const { grounding } = grounded;
    let { ids, own } = grounded;
    const sentences = canvasSentences(beat.script);
    const planned = beat.sentenceBlocks ?? [];
    const kept: Array<{ sentence: string; block?: string }> = [];
    sentences.forEach((sentence, i) => {
      if (ungroundedScriptSentences(sentence, grounding).length > 0) {
        if (ungroundedScriptSentences(sentence, beat.stage === "code" ? whole.code : whole.prose).length > 0) {
          removed++;
          log.push(`${beat.id}: dropped "${sentence.slice(0, 80)}"`);
          return;
        }
        // Said elsewhere in the document: that passage joins this board, and is boxed for it.
        const from = closestBlocks(sentence, all.filter((b) => boxable(b)))[0] ?? closestBlocks(sentence, all)[0];
        if (from && !ids.includes(from.id)) {
          ids = [...ids, from.id];
          own = [...own, from];
        }
        kept.push({ sentence, block: from?.id });
        return;
      }
      kept.push({ sentence, block: planned[i] });
    });
    let script = kept.map((k) => k.sentence).join(" ");
    if (kept.length < 2 && own.length) {
      // Too little survived: the board speaks its passages' own sentences.
      const said = own.flatMap((b) => canvasSentences(speakable((b.text ?? "").replace(/\s+/g, " ").trim())).map((sentence) => ({ sentence, block: b.id }))).slice(0, 6);
      if (said.length >= 2) {
        kept.splice(0, kept.length, ...said);
        script = said.map((k) => k.sentence).join(" ");
        log.push(`${beat.id}: spoke its source's own sentences`);
      }
    }

    const canBox = own.filter((b) => boxable(b));
    const sentenceBlocks = kept.map((k) => {
      if (k.block && ids.includes(k.block) && (boxable(byId.get(k.block)) || !canBox.length)) return k.block;
      return (closestBlocks(k.sentence, canBox.length ? canBox : own)[0] ?? canBox[0] ?? own[0])?.id ?? "";
    });
    const pages = [...new Set(own.map((b) => b.pageNumber).filter((p): p is number => typeof p === "number"))];
    return {
      ...beat,
      script: script || beat.script,
      source: { ...(beat.source ?? { pages: [] }), pages: beat.source?.pages?.length ? beat.source.pages : pages, blocks: ids },
      sentenceBlocks,
    };
  });
  return { beats: out, removed, log };
}

/**
 * ON A CODE BOARD THE BOX FOLLOWS THE LIT LINES. Each sentence's box is the PDF block holding the
 * printed line its code step lights (DocumentListing.lineBlocks), so as the highlight moves down
 * the listing on the board, the box moves down the listing on the page. Board lines are matched to
 * printed lines by their text (a wrapped line belongs to the printed line it continues).
 */
export function codeSentenceBlocks(
  doc: SuprnotesLessonInput,
  beat: Pick<CanvasPlanBeat, "script" | "source" | "sentenceBlocks">,
  code: { lines: string[]; steps: Array<{ s: number; lines: number[] }> },
): string[] | null {
  const listing = beat.source?.listing ? documentListings(doc).find((l) => l.n === beat.source!.listing) : undefined;
  if (!listing || !code.steps.length) return null;
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const [from, to] = beat.source?.lines ?? [1, listing.lines.length];
  // Board line (1-based) → printed line number.
  const printed: number[] = [];
  let at = Math.max(1, from);
  for (const line of code.lines) {
    const text = norm(line);
    let found = 0;
    for (let n = at; n <= Math.min(listing.lines.length, to); n++) {
      const src = norm(listing.lines[n - 1] ?? "");
      if (text && src && (src === text || src.startsWith(text) || src.includes(text))) {
        found = n;
        break;
      }
    }
    if (found) at = found;
    printed.push(found || at);
  }
  // A line read from a block the parse could not place on the page is boxed by the nearest line
  // of the same listing that can be — the box stays on the code being explained.
  const byId = new Map((doc.contentBlocks ?? []).map((b) => [b.id, b]));
  const boxedLine = (n: number): string | undefined => {
    for (let d = 0; d < listing.lineBlocks.length; d++) {
      for (const k of [n - d, n + d]) {
        const id = listing.lineBlocks[k - 1];
        if (id && boxable(byId.get(id))) return id;
      }
    }
    return listing.lineBlocks[n - 1];
  };
  const sentences = canvasSentences(beat.script);
  return sentences.map((_, s) => {
    const step = [...code.steps].reverse().find((st) => st.s <= s) ?? code.steps[0];
    const first = Math.min(...step.lines);
    const n = printed[first - 1];
    return (n && boxedLine(n)) || beat.sentenceBlocks?.[s] || listing.blockIds[0];
  });
}

/* ── what each board reads ────────────────────────────────────────────────────────────────────── */

/** A strict board's source: its listing to copy on a code board, and its passages' exact text. */
export function strictBoardLines(doc: SuprnotesLessonInput, beat: Pick<CanvasPlanBeat, "stage" | "source">): string[] {
  const out: string[] = [];
  if (beat.stage === "code" && beat.source?.listing) out.push(...documentBoardLines(doc, { stage: beat.stage, source: { pages: [], listing: beat.source.listing, lines: beat.source.lines } }));
  const byId = new Map((doc.contentBlocks ?? []).map((b) => [b.id, b]));
  const passages = (beat.source?.blocks ?? []).map((id) => byId.get(id)).filter((b): b is SuprnotesContentBlock => Boolean(b));
  const text = passages.map((b) => `{${b.id}} ${blockText(b).replace(/\s+/g, " ").trim()}`).join("\n").slice(0, 12_000);
  if (text) out.push("", "THIS BOARD TEACHES these passages of the student's document — draw THIS content (its own example, values, labels and code) as richly as any board; every fact, number and label on the board comes from it:", text);
  return out;
}

/** A video board's source: its key points and what was said and shown in that stretch. */
export function videoBoardLines(doc: SuprnotesLessonInput, beat: Pick<CanvasPlanBeat, "source">): string[] {
  const byId = new Map((doc.contentBlocks ?? []).map((b) => [b.id, b]));
  const ids = beat.source?.blocks ?? [];
  const points = ids.map((id) => byId.get(id)).filter((b): b is SuprnotesContentBlock => Boolean(b)).map((b) => `{${b.id}} ${(b.text ?? "").replace(/\s+/g, " ").trim()}`);
  const stretch = videoTranscriptStretch(doc, ids).replace(/\s+/g, " ").trim().slice(0, 10_000);
  if (!points.length) return [];
  return [
    "",
    "THIS BOARD TEACHES this part of the video — draw THIS content (its own example, values, labels and any code exactly as shown) as richly as any board; every fact, number and label comes from it:",
    points.join("\n"),
    ...(stretch ? ["What the video says and shows in this stretch:", stretch] : []),
  ];
}
