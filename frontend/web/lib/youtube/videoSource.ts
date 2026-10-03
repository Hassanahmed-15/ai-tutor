import type { SuprnotesContentBlock, SuprnotesLessonInput } from "../suprnotes";
import { formatTimestamp } from "./videoUrl";

/**
 * A YouTube video as a lesson source: the same `SuprnotesLessonInput` a parsed PDF produces.
 *
 * WHY AN ADAPTER AND NOT A PIPELINE. Everything after parsing — the plan, the script writer, the
 * board generators, the strict gates — runs on `contentBlocks` plus `lessonPlan.beats`. The
 * markdown adapter (lib/markdownSource.ts) already feeds that shape without pages or images. A
 * video does the same, so a video lecture is planned, written, drawn and narrated by the code that
 * teaches a PDF; nothing downstream knows what a video is.
 *
 * WHAT THE BLOCKS ARE. Not the transcript. An hour of speech is ~9,000 words, and a strict board
 * is sized to its source (lib/lectureDepth.ts strictDepthBudget), so blocks of raw transcript would
 * produce a lecture LONGER than the video. The blocks are the video's KEY POINTS (lib/youtube/
 * videoNotes.ts): every definition, claim, formula, step, number and example, one sentence each,
 * with the filler removed. That is where the lecture gets short; the strict path then teaches every
 * block completely, which is what keeps it from getting thin.
 *
 * NO IMAGES, BY CONSTRUCTION. There is no `documentId` and there are no assets, so every page-image
 * and figure-crop path (beatPageImages, cropSourceFigure, SourceFigureBoard, PdfSourcePanel) is
 * already a no-op. What the video SHOWED reaches the boards as words — the key points state what a
 * diagram conveyed — and the animation engine draws it.
 *
 * The whole transcript is kept separately as `fullDocumentText`, for the chat and the voice tutor.
 */

export const VIDEO_ADAPTER = "youtube-video";

/** The video is read in clips this long (lib/youtube/geminiVideo.ts says why). */
export const VIDEO_WINDOW_SEC = 600;
/** One Gemini request reads up to about three hours; past that the feature has not been measured. */
export const MAX_VIDEO_SEC = 3 * 60 * 60;

/**
 * How much of a video's transcript the chat and voice tutor carry.
 *
 * A document is capped at 30,000 characters (lib/lessonChatContext.ts), which is about half an hour
 * of speech — so a tutor given that cap could not answer about the second half of a one-hour video.
 * Speech runs near 9,000 words (~55,000 characters) an hour and the on-screen notes add to it; this
 * carries a three-hour video whole.
 */
export const MAX_VIDEO_CONTEXT_CHARS = 260_000;

/**
 * The opening of a video lesson's whole-lecture context (lib/lessonChatContext.ts). The chat routes
 * recognise it and carry the lecture whole instead of cutting it at a document outline's cap.
 */
export const VIDEO_LESSON_HEADING = "THE SHORT LECTURE.";
/** A three-hour video's short lecture, every slide in full, fits well inside this. */
export const MAX_VIDEO_LESSON_CHARS = 60_000;

export function isVideoLessonContext(lessonContext: string): boolean {
  return lessonContext.startsWith(VIDEO_LESSON_HEADING);
}

/** A block's key points are kept under the 1,400 characters compactBeatSource allows a non-PDF block. */
const MAX_BLOCK_CHARS = 1_300;
/**
 * Notes one board teaches. A video board's script runs about 1.3 words per note word
 * (VIDEO_SCRIPT_WORDS_PER_NOTE_WORD), so 200 words of notes is a board of about 290 — two minutes
 * of speech, and well inside the script call's output limit.
 */
const MAX_BEAT_NOTE_WORDS = 200;
/** Fewer notes than this are not a board of their own when they can join the one before. */
const MIN_BEAT_NOTE_WORDS = 70;
/**
 * How many words a video board's script gets per word of its notes.
 *
 * A strict PDF board gets 1.6 (lib/lectureDepth.ts): a textbook paragraph is terse, and each of its
 * sentences needs explaining once in plain words. A video's key points are ALREADY plain-spoken
 * sentences written to be taught from, so the script's job is to say each one and connect it to the
 * next. At 1.6 a lecture built from a dense video came out as long as the video; at 1.2 the script
 * had no room for the connecting and came out as the key points read in a row.
 */
export const VIDEO_SCRIPT_WORDS_PER_NOTE_WORD = 1.3;

