import type { Beat } from "./lessonContent";

/**
 * What the side chat is allowed to know.
 *
 * WHY THIS EXISTS. The panel used to send one thing: the title and script of the beat playing at
 * that instant. So the tutor answering a question knew the sentence in front of it and nothing else
 * — it could not say what was coming next, could not refer back to something it had already taught,
 * and when a student asked about their own uploaded PDF it answered from general knowledge instead
 * of from their document. That last one is the worst of the three, because a confident answer drawn
 * from the wrong source still looks like an answer.
 *
 * EVERYTHING HERE IS CAPPED. A whole lecture plus a parsed paper is far more text than one question
 * needs, and this runs on every question asked mid-lesson — an unbounded prompt is paid for in
 * latency while the student sits waiting with the lecture paused.
 */

/** Roughly a third of a beat's script — enough to know what a beat covers, not to re-teach it. */
const SCRIPT_PREVIEW_CHARS = 260;
/** Beats either side of the current one that get their script rather than just a title. */
const NEARBY_WINDOW = 2;
/** Hard ceilings, mirrored by the endpoint so neither side can be surprised by the other. */
const MAX_LESSON_CHARS = 8000;
/**
 * Raised from 12,000.
 *
 * At 12k a twenty-page paper was truncated to roughly a fifth of itself, so "the chat can see your
 * document" was not true for any document big enough to need saying. 30k carries a realistic paper
 * whole, at a cost of about 7.5k extra input tokens on a question that asks for it.
 */
const MAX_DOCUMENT_CHARS = 30000;

const clean = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * The lecture as an ordered outline, marked with where the student currently is.
 *
 * Nearby beats carry a preview of their script because "what were you just saying?" and "what's
 * next?" are the questions this exists to answer, and a bare title cannot answer either. Distant
 * beats are titles only — enough to say what the lesson covers without pasting the whole thing.
 */
export function buildLessonContext(beats: Beat[], currentIndex: number): string {
  if (!beats.length) return "";

  const lines = beats.map((beat, i) => {
    const marker = i === currentIndex ? " ← PLAYING NOW" : i < currentIndex ? " (already taught)" : " (still to come)";
    const title = clean(beat.title) || `Section ${i + 1}`;
    const near = Math.abs(i - currentIndex) <= NEARBY_WINDOW;
    const body = near ? clean(beat.script).slice(0, SCRIPT_PREVIEW_CHARS) : "";
    return `${i + 1}. ${title}${marker}${body ? `\n   ${body}${beat.script && beat.script.length > SCRIPT_PREVIEW_CHARS ? "…" : ""}` : ""}`;
  });

  return lines.join("\n").slice(0, MAX_LESSON_CHARS);
}

/**
 * The student's uploaded document, flattened to text with its page or slide labels kept.
 *
 * Labels are worth their characters: they let the answer say "on page 4 it defines…", which is the
 * difference between an answer the student can check and one they have to trust.
 *
 * Deliberately shaped like `chunksFrom` in ragRetrieve.ts — PDF content blocks and deck slide text
 * reduce to the same thing — but this is not retrieval. Retrieval picks the few passages a question
 * needs at generation time; this hands the model the document so a live question can be answered
 * from it at all.
 */
export function buildDocumentContext(
  sourceDocument: unknown,
  slideContext = "",
  transcript = "",
  fullDocumentText = "",
): string {
  const doc = sourceDocument as { contentBlocks?: unknown[] } | null;
  const blocks = Array.isArray(doc?.contentBlocks) ? doc.contentBlocks : [];

  /*
   * WHAT WAS READ OFF THE PIXELS GOES FIRST.
   *
   * `contentBlocks` are the text objects the PDF declares, and on a real paper that is frequently
   * only the captions — the formula drawn as vector strokes, the values inside a chart and anything
   * scanned leave no text object behind. So a chat given blocks alone answers a question about a
   * figure from the sentence describing it, which is the exact failure the OCR pass exists to
   * prevent, reappearing in the side panel.
   *
   * First rather than appended, because the cap below truncates the tail: the transcript is the part
   * that cannot be recovered from anywhere else, so it must not be what gets cut.
   */
  const read = clean(transcript).slice(0, MAX_DOCUMENT_CHARS);
  const readSection = read ? `Read directly from the page images (this is content the extracted text below does NOT contain):
${read}` : "";
  // The blank line joining the two sections counts toward the cap as well; without it the result
  // lands two characters over, which is the kind of miss a cap exists to prevent in the first place.
  const room = MAX_DOCUMENT_CHARS - readSection.length - (readSection ? 2 : 0);
  if (room <= 0) return readSection.slice(0, MAX_DOCUMENT_CHARS);

  /*
   * THE WHOLE DOCUMENT WINS OVER THE PARSED BLOCKS.
   *
   * `contentBlocks` only ever contain the pages the student selected — everything else is dropped
   * during parsing, before a source document is built. So a chat given blocks alone cannot answer
   * anything about the rest of the file, and answers from general knowledge instead. This text is a
   * superset of them, so where it exists it replaces them rather than being appended alongside.
   */
  const whole = clean(fullDocumentText).slice(0, room);
  if (whole) return [readSection, whole].filter(Boolean).join("\n\n");

  if (blocks.length > 0) {
    const parts: string[] = [];
    for (const raw of blocks) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as Record<string, unknown>;
      const body = [
        typeof block.heading === "string" ? block.heading : "",
        typeof block.text === "string" ? block.text : "",
        ...(Array.isArray(block.items) ? block.items.filter((x): x is string => typeof x === "string") : []),
        ...(Array.isArray(block.rows)
          ? block.rows.map((row) => (Array.isArray(row) ? row.filter((c): c is string => typeof c === "string").join(" | ") : ""))
          : []),
      ]
        .filter(Boolean)
        .join(" ");
      const text = clean(body);
      if (!text) continue;
      const where = typeof block.pageNumber === "number" ? `[page ${block.pageNumber}]` : "";
      parts.push(`${where} ${text}`.trim());
      // Stop building once the cap is reached rather than assembling megabytes and slicing after.
      if (parts.join("\n").length > room) break;
    }
    const extracted = parts.join("\n").slice(0, room);
    return [readSection, extracted].filter(Boolean).join("\n\n");
  }

  // A deck with no embedded images arrives as slide text rather than a parsed document.
  const slides = clean(slideContext).slice(0, room);
  return [readSection, slides].filter(Boolean).join("\n\n");
}
