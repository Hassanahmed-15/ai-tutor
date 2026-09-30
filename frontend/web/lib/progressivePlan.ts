/**
 * HOW A LECTURE IS PLANNED — the part of the progressive worker that needs no server.
 *
 * Moved out of lib/progressiveLectureWorker.ts, which is `server-only`, so the plan a real lecture
 * gets can be built and inspected by tests and by the generation harness
 * (scripts/audit-lesson-generation.mjs) without running the queue, Cosmos and the worker. The
 * worker imports from here; nothing here imports from the worker.
 */

import { isRecapTitle, nounTitle, polishBeatPlan } from "./beatPresentation";
import { defaultLadderObjectives, inferRole, orderByLadder, subjectPhrase, type TeachingRole } from "./lessonLadder";
import { expandConceptPasses, type ConceptPass } from "./board/conceptPasses";
import { blocksForSelection, scopedBlockText } from "./beatSourceScope";
import { boardCountFor, depthBudget, type DepthLevelName } from "./lectureDepth";
import { CODE_BEAT_PATTERN, asksForCode, isProgrammingTopic, looksLikeCode, mergeSplitCodeBeats } from "./codeSpec";
import type { ProgressiveBeatPlan, ProgressiveLectureInput, ProgressiveVisualKind } from "./progressiveLectureTypes";
import { isStrictSource } from "./sourceScope";
import { isSpecificDocumentRequest, isWholeDocumentRequest } from "./documentLessonPlanning";
import { contentStems } from "./sourceGrounding";
import { BROKEN_GLYPHS, referenceSectionTitle } from "./sectionTitle";

export { referenceSectionTitle };
import { isSuprnotesLessonInput, type SuprnotesLessonInput } from "./suprnotes";

/** The depth slider as the three names the budget and the pass-count both speak. */
function depthLevel(depth: string | undefined): DepthLevelName {
  return depth === "deep" ? "deep" : depth === "concise" ? "concise" : "balanced";
}

/**
 * What must be understood before this beat: the previous CONCEPT, not the previous beat.
 *
 * Keyed off concepts rather than sequence numbers, so a three-pass subtopic lists the subtopic
 * before it once, instead of naming its own earlier passes as prerequisites of itself.
 */
function prerequisitesFor(entries: ConceptPass[], sequence: number): string[] {
  const self = entries[sequence].conceptKey;
  for (let i = sequence - 1; i >= 0; i--) {
    if (entries[i].conceptKey !== self) return [entries[i].conceptKey];
  }
  return [];
}

/**
 * A continuation pass climbs one rung ABOVE the pass before it, starting from the subtopic's own
 * rung: an example subtopic's second board draws the implication, an implication subtopic's second
 * board shows the application. Passes therefore never share a rung and never descend — which is
 * what keeps "board 2 of 3" from being board 1 said again (it was: eight sentences of one TCP
 * lesson's second pass were its first pass reworded).
 */
function roleForPass(base: TeachingRole, passRole: ConceptPass["passRole"]): TeachingRole {
  const climb: TeachingRole[] = ["core", "mechanism", "example", "implication", "application", "pitfall", "contrast"];
  // The hook and the recap are not on the climb and never have passes; they keep their rung.
  // (Clamping them to index 0 is how the opener and the recap were both labelled "core".)
  if (!climb.includes(base)) return base;
  const from = climb.indexOf(base);
  const steps = passRole === "establish" ? 0 : passRole === "example" ? 1 : 2;
  return climb[Math.min(climb.length - 1, from + steps)];
}

/** The student wants code: they said so, or their confirmed profile asks for code examples. */
function requestedCode(input: ProgressiveLectureInput): boolean {
  return input.learnerProfile.codeExamples || asksForCode(`${input.topic ?? ""} ${input.focus ?? ""}`) || programmingLesson(input);
}

/** A programming topic by its topic, focus or planned subtopics — code belongs on its boards. */
function programmingLesson(input: ProgressiveLectureInput): boolean {
  const titles = (input.outline?.subtopics ?? []).map((item) => item.title).join(" ");
  return isProgrammingTopic(`${input.topic ?? ""} ${input.focus ?? ""} ${titles}`);
}

/**
 * A PDF taught AS A REFERENCE: a document is present and the student chose reference, not strict.
 *
 * Both halves matter. A typed topic carries `fidelity: "reference"` by default, so fidelity alone
 * would sweep prompt lessons into this path.
 */
