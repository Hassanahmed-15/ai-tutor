import { checkNumbers, numberIssuesText } from "./numberCheck";
import "server-only";

import type { Beat } from "../lessonContent";
import type { ProgressiveBeatPlan, ProgressiveLectureInput } from "../progressiveLectureTypes";
import { chooseVisuals } from "./visualChoice";
import { bounded, canvasBeat, canvasSentences, client, fallbackSpec, generateSpec, illustrate, jsonCall, PLAN_MODEL, plainRebuild, validatePlan, type Clock, type CoursePictureState } from "./generate";
import { withRefresherOnlyIfOffered } from "./plan";
import { gradeRules, readingGrade } from "../studentCard";
import { layoutPanel } from "./layout";
import { canvasBeatId, connectToEarlier } from "./connect";
import { repairCues } from "./cueRepair";
import { canvasBoardCount, canvasBoardDurationMs, canvasPlanRequest, canvasPolicy, canvasRefresherAllowed, curriculumDocumentOf, documentExtraBoards, referenceDocumentOf, strictDocumentOf, videoDocumentOf } from "./lessonRequest";
import { codeSentenceBlocks, groundSourcePlan, strictBoardLines, ungroundedInPlan, videoBoardLines, videoParts } from "./sourceLessons";
import { assignListings, documentBoardLines, documentListings, documentSections, extraBoardsForListings, faithfulCodeLines, listingGaps, listingsAsked, listingsLeftOut, listingText, overlongCodeBoards, splitListing, substantivePages, uncoveredPages, type DocumentListing } from "./documentContext";
import type { SuprnotesLessonInput } from "../suprnotes";
import { policyForBoards } from "../teachingPolicy";
import { applyConceptColours, planConceptColours, recapTour } from "./lessonPasses";
import { CANVAS_PLAN_PROMPT } from "./prompts";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";
import type { PlanningKnowledge } from "../knowledge/graph";
import { slug } from "./validate";
import { sourcesForText, type SourcePack } from "../webSources";
import { splitLongWorking } from "./splitWorking";
import type { ExaminerSubject } from "./mathsCheck";
import { isCsTopic, isLabLookTopic } from "./subjectLook";
import { asCs, asMathsOrCs, courseLessonSubject, type LessonSubject } from "./lessonSubject";
import { courseBoardContext } from "./coursePicturePrompt";
import { courseCodeDiagramsOff, offInCourses, readyFiguresOffForCourses } from "./courseFigures";
import { classifySubject, type SubjectEvidence } from "./subjectClassifier";
import { mentionLabels } from "./labelMentions";
import { boardLookOn, boardPhoto, lookAtBoard } from "./boardLook";
import { lookFeedback, removeNamedLines, type LookKind, type LookProblem } from "./boardLookCheck";
import { applySplits, SQUEEZE_PROMPT, squeezedInPlan } from "./squeeze";
import { applyLessonVisualPolicy, labelledFigureParts, type VisualPolicyMode } from "./visualPolicy";
import { componentFitsSubject } from "../diagrams/visualForm";
import { figureFor } from "../figures/registry";
import { findLibraryFigure } from "../figures/library";
import { courseCoverageGaps, coverageMessage, requiredTermsOf, syllabusLost, type CoverageGap } from "./courseCoverage";
import { boardNotesOf, mathsEllipsis } from "./plan";
import { dropRowsWhere, formulaNotes, narrationArithmetic, saysNothing } from "./equationCheck";
import { chemSubscripts } from "./chemText";
import { partMentionCues } from "./pictureTalk";
import { prettyPowers } from "../text/fit";
import { examBoardSpec } from "./examBoard";
import { writeCheckCard } from "./checkCard";
import { checkCardBoards, tasksGiveWay } from "./checkCardPlan";
import { DIVE_PROMPT, diveCandidate, parseDives, withDives } from "./cardDives";
import { isLadder, ladderBoardBudget } from "./conceptLadder";

/**
 * THE LESSON CANVAS INSIDE THE PROGRESSIVE WORKER (lib/progressiveLectureWorker.ts).
 *
 * A typed-prompt lecture is planned and taught exactly as before — the planning conversation, the
 * worker's queue, the snapshot the player polls, history, Aria's voice — but its boards are canvas
 * boards. Two things differ from the ordinary boards, and both come from the canvas being ONE
 * lesson rather than independent slides:
 *
 *   - The plan writes every board's script at once (one call), so the boards build on each other
 *     and the recap can walk back over them. The worker then only writes each board's spec.
 *   - Boards are written in parallel, so a board cannot wait for the others: the lesson's concept
 *     colours are fixed from the plan, and a reference to an earlier board ("inside" it, "carry"
 *     from it) is checked against that board only if it is already written; the renderer ignores
 *     one that does not resolve.
 */

const BOARD_BUDGET_MS = Number(process.env.CANVAS_BOARD_BUDGET_MS) || 170_000;

export { canvasBeatId, connectToEarlier };

/** Faults of placement, not of content: what a checked library figure is still held to. */
const LAYOUT_FAULTS = new Set<LookKind>(["covers-writing", "overlap", "illegible", "broken-maths", "empty-shape"]);
/** A figure drawn by the code library (a component or a library asset) — not one the writer drew. */
function isLibraryFigure(spec: CanvasBoardSpec): boolean {
  const st = spec.stage as { kind: string; component?: string; asset?: unknown };
  return st.kind === "figure" && st.component !== undefined && st.component !== "drawn";
}

/**
 * THE LECTURE'S SUBJECT, DECIDED ONCE (lib/canvas/lessonSubject.ts): a course lesson's from its course;
 * any other lecture's by one small call that reads what it is about (lib/canvas/subjectClassifier.ts).
 * A failed call leaves it undecided, and every later step then guesses from words as it used to.
 */
async function lectureSubject(openai: ReturnType<typeof client>, input: ProgressiveLectureInput): Promise<{ subject?: LessonSubject; costUsd: number }> {
  const course = courseLessonSubject(curriculumDocumentOf(input), input.topic);
  if (course) return { subject: course, costUsd: 0 };
  if (process.env.CANVAS_SUBJECT_CHECK === "off") return { costUsd: 0 };
  const doc = referenceDocumentOf(input) ?? strictDocumentOf(input) ?? videoDocumentOf(input);
  const evidence: SubjectEvidence = {
    topic: input.topic,
    request: input.focus,
    parts: input.outline?.subtopics.map((s) => s.title),
    documentTitle: doc?.lesson?.title,
    headings: doc ? documentSections(doc) : undefined,
    excerpt: doc ? (doc.contentBlocks ?? []).map((b) => b.text ?? "").join(" ").slice(0, 900) : undefined,
  };
  const judged = await bounded(classifySubject((system, user, max) => jsonCall(openai, PLAN_MODEL, system, user, max), evidence), 15_000, "lesson subject").catch(() => ({ subject: null, costUsd: 0 }));
  console.log(`[canvas] lesson subject: ${judged.subject ?? "undecided (words guess)"} — "${input.topic.slice(0, 60)}"`);
  return { subject: judged.subject ?? undefined, costUsd: judged.costUsd };
}

