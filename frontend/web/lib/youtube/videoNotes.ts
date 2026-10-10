import { formatTimestamp, parseTimestamp } from "./videoUrl";
import type { VideoChapter, VideoChapterNotes, VideoKeyPoint, VideoNoteSection, VideoOnScreen, VideoSegment } from "./videoSource";

/**
 * From a video's transcript to the key points a short lecture must teach.
 *
 * TWO STEPS, EACH OVER A SMALL INPUT. A model handed an hour of transcript and asked for "the key
 * points" returns the opening and the ending and loses the middle — the position bias is in the
 * model, not in the prompt. So the video is first cut into chapters (one call, which only has to
 * find boundaries), and each chapter's points are then written from that chapter alone.
 *
 * AND A SECOND LOOK. The first pass over a chapter is followed by one that is shown the chapter and
 * the points and asked only for what is missing. Extraction calls stop early; asking "what did you
 * miss?" is what recovers the tail.
 *
 * This file is the prompts and the parsing, with no model client in it, so it can be tested. The
 * calls themselves are in app/api/youtube/.
 */

/** Past this a chapter is split: its notes would outgrow one call's attention, not its context. */
const MAX_CHAPTER_SEC = 12 * 60;
/**
 * Below this a "chapter" joins its neighbour. Each chapter becomes at least one board, and a board
 * built from ninety seconds of video is three sentences long.
 */
const MIN_CHAPTER_SEC = 150;
/**
 * HOW FINE A "POINT" IS — the one number that decides how short the lecture is.
 *
 * Measured on a dense 19-minute video (2026-10-03): asked for "every teaching point" with no sense
 * of scale, the notes came back as 102 points — one for every eleven seconds, 60% of the speech.
 * Taught at that grain the "short" lecture runs as long as the video. A point is therefore an IDEA
 * with its essential detail carried inside the sentence, and a chapter is given a count to aim at:
 * one point per this many spoken words, about two a minute. A quarter to a third of the video's
 * length is what that produces. It is a target for the grain, never a cap on the ideas: the prompt
 * lets a chapter that teaches more go over, and the second look adds any idea that was left out.
 */
const SPOKEN_WORDS_PER_POINT = 80;

/** How many points a chapter of this much speech is expected to come to. */
export function targetPointCount(segments: VideoSegment[]): number {
  const words = segments.reduce((n, segment) => n + segment.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.max(3, Math.round(words / SPOKEN_WORDS_PER_POINT));
}

const clean = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

export function transcriptLines(segments: VideoSegment[]): string {
  return segments.map((segment) => `[${formatTimestamp(segment.startSec)}] ${clean(segment.text)}`).join("\n");
}

function onScreenLines(onScreen: VideoOnScreen[]): string {
  return onScreen.map((shown) => `[${formatTimestamp(shown.startSec)}] (${clean(shown.kind) || "text"}) ${clean(shown.content)}`).join("\n");
}

/** A transcript arriving at a route, without trusting arbitrary client JSON. */
export function sanitizeSegments(value: unknown, limit: number): VideoSegment[] {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({ startSec: Math.max(0, Math.floor(Number(item.startSec) || 0)), text: typeof item.text === "string" ? item.text.trim().slice(0, 4_000) : "" }))
    .filter((segment) => segment.text)
    .slice(0, limit);
}

export function sanitizeOnScreen(value: unknown, limit: number): VideoOnScreen[] {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      startSec: Math.max(0, Math.floor(Number(item.startSec) || 0)),
      kind: typeof item.kind === "string" ? item.kind.trim().slice(0, 40) : "text",
      content: typeof item.content === "string" ? item.content.trim().slice(0, 2_000) : "",
    }))
    .filter((shown) => shown.content)
    .slice(0, limit);
}

/* ── Chapters ─────────────────────────────────────────────────────────────── */

export const CHAPTERS_SYSTEM_PROMPT = `You divide the transcript of a lecture video into chapters, for a tutor who will re-teach the video chapter by chapter.

Return JSON only: {"title":"...","chapters":[{"start":"M:SS","title":"..."}]}

- A chapter is one topic the video teaches. Most chapters run 4 to 8 minutes and none is shorter than 3: a short aside, an intro or a sign-off belongs to the chapter next to it. Start a new chapter only where the subject really changes.
- The chapters cover the whole video in order. The first starts at 0:00. "start" is a timestamp copied from the transcript's own [m:ss] labels.
- A chapter title names its topic in 2 to 5 words ("Gradient descent", "Why ReLU replaced sigmoid"). Never more than 5: a longer title is cut off on the board. Never "Introduction", "Part 2", "Conclusion" or "Summary" on their own: name what that stretch is about.
- "title" is the subject of the whole video as a short lesson title. If the video's own title is given, clean it rather than replace it: drop channel names, episode numbers and clickbait.`;