export function isReferenceLesson(input: ProgressiveLectureInput): boolean {
  return input.sourceScope?.fidelity === "reference" && isSuprnotesLessonInput(input.suprnotes);
}

const FRONT_MATTER_TITLE =
  /^(?:table\s+of\s+)?contents\b|^(?:agenda|outline|index|references|bibliography|acknowledge?ments?)\s*$|^thank\s*(?:you|s)\b|^any\s+questions\b|^questions\s*\??\s*$|^q\s*&\s*a\s*$/i;
const COVER_MARKERS = /\b(?:dr|prof|engr)\.?\s+[A-Z]|\bpresented\s+by\b|\blecturer\b|\binstructor\b|\buniversity\b|\bdepartment\b|\bfaculty\b/i;

/**
 * A section that is the document's packaging, not its teaching: a table of contents, a cover page,
 * an agenda, a thank-you slide. In reference mode these are not taught as parts of the lecture.
 */
export function isFrontMatterSection(title: string, text: string, index: number): boolean {
  const plain = clean(title).replace(BROKEN_GLYPHS, " ").trim();
  if (FRONT_MATTER_TITLE.test(plain)) return true;
  const body = clean(text);
  if (/^\s*(?:table\s+of\s+)?contents\b/i.test(body)) return true;
  // The cover: the opening section, a handful of words, naming the lecturer or the institution.
  const words = body.split(/\s+/).filter(Boolean).length;
  return index === 0 && words > 0 && words < 30 && COVER_MARKERS.test(body);
}

/** Block ids whose text shares at least this many content words with a beat are its source. */
const REFERENCE_MATCH_MIN_SHARED = 2;
/** More than this and a beat's context stops being "its pages" and becomes the document. */
const REFERENCE_MATCH_MAX_BLOCKS = 4;

/**
 * The document blocks an outline beat draws on, by the words they share.
 *
 * A reference beat is planned from the student-approved outline, not from the PDF's sections, so it
 * has no blocks of its own. Giving it the few blocks that talk about the same thing keeps what the
 * document is good for — its own figure shown on the beat that matches it, and its facts in the
 * beat's context — without letting the document's order or length dictate the lecture. No match is
 * an ordinary answer: the beat is taught from the idea alone.
 */
export function referenceBlocksFor(document: SuprnotesLessonInput, beatText: string): string[] {
  const wanted = new Set(contentStems(beatText));
  if (wanted.size === 0) return [];
  return (document.contentBlocks ?? [])
    .map((block) => {
      const shared = new Set(contentStems(block.text ?? "").filter((word) => wanted.has(word)));
      return { id: block.id, shared: shared.size };
    })
    .filter((match) => match.shared >= REFERENCE_MATCH_MIN_SHARED)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, REFERENCE_MATCH_MAX_BLOCKS)
    .map((match) => match.id);
}