export async function planCanvasLecture(input: ProgressiveLectureInput, knowledge?: PlanningKnowledge): Promise<{ plan: ProgressiveBeatPlan[]; costUsd: number }> {
  const openai = client();
  // The subject is decided before the plan, whose rules depend on it — except for a lesson taught strictly
  // from a source, whose plan has no subject rules: there it is decided alongside the plan (no added wait).
  const subjectWork = lectureSubject(openai, input);
  const sourceOnly = Boolean(strictDocumentOf(input) || videoDocumentOf(input));
  const early = sourceOnly ? null : await subjectWork;
  const request = canvasPlanRequest(input, knowledge, early?.subject);
  // The approved outline sized the lecture; the plan may not grow it (only a refresher may be added).
  const outlined = canvasBoardCount(input);
  const ladder = isLadder(input.outline?.subtopics) ? ladderBoardBudget(input.outline!.subtopics) : null;
  // A document's long code listings may each take consecutive boards (lib/canvas/documentContext.ts).
  // A strict lecture on the whole selection may add a board per page its outline missed (up to 14):
  // capped at the outline's count, the page check could never be met (pages 3-10 of 10; 2026-10-18).
  const strictWhole = strictDocumentOf(input) && input.sourceScope?.breadth.kind === "whole" ? Math.min(14, substantivePages(strictDocumentOf(input)!).length) : 0;
  const allowed = outlined > 0 ? Math.max(outlined + documentExtraBoards(input) + (canvasRefresherAllowed(input, knowledge) ? 1 : 0), strictWhole) : 0;
  // The whole document travels in the request: more to read, and code boards with longer scripts.
  const reference = referenceDocumentOf(input);
  // Taught strictly from a source (lib/canvas/sourceLessons.ts): a strict-mode PDF or a video.
  const strictDoc = strictDocumentOf(input);
  const video = videoDocumentOf(input);
  const sourceMode = strictDoc ? "strict" as const : video ? "video" as const : null;
  const videoBoards = video ? videoParts(video).length : 0;
  // The document whose code listings the boards copy: a reference or strict PDF.
  const document = reference ?? strictDoc;
  // The listings this lecture must show when it teaches code: the ones a question asks for, or all of them.
  const codeAsk = input.sourceScope && input.sourceScope.breadth.kind !== "whole" ? input.sourceScope.breadth.focus : null;
  const wantedListings = document ? (codeAsk ? listingsAsked(codeAsk, documentListings(document)) : documentListings(document)) : [];
  const fromDocument = Boolean(reference || strictDoc || video);
  let costUsd = 0;
  // The subject call's cost, counted once whichever attempt's plan is kept.
  void subjectWork.then((d) => { costUsd += d.costUsd; });
  let lastError = "";
  // A strict lecture on the selected pages (no question) must teach every one of them: a plan that
  // leaves a page out is sent back, naming it — one more try than other lectures get.
  // So must a REFERENCE lecture on the whole PDF: its outline fixed the boards, so a page left out is
  // folded into the board it belongs to (AVL chapter: 1 of 6 sections taught; PDF bench, 2026-10-18).
  const covering = Boolean(strictDoc || reference) && input.sourceScope?.breadth.kind === "whole";
  const maxAttempts = covering ? 3 : 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { json, costUsd: c } = await bounded(jsonCall(openai, PLAN_MODEL, CANVAS_PLAN_PROMPT, attempt > 1 && lastError ? `${request}\n\nYour previous plan could not be used: ${lastError}` : request, fromDocument ? 16_000 : 9000), fromDocument ? 180_000 : 120_000, "canvas plan");
      costUsd += c;
      const valid = validatePlan(json);
      // Only a refresher the student's knowledge offered — the planner may not add its own (lib/canvas/plan.ts).
      let plan = valid && withRefresherOnlyIfOffered(valid, canvasRefresherAllowed(input, knowledge));
      const courseDoc = curriculumDocumentOf(input);
      // The lesson plan's exam-practice block is drawn as the exam board, whatever stage the planner wrote.
      const examAt = courseDoc?.contentBlocks?.findIndex((b) => b.exam) ?? -1;
      if (plan && examAt >= 0) {
        const lessonBeats = plan.beats.filter((b) => !b.refresher);
        const examBeat = lessonBeats[examAt];
        if (examBeat && examBeat.stage !== "exam") {
          examBeat.stage = "exam";
          examBeat.interaction = null;
          delete examBeat.teachingCycle;
          examBeat.objects = [];
        }
      }
      // What the planner chose to SHOW on each board (its stage and catalogue diagram), before any routing.
      if (plan) console.log(`[canvas] planner visuals: ${plan.beats.map((b) => `${b.id} ${b.stage}${b.plannedFigure ? `:${b.plannedFigure}` : ""}`).join(" | ")}; raw diagram fields: ${JSON.stringify(((json as { beats?: Array<{ diagram?: unknown }> }).beats ?? []).map((b) => b.diagram ?? null)).slice(0, 300)}`);
      // A course lesson must teach what its syllabus plan lists: a plan that leaves out key points or
      // required terms goes back once, naming each one (lib/canvas/courseCoverage.ts).
      if (plan && courseDoc?.contentBlocks?.length) {
        const gaps = courseCoverageGaps(plan.beats, courseDoc.contentBlocks, requiredTermsOf(courseDoc.contentBlocks[0].teachingHints));
        if (gaps.boards.length || gaps.terms.length > 2) {
          lastError = `it leaves out parts of the syllabus lesson: ${coverageMessage(gaps)}`;
          if (attempt < maxAttempts) { console.log(`[canvas] plan sent back for coverage: ${lastError.slice(0, 600)}`); continue; }
          console.warn(`[canvas] plan kept with coverage gaps: ${lastError.slice(0, 600)}`);
          // The gaps are repaired board by board instead of shipped: each board that left out key
          // points has its own script rewritten to add them, everything else kept (a history lesson
          // shipped without the 1960s dollar crisis this way, audit 2026-10-17).
          const repaired = await repairBoardScripts(openai, plan.beats, gaps.boards);
          costUsd += repaired.costUsd;
          if (repaired.count) { plan = { ...plan, beats: repaired.beats }; console.log(`[canvas] ${repaired.count} board script(s) rewritten to teach their missing key points`); }
        } else console.log(`[canvas] plan covers every key point${gaps.terms.length ? ` (terms not used: ${gaps.terms.join(", ")})` : ""}`);
      }
      // THE CONCEPT LADDER (lib/canvas/conceptLadder.ts): each new part climbs its rungs over several
      // boards, so a plan of one board per part goes back once, saying why.
      if (plan && ladder && plan.beats.length < ladder.min && attempt < maxAttempts) {
        lastError = `it had ${plan.beats.length} boards; the concept ladder needs at least ${ladder.min}: each NEW part climbs its rungs over 2 to 4 boards, each SHAKY part over 1 to 2, and a KNOWN part is only a recap sentence`;
        console.log(`[canvas] plan sent back: ${lastError}`);
        continue;
      }
      if (plan && allowed > 0 && plan.beats.length > allowed) {
        lastError = ladder
          ? `it had ${plan.beats.length} boards; the concept ladder allows at most ${allowed}`
          : `it had ${plan.beats.length} boards; the outline has exactly ${outlined}${allowed > outlined ? ` (at most ${allowed} with the extra boards allowed)` : ""}`;
        if (attempt < maxAttempts) continue;
        // Still over: keep the refresher (if first) and the outline's boards, drop the extras.
        const keep = plan.beats.filter((b, i) => (b.refresher && i === 0) || !b.refresher).slice(0, allowed);
        plan = { ...plan, beats: keep };
      }
      // A document's code board must be able to show its code: one that names more lines than a
      // board holds (or no listing) sends the plan back once with exactly what to split.
      // A code board the plan left without its listing is given the one it is about first.
      if (plan && document) {
        const given = assignListings(document, plan.beats);
        if (given.assigned) console.log(`[canvas] ${given.assigned} code board(s) given their listing from what they say`);
        plan = { ...plan, beats: given.beats };
      }
      // A video lesson is one board per part of the video, exactly.
      if (plan && video && plan.beats.length !== videoBoards) {
        lastError = `it had ${plan.beats.length} boards; the video has exactly ${videoBoards} parts, one board each`;
        if (attempt < maxAttempts) continue;
        plan = { ...plan, beats: plan.beats.slice(0, videoBoards) };
      }
      const overlong = plan && document ? [...overlongCodeBoards(document, plan.beats), ...listingGaps(document, plan.beats), ...listingsLeftOut(document, plan.beats, wantedListings)] : [];
      if (overlong.length && attempt < maxAttempts) {
        lastError = overlong.join("; ");
        console.log(`[canvas] plan sent back: ${lastError}`);
        continue;
      }
      // Still cut off on the last try: the listing is split by code and each piece narrated (splitCodeBoards).
      if (overlong.length && plan && document) {
        const split = await splitCodeBoards(openai, document, plan.beats, Boolean(strictDoc), wantedListings);
        costUsd += split.costUsd;
        if (split.count) { plan = { ...plan, beats: split.beats }; console.log(`[canvas] ${split.count} code listing(s) split over consecutive boards by code: ${split.beats.length} board(s) now`); }
        else console.warn(`[canvas] code plan kept with gaps: ${overlong.join("; ").slice(0, 400)}`);
      }
      const coveredDoc = strictDoc ?? reference;
      const missing = plan && covering && coveredDoc ? uncoveredPages(coveredDoc, plan.beats) : [];
      if (missing.length && attempt < maxAttempts) {
        lastError = strictDoc
          ? `page${missing.length === 1 ? "" : "s"} ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not taught by any board — this lecture covers EVERY selected page: keep the boards you have and add the ones these pages need, in page order, each naming its pages in "source.pages"`
          : `page${missing.length === 1 ? "" : "s"} ${missing.join(", ")} of the student's PDF ${missing.length === 1 ? "is" : "are"} taught by no board — this lecture teaches the WHOLE document: keep the same boards, and fold each missing page's points (its examples, activities, figures and numbers) into the board whose part it belongs to, naming the page in that board's "source.pages"`;
        console.log(`[canvas] plan sent back: ${lastError}`);
        continue;
      }
      if (missing.length) console.warn(`[canvas] ${strictDoc ? "strict" : "reference"} plan still leaves out page(s) ${missing.join(", ")}`);
      if (plan) {
        // WORKED NUMBERS ARE CHECKED BY CODE (lib/canvas/numberCheck.ts): a script that says
        // "−(8π)²(0.060) = −121" goes back with the right value named (it is −37.9).
        const arithmetic = plan.beats.flatMap((beat) => narrationArithmetic(beat.script));
        if (arithmetic.length && attempt < maxAttempts) {
          lastError = `worked calculations are wrong: ${numberIssuesText(arithmetic)}. Recompute every number, fix those sentences and anything that depends on them (later steps, the quiz answer)`;
          console.log(`[canvas] plan sent back: ${lastError}`);
          continue;
        }
        if (arithmetic.length) console.warn(`[canvas] plan still has ${arithmetic.length} wrong calculation(s): ${numberIssuesText(arithmetic)}`);
        // Curriculum visual contracts are deterministic; attach them to the model's beats so the
        // board-spec retry gate can reject a decorative stage that cannot show the required evidence.
        const curriculum = curriculumDocumentOf(input);
        if (curriculum) {
          const contractBeats = ((curriculum.lessonPlan as { beats?: Array<{ title?: string; visualRequirement?: Array<{ preferredStages?: string[]; mustShow?: string[] }> }> } | undefined)?.beats ?? []);
          plan = {
            ...plan,
            beats: plan.beats.map((beat, i) => {
              // By title first, then by position counted without refresher boards: a refresher
              // added at the front shifted every contract onto the wrong board.
              if (beat.refresher) return beat;
              const position = plan!.beats.slice(0, i).filter((b) => !b.refresher).length;
              const match = contractBeats.find((candidate) => candidate.title?.trim().toLowerCase() === beat.title.trim().toLowerCase()) ?? contractBeats[position];
              const reqs = match?.visualRequirement ?? [];
              const stages = [...new Set(reqs.flatMap((r) => r.preferredStages ?? []))];
              const mustShow = [...new Set(reqs.flatMap((r) => r.mustShow ?? []))];
              return stages.length || mustShow.length ? { ...beat, requiredVisual: { stages, mustShow } } : beat;
            }),
          };
        }
        const visualMode: VisualPolicyMode = sourceMode ? "strict" : reference ? "reference" : curriculum ? "course" : "prompt";
        // A COURSE LESSON IS TAUGHT AS ITS COURSE'S SUBJECT (lib/canvas/lessonSubject.ts), stamped on every
        // board so every later step reads it instead of guessing from words.
        const decided = early ?? (await subjectWork);
        const subject = decided.subject;
        if (subject) plan = { ...plan, beats: plan.beats.map((b) => ({ ...b, subject })) };
        const planWords = [input.topic, ...plan.beats.map((b) => b.title)].join(" ");
        // A CS sentence that packs several lines or steps is split into one per line or step, in the plan,
        // so each board is written once for the narration it plays with (lib/canvas/squeeze.ts).
        if (visualMode !== "strict" && asCs(subject, () => isCsTopic(planWords))) {
          const squeezed = squeezedInPlan(plan.beats).slice(0, 24);
          if (squeezed.length) {
            try {
              const user = squeezed.map((x, i) => `[${i}] ${x.text}`).join("\n");
              const { json, costUsd: c } = await bounded(jsonCall(openai, PLAN_MODEL, SQUEEZE_PROMPT, user, 3000), 30_000, "split squeezed sentences");
              costUsd += c;
              const raw = Array.isArray((json as { splits?: unknown }).splits) ? (json as { splits: Array<{ id?: unknown; sentences?: unknown }> }).splits : [];
              const splits = raw.flatMap((r) => {
                const at = squeezed[Number(r.id)];
                return at && Array.isArray(r.sentences) ? [{ beat: at.beat, sentence: at.sentence, sentences: r.sentences.map(String) }] : [];
              });
              const n = applySplits(plan.beats, splits);
              console.log(`[canvas] ${n} of ${squeezed.length} squeezed sentence(s) split into one per line or step`);
            } catch (error) {
              console.warn(`[canvas] squeezed sentences left as they are: ${(error as Error).message}`);
            }
          }
        }
        // A maths or CS board says every step of its working; one longer than a board continues on the next.
        if (visualMode !== "strict" && asMathsOrCs(subject, () => isLabLookTopic(planWords))) {
          const split = splitLongWorking(plan.beats);
          if (split.count) { plan = { ...plan, beats: split.beats }; console.log(`[canvas] ${split.count} long piece(s) of working continued on a second board: ${split.beats.length} board(s) now`); }
        }
        // What each board shows is chosen by one focused call (lib/canvas/visualChoice.ts), not by the
        // long planning prompt, which reached for tables (owner, 2026-10-17: "fix the weak link").
        if (visualMode !== "strict" && process.env.CANVAS_VISUAL_CHOICE !== "off") {
          const chosen = await bounded(chooseVisuals((system, user, max) => jsonCall(openai, PLAN_MODEL, system, user, max), input.topic, plan.beats, { course: visualMode === "course" && courseCodeDiagramsOff() }), 30_000, "visual choice").catch((error: Error) => { console.warn(`[canvas] visual choice skipped: ${error.message}`); return null; });
          if (chosen) { plan = { ...plan, beats: chosen.beats }; costUsd += chosen.costUsd; console.log(`[canvas] visual choice: ${chosen.log}`); }
        }
        const visualPolicy = applyLessonVisualPolicy(plan.beats, { mode: visualMode, findAsset: visualMode === "course" && readyFiguresOffForCourses() ? undefined : findLibraryFigure, topic: input.topic });
        plan = { ...plan, beats: visualPolicy.beats };
        // Not for a course lesson drawn by gpt-image-2: there only a board that needs a picture gets one
        // (owner, 2026-10-24), and a lesson of written boards with one picture is not sent back for more.
        if ((visualMode === "prompt" || (visualMode === "course" && !courseCodeDiagramsOff())) && visualPolicy.audit.meaningfulVisuals < visualPolicy.audit.targetMeaningfulVisuals && attempt < maxAttempts) {
          lastError = `only ${visualPolicy.audit.meaningfulVisuals} of ${plan.beats.length} boards used purpose-built visuals; use at least ${visualPolicy.audit.targetMeaningfulVisuals} appropriate stages such as illustration, flow, graph, equation, compare, molecule, atom-map or code instead of generic scenes`;
          console.log(`[canvas] plan sent back: ${lastError}`);
          continue;
        }
        console.log(`[canvas] visual policy (${visualMode}): ${visualPolicy.audit.illustrations} generated picture(s), ${visualPolicy.audit.meaningfulVisuals}/${plan.beats.length} purpose-built visual board(s)${visualPolicy.audit.changes.length ? ` — ${visualPolicy.audit.changes.join(" | ")}` : ""}`);
        // CHECK THE PITCH: a model told a grade still writes above it, so each script is measured
        // and the ones too hard for this student are rewritten simpler (lib/studentCard.ts).
        // The target is the policy's reading grade: plainer English or simpler language lowers it.
        const policy = canvasPolicy(input);
        // EASY WORDS IN A COURSE LESSON (owner, 2026-10-24: "simpler doesn't mean the text will be small, it
        // means easy wording"): its sentences are rewritten to grade 7 at most — everyday words, each
        // syllabus term kept and explained — whatever the student's level; the ideas stay at their level.
        // Course lessons came out at grade 10–11 (13.8–17.6 words a sentence, 3–5 unexplained terms).
        const pitch = curriculum ? Math.min(policy?.readingGrade ?? COURSE_READING_GRADE, COURSE_READING_GRADE) : policy?.readingGrade;
        if (pitch !== undefined) {
          const scriptsBefore = plan.beats.map((beat) => beat.script);
          const fixed = await pitchScripts(openai, plan.beats.filter((beat) => beat.stage !== "exam"), pitch);
          costUsd += fixed.costUsd;
          // A simpler rewrite must not break a number: a script whose calculations got worse goes back.
          // Nor drop the syllabus (owner, 2026-10-25: "does it still check all the outcomes?"): a board
          // that no longer teaches a key point or required term it taught before keeps its old script.
          const blocks = curriculum?.contentBlocks ?? [];
          const terms = blocks.length ? requiredTermsOf(blocks[0].teachingHints) : [];
          const lessonBeats = plan.beats.filter((beat) => !beat.refresher);
          plan.beats.forEach((beat, i) => {
            if (beat.script === scriptsBefore[i]) return;
            if (checkNumbers(beat.script).length > checkNumbers(scriptsBefore[i]).length) {
              beat.script = scriptsBefore[i];
              return;
            }
            const lost = syllabusLost(scriptsBefore[i], beat.script, blocks[lessonBeats.indexOf(beat)], terms);
            if (lost.length) {
              console.log(`[pitch] ${beat.id}: simpler script kept out — it dropped ${lost.map((x) => `"${x.slice(0, 60)}"`).join(", ")}`);
              beat.script = scriptsBefore[i];
            }
          });
        }
        if (policy) {
          // Each board is written later, from its plan beat alone: it carries the policy's board brief.
          const audience = policyForBoards(policy);
          for (const beat of plan.beats) beat.audience = audience;
        }
        // CHECK THE FACTS (prompt bench, 2026-10-18: "motion includes stillness", "antigens cause no
        // disease" reached students). One call reads every sentence; a wrong one is corrected in place.
        // Not on a PDF lesson: there the document is the authority, not a model's general knowledge.
        if (!sourceMode && !referenceDocumentOf(input)) costUsd += (await factCheckScripts(openai, input.topic, plan.beats)).costUsd;
        // STRICT: every sentence checked against its passages before any board is drawn, and each
        // sentence given the passage the PDF panel boxes while it is spoken.
        const source = strictDoc ?? video;
        if (sourceMode && source) {
          // A sentence that strays is first rewritten from its passages, so a point the source does
          // make is kept in the source's terms; only what still strays is then deleted.
          const flagged = ungroundedInPlan(source, plan.beats, sourceMode);
          if (flagged.length) {
            const repaired = await repairSentences(openai, flagged, plan.beats);
            costUsd += repaired.costUsd;
            console.log(`[canvas] ${sourceMode}: ${repaired.fixed}/${flagged.length} straying sentence(s) rewritten from the source`);
          }
          const grounded = groundSourcePlan(source, plan.beats, sourceMode);
          plan = { ...plan, beats: grounded.beats };
          console.log(`[canvas] ${sourceMode} grounding: ${grounded.removed} sentence(s) dropped${grounded.log.length ? ` — ${grounded.log.slice(0, 6).join(" | ")}` : ""}`);
        }
        // CARD DIVES (lib/canvas/cardDives.ts): each board of cards becomes a tour and a close-up inside
        // every card. Off unless CANVAS_CARD_DIVES=1; never for a strict PDF or a video.
        if (process.env.CANVAS_CARD_DIVES === "1" && !sourceMode) {
          const dived = await addCardDives(openai, input.topic, plan.beats, Number(process.env.CANVAS_CARD_DIVES_MAX) || 12);
          costUsd += dived.costUsd;
          if (dived.boards) plan = { ...plan, beats: dived.beats };
          console.log(`[canvas] card dives: ${dived.boards} board(s) of cards, ${dived.dives} close-up(s) added`);
        }
        return {
          costUsd,
          plan: plan.beats.map((beat, sequence) => ({
            id: beat.id,
            sequence,
            title: beat.title,
            objective: beat.brief || beat.title,
            conceptId: slug(beat.title, beat.id),
            visualKind: "canvas",
            estimatedDurationMs: canvasBoardDurationMs(beat.script),
            canvas: beat,
          })),
        };
      }
      lastError = "the plan had fewer than three usable boards";
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
      lastError = (error as Error).message;
    }
  }
  throw new Error(`The canvas lesson could not be planned: ${lastError}`);
}