export type VideoSegment = { startSec: number; text: string };
export type VideoOnScreen = { startSec: number; kind: string; content: string };
export type VideoWindow = { startSec: number; endSec: number; segments: VideoSegment[]; onScreen: VideoOnScreen[] };
export type VideoChapter = { title: string; startSec: number; endSec: number };
export type VideoKeyPoint = { text: string; startSec?: number };
export type VideoNoteSection = { heading: string; points: VideoKeyPoint[] };
export type VideoChapterNotes = {
  chapter: VideoChapter;
  sections: VideoNoteSection[];
  /** What was deliberately not kept (a sponsor read, a recap of last week), so nothing vanishes silently. */
  leftOut: string[];
};

const clean = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const wordCount = (text: string): number => text.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
const asSentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

/**
 * The strict contract (lib/sourceScope.ts STRICT_SOURCE_RULE), in a video's words.
 *
 * The same promise — only what the source states, all of what the source states — but the PDF
 * wording points the student at "the labelled parts of the source's figure" and tells the writer
 * the passage is "highlighted on their PDF". A video lesson has neither: the student has not seen
 * the video and there is nothing on screen but the board. Kept as its own text, chosen by adapter,
 * so the document rule is never edited for a video's sake.
 */
export function videoSourceInstruction(): string {
  return (
    "\n\nSOURCE SCOPE.\n" +
    "A SHORT VERSION OF A VIDEO, TAUGHT FROM ITS KEY POINTS. This board's source blocks are the key points of one " +
    "stretch of a video the student has NOT watched. They are the ONLY permitted material, and ALL of them must be " +
    "taught: go through the key points in order and teach every one, never skipping a definition, formula, number, " +
    "step, example or warning. Do not add any fact, number, name, example, analogy, application, history, cause or " +
    "consequence the key points do not state, not even a true one. You may rephrase in plain words using the source's " +
    "own terms, connect one point to the next, and say what a term means using other words from the source. " +
    "A FORMULA IS SPOKEN THE WAY ITS KEY POINT WORDS IT: this script is read aloud, so say the formula in the key " +
    "point's own words and never rewrite it in symbols, subscripts or LaTeX. " +
    "EXPLAIN, DO NOT READ ALOUD: teach it like a teacher, so the points become one explanation rather than a list. " +
    "Do not recite the key points one after another as separate statements: join them, saying how each follows " +
    "from or builds on the one before (\"so\", \"because\", \"which means\", \"that is why\"), and address the student " +
    "directly. The connecting is yours; every fact, term, number and example stays the source's. " +
    "Everyday explaining words are fine; what must come ONLY from the source is the CONTENT. A sentence that adds " +
    "content the source does not have is deleted before the student hears it, and a key point left out is a fault. " +
    "TEACH THE CONTENT, NOT THE VIDEO: never mention the video, the speaker, the clip, a timestamp, \"this part\" or " +
    "\"this section\". Say the idea itself.\n" +
    "Cover the complete selected source."
  );
}

/** How the transcript opens (buildVideoTranscriptText). The chat routes recognise a video by it. */
const TRANSCRIPT_OPENING = 'Transcript of the video "';

/**
 * Is this document context a video's transcript?
 *
 * The chat and the voice tutor reach their routes as strings — the voice hook forwards a fixed set
 * of them and is frozen production code — so there is no field to say "this is a video". The
 * transcript says so itself, in the first line this module writes. The same channel the strict
 * header uses (lib/strictSourceAnswers.ts), for the same reason.
 */
export function isVideoTranscriptContext(documentContext: string): boolean {
  return documentContext.slice(0, 1_500).includes(TRANSCRIPT_OPENING);
}

/**
 * What the chat and the voice tutor are told about a video's transcript.
 *
 * The lecture is a short version of the video; the transcript is the whole of it. So the tutor is
 * told the transcript holds more than the lesson said and that the student may ask about any of it.
 * The tutor is not fenced to the video — a question past it is answered and marked as such — which
 * is the document chat's reference behaviour, in a video's words and with moments instead of pages.
 */