/** Builds the global map synchronously so no model round-trip delays the first beat. */
export function buildProgressivePlan(input: ProgressiveLectureInput): ProgressiveBeatPlan[] {
  /*
   * A REFERENCE LESSON IS BUILT FROM THE OUTLINE THE STUDENT APPROVED.
   *
   * The document's own section plan used to win whenever one existed — in reference mode too — so a
   * student could plan, revise and approve an outline and then be taught the PDF's section list
   * instead. Reference mode takes the document's ideas, not its structure: with an outline it plans
   * exactly like a typed topic (opener, ladder, depth passes), and each beat is matched to the
   * document blocks it draws on. Strict, and a reference lesson with no outline, are unchanged.
   */
  const referenceDocument = isReferenceLesson(input) && (input.outline?.subtopics?.length ?? 0) > 0
    ? (input.suprnotes as SuprnotesLessonInput)
    : null;
  const sourcePlan = referenceDocument ? [] : sourceDocumentPlan(input);
  if (sourcePlan.length > 0) return sourcePlan;
  // The THING the lesson is about, not the sentence the student typed: "What is overfitting?"
  // is a lesson on Overfitting, and its boards are titled for overfitting.
  const subject = subjectPhrase(input.topic);
  /*
   * A TYPED-PROMPT LECTURE (no uploaded document) is held to three rules the student asked for:
   * every slide title is a noun phrase naming its concept, each topic is taught once, and one topic
   * is one slide except at "deep". Document lectures (strict and reference) keep their own rules.
   */
  const promptLecture = input.sourceType === "prompt" && !isSuprnotesLessonInput(input.suprnotes);
  const outlined = (input.outline?.subtopics ?? [])
    .map((item) => ({
      title: promptLecture ? nounTitle(clean(item.title)) : clean(item.title),
      objective: clean(item.caption || item.reason || item.title),
    }))
    .filter((item) => item.title);
  const supplied = promptLecture ? withoutNearDuplicates(outlined) : outlined;
  /*
   * THE CONCEPTS DECIDE THE COUNT — see lib/lectureDepth.ts.
   *
   * This used to pad the plan up to `beatCountForDepth(depth)` with invented beats titled
   * "${subject}: idea 2/3/4", every one carrying the same objective string, and then truncate
   * anything longer. That is the whole shallow-and-repetitive complaint in two statements: the
   * padding manufactured duplicate teaching instructions, and the truncation threw away real
   * concepts the planner had reasoned about. `polishBeatPlan` then renamed the duplicates to
   * "Worked Example" / "Common Pitfalls", which hid the repetition behind distinct headings.
   *
   * A narrow topic now gets three boards taught thoroughly; a broad one gets eight. The depth
   * setting buys WORDS PER BOARD (depthBudget), never more boards.
   */
  // Default objectives arrive with their rung already assigned, and orderByLadder honours it.
  const middle = supplied.length > 0 ? supplied : defaultLadderObjectives(subject, 4);
  /*
   * Titles are uniquified HERE, over the subtopics, and never again afterwards. `polishBeatPlan`
   * renames any duplicate title it sees, so running it after the concept expansion below would
   * rename the second and third pass over one subtopic into two unrelated-looking headings — which
   * is precisely the "separate slides for one subtopic" symptom being fixed.
   */
  const opener = { title: subject, objective: `Open with the concrete puzzle or situation that makes ${subject} worth learning, and end on the open question. Do NOT define ${subject} or explain how it works — the next board does.` };
  /*
   * NO RECAP BOARD. A recap restates the lesson by definition — the "same concept again in
   * different words" students reported — and every lecture already ends with its own one-slide
   * summary. A QUESTION gets no opener either: "Why does overfitting happen?" is answered by the
   * one or two boards the planner sized for it, not framed by a puzzle board first.
   */
  const question = input.outline?.scope === "question" && supplied.length > 0;
  /*
   * PLANNER TITLES ARE POLISHED; DEFAULT TITLES ARE NOT. `polishBeatPlan` exists to rescue weak or
   * duplicate titles from a model, and it does so by stripping a leading "What"/"How" and trimming
   * to five words — which turned the default "What Overfitting Implies" into "Overfitting Implies"
   * and "TCP Three-way Handshake With Real Numbers" into "…With Real". The defaults are written
   * here, for the subject, and are already distinct; they go through as written.
   */
  // The planner's outline is already sized to the request, so it is never cut to a board count.
  const subtopics = supplied.length > 0
    // A question's boards keep the planner's own titles ("Why Underfitting Happens"): polishing
    // would retitle the first as the subject and strip its "Why".
    // A typed-prompt QUESTION is answered in two slides at most, however many the planner sent.
    ? question ? (promptLecture ? middle.slice(0, 2) : middle) : polishBeatPlan([opener, ...middle], subject)
    : [opener, ...middle].slice(0, boardCountFor(middle.length + 1));

  /*
   * THE LADDER. Each subtopic is given its rung (hook, core, mechanism, example, …) and the plan is
   * put in ladder order, so a definition never follows a mechanism and basics never follow an
   * example — see lib/lessonLadder.ts. The rung travels with the beat into its prompt, where it
   * decides what the board must add and what it must not repeat.
   */
  const ordered = orderByLadder(subtopics);
  const roleByTitle = new Map(ordered.map((item) => [item.title, item.role]));
  /*
   * Continuation passes are for the PLANNER'S subtopics, which are broad ideas ("Chlorophyll") that
   * can genuinely take two or three boards. The default ladder already gives every board its own
   * rung, so expanding it only produced same-rung neighbours — two "implication" boards in a row —
   * with nothing new for the second to say.
   */
  // A question never gets "now an example" / "now go deeper" boards it did not ask for.
  /*
   * ONE TOPIC, ONE SLIDE for a typed prompt: a continuation pass repeats its topic under the same
   * title ("now an example", "where it breaks"), which read as the same content twice. Only "deep"
   * keeps them, where a big topic may take a second slide. Document lectures keep the depth rule.
   */
  const depth = depthLevel(input.learnerProfile.depth);
  const passDepth = supplied.length === 0 || question ? "concise" : promptLecture && depth !== "deep" ? "concise" : depth;
  const entries = expandConceptPasses(ordered, passDepth, slug);

  const plan = entries.map((entry, sequence) => ({
    // The id stays per-beat and unique; the CONCEPT is what repeats.
    id: `beat-${sequence + 1}-${slug(entry.title)}${entry.passes > 1 ? `-p${entry.pass}` : ""}`,
    sequence,
    title: entry.title,
    objective: entry.objective,
    conceptId: entry.conceptKey,
    conceptPass: entry.pass,
    conceptPasses: entry.passes,
    role: roleForPass(roleByTitle.get(entry.title) ?? "mechanism", entry.passRole),
    prerequisiteConceptIds: prerequisitesFor(entries, sequence),
    visualKind: visualKindFor(sequence, entries.length, input, entry),
    estimatedDurationMs: depthBudget(input.learnerProfile.depth).boardMs,
    ...(referenceDocument ? referenceSourceFor(referenceDocument, entry) : {}),
  }));
  // A prompted lecture should exercise the live animation engine, not accidentally collapse into
  // blackboards/structure boards because every outline title matched a broad keyword. Prefer the
  // most process-like teaching beat, and keep specialised equation/plot choices intact.
  if (!plan.some((beat) => beat.visualKind === "react-animation")) {
    const candidate = plan.find((beat) =>
      beat.sequence < plan.length - 1 &&
      /how|work|apply|example|try|mechanism|process|change|step/i.test(`${beat.title} ${beat.objective}`) &&
      !["equation", "plot"].includes(beat.visualKind),
    ) ?? plan.find((beat) => beat.sequence < plan.length - 1 && !["equation", "plot"].includes(beat.visualKind));
    if (candidate) candidate.visualKind = "react-animation";
  }
  return plan;
}

