/**
 * Readable titles from a document's own text — for REFERENCE-mode lessons only.
 *
 * Pure and dependency-free so both the planning page (client) and the plan builder (server) can use
 * it. Strict mode never goes through here: its titles are the parser's, unchanged.
 */

const clean = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/*
 * REFERENCE-MODE SECTION TITLES.
 *
 * A section is titled at parse time by the first SENTENCE of its text (lib/pdfLessonPipeline.ts), and
 * every full stop ends a sentence — so a cover slide reading "ACTUATORS Dr. Ahmed Khan" was cut after
 * "Dr." and taught as "ACTUATORS DR". The parser also serves strict mode, whose titles must not
 * change, so reference mode cleans its own titles here instead.
 */
const HONORIFIC_TAIL = /\s+(?:dr|prof|mr|mrs|ms|engr|sir)\.?$/i;
/** "— Dr. Ahmed Khan" at the end: the name words must be capitalised, so "Sir Isaac's laws" is not a byline. */
const BYLINE_TAIL = /\s*(?:[-–—|,]\s*)?(?:[Bb]y\s+)?(?:DR|Dr|dr|PROF|Prof|MR|Mr|MRS|Mrs|MS|Ms|ENGR|Engr|SIR|Sir)\.?\s+[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3}$/;
/** Replacement characters and box glyphs a PDF's text layer leaves where a bullet or symbol was. */
export const BROKEN_GLYPHS = /[�■□▪▫▯☐\u0000-\u001F\u007F]/g;
/** Words kept lower-case when an ALL-CAPS title is re-cased. */
const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs"]);

/** A section title a student can read: no stray glyphs, no lecturer's name, not shouted. */
export function referenceSectionTitle(raw: string): string {
  let title = clean(raw).replace(BROKEN_GLYPHS, " ").replace(/\s+/g, " ").trim();
  // "CONTENTS ▯ What Is an Actuator?" — the listing's label is not part of the topic.
  title = title.replace(/^(?:table\s+of\s+)?contents\b\s*[:\-–—|]?\s*(?=\S)/i, "");
  title = title.replace(BYLINE_TAIL, "").replace(HONORIFIC_TAIL, "").replace(/[\s.:;,\-–—|]+$/, "").trim();
  const letters = title.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) {
    title = title
      .split(" ")
      .map((word, index) => {
        const bare = word.replace(/[^A-Za-z]/g, "").toLowerCase();
        if (index > 0 && MINOR_WORDS.has(bare)) return word.toLowerCase();
        // Short all-caps words are acronyms — DC, LED, PWM — and keep their capitals.
        if (bare.length <= 3 && !MINOR_WORDS.has(bare)) return word;
        return word.charAt(0) + word.slice(1).toLowerCase();
      })
      .join(" ");
  }
  return title || clean(raw);
}

/** A title is a handful of words with real letters in it — not a sentence, not a page number. */
/**
 * A label a PARSER made up, not a title a person wrote: "Slide 1" (parse-pptx, for a slide with no
 * title placeholder), "Page 3" / "Pages 2-4" / "Page 2 (selected area)" (parse-pdf, pdfOcr), or a
 * deck's own "Untitled"/"Title slide". One of these titled a reference lecture "Slide 1", so every
 * planning question was about "Slide 1" instead of the deck.
 */
const PLACEHOLDER_TITLE = /^(?:(?:slides?|pages?|sections?|parts?|chapters?)\s*\d+(?:\s*[-–—]\s*\d+)?(?:\s*\(.*\))?|untitled(?:\s+\w+)?|title\s+slide|\d+)[.:]?$/i;

function usableTitle(title: string): boolean {
  const words = title.split(/\s+/).filter(Boolean).length;
  return /[A-Za-z]{3,}/.test(title) && words > 0 && words <= 10 && !PLACEHOLDER_TITLE.test(title.trim());
}

/**
 * The lecture's title, read off the document's FIRST PAGE.
 *
 * The lecture used to be named after what the student typed, with the pages only as hints — so an
 * actuators PDF opened with the words "camera sensor" became a lecture called "Camera Sensor". The
 * first page is where a document says what it is: its cover or its opening heading.
 *
 * Page-1 blocks in source order, figure labels skipped. A block's own heading wins; otherwise its
 * text up to the first line break, " — " / " | " separator or sentence end, cleaned by
 * referenceSectionTitle — which is what turns the cover's "ACTUATORS Dr. Ahmed Khan, University…"
 * into "Actuators". Empty when page 1 has nothing usable, so the caller can fall back.
 */
export function firstPageTitle(document: unknown): string {
  if (!document || typeof document !== "object") return "";
  const blocks = (document as { contentBlocks?: unknown }).contentBlocks;
  if (!Array.isArray(blocks)) return "";
  const pageOne = blocks
    .filter((block): block is { heading?: unknown; text?: unknown; role?: unknown; pageNumber?: unknown; sourceOrder?: unknown } =>
      Boolean(block) && typeof block === "object")
    .filter((block) => (block.pageNumber ?? 1) === 1 && block.role !== "figure-labels")
    .sort((a, b) => (Number(a.sourceOrder) || 0) - (Number(b.sourceOrder) || 0));
  for (const block of pageOne) {
    const heading = referenceSectionTitle(clean(block.heading));
    if (usableTitle(heading)) return heading;
    /*
     * BODY TEXT IS NOT A TITLE. A scanned textbook page has no heading, only captions and paragraphs,
     * and the first sentence of one became the lesson's name: "How deep do you want to go with The
     * hardest operation is \texttt{remove}" (reported 2026-10-03). With no heading on page 1 the
     * caller names the subject from the document instead.
     */
    if (block.role === "paragraph" || block.role === "caption") continue;
    const raw = typeof block.text === "string" ? block.text : "";
    // The first line that is a title, not a placeholder: a slide exported to PDF, or a pptx text
    // chunk, often starts with "Slide 1" and only then says what the slide is about.
    const lines = raw.split(/\n|\s[-–—|]\s|,\s|(?<=[.!?])\s/);
    for (const line of lines.slice(0, 3)) {
      const title = referenceSectionTitle(line ?? "");
      if (usableTitle(title)) return title;
      if (!PLACEHOLDER_TITLE.test(clean(line))) break;
    }
  }
  return "";
}
