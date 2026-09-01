/**
 * Building the prompt that carries a WHOLE document — its text and its pages as pictures.
 *
 * WHAT CHANGED AND WHY. Generation used to receive a trimmed excerpt: the passage retrieval judged
 * relevant, a handful of supporting chunks, and captions standing in for the figures. That is the
 * right shape when a document is too big to send, and it is the wrong shape now that uploads are
 * capped at twenty pages, because everything the student asked about fits. Sending an excerpt when
 * the whole thing fits means the model answers from a summary of the source while the source itself
 * sits unused — and a question about a figure was being answered from the sentence describing it.
 *
 * So the model now gets the document: every page's extracted text, every page's image, and the
 * question. It reads the page the way the student does.
 *
 * WHY THE IMAGES MATTER MORE THAN THE TEXT HERE. A PDF's extracted text is only what it declares.
 * A formula drawn as vector strokes, a chart pasted as a bitmap, a scanned page — none of them
 * leave a text object behind. The page image is the only representation that contains all of it, so
 * it is not an enrichment of the text: for a great deal of real content it IS the content.
 *
 * Everything here is pure string and array work. No client, no key, no network — so the ordering
 * rules, the region emphasis and the page labelling can all be asserted in tests.
 */

export type NormalisedRect = { x: number; y: number; width: number; height: number };

export type ContextPageImage = {
  pageNumber: number;
  dataUrl: string;
};

export type ContextRegionImage = {
  pageNumber: number;
  dataUrl: string;
  rect: NormalisedRect;
};

/** One part of a multimodal user message, in the shape the chat API expects. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" | "low" | "auto" } };

export const FULL_CONTEXT_RULES = {
  /**
   * Ceiling on page images in one call, matching the upload cap so a permitted document always
   * fits whole. Kept as its own constant rather than read from the limit: this is the number the
   * PROMPT can carry, and a future change to one should be a deliberate change to the other.
   */
  MAX_PAGE_IMAGES: 20,
  /**
   * `high` is not a quality preference here, it is the requirement. At `low` the model receives a
   * single 85-token thumbnail of the page, which cannot resolve body text, axis labels or
   * subscripts — the exact content the image was attached to convey. A page at `high` is roughly
   * 765 tokens, so a full twenty-page document costs about 15k input tokens, a few cents.
   */
  DETAIL: "high",
} as const;

/**
 * The two shapes a lecture can take, and the numbers that define each.
 *
 * WHY THIS IS ONE FUNCTION AND NOT FOUR CONDITIONS. The shape is decided in one place and then read
 * by everything that depends on it: the prompt that asks for it, the sanitiser's minimum beat
 * count, and the depth guard that rejects a lecture for being too short. Those three disagreeing is
 * not a hypothetical — the prompt already asked for four to seven beats while the guard demanded an
 * average of 125 words per beat and the deepening pass rewrote anything shorter back up to 140. An
 * instruction nothing enforces is a wish; a check nothing announces is a trap.
 *
 * ASKING SOMETHING IS BEING SPECIFIC, whether or not a box was drawn. Selecting pages and saying
 * nothing is a request to be taught the material. Typing a question — or pointing at part of a page
 * — is a request for an answer, and an answer that arrives as a twelve-beat lesson is not an answer.
 */
export type LectureShape = {
  mode: "focused-answer" | "full-lecture";
  minBeats: number;
  /** Words per beat the prompt asks for. */
  wordTarget: [number, number];
  /** Words per beat below which the result is treated as too thin to ship. */
  wordFloor: number;
};

export const LECTURE_SHAPES = {
  /**
   * ONE THING, TREATED PROPERLY.
   *
   * Narrow scope, generous depth — and those are two separate dials that have each been wrong once.
   * First this shape did not exist, so a specific question was answered with a whole-document
   * survey: the scope was wrong. The fix set it to one or two beats of forty to seventy words, and
   * the depth became wrong instead — an answer so clipped it was no longer teaching anything.
   *
   * The scope rules below are unchanged from that fix; only the length moved. Two to three beats at
   * this length is roughly four hundred to eight hundred spoken words spent entirely on the thing
   * that was asked about, which is what "be specific, and go deep on it" actually requires.
   */
  focusedAnswer: {
    mode: "focused-answer",
    minBeats: 2,
    wordTarget: [180, 260],
    /*
     * Well under the target, because this floor exists to catch a thin or empty script, not to
     * police length. Set it near the target and it becomes the thing that rejects good output —
     * which is exactly how the old 125-word floor turned a usable answer into a failed generation
     * followed by five paid attempts to pad it out. At 120 a solid 150-word beat ships untouched.
     */
    wordFloor: 120,
  },
  /** Being taught the material, which is what page selection with no question asks for. */
  fullLecture: {
    mode: "full-lecture",
    minBeats: 10,
    wordTarget: [130, 170],
    wordFloor: 100,
  },
} as const satisfies Record<string, LectureShape>;

/** Which shape this request wants. */
export function lectureShape(args: { hasRegions: boolean; question: string }): LectureShape {
  const asked = (args.question ?? "").trim().length > 0;
  return args.hasRegions || asked ? LECTURE_SHAPES.focusedAnswer : LECTURE_SHAPES.fullLecture;
}