/** A reference beat's matched blocks, as a field only when there are any. */
function referenceSourceFor(document: SuprnotesLessonInput, entry: { title: string; objective: string }): { sourceBlockIds?: string[] } {
  const ids = referenceBlocksFor(document, `${entry.title} ${entry.objective}`);
  return ids.length ? { sourceBlockIds: ids } : {};
}

/**
 * The opening words of a beat's own source text — what a weakly titled section ("Page 3",
 * "Figure 1.2") is named for instead of a generic role title. A figure's labels and a question box
 * are not what a section says, so the first ordinary block is used when there is one.
 */
function sourceOpeningWords(document: SuprnotesLessonInput, sourceBlockIds: string[] | undefined): string {
  const wanted = new Set(sourceBlockIds ?? []);
  const own = (document.contentBlocks ?? []).filter((block) => wanted.has(block.id) && clean(block.text));
  const block = own.find((candidate) => candidate.role !== "figure-labels" && candidate.role !== "questions") ?? own[0];
  const text = clean(block?.text).replace(/^Diagram labels:\s*/i, "");
  return (text.split(/(?<=[.!?:])\s/, 1)[0] ?? "").replace(/[.!?:]+$/, "").split(" ").slice(0, 6).join(" ");
}

/**
 * A strict source beat's job: the source's own Questions box, or its own text. Question boxes are
 * recognised by their blocks' role (pdfLessonPipeline marks them) and, for plans without roles, by
 * the "Questions: …" title the pipeline gives them.
 */
export function sourceRoleFor(document: SuprnotesLessonInput, title: string, sourceBlockIds: string[] | undefined): TeachingRole {
  const wanted = new Set(sourceBlockIds ?? []);
  const own = (document.contentBlocks ?? []).filter((block) => wanted.has(block.id));
  const allQuestions = own.length > 0 && own.every((block) => block.role === "questions" || block.role === "figure-labels") && own.some((block) => block.role === "questions");
  return allQuestions || /^questions?\b/i.test(title) ? "questions" : "source";
}

/**
 * EACH TOPIC ONCE. The planner is told not to plan the same idea twice, and sometimes does anyway:
 * "Photosynthesis Process" beside "How Photosynthesis Works", each its own slide saying the same
 * thing. A subtopic whose content words (title and caption) mostly repeat an earlier one's — 70% or
 * more of the smaller set — is dropped. The earlier one stays, since it came first in the order.
 */