/**
 * One board, written whole: its spec, its picture when it is an illustration, its lesson colours,
 * and its references to other boards resolved. Never throws — a board that cannot be written falls
 * back to a simple scene, so the lesson never loses a board.
 */
export async function writeCanvasBoard(args: {
  userId: string;
  sessionId: string;
  topic: string;
  plan: CanvasPlanBeat[];
  index: number;
  /** Specs of the earlier boards already written, by plan index; undefined = not written yet. */
  earlier: Array<CanvasBoardSpec | undefined>;
  /** What the student has done so far that the board should take into account. */
  notes: string[];
  /** A reference-mode lesson's PDF: the board reads its pages and copies its code. */
  document?: SuprnotesLessonInput | null;
  /**
   * A lesson taught strictly from a source (lib/canvas/sourceLessons.ts): the board reads its own
   * passages, and its Beat carries their ids so the PDF panel boxes what is being said.
   */
  strictSource?: { mode: "strict" | "video"; doc: SuprnotesLessonInput } | null;
  /** What Aria read up on (lib/webResearch.ts): the board's Beat cites the pages its material came from. */
  webSources?: SourcePack | null;
  /** The maths examiner reads this board before it ships (lib/canvas/mathsCheck.ts). */
  mathsCheck?: boolean;
  /** Which examiner reads the board when mathsCheck is on (lib/canvas/mathsCheck.ts examinerFor). */
  examiner?: ExaminerSubject;
  /** Faults a later read found on an earlier version of this board, for the writer to correct. */
  feedback?: string[];
  /** True while the student is about to reach this board: polish passes are skipped (generateSpec). */
  hurry?: () => boolean;
}): Promise<{ beat: Beat; costUsd: number; fallback: boolean; log: string[] }> {
  const { plan, index, sessionId } = args;
  const beat = plan[index];
  const started = Date.now();
  // An examined board may need one rewrite: it gets a minute more (boards 2+ are written while earlier ones play).
  // A course lesson's picture (gpt-image-2, checked, perhaps drawn twice) gets the time it needs: boards
  // 2+ are written while earlier ones play (lib/canvas/coursePicture.ts).
  const course = beat.stage === "illustration" || beat.pictureBeside ? courseBoardContext(args.document, args.topic, beat) : null;
  const budget = BOARD_BUDGET_MS + (args.mathsCheck ? 60_000 : 0) + (course ? 150_000 : 0);
  const clock: Clock = { left: () => budget - (Date.now() - started) };
  const log: string[] = [];
  const colours = planConceptColours(plan);

  const extra: string[] = [];
  const shared = beat.objects.filter((o) => colours[o]);
  if (shared.length) extra.push(`Lesson colours — these things appear on several boards, so give them exactly these colours: ${shared.map((o) => `${o} ${colours[o]}`).join(", ")}.`);
  if (beat.audience) extra.push(`How to pitch this board for the student (presentation only — never change what it depicts): ${beat.audience}`);
  if (args.notes.length) extra.push(`What the student has shown so far (pitch the notes, cues and any interaction to it): ${args.notes.slice(-3).join(" ")}`);
  if (args.feedback?.length) extra.push(`CORRECT THESE — ${args.feedback.join(" ")}`);
  if (args.document) extra.push(...documentBoardLines(args.document, beat));
  if (args.strictSource) extra.push(...(args.strictSource.mode === "video" ? videoBoardLines(args.strictSource.doc, beat) : strictBoardLines(args.strictSource.doc, beat)));
  const codeDoc = args.document ?? (args.strictSource?.mode === "strict" ? args.strictSource.doc : null);

  let made: { spec: CanvasBoardSpec; costUsd: number; attempts: number };
  let pictured: { spec: CanvasBoardSpec; costUsd: number; picture?: CoursePictureState };
  // FIX 2 (owner, 2026-10-24): a course board's line of working that says nothing ("Na₂O = Na₂O") is
  // removed before anything is drawn from the board. Not maths, where "6 = 6" checks an answer.
  const dropEmptyRows = (board: CanvasBoardSpec) => {
    // Formulas in a course board's notes are written as in print ("CH₂", not "CH2"; lib/canvas/chemText.ts).
    // …and powers as in print ("N kg⁻¹", "4.0 × 10⁷ m" — a gravitation board showed "N kg^-1" and "10^7").
    if (beat.course) board.notes = board.notes.map((n) => ({ ...n, text: beat.subject === "maths" ? prettyPowers(n.text) : chemSubscripts(prettyPowers(n.text)) }));
    if (!beat.course || beat.subject === "maths" || board.stage.kind !== "equation") return;
    const gone = dropRowsWhere(board.stage, saysNothing);
    if (gone.length) log.push(`${beat.id}: removed ${gone.length} line(s) of working that say nothing — ${gone.join(" | ").slice(0, 200)}`);
  };
  // The exam-practice board is the lesson's mark scheme, built by code (lib/canvas/examBoard.ts).
  const exam = beat.stage === "exam" ? args.document?.contentBlocks?.find((b) => b.exam)?.exam : undefined;
  try {
    const openai = client();
    if (exam) made = { spec: examBoardSpec(beat, exam), costUsd: 0, attempts: 1 };
    else if (beat.stage === "exam") throw new Error("an exam board needs the lesson's mark scheme");
    // A course board with nothing to see is Aria's notes, written as she says them (owner, 2026-10-24:
    // "only those which are necessary get a diagram").
    else if (beat.written && beat.course) made = { spec: fallbackSpec(beat), costUsd: 0, attempts: 1 };
    else made = await generateSpec(openai, args.topic, plan, beat, clock, extra, false, { mathsCheck: args.mathsCheck, examiner: args.examiner, hurry: args.hurry });
    dropEmptyRows(made.spec);
    pictured = await illustrate(openai, args.userId, sessionId, beat, made.spec, log, clock, plainRebuild(openai, args.topic, plan, beat, clock, extra), course);
  } catch (error) {
    log.push(`${beat.id}: ${(error as Error).message}`);
    made = { spec: fallbackSpec(beat), costUsd: 0, attempts: -1 };
    pictured = { spec: made.spec, costUsd: 0 };
  }
  let spec: CanvasBoardSpec = { ...pictured.spec };
  let picture = pictured.picture;
  // EYES ON THE BOARD BEFORE A STUDENT SEES IT (lib/canvas/boardLook.ts; owner, 2026-10-23: "100 percent
  // accurate diagrams … I don't want to reduce the amount of visuals"). The finished board is drawn by the
  // real board code in a headless browser and a vision model checks it against what Aria says — a course
  // lesson's gpt-image-2 picture boards included (owner, 2026-10-24: "the board itself should have a visual
  // check of what it contains"). Never a lecture held up: a board that could not be photographed or judged
  // ships as it is.
  let lookCost = 0;
  // null: not looked at (no photo, no verdict, the look off); true: passed; false: refused and shipped as settled.
  let lookPassed: boolean | null = null;
  const courseBoard = Boolean(beat.course && courseCodeDiagramsOff());
  if (made.attempts >= 0 && boardLookOn() && beat.stage !== "exam" && !beat.overview) {
    const openai = client();
    const opts = { mathsCheck: args.mathsCheck, examiner: args.examiner, hurry: args.hurry };
    // LOOSENED (owner, 2026-10-24: "please loosen its check, it always rejects things"): a board is refused
    // only for a serious fault (lib/canvas/boardLookCheck.ts) and redrawn ONCE. Refused again, the better of
    // its drawings ships — in a course lesson with every line the look named as false taken off it (fix 1);
    // elsewhere an exact code-drawn figure replaces it when one fits. Never a plain board of boxes.
    let best: { spec: CanvasBoardSpec; serious: number; problems: LookProblem[]; picture?: CoursePictureState } | null = null;
    let current: LookProblem[] = [];
    const settle = (why: string) => {
      let problems = current;
      if (best && best.spec !== spec) {
        spec = best.spec;
        picture = best.picture;
        problems = best.problems;
        log.push(`${beat.id}: kept the better drawing (${why})`);
      } else log.push(`${beat.id}: shipped as drawn (${why})`);
      if (!courseBoard) return;
      const cleaned = removeNamedLines(spec, problems);
      if (cleaned.removed.length) {
        spec = cleaned.spec;
        log.push(`${beat.id}: took off ${cleaned.removed.length} line(s) the look named as wrong — ${cleaned.removed.join(" | ").slice(0, 300)}`);
      }
    };
    for (let round = 0; round < 3; round++) {
      const photo = await boardPhoto(spec, { userId: args.userId, topic: args.topic, withoutCues: courseBoard });
      if (!photo) { log.push(`${beat.id}: not looked at (no photo)`); break; }
      // A written board is read by the cheaper model, as a board of working is.
      const verdict = await bounded(lookAtBoard(openai, photo, { topic: args.topic, title: beat.title, script: beat.script, stageKind: beat.written ? "written" : spec.stage.kind }), 60_000, "board look").catch(() => null);
      lookCost += verdict?.costUsd ?? 0;
      if (!verdict) { log.push(`${beat.id}: not looked at (no verdict)`); break; }
      // A checked library figure is not second-guessed on its own drawing (calibration: "elastic tissue"
      // pointed at the layer textbooks put elastic fibres in): only what lands on it, over it or beside it.
      if (isLibraryFigure(spec)) {
        verdict.problems = verdict.problems.filter((p) => LAYOUT_FAULTS.has(p.kind));
        verdict.ok = !verdict.problems.some((p) => p.serious);
      }
      const serious = verdict.problems.filter((p) => p.serious);
      const minor = verdict.problems.length - serious.length;
      if (verdict.ok) { lookPassed = true; log.push(`${beat.id}: looked at${round ? " after a redraw" : ""} — fine${minor ? ` (${minor} minor note(s) let through)` : ""}`); break; }
      lookPassed = false;
      current = verdict.problems;
      log.push(`${beat.id}: looked at — refused: ${serious.map((p) => `${p.kind}${p.where ? ` (${p.where})` : ""}: ${p.detail}`).join(" | ").slice(0, 400)}`);
      if (!best || serious.length < best.serious) best = { spec, serious: serious.length, problems: verdict.problems, picture };
      if (round === 2 || clock.left() < 40_000) { settle("no time for more"); break; }
      try {
        if (courseBoard) {
          // A COURSE BOARD: one redraw in all (owner, 2026-10-24: "redraw it one time only"). A fault in its
          // picture redraws the picture with the faults named — unless the picture's own check already used
          // the redraw; a fault only in the writing of a picture board takes those lines off rather than
          // pay for the picture again; a board with no picture is written again.
          const hasPicture = spec.stage.kind === "illustration" ? Boolean(spec.stage.coursePicture) : spec.stage.kind === "equation" && Boolean(spec.stage.picture);
          const pictureFault = serious.some((p) => p.where !== "writing");
          if (round > 0) { settle("its one redraw was refused too"); break; }
          // A written board is Aria's notes: a false line is taken off, never redrawn as a sketch.
          if (beat.written) { settle("a written board keeps its true lines"); break; }
          if (hasPicture && !pictureFault) { settle("the fault is in its writing"); break; }
          if (hasPicture && picture?.redrawn) { settle("its picture already had its one redraw"); break; }
          if (args.hurry?.() || clock.left() < (hasPicture ? 130_000 : 80_000)) { settle("no time for a redraw"); break; }
          const again = await generateSpec(openai, args.topic, plan, beat, clock, [...extra, lookFeedback(verdict.problems)], false, opts);
          dropEmptyRows(again.spec);
          const redraw = hasPicture ? serious.filter((p) => p.where !== "writing").map((p) => p.detail) : undefined;
          const pic = await illustrate(openai, args.userId, sessionId, beat, again.spec, log, clock, undefined, course, { redraw });
          lookCost += again.costUsd + pic.costUsd;
          if (again.attempts < 0) { settle("its redraw could not be written"); break; }
          spec = { ...pic.spec };
          picture = pic.picture;
          continue;
        }
        if (round === 0 && !args.hurry?.() && clock.left() > 80_000) {
          const again = await generateSpec(openai, args.topic, plan, beat, clock, [...extra, lookFeedback(verdict.problems)], false, opts);
          const pic = await illustrate(openai, args.userId, sessionId, beat, again.spec, log, clock, plainRebuild(openai, args.topic, plan, beat, clock, extra), course);
          lookCost += again.costUsd + pic.costUsd;
          if (again.attempts >= 0) { spec = { ...pic.spec }; picture = pic.picture; continue; }
        }
        // Refused after its one redraw: an exact figure drawn by code when one fits (a library diagram
        // outside course lessons) — else the better of the drawings it has, never a plain board.
        const about = `${beat.title} ${beat.brief} ${beat.script}`;
        const drawnNow = spec.stage.kind === "figure" ? spec.stage.component : undefined;
        const component = figureFor(`${beat.title} ${beat.brief} ${beat.script.split(/(?<=[.!?])\s+/)[0] ?? ""}`) ?? figureFor(about);
        const kit = component && component.name !== drawnNow && componentFitsSubject(component.name, about) && !(beat.course && offInCourses(component.name)) ? component : undefined;
        const asset = kit || (beat.course && offInCourses("library")) ? null : findLibraryFigure(`${beat.title} ${beat.brief} ${beat.objects.join(" ")}`, beat.requiredVisual?.mustShow ?? []);
        if (!kit && !asset) { settle("no exact figure fits"); break; }
        const refusedAs = `The first drawing of this board was refused (${serious.map((p) => p.kind).join(", ")}); it is taught on a checked figure instead.`;
        const rebuilt = kit
          ? await generateSpec(openai, args.topic, plan, { ...beat, stage: "figure", figure: kit.name, figureAsset: undefined, objects: labelledFigureParts(kit, beat.requiredVisual?.mustShow ?? []) }, clock, [...extra, refusedAs], true)
          : await generateSpec(openai, args.topic, plan, { ...beat, stage: "figure", figure: "library", figureAsset: asset! }, clock, [...extra, refusedAs], true);
        lookCost += rebuilt.costUsd;
        spec = { ...rebuilt.spec };
        log.push(`${beat.id}: ${kit ? `replaced by the code-drawn figure "${kit.name}"` : `replaced by the library figure "${asset!.id}"`} after the look refused it${round ? " twice" : ""}`);
        round = 1;
      } catch (error) {
        log.push(`${beat.id}: redraw after the look failed — ${(error as Error).message}`);
        settle("the redraw failed");
        break;
      }
    }
  }
  // A course picture that passed its own check is shared with other students only when the board's look
  // passed too (or could not be had) — never one the look refused.
  if (picture?.remember && lookPassed !== false) await picture.remember().catch(() => undefined);
  // EVERY PART DRAWN IS NAMED (lib/canvas/labelMentions.ts): a diagram label the narration never says is
  // named on the sentence it appears on. Same number of sentences, so the board's timing is untouched.
  let mentionCost = 0;
  if (made.attempts >= 0 && !beat.overview && process.env.CANVAS_LABEL_MENTIONS !== "off") {
    const named = await bounded(mentionLabels((system, user, max) => jsonCall(client(), PLAN_MODEL, system, user, max), spec, beat.script), 20_000, "label mentions").catch(() => null);
    if (named?.mentioned) {
      beat.script = named.script;
      log.push(`${beat.id}: ${named.mentioned} diagram label(s) Aria never said are now named as they are drawn`);
    }
    mentionCost = named?.costUsd ?? 0;
  }
  // THE "CHECK IT" CARD (lib/canvas/checkCard.ts): written and verified after the board, shown when
  // Aria finishes it. A card that cannot be verified is left off — it never fails or holds the board.
  // Only on about every third board, and never in a strict PDF lesson (lib/canvas/checkCardPlan.ts).
  let cardCost = 0;
  const cardHere = checkCardBoards(plan, args.strictSource?.mode === "strict").has(index);
  // In a lesson full of sliders the question takes this board's slider's place (the slider stays if
  // no card can be verified).
  const taskYields = Boolean(spec.interaction && (spec.interaction.kind === "try" || spec.interaction.kind === "draw") && tasksGiveWay(plan));
  if (cardHere && (!spec.interaction || taskYields) && spec.stage.kind !== "exam" && !beat.overview && !beat.refresher && process.env.CANVAS_CHECK_CARDS !== "off") {
    const block = args.document?.contentBlocks?.[plan.filter((b) => !b.refresher).indexOf(beat)];
    const made = await writeCheckCard(client(), beat, spec, { level: args.document?.lesson?.level, teachingHints: block?.teachingHints }).catch((error) => ({ card: null, costUsd: (error as { costUsd?: number }).costUsd ?? 0, log: `no check card — ${(error as Error).message}` }));
    cardCost = made.costUsd;
    log.push(`${beat.id}: ${made.log}`);
    if (made.card) spec.interaction = made.card;
  }
  // The student's own code, exactly: a token the board model changed while copying is put back.
  const listing = codeDoc && spec.stage.kind === "code" && beat.source?.listing ? documentListings(codeDoc).find((l) => l.n === beat.source!.listing) : undefined;
  if (listing && spec.stage.kind === "code") {
    const [from, to] = beat.source?.lines ?? [1, listing.lines.length];
    const faithful = faithfulCodeLines(spec.stage.lines, listing, from, to);
    if (faithful.fixed) {
      spec.stage = { ...spec.stage, lines: faithful.lines };
      log.push(`${beat.id}: ${faithful.fixed} code line(s) put back to the document's text`);
    }
  }
  applyConceptColours(spec, colours);

  connectToEarlier(spec, plan, index, args.earlier, sessionId);
  // The player reads the course lesson's subject from the board itself (lib/canvas/lessonSubject.ts).
  if (beat.subject) spec.subject = beat.subject;

  // The recap's visits go back to boards the student has seen, by their deterministic ids.
  if (beat.overview) spec.overview = true;
  if (beat.refresher) spec.refresher = true;
  const earlierIds = new Set(plan.slice(0, index).map((b) => b.id));
  spec.cues = spec.cues.filter((c) => c.action !== "visit" || earlierIds.has(c.beat ?? ""));
  if (beat.overview && !spec.cues.some((c) => c.action === "visit")) spec.cues = [...spec.cues, ...recapTour(beat, plan.slice(0, index))];
  spec.cues = spec.cues.map((c) => (c.action === "visit" ? { ...c, beat: canvasBeatId(sessionId, c.beat!) } : c));

  // A course picture is talked through (lib/canvas/pictureTalk.ts): the pointer goes to each part of it
  // every time Aria names it, as she says it.
  if (beat.course) {
    const before = spec.cues.length;
    spec.cues = partMentionCues(spec, beat.script);
    if (spec.cues.length !== before) log.push(`${beat.id}: picture talked through — ${spec.cues.filter((c) => c.action === "circle" || c.action === "point").length} pointer moves`);
  }
  // The pen never points at nothing (lib/canvas/cueRepair.ts): checked on the board as it ships.
  const shipped = layoutPanel(spec);
  const onBoard = new Set([...Object.keys(shipped.targets), ...shipped.marks.flatMap((m) => (m.type === "graph" ? (m.spec.markers ?? []).map((k) => k.id) : []))]);
  const pen = repairCues(spec, beat, onBoard);
  if (pen.moved || pen.dropped) log.push(`${beat.id}: pen cues — ${pen.moved} moved to what the sentence names, ${pen.dropped} dropped`);
  spec.cues = pen.cues;

  log.unshift(`${beat.id}: ${spec.stage.kind} in ${Math.round((Date.now() - started) / 1000)}s, ${made.attempts < 0 ? "FALLBACK board" : `${made.attempts} attempt(s)`}`);
  const written = canvasBeat(canvasBeatId(sessionId, beat.id), beat, index, spec);
  // The passages this board teaches, and the one each sentence is about: the PDF panel's box.
  if (args.strictSource && beat.source?.blocks?.length) {
    written.sourceBlockIds = beat.source.blocks;
    // On a code board the box follows the lit lines down the printed listing.
    const followCode = spec.stage.kind === "code" && args.strictSource.mode === "strict" ? codeSentenceBlocks(args.strictSource.doc, beat, spec.stage) : null;
    const sentenceBlocks = followCode ?? beat.sentenceBlocks;
    if (sentenceBlocks?.length) written.sentenceBlockIds = sentenceBlocks;
  }
  // The links at the foot of the slide: the pages behind what this board actually says.
  if (args.webSources) {
    const cited = sourcesForText(args.webSources, `${beat.title} ${beat.brief ?? ""} ${beat.script}`);
    if (cited.length) written.sources = cited.map(({ title, url, site }) => ({ title, url, site }));
  }
  return { beat: written, costUsd: made.costUsd + pictured.costUsd + cardCost + mentionCost + lookCost, fallback: made.attempts < 0 || Boolean(spec.visualFallback), log };
}