export const VIDEO_CHAT_RULES =
  "THE VIDEO THIS LESSON WAS MADE FROM, in full: everything said, and what was shown on screen. The lesson is a " +
  "SHORT version of this video, so this transcript holds more than the lesson said, and the student may ask about " +
  "any part of it. Answer from it whenever the question is about the video or its subject, using its own terms, " +
  "numbers and examples. Each line carries a [m:ss] label, the moment in the video: whenever your answer comes from " +
  "the video, ALWAYS say when, in passing (\"around 12:40 in the video…\"), so the student can go and watch it; never " +
  "read a bracketed label aloud as it is written. When the question goes beyond the video, answer fully from what you know and say so lightly (\"the " +
  "video doesn't go into this, but…\"). Never refuse because the video is silent on something.";

export function isVideoSource(document: unknown): boolean {
  const source = (document as { source?: unknown } | null)?.source;
  return Boolean(source && typeof source === "object" && (source as Record<string, unknown>).adapter === VIDEO_ADAPTER);
}

/** The clips a video of this length is read in. The last one may be short. */
export function planVideoWindows(durationSec: number, windowSec = VIDEO_WINDOW_SEC): Array<{ startSec: number; endSec: number }> {
  const total = Math.max(0, Math.floor(durationSec));
  const windows: Array<{ startSec: number; endSec: number }> = [];
  for (let startSec = 0; startSec < total; startSec += windowSec) {
    windows.push({ startSec, endSec: Math.min(total, startSec + windowSec) });
  }
  return windows;
}

/**
 * The whole video as text, for the chat and the voice tutor: every spoken segment and everything
 * shown on screen, in time order, each line labelled with its moment.
 *
 * The labels are worth their characters for the same reason a document's `[page N]` labels are
 * (lib/lessonChatContext.ts): they let an answer say "at 12:40 he defines…", which the student can
 * check against the video.
 */
export function buildVideoTranscriptText(title: string, windows: VideoWindow[]): string {
  return transcriptTextFromEntries(title, transcriptEntries(windows));
}

function transcriptTextFromEntries(title: string, entries: Array<[number, string]>): string {
  const lines = entries.map(([at, text]) => `[${formatTimestamp(at)}] ${text}`);
  if (lines.length === 0) return "";
  return [`${TRANSCRIPT_OPENING}${clean(title) || "this video"}". [m:ss] labels are the moment in the video.`, ...lines].join("\n");
}

/**
 * The chat's transcript, rebuilt from a saved source document.
 *
 * A lecture opened from history used to come back with its slides and nothing else, so its chat had
 * no video to answer from (reported 2026-10-03). The source document now travels with the saved
 * lecture, and it carries every line of the transcript (`source.transcript`), so the same text the
 * live lesson's chat had is rebuilt here. "" for a document saved before the transcript was kept.
 */
export function videoTranscriptFromDocument(document: unknown): string {
  const doc = document as { source?: { transcript?: unknown }; lesson?: { title?: string } } | null;
  const entries = (Array.isArray(doc?.source?.transcript) ? doc.source.transcript : [])
    .filter((entry): entry is [number, string] => Array.isArray(entry) && typeof entry[0] === "number" && typeof entry[1] === "string");
  return transcriptTextFromEntries(clean(doc?.lesson?.title), entries);
}

/** The part of the transcript text between two moments — what one chapter's notes are written from. */
/**
 * Everything said and shown, in time order, as [seconds, text]. What was on screen is marked as such
 * and comes before what was said at the same moment. One list serves the chat's transcript, the
 * strict check's vocabulary (videoTranscriptStretch), and the copy saved with the lecture.
 */
function transcriptEntries(windows: VideoWindow[]): Array<[number, string]> {
  return windows
    .flatMap((window) => [
      ...window.segments.map((segment) => ({ at: segment.startSec, order: 1, text: clean(segment.text) })),
      ...window.onScreen.map((shown) => ({ at: shown.startSec, order: 0, text: clean(shown.content) ? `(on screen, ${clean(shown.kind) || "text"}) ${clean(shown.content)}` : "" })),
    ])
    .filter((line) => line.text)
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((line): [number, string] => [line.at, line.text]);
}

/**
 * WHAT THE VIDEO SAID OVER THE STRETCH A BOARD TEACHES — for checking the board, never for writing it.
 *
 * A strict board's grounding check deletes every sentence whose content words its source does not
 * use. For a document the source is the page's own text, which is right. For a video the board's
 * blocks are KEY POINTS: a condensation, one sentence per idea. Checked against those alone, the
 * gate deleted the explaining a lecture needs ("this means each neuron can represent a value in that
 * range") although the speaker had said those very words, and on the opening boards — which delete
 * rather than rewrite — it took key points with it: one board shipped 7 of its 10 (measured
 * 2026-10-03). The source of a video lesson is the video, so the check is widened to everything said
 * and shown over the board's stretch of it. Outside content is still deleted; the speaker's own
 * words no longer are. The script writer still sees only the key points.
 */