function withoutNearDuplicates<T extends { title: string; objective: string }>(subtopics: T[]): T[] {
  const kept: Array<{ item: T; stems: Set<string> }> = [];
  for (const item of subtopics) {
    const stems = new Set(contentStems(`${item.title} ${item.objective}`));
    const repeats = kept.some((earlier) => {
      const smaller = Math.min(stems.size, earlier.stems.size);
      if (smaller === 0) return false;
      let shared = 0;
      for (const stem of stems) if (earlier.stems.has(stem)) shared++;
      return shared / smaller >= 0.7;
    });
    if (!repeats) kept.push({ item, stems });
  }
  return kept.map((entry) => entry.item);
}

type PlannedSection = { title: string; objective: string; sourceBlockIds: string[]; visualKind: ProgressiveVisualKind };

/** Lower-cased words of four or more letters — enough to tell the same text from a neighbour's. */
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];

/**
 * A LECTURE "FROM THIS AREA" TEACHES THE AREA.
 *
 * The parse returns the whole page's blocks plus one block for the box ("Page N (selected area)"),
 * and the document's plan is built over all of them. Every section was kept whenever a selection
 * existed, so a box drawn over one paragraph produced a board for every section on its page — the
 * box was one board among four, sharing it with blocks from all around it.
 *
 * Only the sections holding the box survive, each narrowed to the box's blocks: the box's own
 * block, and the page's text-layer blocks that carry the same words (`blocksForSelection`), so a
 * strict board can still quote the page's own wording. If no section holds the box — its block
 * was not grouped anywhere — the box is taught as one board of its own.
 */
function sectionsForSelection<T extends PlannedSection>(
  sections: T[],
  document: SuprnotesLessonInput,
  selection: { pages: number[]; transcript: string; description?: string },
): Array<T | PlannedSection> {
  const blocks = document.contentBlocks ?? [];
  const candidates = new Set(blocksForSelection(blocks, selection));
  if (candidates.size === 0) return sections;
  const cropIds = new Set(
    blocks.filter((block) => candidates.has(block.id) && /\(selected area\)/i.test(block.heading ?? "")).map((block) => block.id),
  );
  /*
   * Two shared words is enough for `blocksForSelection` to call a page block "part of the box", and
   * on a paper every paragraph shares "SMOTE" and "dataset" — the paragraphs above and below the box
   * came along. With the box's own transcript to compare against, a page block counts only when most
   * of its words are IN that transcript: it is the text layer of the same lines, not a neighbour.
   */
  const boxWords = new Set(wordsOf(selection.transcript));
  const inBox = cropIds.size > 0
    ? new Set([...candidates].filter((id) => {
        if (cropIds.has(id)) return true;
        const block = blocks.find((candidate) => candidate.id === id);
        const words = wordsOf(`${block?.heading ?? ""} ${block?.text ?? ""}`).filter((word) => !/^page$/.test(word));
        return words.length > 0 && words.filter((word) => boxWords.has(word)).length / words.length >= 0.6;
      }))
    : candidates;
  // With a crop block the box is exact; without one (a deck, an unreadable crop) the page words decide.
  const anchor = cropIds.size > 0 ? cropIds : inBox;
  // "Page 2 (Selected Area)" is the parser's label for the box, not something to title a board with.
  const described = clean(selection.description);
  const kept = sections
    .filter((section) => section.sourceBlockIds.some((id) => anchor.has(id)))
    .map((section) => ({
      ...section,
      title: described && /\(selected area\)/i.test(section.title) ? described : section.title,
      sourceBlockIds: section.sourceBlockIds.filter((id) => inBox.has(id)),
    }));
  if (kept.length > 0) return kept;
  const title = clean(selection.description) || clean(blocks.find((block) => anchor.has(block.id))?.heading) || "Selected area";
  return [{ title, objective: `Teach the area the student selected: ${title}`, sourceBlockIds: [...inBox], visualKind: sourceVisualKind({}) }];
}