/**
 * Rewrites the scripts written above the student's reading level, keeping every fact, the order and
 * EXACTLY the number of sentences (each sentence is timed to its board's drawing). A rewrite that
 * changes the count, or is no easier, is not used. Best effort: on any failure the plan stands.
 */
export async function pitchScripts(openai: ReturnType<typeof client>, beats: CanvasPlanBeat[], grade: number): Promise<{ costUsd: number }> {
  const rules = gradeRules(grade);
  let costUsd = 0;
  // Two passes at most: a first rewrite often lands a grade short, and the second sees its own score.
  for (let pass = 1; pass <= 2; pass++) {
    // One grade over is already too hard (a teacher, 2026-10-23: "overcomplicated"); it was two.
    const tooHard = beats.filter((b) => readingGrade(b.script) > grade + 1);
    if (tooHard.length === 0) break;
    const system = `You rewrite a teacher's spoken narration so a student reading at GRADE ${grade} follows every word. For each script: keep every fact and idea, the same order, and EXACTLY the same number of sentences — each sentence is timed to a drawing. Aim for grade ${Math.max(2, grade - 1)}: sentences of at most ${rules.sentenceWords} words, mostly short everyday words of one or two syllables ("main government", not "central authority"; "fights inside", not "internal conflicts"). Make it sound like a friendly tutor talking to the student ("you"), not a textbook: no "whereas", "hence", "thus". A technical term the lesson needs stays, followed by a few plain words saying what it means. Never add new content. SIMPLER NEVER MEANS WRONG: a plainer sentence must stay exactly as true as the original — never turn "vaccine antigens come from a harmless or killed form of the germ" into "antigens cause no disease", or "Newton's laws describe objects at rest and in motion" into "motion includes staying still". Return JSON only: {"scripts": {"<id>": "<rewritten script>"}}.`;
    const user = tooHard.map((b) => `${b.id} (${canvasSentences(b.script).length} sentences, reads at grade ${readingGrade(b.script)}):\n${b.script}`).join("\n\n");
    try {
      const { json, costUsd: c } = await bounded(jsonCall(openai, PITCH_MODEL, system, user, 5000), 45_000, "pitch");
      costUsd += c;
      const out = (json && typeof json === "object" ? (json as Record<string, unknown>).scripts : null) as Record<string, unknown> | null;
      for (const b of tooHard) {
        const next = typeof out?.[b.id] === "string" ? mathsEllipsis((out[b.id] as string).replace(/\s+/g, " ").trim()) : "";
        if (!next || canvasSentences(next).length !== canvasSentences(b.script).length) continue;
        if (readingGrade(next) >= readingGrade(b.script)) continue;
        console.log(`[pitch] ${b.id} pass ${pass}: grade ${readingGrade(b.script)} -> ${readingGrade(next)} (target ${grade})`);
        b.script = next;
      }
    } catch (error) {
      console.warn(`[pitch] could not rewrite for grade ${grade}: ${(error as Error).message}`);
      break;
    }
  }
  return { costUsd };
}