export function videoTranscriptStretch(document: unknown, sourceBlockIds: string[] | undefined): string {
  const doc = document as { source?: { transcript?: unknown }; contentBlocks?: Array<{ id: string; startSec?: number; endSec?: number }> } | null;
  const entries = Array.isArray(doc?.source?.transcript) ? doc.source.transcript as Array<[number, string]> : [];
  const wanted = new Set(sourceBlockIds ?? []);
  const own = (doc?.contentBlocks ?? []).filter((block) => wanted.has(block.id));
  const starts = own.map((block) => block.startSec).filter((value): value is number => typeof value === "number");
  const ends = own.map((block) => block.endSec).filter((value): value is number => typeof value === "number");
  if (!entries.length || !starts.length || !ends.length) return "";
  const from = Math.min(...starts);
  const until = Math.max(...ends);
  return entries
    .filter((entry) => Array.isArray(entry) && entry[0] >= from && entry[0] < until && typeof entry[1] === "string")
    .map((entry) => entry[1])
    .join(" ");
}

export function windowsBetween(windows: VideoWindow[], startSec: number, endSec: number): { segments: VideoSegment[]; onScreen: VideoOnScreen[] } {
  const inRange = (at: number) => at >= startSec && at < endSec;
  return {
    segments: windows.flatMap((window) => window.segments).filter((segment) => inRange(segment.startSec)).sort((a, b) => a.startSec - b.startSec),
    onScreen: windows.flatMap((window) => window.onScreen).filter((shown) => inRange(shown.startSec)).sort((a, b) => a.startSec - b.startSec),
  };
}

type PlannedVideoBeat = {
  id: string;
  title: string;
  objective: string;
  sourceBlockIds: string[];
  visualMode: string;
  startSec: number;
  endSec: number;
};

export type VideoBuildInput = {
  videoId: string;
  url: string;
  title: string;
  durationSec: number;
  chapters: VideoChapterNotes[];
  windows: VideoWindow[];
};

export type VideoBuildResult = {
  document: SuprnotesLessonInput;
  title: string;
  fullDocumentText: string;
  blockCount: number;
  beatCount: number;
  pointCount: number;
  noteWords: number;
};

/** Sentences packed into runs that fit one block and one board, never splitting a sentence. */
function packSentences(sentences: string[]): string[] {
  const runs: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const tooLong = current.length + 1 + sentence.length > MAX_BLOCK_CHARS;
    const tooManyWords = wordCount(current) + wordCount(sentence) > MAX_BEAT_NOTE_WORDS;
    if (current && (tooLong || tooManyWords)) {
      runs.push(current);
      current = "";
    }
    // A single sentence longer than a block is cut rather than dropped: the cut loses its tail, a drop loses it all.
    current = current ? `${current} ${sentence}` : sentence.slice(0, MAX_BLOCK_CHARS);
  }
  if (current) runs.push(current);
  return runs;
}