export function chaptersUserMessage(videoTitle: string, segments: VideoSegment[]): string {
  return `${videoTitle ? `The video's own title: "${clean(videoTitle)}".\n\n` : ""}Transcript:\n${transcriptLines(segments)}`;
}

/** Equal chapters of about six minutes, for a transcript the chapter call could not divide. */
export function fallbackChapters(durationSec: number): VideoChapter[] {
  const total = Math.max(1, Math.floor(durationSec));
  const count = Math.max(1, Math.round(total / 360));
  const length = total / count;
  return Array.from({ length: count }, (_, index) => ({
    title: `Part ${index + 1}`,
    startSec: Math.round(index * length),
    endSec: index === count - 1 ? total : Math.round((index + 1) * length),
  }));
}

/**
 * The model's chapters, made safe to build on: in order, covering 0 to the end with no gaps,
 * fragments joined to a neighbour, and anything too long for one notes call split.
 */
export function parseChapters(raw: unknown, durationSec: number): { title: string; chapters: VideoChapter[] } {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const total = Math.max(1, Math.floor(durationSec));
  const starts = (Array.isArray(record.chapters) ? record.chapters : [])
    .map((item) => {
      const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return { startSec: parseTimestamp(entry.start), title: clean(entry.title) };
    })
    .filter((entry): entry is { startSec: number; title: string } => entry.startSec !== null && entry.startSec < total && Boolean(entry.title))
    .sort((a, b) => a.startSec - b.startSec);
  if (starts.length === 0) return { title: clean(record.title), chapters: fallbackChapters(total) };
  starts[0].startSec = 0;

  const joined: Array<{ startSec: number; title: string }> = [];
  for (const entry of starts) {
    const previous = joined[joined.length - 1];
    if (previous && entry.startSec - previous.startSec < MIN_CHAPTER_SEC) continue;
    joined.push(entry);
  }
  // A closing fragment (the sign-off) belongs to the chapter before it.
  if (joined.length > 1 && total - joined[joined.length - 1].startSec < MIN_CHAPTER_SEC) joined.pop();

  const chapters: VideoChapter[] = [];
  joined.forEach((entry, index) => {
    const endSec = joined[index + 1]?.startSec ?? total;
    const parts = Math.max(1, Math.ceil((endSec - entry.startSec) / MAX_CHAPTER_SEC));
    const length = (endSec - entry.startSec) / parts;
    for (let part = 0; part < parts; part++) {
      chapters.push({
        title: entry.title,
        startSec: Math.round(entry.startSec + part * length),
        endSec: part === parts - 1 ? endSec : Math.round(entry.startSec + (part + 1) * length),
      });
    }
  });
  return { title: clean(record.title), chapters };
}

/* ── Key points ───────────────────────────────────────────────────────────── */

const POINT_DEFINITION = `A point is one self-contained sentence, at most 30 words, stating one IDEA the chapter teaches: a definition, a claim, a formula, a step of a method or derivation, a cause, a comparison, an example and what it shows, a warning about a mistake. The detail that makes the idea exact (the number, the name, the condition) goes inside the same sentence, not in a point of its own. State the content itself ("A neuron holds a number between 0 and 1, called its activation"), never a report of the video ("the speaker explains activations", "the video aims to show what a network is", "learning is covered in the next video"): the video, the speaker and other videos are never the subject of a point. Use the chapter's own terms, names, numbers and examples exactly. An equation is said in words first, then written.

A WORKED EXAMPLE is the one exception to the 30 words: one point of up to 60 words that keeps the example's own data, so a tutor can show it on a board: what it starts from (the numbers, the tree, the values), the steps in the order they were done, briefly, and the result ("Example: a ball dropped from 20 m, with g taken as 10 m/s², falls for 2 s by h = ½gt², and lands at 20 m/s by v = gt"). Only the chapter's own data, never numbers of your own.`;