const PITCH_MODEL = process.env.CANVAS_PITCH_MODEL ?? "gpt-5.6-luna";
/** The reading grade a course lesson's sentences are written at, at most (easy wording, owner 2026-10-24). */
const COURSE_READING_GRADE = 7;

/**
 * Every sentence of the lesson read once by a careful subject teacher; a sentence that is false, or
 * misleading enough that a student would learn something wrong, is replaced by ONE corrected sentence
 * making the same point (each sentence is timed to a drawing, so the count never changes). Best
 * effort: on any failure the plan stands.
 */
async function factCheckScripts(openai: ReturnType<typeof client>, topic: string, beats: CanvasPlanBeat[]): Promise<{ costUsd: number }> {
  const sentences = beats.flatMap((b) => canvasSentences(b.script).map((text, i) => ({ key: `${b.id}.${i}`, text })));
  if (!sentences.length) return { costUsd: 0 };
  const system = `You are a careful subject teacher checking a lesson's narration for factual errors before students hear it. Lesson: "${topic}". Flag ONLY a sentence that is false, or misleading enough that a student would learn something wrong (a wrong definition, a wrong cause, an example that shows a different law, a number or unit that is wrong). Never flag simplification, style, missing detail or a debatable emphasis. For each flagged sentence give ONE corrected sentence that makes the same teaching point, as plainly worded as the original and about as long. Return JSON only: {"fixes": {"<key>": "<corrected sentence>"}} — an empty object when every sentence is right.`;
  const user = sentences.map((s) => `${s.key}: ${s.text}`).join("\n");
  try {
    const { json, costUsd } = await bounded(jsonCall(openai, PITCH_MODEL, system, user, 3000), 40_000, "fact-check");
    const fixes = (json && typeof json === "object" ? (json as Record<string, unknown>).fixes : null) as Record<string, unknown> | null;
    for (const b of beats) {
      const said = canvasSentences(b.script);
      let changed = false;
      said.forEach((text, i) => {
        const next = fixes?.[`${b.id}.${i}`];
        if (typeof next !== "string" || !next.trim() || canvasSentences(next.trim()).length !== 1) return;
        console.log(`[fact-check] ${b.id}.${i}: "${text}" -> "${next.trim()}"`);
        said[i] = mathsEllipsis(next.trim());
        changed = true;
      });
      if (changed) b.script = said.join(" ");
    }
    return { costUsd };
  } catch (error) {
    console.warn(`[fact-check] skipped: ${(error as Error).message}`);
    return { costUsd: 0 };
  }
}