/**
 * The beat-count and length rules, worded for the model.
 *
 * Includes an explicit reminder that the selected scope wins over generic lecture scaffolding.
 */
export function shapeInstructions(shape: LectureShape, unit: "page" | "slide" = "page"): string[] {
  const where = unit === "slide" ? "deck" : "document";
  if (shape.mode === "full-lecture") {
    return [
      `Teach the whole ${where}, in its order, as one coherent lesson. Cover every substantial idea in it — but you are writing ONE response for the entire ${where}, so group related material into beats rather than emitting one beat per paragraph.`,
      `Use at least ${shape.minBeats} teaching beats and continue for as many as complete coverage requires. There is no maximum beat count. Prefer deeper beats over thin fragmentation.`,
      `Every teaching beat's script must be AT LEAST ${shape.wordTarget[0]} spoken words, and ${shape.wordTarget[0]}-${shape.wordTarget[1]} is better: explain each symbol, each value and each relationship in full sentences, as a teacher speaking aloud.`,
    ];
  }
  return [
    "IGNORE any generic fixed beat-count instruction. The lessonPlan/suggestedLecturePlan beat order and targetBeatCount DO NOT APPLY either. The exact question determines the scope.",
    `Write at least ${shape.minBeats} teaching beats and as many additional beats as the exact answer requires. There is no maximum beat count, but every beat must address a different facet of the SAME requested thing, never a tangent.`,
    `LEAD WITH THE ANSWER. If it is a number, a name, a count, a date or a list, state it in the FIRST SENTENCE — do not build up to it, do not restate the question first, and do not open with background.`,
    `Each beat's script must be ${shape.wordTarget[0]}-${shape.wordTarget[1]} spoken words. Being specific is not permission to be brief: narrow the SUBJECT, then treat that subject thoroughly. A four-sentence reply is not an answer to a question worth asking.`,
    "GO DEEP on it, in this order: state the answer; then unpack the mechanism step by step, naming each part; then quote the concrete values, labels, axis names or terms exactly as they appear in the source; then explain WHY it is that way rather than only what it is; then name the misconception someone is most likely to hold about it and correct it.",
    "Fill those words with substance drawn from the source, never with padding, restatement, or a preamble about what you are going to explain.",
    `Do NOT add an introduction, a recap, a summary beat, a checkpoint, neighbouring sections, or tangential examples. Do not survey the ${where}.`,
    `If the ${where} genuinely does not contain the answer, say so plainly in the first sentence and point at the closest thing it does contain. Never invent it.`,
  ];
}

/** Where on the page a dragged box sits, in words a model can act on. */
export function describeRegion(rect: NormalisedRect): string {
  const vertical = rect.y + rect.height / 2 < 0.34 ? "upper" : rect.y + rect.height / 2 > 0.66 ? "lower" : "middle";
  const horizontal = rect.x + rect.width / 2 < 0.34 ? "left" : rect.x + rect.width / 2 > 0.66 ? "right" : "centre";
  const area = Math.round(rect.width * rect.height * 100);
  const where = vertical === "middle" && horizontal === "centre" ? "centre" : `${vertical} ${horizontal}`;
  return `the ${where} of the page, about ${Math.max(1, area)}% of it`;
}

/**
 * The instruction block for a region the student dragged a box around.
 *
 * WHY THIS IS SHOUTED. The region arrives alongside twenty full pages, and a model given a large
 * pile of material and a two-word question ("explain this") will answer about the material rather
 * than about the two words. The selection is the single most specific thing the student has told
 * us — more specific than anything they typed, because they typed "this" and pointed. Stating it
 * plainly, at the top, and repeating that the rest is background, is what keeps a twenty-page
 * upload from producing a twenty-page survey.
 *
 * The cropped pixels are attached separately; this is the text that tells the model what they are.
 */
export function regionEmphasisSection(regions: ContextRegionImage[], unit: "page" | "slide" = "page"): string {
  if (regions.length === 0) return "";

  const listed = regions
    .map((region, index) => {
      const label = regions.length > 1 ? `Selection ${index + 1} — ` : "";
      return `- ${label}${unit} ${region.pageNumber}, ${describeRegion(region.rect)}.`;
    })
    .join("\n");

  const one = regions.length === 1;
  return [
    "THE STUDENT SELECTED A SPECIFIC PART OF THIS DOCUMENT. THAT SELECTION IS THE SUBJECT OF THE LECTURE.",
    "",
    `They dragged a box around ${one ? "this" : "these"}:`,
    listed,
    "",
    `The selected ${one ? "area is" : "areas are"} attached as ${one ? "a cropped image" : "cropped images"}, immediately after the full ${unit} ${one ? "image" : "images"}. Look at ${one ? "it" : "them"} first and read ${one ? "it" : "them"} closely — ${one ? "it is" : "they are"} what the student is pointing at.`,
    "",
    "Rules that follow from that selection, and that override any instruction to survey the document:",
    `- Teach what is inside the selection. Everything else in this ${unit === "slide" ? "deck" : "document"} is background, available to explain the selection but never to become a topic of its own.`,
    "- If the student's words only point ('explain this', 'what is this') they have named nothing. The selection is the subject; do not use their words as the lecture's title or topic.",
    "- Reproduce what is in the selection exactly — every symbol, subscript, index, axis label and value. Never paraphrase a formula, and never round or restate a number.",
    "- Use the rest of the document to define a term the selection uses, supply a value it refers to, or name the figure it points at. Stop there.",
    "- Do not add a general introduction to the wider subject, a recap of the whole document, neighbouring sections, or tangential examples.",
  ].join("\n");
}