export const NOTES_SYSTEM_PROMPT = `You turn one chapter of a lecture video into the complete set of its teaching points, for a tutor who will re-teach the chapter in less time to a student who has not watched it.

Return JSON only: {"sections":[{"heading":"...","points":[{"t":"M:SS","text":"..."}]}],"leftOut":["..."]}

WHAT A POINT IS. ${POINT_DEFINITION}

KEEP EVERY IDEA. Every distinct idea the chapter teaches gets a point; do not pick highlights, and do not drop an idea because it is small. The lecture gets shorter in two ways only. First, through what is not teaching at all: greetings, housekeeping, sponsor reads, requests to subscribe, previews of other videos, jokes, false starts, filler. Second, through condensing: when the chapter spends several sentences building one idea, or says it twice, or walks through an example step by step, write the idea once with its essential detail, and the example as one worked-example point that keeps its data (start, steps, result). Never reduce a worked example to the rule it illustrates: "a falling object speeds up by g every second" is the rule; the ball dropped from 20 m, its 2 s and its 20 m/s are the example, and both are kept.

HOW MANY. The user message gives the number of points a chapter of this length usually comes to. Treat it as the grain to write at, not a limit: a chapter that teaches more distinct ideas gets more points (up to half as many again), and a thin one gets fewer. Never pad, and never merge two different ideas to hit the number.

WHAT WAS SHOWN. The chapter comes with notes of what was on screen. A slide's text, an equation, code or a diagram that carries content the speech did not fully say is a teaching point too. State what it conveys in words: an equation written out, a diagram as what its parts are and how they connect, with its actual labels and values (the numbers in a tree's nodes, not just "a tree"), and a path traced on it in the order it was traced. Ignore decoration, logos, and anything that teaches nothing.

ORDER AND GROUPING. Keep the chapter's order. Group the points under 1 to 4 headings; a heading is a topic name of 2 to 6 words, not a sentence. A diagram, a worked example or anything shown on screen goes under the heading of the idea it illustrates, beside that idea's points: never a heading of its own such as "Diagrams and Examples", "Examples" or "Visuals". "t" is the moment the point is made, copied from the [m:ss] labels.

ADD NOTHING. Every point must be something this chapter says or shows. No outside facts, no examples of your own, no conclusion the chapter does not draw.

"leftOut": one short phrase for each thing you deliberately did not keep ("sponsor read", "recap of the previous video"). Empty when nothing was dropped.`;

export const GLEAN_SYSTEM_PROMPT = `You check a tutor's notes of one chapter of a lecture video against the chapter itself. The notes are meant to hold EVERY teaching point of the chapter.

Return JSON only: {"missing":[{"heading":"...","t":"M:SS","text":"..."}]}

The notes are condensed on purpose: several sentences of the chapter become one point. So "missing" means an idea, definition, formula, step, example or warning of the chapter that the notes do not mention AT ALL. List each of those. ${POINT_DEFINITION}

- Something the notes already say in other words is not missing.
- A detail that only elaborates an idea the notes already have is not missing.
- A worked example IS missing when the notes keep only the rule it illustrates and lose its data (what it started from, its steps, its result). Add it as one worked-example point.
- Greetings, housekeeping, sponsor reads, jokes, filler and repetition are not teaching points.
- "heading" is the existing heading the point belongs under, copied exactly, or a new 2 to 6 word topic name if none fits.
- Add nothing the chapter does not say or show.

Return {"missing":[]} when the notes are complete.`;

export type NotesRequest = {
  videoTitle: string;
  chapter: VideoChapter;
  segments: VideoSegment[];
  onScreen: VideoOnScreen[];
};

function chapterBody(request: NotesRequest): string {
  const shown = onScreenLines(request.onScreen);
  return [
    `Video: "${clean(request.videoTitle) || "untitled"}". Chapter: "${clean(request.chapter.title)}" (${formatTimestamp(request.chapter.startSec)} to ${formatTimestamp(request.chapter.endSec)}). A chapter of this length usually comes to about ${targetPointCount(request.segments)} points.`,
    `WHAT WAS SAID:\n${transcriptLines(request.segments) || "(no speech in this chapter)"}`,
    shown ? `WHAT WAS ON SCREEN:\n${shown}` : "",
  ].filter(Boolean).join("\n\n");
}

export function notesUserMessage(request: NotesRequest): string {
  return chapterBody(request);
}

export function gleanUserMessage(request: NotesRequest, sections: VideoNoteSection[]): string {
  const notes = sections
    .map((section) => `${section.heading}\n${section.points.map((point) => `- ${point.text}`).join("\n")}`)
    .join("\n\n");
  return `${chapterBody(request)}\n\nTHE TUTOR'S NOTES OF THIS CHAPTER:\n${notes || "(empty)"}`;
}