/**
 * Rewrites, in place, the sentences of a strict lesson that bring in material their passages lack:
 * each becomes ONE sentence making the same point from the passages alone. A rewrite that is not
 * exactly one sentence is not used (each sentence is timed to its board), and nothing is deleted
 * here — groundSourcePlan deletes whatever still strays. Best effort: on failure the plan stands.
 */
async function repairSentences(
  openai: ReturnType<typeof client>,
  flagged: Array<{ beat: string; index: number; sentence: string; passages: string }>,
  beats: CanvasPlanBeat[],
): Promise<{ costUsd: number; fixed: number }> {
  const system = `You correct a lesson that must be taught STRICTLY from the student's source. Each sentence below says something its passages do not. Rewrite it as ONE spoken sentence that makes the same teaching point using only what its passages state — their facts, terms, numbers and code (reading code aloud in plain words is fine: "when x is smaller", "it returns"). Never add a fact, example, analogy or application the passages do not state. If the passages do not support the point at all, return "". Never use abbreviations with full stops. Return JSON only: {"fixes": {"<key>": "<one sentence, or empty>"}}.`;
  const user = flagged.slice(0, 40).map((f) => `KEY ${f.beat}#${f.index}\nSENTENCE: ${f.sentence}\nITS PASSAGES:\n${f.passages}`).join("\n\n");
  try {
    const { json, costUsd } = await bounded(jsonCall(openai, PITCH_MODEL, system, user, 6000), 60_000, "strict repair");
    const fixes = (json && typeof json === "object" ? (json as Record<string, unknown>).fixes : null) as Record<string, unknown> | null;
    let fixed = 0;
    for (const f of flagged) {
      const next = typeof fixes?.[`${f.beat}#${f.index}`] === "string" ? (fixes[`${f.beat}#${f.index}`] as string).replace(/\s+/g, " ").trim() : "";
      if (!next || canvasSentences(next).length !== 1) continue;
      const beat = beats.find((b) => b.id === f.beat);
      if (!beat) continue;
      const sentences = canvasSentences(beat.script);
      if (sentences[f.index] !== f.sentence) continue;
      sentences[f.index] = mathsEllipsis(next);
      beat.script = sentences.join(" ");
      fixed++;
    }
    return { costUsd, fixed };
  } catch (error) {
    console.warn(`[canvas] strict repair failed: ${(error as Error).message}`);
    return { costUsd: (error as { costUsd?: number }).costUsd ?? 0, fixed: 0 };
  }
}

