import { checkNumbers, numberIssuesText } from "./numberCheck";
import "server-only";

import type { Beat } from "../lessonContent";
import type { ProgressiveBeatPlan, ProgressiveLectureInput } from "../progressiveLectureTypes";
import { bounded, canvasBeat, canvasSentences, client, fallbackSpec, generateSpec, illustrate, jsonCall, PLAN_MODEL, plainRebuild, validatePlan, type Clock } from "./generate";
import { withRefresherOnlyIfOffered } from "./plan";
import { gradeRules, readingGrade } from "../studentCard";
import { layoutPanel } from "./layout";
import { canvasBoardCount, canvasBoardDurationMs, canvasPlanRequest, canvasPolicy, canvasRefresherAllowed, curriculumDocumentOf, documentExtraBoards, referenceDocumentOf, strictDocumentOf, videoDocumentOf } from "./lessonRequest";
import { codeSentenceBlocks, groundSourcePlan, strictBoardLines, ungroundedInPlan, videoBoardLines, videoParts } from "./sourceLessons";
import { assignListings, documentBoardLines, documentListings, faithfulCodeLines, overlongCodeBoards, uncoveredPages } from "./documentContext";
import type { SuprnotesLessonInput } from "../suprnotes";
import { policyForBoards } from "../teachingPolicy";
import { applyConceptColours, planConceptColours, recapTour } from "./lessonPasses";
import { CANVAS_PLAN_PROMPT } from "./prompts";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";
import type { PlanningKnowledge } from "../knowledge/graph";
import { slug } from "./validate";
import { sourcesForText, type SourcePack } from "../webSources";
import { applyLessonVisualPolicy, type VisualPolicyMode } from "./visualPolicy";
import { withCourseContract } from "./sourceContract";
import { findLibraryFigure } from "../figures/library";
import { courseCoverageGaps, coverageMessage, requiredTermsOf, type CoverageGap } from "./courseCoverage";
import { boardNotesOf } from "./plan";
import { examBoardSpec } from "./examBoard";
import { writeCheckCard } from "./checkCard";
import { checkCardBoards } from "./checkCardPlan";

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

/** The Beat id of a canvas board — deterministic, so the recap can name boards not yet written. */
export function canvasBeatId(sessionId: string, planId: string): string {
  return `cv-${sessionId}-${planId}`;
}