/**
 * A "point" that is about the video rather than its subject: "The video aims to explain neural
 * networks…", "Learning is covered in the next video". The prompt forbids them and a model writes
 * them anyway. They are not content, and they cannot be taught either — the script writer is told
 * never to mention the video, so each one came back from the coverage gate as a point the lecture
 * "missed" (measured 2026-10-03). Dropped here, where a key point becomes a key point.
 */
// "the video aims to…", "this lecture covers…": the video as the subject of the sentence.
const VIDEO_AS_SUBJECT = /\b(?:the|this) (?:video|episode|lecture|talk) (?:aims|explains?|covers?|shows?|will|is about|focus(?:es)?|introduces?|discusses|describes|uses|assumes|ends|begins|starts)\b/i;
// "the next video", "a later episode": other videos.
const OTHER_VIDEOS = /\b(?:next|previous|last|future|upcoming|another|earlier|later|separate) (?:video|episode)s?\b/i;
const ABOUT_THE_VIDEO = { test: (text: string) => VIDEO_AS_SUBJECT.test(text) || OTHER_VIDEOS.test(text) };

function parsePoint(item: unknown, chapter: VideoChapter): VideoKeyPoint | null {
  const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const text = clean(typeof item === "string" ? item : entry.text);
  if (!text || ABOUT_THE_VIDEO.test(text)) return null;
  const at = parseTimestamp(entry.t);
  // A timestamp outside the chapter is the model's slip, not information.
  return at !== null && at >= chapter.startSec - 5 && at <= chapter.endSec + 5 ? { text, startSec: at } : { text };
}

/**
 * A section's points in the order the video made them. A point with no timestamp stays beside the
 * point it was written after, so only what can be placed is moved.
 */
function inTimeOrder(section: VideoNoteSection): VideoNoteSection {
  let last = 0;
  const keyed = section.points.map((point, index) => {
    last = point.startSec ?? last;
    return { point, at: last, index };
  });
  return { heading: section.heading, points: keyed.sort((a, b) => a.at - b.at || a.index - b.index).map((entry) => entry.point) };
}

export function parseNotes(raw: unknown, chapter: VideoChapter): VideoChapterNotes {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const sections: VideoNoteSection[] = (Array.isArray(record.sections) ? record.sections : [])
    .map((item) => {
      const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const points = (Array.isArray(entry.points) ? entry.points : [])
        .map((point) => parsePoint(point, chapter))
        .filter((point): point is VideoKeyPoint => point !== null);
      return { heading: clean(entry.heading) || chapter.title, points };
    })
    .filter((section) => section.points.length > 0);
  const leftOut = (Array.isArray(record.leftOut) ? record.leftOut : []).map(clean).filter(Boolean).slice(0, 20);
  return { chapter, sections, leftOut };
}

/**
 * The second look's findings, added to the notes. Each goes under the heading it names, in time
 * order where it carries a timestamp, so the chapter's order survives; a point the notes already
 * hold word for word is not added twice.
 */
export function mergeGleaned(notes: VideoChapterNotes, raw: unknown): { notes: VideoChapterNotes; added: number } {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const sections = notes.sections.map((section) => ({ heading: section.heading, points: [...section.points] }));
  const have = new Set(sections.flatMap((section) => section.points.map((point) => point.text.toLowerCase())));
  let added = 0;
  for (const item of Array.isArray(record.missing) ? record.missing : []) {
    const point = parsePoint(item, notes.chapter);
    if (!point || have.has(point.text.toLowerCase())) continue;
    have.add(point.text.toLowerCase());
    const heading = clean((item as Record<string, unknown> | null)?.heading);
    let section = sections.find((candidate) => candidate.heading.toLowerCase() === heading.toLowerCase());
    if (!section) {
      section = { heading: heading || notes.chapter.title, points: [] };
      sections.push(section);
    }
    section.points.push(point);
    added++;
  }
  return { notes: { ...notes, sections: sections.map(inTimeOrder) }, added };
}

/* ── What was shown, kept ─────────────────────────────────────────────────── */

const NUMBER = /\d+(?:\.\d+)?/g;
const numbersIn = (text: string): string[] => text.match(NUMBER) ?? [];

/** Does `run` appear, in order and unbroken, in `numbers`? */
function containsRun(numbers: string[], run: string[]): boolean {
  for (let i = 0; i + run.length <= numbers.length; i++) {
    if (run.every((n, j) => numbers[i + j] === n)) return true;
  }
  return false;
}