function sourceDocumentPlan(input: ProgressiveLectureInput): ProgressiveBeatPlan[] {
  if (!isSuprnotesLessonInput(input.suprnotes)) return [];
  const document = input.suprnotes;
  /*
   * STRICT: THE SOURCE'S STRUCTURE IS THE PLAN. Every section stays (a section headed "Summary" or
   * "Conclusion" is source content, not a recap beat to drop), every section is one board (a
   * continuation pass's job — "work through an actual example", "the subtle case" — is content the
   * source may not have), and every board is briefed on the "source" or "questions" rung rather than
   * a ladder rung (lib/lessonLadder.ts).
   */
  const strict = isStrictSource(input.sourceScope);
  const rawPlan = (document.lessonPlan ?? document.suggestedLecturePlan) as Record<string, unknown> | undefined;
  const rawBeats = Array.isArray(rawPlan?.beats) ? rawPlan.beats : [];
  const plannedRaw = rawBeats
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const sourceBlockIds = Array.isArray(item.sourceBlockIds)
        ? item.sourceBlockIds.filter((id): id is string => typeof id === "string")
        : [];
      return {
        title: clean(item.title),
        objective: clean(item.objective) || clean(item.teachingGoal) || clean(item.title),
        sourceBlockIds,
        visualKind: sourceCodeKind(document, sourceBlockIds) ?? sourceVisualKind(item),
      };
    })
    // A document section planned as a recap/summary is dropped too — no lecture ends on a recap.
    // Except in strict mode, where it is part of the source the student chose to be taught.
    .filter((item) => item.title && (strict || !isRecapTitle(item.title)));
  /*
   * REFERENCE MODE teaches the document's ideas, not its packaging: contents pages, the cover and
   * thank-you slides are dropped, and titles are cleaned ("ACTUATORS DR" → "Actuators"). Never down
   * to nothing — a document that is all front matter keeps its sections. Strict is untouched.
   */
  const reference = !strict && isReferenceLesson(input);
  const referenceKept = reference
    ? plannedRaw.filter((item, index) => !isFrontMatterSection(item.title, scopedBlockText(document.contentBlocks ?? [], item.sourceBlockIds), index))
    : plannedRaw;
  const referenceClean = reference
    ? (referenceKept.length > 0 ? referenceKept : plannedRaw).map((item) => ({ ...item, title: referenceSectionTitle(item.title) }))
    : plannedRaw;
  // A listing the planner cut across beats is re-joined, so the code board shows the whole function.
  const merged = mergeSplitCodeBeats(referenceClean, (ids) => scopedBlockText(document.contentBlocks ?? [], ids));
  /*
   * A QUESTION ABOUT THE DOCUMENT IS ANSWERED FROM ITS PART OF THE DOCUMENT. The plan used to be
   * every section of the PDF whatever the student asked, so "what is starch in here" produced a
   * lecture on the whole excerpt. When the upload came with a specific question, only the sections
   * that answer it are kept (see sectionsForQuestion); a question the document does not match keeps
   * the whole plan rather than teaching nothing.
   */
  const planned = input.selection
    ? sectionsForSelection(merged, document, input.selection)
    : sectionsForQuestion(merged, input.focus ?? "", (ids) => scopedBlockText(document.contentBlocks ?? [], ids));
  /*
   * DEPTH CAPS THE BEAT COUNT FOR A DOCUMENT TOO, not just for a typed topic.
   *
   * The prompt path has always honoured depth — 6 beats concise, 8 balanced, 10 deep. This path
   * ignored it and took a flat 12 blocks, so an uploaded PDF produced a longer lecture than the
   * same request typed as a sentence, and asking for "concise" changed only the words per beat
   * while the lecture still ran twelve sections. That is the regression: concise stopped meaning
   * concise on exactly the source type where documents are longest.
   *
   * Applied to the model's own plan as well as the block fallback, since a long PDF makes the
   * planner propose many beats and the cap is what makes the student's choice win.
   */
  /*
   * A document's board count follows the document's own structure, not the depth slider. Depth is
   * spent on WORDS PER BOARD instead (depthBudget), so "concise" on a long PDF now means each
   * section is taught briskly rather than the last two thirds of the document being dropped —
   * `planned.slice(0, beatCap)` silently discarded the tail of real material.
   */
  const requestedCount = planned.length > 0 ? planned.length : (document.contentBlocks ?? []).length;
  /*
   * STRICT SOURCE MODE MAY NOT DROP THE TAIL.
   *
   * boardCountFor deliberately guards ordinary lectures at twelve boards. Applying that guard to
   * an authoritative selected source silently removed every later block from a long document —
   * precisely the failure strict mode promises not to make. The PDF parser already caps uploads;
   * in strict/whole mode the source plan itself is the safe bound and every planned block stays.
   */
  const beatCap = input.sourceScope?.fidelity === "strict" && input.sourceScope.breadth.kind === "whole"
    ? requestedCount
    : boardCountFor(requestedCount);
  const fallback = planned.length > 0 ? planned.slice(0, beatCap) : (document.contentBlocks ?? [])
    .slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .slice(0, beatCap)
    .map((block) => ({
      title: clean(block.heading) || `Page ${block.pageNumber ?? "source"}`,
      objective: clean(block.text).slice(0, 260) || `Teach the source material in ${block.id}.`,
      sourceBlockIds: [block.id],
      visualKind: (looksLikeCode(block.text) ? "code" : "react-animation") as ProgressiveVisualKind,
    }));
  /*
   * A DOCUMENT'S SECTIONS GET THE SAME CONTINUOUS BOARD as a typed topic's subtopics.
   *
   * This path previously emitted no `conceptId` at all, so every beat fell back to a `legacy:` id
   * and no two beats could ever share a concept — a PDF section explained over two boards produced
   * two unrelated titled slides, which is the reported behaviour. Expanding here keeps the source's
   * own structure (one section is still one concept) while letting a section that needs a worked
   * example take a second board underneath the first.
   *
   * Source provenance is carried onto every pass, so an extracted figure still attaches to each
   * board that teaches its page.
   */
  /*
   * The opening board takes the SUBJECT's name, and for a document that subject is its first real
   * section — not `input.topic`, which is whatever the page named the upload. That was a textbook's
   * publisher line, so the first slide of a photosynthesis lesson read "Cambridge University Press".
   */
  /*
   * A weak title falls back to the section's own opening words, never to a generic role title
   * ("Worked Example" over a section with no example in it) — see polishBeatPlan's sourceOpening.
   */
  const polished = polishBeatPlan(fallback, fallback[0]?.title || input.topic, {
    // Reference mode's fallback title gets the same cleaning: its sentence split cuts at "Dr." too.
    sourceOpening: (item) => reference
      ? referenceSectionTitle(sourceOpeningWords(document, item.sourceBlockIds))
      : sourceOpeningWords(document, item.sourceBlockIds),
  });
  const provenance = new Map(polished.map((item) => [item.title, item]));
  const expanded = expandConceptPasses(
    polished.map((item) => ({ title: item.title, objective: item.objective })),
    strict ? "concise" : depthLevel(input.learnerProfile.depth),
    slug,
  );
  return expanded.map((item, sequence) => {
    const source = provenance.get(item.title);
    return {
      id: `beat-${sequence + 1}-${slug(item.title)}${item.passes > 1 ? `-p${item.pass}` : ""}`,
      sequence,
      title: item.title,
      objective: item.objective,
      conceptId: item.conceptKey,
      conceptPass: item.pass,
      conceptPasses: item.passes,
      ...(strict ? { role: sourceRoleFor(document, item.title, source?.sourceBlockIds) } : {}),
      prerequisiteConceptIds: prerequisitesFor(expanded, sequence),
      sourceBlockIds: source?.sourceBlockIds,
      visualKind: source?.visualKind ?? ("react-animation" as ProgressiveVisualKind),
      estimatedDurationMs: depthBudget(input.learnerProfile.depth).boardMs,
    };
  });
}