/**
 * The instruction block naming which pages are attached, and what they are for.
 *
 * Without this the images are just there, and a model tends to treat attachments as illustration
 * rather than as source. Saying that a page image OUTRANKS the extracted text for anything visual
 * is the whole point: on a real paper the text is often only the captions.
 */
export function documentImagesSection(
  pages: ContextPageImage[],
  unit: "page" | "slide" = "page",
  hasRegions = false,
): string {
  if (pages.length === 0) return "";
  const numbers = pages.map((page) => page.pageNumber).join(", ");
  const plural = unit === "page" ? "pages" : "slides";

  return [
    `THE COMPLETE DOCUMENT IS ATTACHED AS IMAGES — ${unit === "page" ? "page" : "slide"} ${numbers}, in order.`,
    "",
    `Each image is a full ${unit}, exactly as the student sees it${hasRegions ? ", followed by the cropped selection" : ""}. Read them.`,
    "",
    `- The ${plural} are the authoritative source. Where the extracted text below and the ${unit} image disagree, believe the image.`,
    `- Much of this document exists ONLY in the images: formulas typeset as strokes, charts and tables pasted as pictures, anything scanned. None of that appears in the extracted text, so a claim you cannot find in the text may still be plainly visible on the ${unit}.`,
    `- Read values, axis labels, legends, table cells and equations off the ${unit} directly rather than inferring them from a caption.`,
    `- When you teach something taken from a ${unit}, say which ${unit} it came from.`,
    `- Do not describe a ${unit} you were not given, and do not invent content for a ${unit} that is not attached.`,
  ].join("\n");
}

/**
 * Turn the page and region images into message parts, in the order the model should meet them.
 *
 * Pages ascend, and each region follows the page it was cut from, so the model sees context then
 * detail rather than a bag of pictures. A page carrying a selection is still sent whole: the crop
 * says what to look at, the page says what surrounds it, and answering a question about a figure
 * usually needs both.
 */
export function buildImageParts(
  pages: ContextPageImage[],
  regions: ContextRegionImage[],
  unit: "page" | "slide" = "page",
): ContentPart[] {
  const ordered = [...pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .slice(0, FULL_CONTEXT_RULES.MAX_PAGE_IMAGES);
  const parts: ContentPart[] = [];

  for (const page of ordered) {
    parts.push({ type: "text", text: `--- ${unit} ${page.pageNumber} ---` });
    parts.push({
      type: "image_url",
      image_url: { url: page.dataUrl, detail: FULL_CONTEXT_RULES.DETAIL },
    });

    for (const region of regions.filter((candidate) => candidate.pageNumber === page.pageNumber)) {
      parts.push({
        type: "text",
        text: `--- THE STUDENT'S SELECTION on ${unit} ${region.pageNumber} (${describeRegion(region.rect)}) — this is the subject ---`,
      });
      parts.push({
        type: "image_url",
        image_url: { url: region.dataUrl, detail: FULL_CONTEXT_RULES.DETAIL },
      });
    }
  }

  /*
   * A selection whose page was not attached still gets sent.
   *
   * Losing the crop because its page image failed to render would throw away the most specific
   * thing the student gave us in order to preserve a tidy ordering rule.
   */
  const attached = new Set(ordered.map((page) => page.pageNumber));
  for (const region of regions.filter((candidate) => !attached.has(candidate.pageNumber))) {
    parts.push({
      type: "text",
      text: `--- THE STUDENT'S SELECTION on ${unit} ${region.pageNumber} (${describeRegion(region.rect)}) — this is the subject ---`,
    });
    parts.push({
      type: "image_url",
      image_url: { url: region.dataUrl, detail: FULL_CONTEXT_RULES.DETAIL },
    });
  }

  return parts;
}

/**
 * The question, stated as the thing to answer.
 *
 * Separated from the topic on purpose. The question used to be folded into the lecture's title,
 * which meant it arrived as a name rather than as something to answer — and a model given a title
 * and a pile of source writes the broad lecture, reasonably.
 */
export function questionSection(question: string, hasRegions: boolean): string {
  const asked = (question ?? "").trim();
  if (!asked) {
    return hasRegions
      ? "The student asked no question in words — they pointed at the selection above. Teach exactly what they selected."
      : "";
  }
  return [
    "THE STUDENT'S QUESTION, exactly as they typed it:",
    `"${asked}"`,
    "",
    "Answer this question, using the attached document. Answer it completely, and stop when it is answered.",
  ].join("\n");
}