/** The spec a written canvas Beat carries, if it is one. */
export function canvasSpecOf(beat: Beat | null | undefined): CanvasBoardSpec | undefined {
  const op = beat?.draw?.ops.find((o) => (o as { kind: string }).kind === "canvasBoard") as { spec?: CanvasBoardSpec } | undefined;
  return op?.spec;
}

/**
 * Every board of cards (up to `max` close-ups in all) becomes a tour plus close-ups. One small call per
 * board; a board whose answer does not check out is kept exactly as it was.
 */
async function addCardDives(openai: ReturnType<typeof client>, topic: string, beats: CanvasPlanBeat[], max = 12): Promise<{ beats: CanvasPlanBeat[]; boards: number; dives: number; costUsd: number }> {
  let room = max;
  const chosen = beats.filter((b) => diveCandidate(b) && (room -= b.objects.length) >= 0);
  let costUsd = 0;
  const answers = new Map<string, NonNullable<ReturnType<typeof parseDives>>>();
  await Promise.all(chosen.map(async (beat) => {
    try {
      const user = `Lesson: ${topic}${beat.audience ? `\nThe student: ${beat.audience}` : ""}\n\nBoard: ${beat.title}\nWhat it shows: ${beat.brief}\nIts cards, in order (objects): ${beat.objects.join(", ")}\n\nWhat Aria says over it now:\n${beat.script}`;
      const { json, costUsd: c } = await bounded(jsonCall(openai, PLAN_MODEL, DIVE_PROMPT, user, 5000), 60_000, `dives ${beat.id}`);
      costUsd += c;
      const parsed = parseDives(beat, json);
      if (parsed) answers.set(beat.id, parsed);
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
    }
  }));
  const dives = [...answers.values()].reduce((n, a) => n + a.dives.length, 0);
  return { beats: answers.size ? withDives(beats, answers) : beats, boards: answers.size, dives, costUsd };
}