export function buildLessonInputFromVideo(input: VideoBuildInput): VideoBuildResult {
  const title = clean(input.title) || "YouTube video";
  const contentBlocks: SuprnotesContentBlock[] = [];
  const beats: PlannedVideoBeat[] = [];
  const usedTitles = new Set<string>();
  let pointCount = 0;
  let noteWords = 0;

  /*
   * Titles must be unique: the planner maps a board back to its source blocks by title
   * (progressivePlan.ts sourceDocumentPlan `provenance`), so two beats sharing one would both be
   * handed the first one's blocks and the second's content would never be taught.
   */
  const uniqueTitle = (wanted: string): string => {
    const base = clean(wanted) || title;
    let candidate = base;
    for (let part = 2; usedTitles.has(candidate.toLowerCase()); part++) candidate = `${base} (part ${part})`;
    usedTitles.add(candidate.toLowerCase());
    return candidate;
  };

  input.chapters.forEach((notes, chapterIndex) => {
    /*
     * Each block is a run of one section's key points that fits one board. A long section therefore
     * becomes several blocks, and several boards, rather than one board that has to rush.
     */
    type Unit = { heading: string; id: string; words: number; opening: string };
    const units: Unit[] = [];
    notes.sections.forEach((section, sectionIndex) => {
      const points = section.points.map((point) => clean(point.text)).filter(Boolean).map(asSentence);
      if (points.length === 0) return;
      pointCount += points.length;
      const heading = clean(section.heading) || clean(notes.chapter.title) || title;
      const startSec = section.points.find((point) => typeof point.startSec === "number")?.startSec ?? notes.chapter.startSec;
      packSentences(points).forEach((text, runIndex) => {
        const id = `v${chapterIndex + 1}-s${sectionIndex + 1}-b${runIndex + 1}`;
        const words = wordCount(text);
        noteWords += words;
        contentBlocks.push({ id, type: "section", heading, text, sourceOrder: contentBlocks.length + 1, startSec, endSec: notes.chapter.endSec });
        units.push({ heading, id, words, opening: text });
      });
    });

    /*
     * One board per chapter where the chapter fits; otherwise consecutive blocks share a board up
     * to the note budget. Blocks never move between chapters and never change order: the video's
     * own order is the lecture's order.
     */
    const groups: Unit[][] = [];
    const wordsIn = (group: Unit[]) => group.reduce((n, unit) => n + unit.words, 0);
    for (const unit of units) {
      const current = groups[groups.length - 1];
      if (current && wordsIn(current) + unit.words <= MAX_BEAT_NOTE_WORDS) current.push(unit);
      else groups.push([unit]);
    }
    /*
     * A chapter that runs a sentence or two past one board does not get a second board for them.
     * Greedy packing left "Column Picture in 3D (part 2)" holding 18 words of notes — a board on
     * screen for ten seconds, with its own title card and its own animation (measured 2026-10-03).
     * The remainder joins the board before it; the script budget has the room (lib/lectureDepth.ts).
     */
    const last = groups[groups.length - 1];
    if (groups.length > 1 && wordsIn(last) < MIN_BEAT_NOTE_WORDS) groups[groups.length - 2].push(...groups.pop()!);

    for (const group of groups) {
      const wholeChapter = groups.length === 1;
      beats.push({
        id: `video-beat-${beats.length + 1}`,
        title: uniqueTitle(wholeChapter ? notes.chapter.title || group[0].heading : group[0].heading),
        objective: group[0].opening.slice(0, 260),
        sourceBlockIds: group.map((unit) => unit.id),
        // Every board of a video lecture is drawn by the animation engine (progressivePlan.ts sourceVisualKind).
        visualMode: "react-animation",
        startSec: notes.chapter.startSec,
        endSec: notes.chapter.endSec,
      });
    }
  });

  const fullDocumentText = buildVideoTranscriptText(title, input.windows);
  const document: SuprnotesLessonInput = {
    schemaVersion: "suprnotes.lesson_input.v1",
    source: {
      adapter: VIDEO_ADAPTER,
      generatedAt: new Date().toISOString(),
      videoId: input.videoId,
      url: input.url,
      durationSec: Math.round(input.durationSec),
      leftOut: input.chapters.flatMap((notes) => notes.leftOut.map((item) => `${formatTimestamp(notes.chapter.startSec)} ${clean(item)}`)).filter(Boolean),
      // What the video said and showed, as [seconds, text]: the strict check's vocabulary (videoTranscriptStretch).
      transcript: transcriptEntries(input.windows),
    },
    lesson: {
      title,
      subject: title,
      language: "en",
      // ~150 spoken words a minute, plus a sentence of framing per board.
      estimatedTeachingMinutes: Math.max(1, Math.round((noteWords * VIDEO_SCRIPT_WORDS_PER_NOTE_WORD + beats.length * 30) / 150)),
    },
    generationDirectives: {
      imagePolicy: "no_source_images",
      disableAiImageGeneration: true,
      preferredLectureStyle: "brief_of_video",
      preserveExistingLecturePrompting: true,
    },
    contentGovernance: {
      groundingPolicy: "prefer_provided_content",
      hallucinationPolicy: "hedge_when_unsupported",
      requireClaimSourceTags: false,
    },
    assets: [],
    contentBlocks,
    lessonPlan: {
      sourceType: "youtube_video",
      strategy: "video_order_complete_coverage",
      targetBeatCount: beats.length,
      requireCompleteCoverage: true,
      contentBlockIds: contentBlocks.map((block) => block.id),
      beats,
    },
    webPreview: { status: "not_requested" },
  };

  return { document, title, fullDocumentText, blockCount: contentBlocks.length, beatCount: beats.length, pointCount, noteWords };
}