/**
 * A beat planned from pages that contain program source teaches THAT code, so it gets the code
 * board whatever the planner recommended. Asked about a PDF's `remove()` function, the lecture drew
 * an animated tree and never showed the function the student was reading.
 */
function sourceCodeKind(document: SuprnotesLessonInput, sourceBlockIds: string[]): ProgressiveVisualKind | null {
  if (sourceBlockIds.length === 0) return null;
  return looksLikeCode(scopedBlockText(document.contentBlocks ?? [], sourceBlockIds)) ? "code" : null;
}

function sourceVisualKind(item: Record<string, unknown>): ProgressiveVisualKind {
  const recommended = item.recommendedVisual && typeof item.recommendedVisual === "object"
    ? item.recommendedVisual as Record<string, unknown>
    : {};
  const value = `${String(recommended.type ?? "")} ${String(item.visualMode ?? "")}`.toLowerCase();
  if (value.includes("react") || value.includes("svg")) return "react-animation";
  if (value.includes("manim")) return "manim";
  if (value.includes("geometry")) return "manim";
  if (value.includes("transform")) return "react-animation";
  if (value.includes("structure") || value.includes("flow") || value.includes("cycle") || value.includes("tree")) return "structure";
  if (value.includes("plot") || value.includes("chart") || value.includes("graph")) return "plot";
  if (value.includes("equation") || value.includes("formula") || value.includes("derivation")) return "equation";
  if (value.includes("blackboard") || value.includes("text") || value.includes("notes")) return "blackboard";
  // A source planner often says only "diagram" or omits the engine. The full pipeline used the
  // sandbox for those visual teaching beats; defaulting them to blackboard caused uploaded-source
  // progressive lectures to lose animation entirely.
  return "react-animation";
}


