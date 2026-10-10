import "server-only";

import type { Beat } from "../lessonContent";
import type { ProgressiveBeatPlan, ProgressiveLectureInput } from "../progressiveLectureTypes";
import { bounded, canvasBeat, canvasSentences, client, fallbackSpec, generateSpec, illustrate, jsonCall, PLAN_MODEL, validatePlan, type Clock } from "./generate";
import { gradeRules, readingGrade } from "../studentCard";
import { layoutPanel } from "./layout";
import { canvasBoardCount, canvasBoardDurationMs, canvasPlanRequest, canvasPolicy, canvasRefresherAllowed, documentExtraBoards, referenceDocumentOf, strictDocumentOf, videoDocumentOf } from "./lessonRequest";
import { codeSentenceBlocks, groundSourcePlan, strictBoardLines, ungroundedInPlan, videoBoardLines, videoParts } from "./sourceLessons";
import { assignListings, documentBoardLines, documentListings, faithfulCodeLines, overlongCodeBoards, uncoveredPages } from "./documentContext";
import type { SuprnotesLessonInput } from "../suprnotes";
import { policyForBoards } from "../teachingPolicy";
import { applyConceptColours, planConceptColours, recapTour } from "./lessonPasses";
import { CANVAS_PLAN_PROMPT } from "./prompts";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";
import type { PlanningKnowledge } from "../knowledge/graph";
import { slug } from "./validate";

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
      let plan = validatePlan(json);
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
        // CHECK THE PITCH: a model told a grade still writes above it, so each script is measured
        // and the ones too hard for this student are rewritten simpler (lib/studentCard.ts).
        // The target is the policy's reading grade: plainer English or simpler language lowers it.
        const policy = canvasPolicy(input);
        if (policy) {
          const fixed = await pitchScripts(openai, plan.beats, policy.readingGrade);
          costUsd += fixed.costUsd;
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
  try {
    const openai = client();
    made = await generateSpec(openai, args.topic, plan, beat, clock, extra);
    pictured = await illustrate(openai, args.userId, sessionId, beat, made.spec, log, clock);
  } catch (error) {
    log.push(`${beat.id}: ${(error as Error).message}`);
    made = { spec: fallbackSpec(beat), costUsd: 0, attempts: -1 };
    pictured = { spec: made.spec, costUsd: 0 };
  }
  const spec: CanvasBoardSpec = { ...pictured.spec };
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
  return { beat: written, costUsd: made.costUsd + pictured.costUsd, fallback: made.attempts < 0, log };
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