const SPLIT_PROMPT = `You split what Aria says about ONE code listing over CONSECUTIVE code boards of a lesson, one board per piece of the listing. Return JSON only: {"boards": [{"title": string, "script": string, "board": [{"s": number, "text": string}]}]} with exactly one entry per piece, in order.
- Each board's script walks through ITS piece's lines in order (what each part does and why), 4 to 8 spoken sentences ending in . ! or ?, one idea each, at most about 25 words. Keep what the existing narration says about those lines, in its words where it can; explain any line it never explained. Say only what the code and the existing narration say: no outside facts.
- NEVER say a line number aloud; name the code instead ("the null check", "the call to balance").
- "title": what that piece does, at most 6 words ("The balance routine"), no two alike.
- "board": for at least 7 in 10 sentences, the short phrase written on the board as that sentence is said (s = 0-based sentence number, at most 34 characters).`;

/**
 * A LISTING NO PLAN COULD SPLIT IS SPLIT BY CODE. "explain me AVL tree coding" (strict) planned the
 * 37-line insert listing on one board three times over; the board showed its first 18 lines and
 * balance() stopped mid-function (PDF bench, 2026-10-19). Each listing whose boards still show more
 * lines than a board holds, or leave lines on no board, is cut into pieces where statements end
 * (splitListing), and one small call narrates each piece from what the boards said about it.
 */
async function splitCodeBoards(openai: ReturnType<typeof client>, doc: SuprnotesLessonInput, beats: CanvasPlanBeat[], strict = false, wanted: DocumentListing[] = []): Promise<{ beats: CanvasPlanBeat[]; count: number; costUsd: number }> {
  const listings = documentListings(doc);
  let costUsd = 0;
  let out = [...beats];
  let count = 0;
  const template = out.find((b) => b.stage === "code");
  if (!template) return { beats, count, costUsd };
  for (const listing of listings) {
    const showing = out.filter((b) => b.stage === "code" && b.source?.listing === listing.n);
    const leftOut = !showing.length && wanted.some((l) => l.n === listing.n);
    if (!leftOut && (!showing.length || (!overlongCodeBoards(doc, showing).length && !listingGaps(doc, showing).length))) continue;
    const pieces = splitListing(listing, extraBoardsForListings([listing]) + 1);
    if (!leftOut && pieces.length < 2 && !listingGaps(doc, showing).length) continue;
    try {
      // Strict: the narration says what the pages say about this code, and reads each line plainly — nothing more.
      const pageText = strict ? (doc.contentBlocks ?? []).filter((x) => x.pageNumber === listing.page || x.pageNumber === listing.page - 1).map((x) => [x.heading, x.text].filter(Boolean).join(" ")).join("\n").slice(0, 4000) : "";
      const strictLine = strict ? `\n\nSTRICT: the student is taught ONLY from their document. Every sentence either says what the DOCUMENT TEXT below says about this code, or reads a line in plain words (what it checks, assigns, calls or returns). Never a reason, purpose, example or fact the document text does not give.\n\nDOCUMENT TEXT:\n${pageText}` : "";
      const said = showing.length ? showing.map((b) => `${b.title}: ${b.script}`).join("\n") : "(nothing yet: this listing is new to the lesson)";
      const user = `Listing ${listing.n}${listing.caption ? ` (${listing.caption})` : ""}.${strictLine}\n\nWhat Aria says over it now:\n${said}\n\n${pieces.map(([a, z], k) => `PIECE ${k + 1} (lines ${a} to ${z}):\n${listingText(listing, a, z)}`).join("\n\n")}`;
      const { json, costUsd: c } = await bounded(jsonCall(openai, PLAN_MODEL, SPLIT_PROMPT, user, 4000), 60_000, `split listing ${listing.n}`);
      costUsd += c;
      const boards = Array.isArray((json as { boards?: unknown }).boards) ? ((json as { boards: Array<Record<string, unknown>> }).boards) : [];
      const written = boards.map((b) => ({ title: typeof b.title === "string" ? b.title.trim() : "", script: typeof b.script === "string" ? mathsEllipsis(b.script.replace(/\s+/g, " ").trim()) : "", board: b.board }));
      if (written.length !== pieces.length || written.some((w) => !w.title || canvasSentences(w.script).length < 3)) continue;
      const first = showing[0] ?? { ...template, brief: listing.caption || `Listing ${listing.n}`, objects: [], inside: null, carry: [], interaction: null, source: { pages: [listing.page] } };
      const replaced = pieces.map(([a, z], k): CanvasPlanBeat => ({
        ...first,
        title: written[k].title,
        script: written[k].script,
        boardNotes: formulaNotes(boardNotesOf(written[k].board, canvasSentences(written[k].script).length).boardNotes, written[k].script),
        interaction: k === 0 ? first.interaction : null,
        teachingCycle: undefined,
        source: { pages: first.source?.pages ?? [listing.page], ...(first.source?.blocks ? { blocks: first.source.blocks } : {}), listing: listing.n, lines: [a, z] },
      }));
      // A listing left out goes after the last code board of an earlier listing (before the first code board otherwise).
      const after = out.reduce((last, b, i) => (b.stage === "code" && (b.source?.listing ?? 0) < listing.n ? i : last), -1);
      const at = showing.length ? out.indexOf(first) : after >= 0 ? after + 1 : out.indexOf(template);
      out = showing.length ? [...out.slice(0, at), ...replaced, ...out.slice(at + 1).filter((b) => !showing.includes(b))] : [...out.slice(0, at), ...replaced, ...out.slice(at)];
      count++;
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
    }
  }
  // Boards are numbered again in order (b1, b2, …); a board "inside" another follows its new id.
  if (count) {
    const ids = new Map(beats.map((b) => [b.id, b.id]));
    out = out.map((b, i) => { ids.set(b.id, `b${i + 1}`); return { ...b, id: `b${i + 1}` }; });
    out = out.map((b) => (b.inside ? { ...b, inside: { ...b.inside, beat: ids.get(b.inside.beat) ?? b.inside.beat } } : b));
  }
  return { beats: out, count, costUsd };
}

const REPAIR_PROMPT = `You revise what Aria says over ONE board of a school lesson so it teaches every key point it is missing. Return JSON only: {"script": string, "board": [{"s": number, "text": string}]}.
- Keep every sentence already there, in its order and style; add the missing key points where they belong, one sentence each, with the reason or mechanism when the point is a how or why. Spoken sentences ending in . ! or ?, one idea each, at most about 25 words; at most 13 sentences in all.
- "board": for at least 7 in 10 sentences, the short phrase written on the board as that sentence is said (s = 0-based sentence number, at most 34 characters).`;

/** Each board that left out key points gets its own script rewritten to include them (one small call each, at most four). */
async function repairBoardScripts(openai: ReturnType<typeof client>, beats: CanvasPlanBeat[], gaps: CoverageGap[]): Promise<{ beats: CanvasPlanBeat[]; count: number; costUsd: number }> {
  let costUsd = 0;
  let count = 0;
  const out = [...beats];
  await Promise.all(gaps.slice(0, 4).map(async (gap) => {
    const id = /^(b\d+)/.exec(gap.board)?.[1];
    const at = out.findIndex((b) => b.id === id);
    if (at < 0 || (!gap.missing.length && !(gap.depth ?? []).length)) return;
    const beat = out[at];
    try {
      const user = `Board: ${beat.title}\nWhat Aria says now:\n${beat.script}\n\nMissing key points (teach each):\n${gap.missing.map((m) => `- ${m}`).join("\n") || "(none)"}${gap.depth?.length ? `\nAlso fix: ${gap.depth.join("; ")}` : ""}`;
      const { json, costUsd: c } = await bounded(jsonCall(openai, PLAN_MODEL, REPAIR_PROMPT, user, 2500), 40_000, `repair ${beat.id}`);
      costUsd += c;
      const r = json as { script?: unknown; board?: unknown };
      const script = typeof r.script === "string" ? mathsEllipsis(r.script.replace(/\s+/g, " ").trim()) : "";
      if (canvasSentences(script).length < canvasSentences(beat.script).length) return;
      // The rewrite's notes get the same formula notes as a planned board (a repaired board shipped
      // with no planned notes, and the writer's own left its answer out; maths benchmark round 1).
      const notes = formulaNotes(boardNotesOf(r.board, canvasSentences(script).length).boardNotes, script);
      out[at] = { ...beat, script, boardNotes: notes };
      count++;
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
    }
  }));
  return { beats: out, count, costUsd };
}