function visualKindFor(
  sequence: number,
  total: number,
  input: ProgressiveLectureInput,
  entry: { title: string; objective: string },
): ProgressiveVisualKind {
  const title = entry.title.toLowerCase();
  const planText = `${entry.title} ${entry.objective}`.toLowerCase();
  if (/\b(?:equation|formula|derivation|solve|algebra|calculus)\b/.test(title)) return "equation";
  if (/\b(?:chart|graph|trend|probability distribution|data plot)\b/.test(title)) return "plot";
  if (/\b(?:cycle|pipeline|state machine|hierarchy|workflow|architecture)\b/.test(title)) return "structure";
  if (/\b(?:definition)\b/.test(title)) return "blackboard";
  // A student who asked for code gets it on the beats that teach an implementation. This rule used
  // to exist and return "react-animation" — i.e. it did nothing, and no lecture ever showed code.
  if (requestedCode(input) && CODE_BEAT_PATTERN.test(planText)) return "code";
  /*
   * A PROGRAMMING LESSON SHOWS ITS CODE. Beats about a construct ("How For Loops Iterate") never
   * matched CODE_BEAT_PATTERN, so "explain for loops" got animations and no code at all. In a
   * programming lesson any beat whose own title or objective names a programming construct is a
   * code board; a purely conceptual beat ("Why Recursion Needs a Base Case" still names one) keeps
   * the animation only when it names none.
   */
  if (programmingLesson(input) && isProgrammingTopic(planText)) return "code";
  // The sandbox is the normal teaching surface, matching the pre-progressive pipeline. Specialised
  // renderers above are opt-ins only when the title explicitly calls for their grammar.
  return "react-animation";
}

export function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "lesson";
}

/**
 * The sections of a document plan that answer a specific question — at most two, in source order.
 *
 * Each section is scored by how often the question's content words occur in its own text (its
 * title counting double), so "what is starch in here" keeps the section that is about starch rather
 * than every section of the excerpt. Sections scoring under half the best are dropped. Returns the
 * plan unchanged for a non-question ("explain this PDF"), a whole-document request, or a question
 * whose words the document never uses.
 */
export function sectionsForQuestion<T extends { title: string; sourceBlockIds: string[] }>(
  sections: T[],
  question: string,
  textOf: (ids: string[]) => string,
): T[] {
  if (sections.length <= 2 || !question.trim()) return sections;
  if (isWholeDocumentRequest(question) || !isSpecificDocumentRequest(question)) return sections;
  const asked = new Set(contentStems(question).filter((stem) => !/^(?:pdf|document|here|page|slide|explain|mean|meant)$/.test(stem)));
  if (asked.size === 0) return sections;
  /*
   * "WHAT IS X" IS ANSWERED WHERE X IS DEFINED. Counting mentions alone sent "what is starch" to
   * the section that TESTS for starch (starch in its title, starch on every line) instead of the
   * one that says what starch is ("a starch molecule is made of thousands of glucose molecules").
   * A section that defines the asked word — "X is/are…", "called X", "– X", "an X molecule is…" —
   * outranks any count of mentions.
   */
  const definitional = /^\s*(?:what\s+(?:is|are|'s)|define|definition of|meaning of|what does .+ mean)\b/i.test(question);
  const askedWords = (question.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((word) => asked.has(contentStems(word)[0] ?? ""));
  const defines = (text: string) =>
    askedWords.some((word) =>
      new RegExp(
        `(?:called|known as|[–—-])\\s*(?:an?\\s+|the\\s+)?${word}\\b` +
          `|\\b${word}s?(?:\\s+molecules?)?\\s+(?:is|are)\\s+(?:an?|the|made|one|what|when)\\b` +
          `|\\b${word}s?\\s+means\\b`,
        "i",
      ).test(text),
    );
  const scored = sections.map((section, index) => {
    const raw = textOf(section.sourceBlockIds);
    const body = contentStems(raw);
    const title = contentStems(section.title);
    const mentions = body.filter((stem) => asked.has(stem)).length + 2 * title.filter((stem) => asked.has(stem)).length;
    const score = mentions + (definitional && mentions > 0 && defines(raw) ? 100 : 0);
    return { section, index, score };
  });
  const best = Math.max(...scored.map((entry) => entry.score));
  if (best <= 0) return sections;
  const keep = scored
    .filter((entry) => entry.score >= best / 2)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    // A "what is X" the document defines is answered by the defining section alone.
    .slice(0, definitional && best >= 100 ? 1 : 2)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.section);
  return keep;
}