export async function planCanvasLecture(input: ProgressiveLectureInput, knowledge?: PlanningKnowledge): Promise<{ plan: ProgressiveBeatPlan[]; costUsd: number }> {
  const openai = client();
  const request = canvasPlanRequest(input, knowledge);
  // The approved outline sized the lecture; the plan may not grow it (only a refresher may be added).
  const outlined = canvasBoardCount(input);
  // A document's long code listings may each take consecutive boards (lib/canvas/documentContext.ts).
  const allowed = outlined > 0 ? outlined + documentExtraBoards(input) + (canvasRefresherAllowed(input, knowledge) ? 1 : 0) : 0;
  // The whole document travels in the request: more to read, and code boards with longer scripts.
  const reference = referenceDocumentOf(input);
  // Taught strictly from a source (lib/canvas/sourceLessons.ts): a strict-mode PDF or a video.
  const strictDoc = strictDocumentOf(input);
  const video = videoDocumentOf(input);
  const sourceMode = strictDoc ? "strict" as const : video ? "video" as const : null;
  const videoBoards = video ? videoParts(video).length : 0;
  // The document whose code listings the boards copy: a reference or strict PDF.
  const document = reference ?? strictDoc;
  const fromDocument = Boolean(reference || strictDoc || video);
  let costUsd = 0;
  let lastError = "";
  // A strict lecture on the selected pages (no question) must teach every one of them: a plan that
  // leaves a page out is sent back, naming it — one more try than other lectures get.
  const covering = Boolean(strictDoc) && input.sourceScope?.breadth.kind === "whole";
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
      if (plan && allowed > 0 && plan.beats.length > allowed) {
        lastError = `it had ${plan.beats.length} boards; the outline has exactly ${outlined}${allowed > outlined ? ` (at most ${allowed} with the extra boards allowed)` : ""}`;
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
      const overlong = plan && document ? overlongCodeBoards(document, plan.beats) : [];
      if (overlong.length && attempt < maxAttempts) {
        lastError = overlong.join("; ");
        console.log(`[canvas] plan sent back: ${lastError}`);
        continue;
      }
      const missing = plan && covering && strictDoc ? uncoveredPages(strictDoc, plan.beats) : [];
      if (missing.length && attempt < maxAttempts) {
        lastError = `page${missing.length === 1 ? "" : "s"} ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not taught by any board — this lecture covers EVERY selected page: keep the boards you have and add the ones these pages need, in page order, each naming its pages in "source.pages"`;
        console.log(`[canvas] plan sent back: ${lastError}`);
        continue;
      }
      if (missing.length) console.warn(`[canvas] strict plan still leaves out page(s) ${missing.join(", ")}`);
      if (plan) {
        // WORKED NUMBERS ARE CHECKED BY CODE (lib/canvas/numberCheck.ts): a script that says
        // "−(8π)²(0.060) = −121" goes back with the right value named (it is −37.9).
        const arithmetic = plan.beats.flatMap((beat) => checkNumbers(beat.script));
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
        } else if (!strictDoc) {
          // THE SAME VISUAL CONTRACT AS A COURSE for a typed, PDF or video lesson (owner, 2026-10-17:
          // "the same animation quality in courses, prompt, pdf and yt"): lib/canvas/sourceContract.ts.
          plan = { ...plan, beats: plan.beats.map(withCourseContract) };
        }
        // A video lesson is taught strictly from the video, but its boards get every visual a course
        // board gets (2026-10-17); only a strict PDF keeps to what the document itself shows.
        const visualMode: VisualPolicyMode = strictDoc ? "strict" : reference || video ? "reference" : curriculum ? "course" : "prompt";
        const visualPolicy = applyLessonVisualPolicy(plan.beats, { mode: visualMode, findAsset: findLibraryFigure });
        plan = { ...plan, beats: visualPolicy.beats };
        if (visualMode !== "strict" && visualPolicy.audit.meaningfulVisuals < visualPolicy.audit.targetMeaningfulVisuals && attempt < maxAttempts) {
          lastError = `only ${visualPolicy.audit.meaningfulVisuals} of ${plan.beats.length} boards used purpose-built visuals; use at least ${visualPolicy.audit.targetMeaningfulVisuals} appropriate stages such as illustration, flow, graph, equation, compare, molecule, atom-map or code instead of generic scenes`;
          console.log(`[canvas] plan sent back: ${lastError}`);
          continue;
        }
        console.log(`[canvas] visual policy (${visualMode}): ${visualPolicy.audit.illustrations} generated picture(s), ${visualPolicy.audit.meaningfulVisuals}/${plan.beats.length} purpose-built visual board(s)${visualPolicy.audit.changes.length ? ` — ${visualPolicy.audit.changes.join(" | ")}` : ""}`);
        // CHECK THE PITCH: a model told a grade still writes above it, so each script is measured
        // and the ones too hard for this student are rewritten simpler (lib/studentCard.ts).
        // The target is the policy's reading grade: plainer English or simpler language lowers it.
        const policy = canvasPolicy(input);
        if (policy) {
          const scriptsBefore = plan.beats.map((beat) => beat.script);
          const fixed = await pitchScripts(openai, plan.beats, policy.readingGrade);
          costUsd += fixed.costUsd;
          // A simpler rewrite must not break a number: a script whose calculations got worse goes back.
          plan.beats.forEach((beat, i) => {
            if (beat.script !== scriptsBefore[i] && checkNumbers(beat.script).length > checkNumbers(scriptsBefore[i]).length) beat.script = scriptsBefore[i];
          });
          // Each board is written later, from its plan beat alone: it carries the policy's board brief.
          const audience = policyForBoards(policy);
          for (const beat of plan.beats) beat.audience = audience;
        }
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
}): Promise<{ beat: Beat; costUsd: number; fallback: boolean; log: string[] }> {
  const { plan, index, sessionId } = args;
  const beat = plan[index];
  const started = Date.now();
  const clock: Clock = { left: () => BOARD_BUDGET_MS - (Date.now() - started) };
  const log: string[] = [];
  const colours = planConceptColours(plan);

  const extra: string[] = [];
  const shared = beat.objects.filter((o) => colours[o]);
  if (shared.length) extra.push(`Lesson colours — these things appear on several boards, so give them exactly these colours: ${shared.map((o) => `${o} ${colours[o]}`).join(", ")}.`);
  if (beat.audience) extra.push(`How to pitch this board for the student (presentation only — never change what it depicts): ${beat.audience}`);
  if (args.notes.length) extra.push(`What the student has shown so far (pitch the notes, cues and any interaction to it): ${args.notes.slice(-3).join(" ")}`);
  if (args.document) extra.push(...documentBoardLines(args.document, beat));
  if (args.strictSource) extra.push(...(args.strictSource.mode === "video" ? videoBoardLines(args.strictSource.doc, beat) : strictBoardLines(args.strictSource.doc, beat)));
  const codeDoc = args.document ?? (args.strictSource?.mode === "strict" ? args.strictSource.doc : null);

  let made: { spec: CanvasBoardSpec; costUsd: number; attempts: number };
  let pictured: { spec: CanvasBoardSpec; costUsd: number };
  // The exam-practice board is the lesson's mark scheme, built by code (lib/canvas/examBoard.ts).
  const exam = beat.stage === "exam" ? args.document?.contentBlocks?.find((b) => b.exam)?.exam : undefined;
  try {
    const openai = client();
    if (exam) made = { spec: examBoardSpec(beat, exam), costUsd: 0, attempts: 1 };
    else if (beat.stage === "exam") throw new Error("an exam board needs the lesson's mark scheme");
    else made = await generateSpec(openai, args.topic, plan, beat, clock, extra);
    pictured = await illustrate(openai, args.userId, sessionId, beat, made.spec, log, clock, plainRebuild(openai, args.topic, plan, beat, clock, extra));
  } catch (error) {
    log.push(`${beat.id}: ${(error as Error).message}`);
    made = { spec: fallbackSpec(beat), costUsd: 0, attempts: -1 };
    pictured = { spec: made.spec, costUsd: 0 };
  }
  const spec: CanvasBoardSpec = { ...pictured.spec };
  // THE "CHECK IT" CARD (lib/canvas/checkCard.ts): written and verified after the board, shown when
  // Aria finishes it. A card that cannot be verified is left off — it never fails or holds the board.
  // Only on about every third board, and never in a strict PDF lesson (lib/canvas/checkCardPlan.ts).
  let cardCost = 0;
  const cardHere = checkCardBoards(plan, args.strictSource?.mode === "strict").has(index);
  if (cardHere && !spec.interaction && spec.stage.kind !== "exam" && !beat.overview && !beat.refresher && process.env.CANVAS_CHECK_CARDS !== "off") {
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

  // "Inside" an earlier board: checked against that board when it is written.
  const parentIndex = beat.inside ? plan.findIndex((b) => b.id === beat.inside!.beat) : -1;
  const parent = parentIndex >= 0 && parentIndex < index ? args.earlier[parentIndex] : undefined;
  const insideOk = parentIndex >= 0 && parentIndex < index && (!parent || Boolean(layoutPanel(parent).targets[beat.inside!.object]));
  if (insideOk) spec.inside = { beat: canvasBeatId(sessionId, beat.inside!.beat), id: beat.inside!.object };
  else delete spec.inside;

  // "Carry" from the previous board: only a whole element of the same kind flies across.
  const previous = index > 0 ? args.earlier[index - 1] : undefined;
  const typesHere = new Map(layoutPanel(spec).marks.map((m) => [m.id, m.type]));
  const typesBefore = previous ? new Map(layoutPanel(previous).marks.map((m) => [m.id, m.type])) : null;
  const carry = (spec.carry ?? beat.carry).filter((id) => index > 0 && typesHere.has(id) && (!typesBefore || typesBefore.get(id) === typesHere.get(id)));
  if (carry.length) spec.carry = carry;
  else delete spec.carry;

  // The recap's visits go back to boards the student has seen, by their deterministic ids.
  if (beat.overview) spec.overview = true;
  if (beat.refresher) spec.refresher = true;
  const earlierIds = new Set(plan.slice(0, index).map((b) => b.id));
  spec.cues = spec.cues.filter((c) => c.action !== "visit" || earlierIds.has(c.beat ?? ""));
  if (beat.overview && !spec.cues.some((c) => c.action === "visit")) spec.cues = [...spec.cues, ...recapTour(beat, plan.slice(0, index))];
  spec.cues = spec.cues.map((c) => (c.action === "visit" ? { ...c, beat: canvasBeatId(sessionId, c.beat!) } : c));

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
  return { beat: written, costUsd: made.costUsd + pictured.costUsd + cardCost, fallback: made.attempts < 0 || Boolean(spec.visualFallback), log };
}

/**
 * Rewrites the scripts written above the student's reading level, keeping every fact, the order and
 * EXACTLY the number of sentences (each sentence is timed to its board's drawing). A rewrite that
 * changes the count, or is no easier, is not used. Best effort: on any failure the plan stands.
 */
async function pitchScripts(openai: ReturnType<typeof client>, beats: CanvasPlanBeat[], grade: number): Promise<{ costUsd: number }> {
  const rules = gradeRules(grade);
  let costUsd = 0;
  // Two passes at most: a first rewrite often lands a grade short, and the second sees its own score.
  for (let pass = 1; pass <= 2; pass++) {
    const tooHard = beats.filter((b) => readingGrade(b.script) > grade + 2);
    if (tooHard.length === 0) break;
    const system = `You rewrite a teacher's spoken narration so a student reading at GRADE ${grade} follows every word. For each script: keep every fact and idea, the same order, and EXACTLY the same number of sentences — each sentence is timed to a drawing. Aim for grade ${Math.max(2, grade - 1)}: sentences of at most ${rules.sentenceWords} words, mostly short everyday words of one or two syllables ("main government", not "central authority"; "fights inside", not "internal conflicts"). A technical term the lesson needs stays, followed by a few plain words saying what it means. Never add new content. Return JSON only: {"scripts": {"<id>": "<rewritten script>"}}.`;
    const user = tooHard.map((b) => `${b.id} (${canvasSentences(b.script).length} sentences, reads at grade ${readingGrade(b.script)}):\n${b.script}`).join("\n\n");
    try {
      const { json, costUsd: c } = await bounded(jsonCall(openai, PITCH_MODEL, system, user, 5000), 45_000, "pitch");
      costUsd += c;
      const out = (json && typeof json === "object" ? (json as Record<string, unknown>).scripts : null) as Record<string, unknown> | null;
      for (const b of tooHard) {
        const next = typeof out?.[b.id] === "string" ? (out[b.id] as string).replace(/\s+/g, " ").trim() : "";
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
      sentences[f.index] = next;
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
      const script = typeof r.script === "string" ? r.script.replace(/\s+/g, " ").trim() : "";
      if (canvasSentences(script).length < canvasSentences(beat.script).length) return;
      out[at] = { ...beat, script, ...boardNotesOf(r.board, canvasSentences(script).length) };
      count++;
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
    }
  }));
  return { beats: out, count, costUsd };
}