/** The section whose timed points sit nearest `at`; the last section when none is timed. */
function nearestSection(sections: VideoNoteSection[], at: number): VideoNoteSection | undefined {
  let best: VideoNoteSection | undefined;
  let bestGap = Infinity;
  for (const section of sections) {
    for (const point of section.points) {
      if (point.startSec === undefined) continue;
      const gap = Math.abs(point.startSec - at);
      if (gap < bestGap) {
        best = section;
        bestGap = gap;
      }
    }
  }
  return best ?? sections[sections.length - 1];
}

/** At most this many on-screen items are put back into one chapter's notes. */
const MAX_SHOWN_KEPT = 6;

/**
 * WHAT THE VIDEO SHOWED, KEPT. A worked example lives on screen — the tree the teacher drew, the
 * array the trace produced ("1 2 3 4 5 6 7") — and the notes model, asked to condense, keeps the rule
 * and drops the example even when told not to (measured 2026-10-10: the same chapter kept it on one
 * run and lost it on the next). A strict lecture may then teach only the rule, with nothing to show.
 *
 * So, after the notes are written: an on-screen item that carries data (two or more numbers, or any
 * number in an equation or code) whose numbers no single point states in the same order is put back
 * as a point at its own moment, under the section nearest it in time. In the same ORDER, not merely
 * somewhere: the construction steps of that BST name every key from 1 to 7, and a check on the set
 * of numbers took the traversal's "1 2 3 4 5 6 7" as already said. Deterministic, and never more
 * than MAX_SHOWN_KEPT per chapter.
 */
export function keepShownData(notes: VideoChapterNotes, onScreen: VideoOnScreen[]): { notes: VideoChapterNotes; added: number } {
  const sections = notes.sections.map((section) => ({ heading: section.heading, points: [...section.points] }));
  const pointNumbers = sections.flatMap((section) => section.points.map((point) => numbersIn(point.text)));
  const have = new Set(sections.flatMap((section) => section.points.map((point) => point.text.toLowerCase())));
  const { startSec, endSec, title } = notes.chapter;
  let added = 0;
  for (const shown of [...onScreen].sort((a, b) => a.startSec - b.startSec)) {
    if (added >= MAX_SHOWN_KEPT) break;
    if (shown.startSec < startSec - 5 || shown.startSec > endSec + 5) continue;
    const content = clean(shown.content);
    const numbers = numbersIn(content);
    const formal = /^(?:equation|code)$/i.test(clean(shown.kind));
    if (numbers.length < (formal ? 1 : 2)) continue;
    if (pointNumbers.some((said) => containsRun(said, numbers))) continue;
    if (sections.length === 0) sections.push({ heading: title, points: [] });
    const section = nearestSection(sections, shown.startSec)!;
    // A bare line of text ("1 2 3 4 5 6 7") is named by its topic so it reads as content.
    const text = /^text$/i.test(clean(shown.kind)) ? `${section.heading}: ${content}` : content;
    if (have.has(text.toLowerCase())) continue;
    have.add(text.toLowerCase());
    pointNumbers.push(numbersIn(text));
    section.points.push({ text, startSec: shown.startSec });
    added++;
  }
  return { notes: { ...notes, sections: added ? sections.map(inTimeOrder) : notes.sections }, added };
}

/** "Examples and Diagrams", "Diagrams", "Visuals": a heading that names a kind of material, not a topic. */
const VISUAL_HEADING = /^(?:(?:worked\s+)?examples?|diagrams?|visuals?|illustrations?|figures?)(?:\s*(?:and|&|,)\s*(?:(?:worked\s+)?examples?|diagrams?|visuals?|illustrations?|figures?))*$/i;

/**
 * A section of "Examples and Diagrams" is the examples cut off from the ideas they show: it becomes a
 * board of its own with nothing to explain. Each of its points moves to the topic section nearest it
 * in time (an untimed one to the section before it); with no topic section, the notes stay as they are.
 */
export function foldVisualSections(notes: VideoChapterNotes): VideoChapterNotes {
  const topics = notes.sections.filter((section) => !VISUAL_HEADING.test(section.heading.trim()));
  if (topics.length === 0 || topics.length === notes.sections.length) return notes;
  const sections = topics.map((section) => ({ heading: section.heading, points: [...section.points] }));
  let previous = sections[0];
  for (const section of notes.sections) {
    const own = sections.find((candidate) => candidate.heading === section.heading);
    if (own) {
      previous = own;
      continue;
    }
    for (const point of section.points) {
      const target = point.startSec === undefined ? previous : nearestSection(topics, point.startSec);
      const into = sections.find((candidate) => candidate.heading === target?.heading) ?? previous;
      into.points.push(point);
    }
  }
  return { ...notes, sections: sections.map(inTimeOrder) };
}
