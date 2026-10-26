import { keepSearchedCells, narratedStructureMismatch, repairPositionalIds, structureStateMismatch } from "./structure";
import { missingStackProblem } from "./callStack";
import { isLabLookTopic } from "./subjectLook";
import { checkNumbers } from "./numberCheck";
import { asCodeLesson, asMathsOrCs, plannedSubject } from "./lessonSubject";
import { repairEquationOrder } from "./equationRepair";
import { SKETCH_GUIDE } from "./sketch";
import "server-only";
import { complexNumbersIn } from "../figures/components/argand";

import { createHash, randomBytes } from "node:crypto";
import OpenAI from "openai";
import type { Beat } from "../lessonContent";
import { costFor } from "../modelPricing";
import { ILLUSTRATION_STYLE_VERSION, illustrationImageModel, pictureSubject } from "../illustratedBoard";
import { checkVectorDiagram, textbookDiagram } from "./textbookDiagram";
import { partNameKey, withMandatoryLabels } from "./labelPolicy";
import { layoutPanel, takeLayoutDrops } from "./layout";
import { takeLabelMismatches } from "./labelMatch";
import { takeFigureCutItems } from "../figures/cuts";
import { dropCrossingArrows } from "./layoutQa";
import { recapTour, unifyConceptColours } from "./lessonPasses";
import { CANVAS_PLAN_PROMPT, CANVAS_SPEC_PROMPT } from "./prompts";
import { canvasSentences, validatePlan, withRefresherOnlyIfOffered } from "./plan";
import { type CanvasBoardOp, type CanvasBoardSpec, type CanvasPlanBeat, type FigureStage, type IllustrationStage } from "./types";
import { slug, trimToFit, validateCanvasSpec, validationCutItems } from "./validate";
import { fittedNote } from "../text/fit";
import { fallbackSpec } from "./fallback";
import { figureComponent, figureFor } from "../figures/registry";
import { classifyInstructionalTask } from "./instructionalTask";
import { foreignFigureWords } from "../figures/foreignText";
import { functionGraphProblem } from "../figures/components/functionGraph";
import { textCollisions } from "../diagrams/clutter";
import { compileDiagram } from "../diagrams/render";
import { vectorDiagram } from "../diagrams/grammarWrite";
import type { FigureDrawing } from "../figures/types";
import { DRAWN_GUIDE, drawnFigure } from "../figures/drawn";
import { findLibraryFigure, libraryAssetTitle, libraryStageAsset } from "../figures/library";
import type { FigureComponent } from "../figures/types";
import { loadSharedCanvasImage, loadSharedDiagramRecord, saveCanvasImage, saveCanvasLecture, saveSharedCanvasImage, saveSharedDiagramRecord, type CanvasLecture } from "./store";
import { boardStructureProblem, isDataStructureTopic, withoutStructure } from "./structure";
import { dropBrokenRows, equationProblem, normalizeMath, orderNotesAsSaid, repeatsWorking, revealNotesWhenSaid, tidyNotes, withResultNotes } from "./equationCheck";
import { MATHS_CHECK_MODEL, mathsCheck, mathsFixes, patchNarration, type ExaminerSubject } from "./mathsCheck";
import { isMissingLine, writeMissingLines } from "./writeMissing";
import { codeSyncIssues, fixLineReferences } from "./codeSync";
import { createOpenAI } from "../openaiClient";
import { visualContractIssues } from "../curriculum/visualContract";
import { applyLessonVisualPolicy, labelledFigureParts, LIFE_SCIENCE, photographic, PHYSICAL, pictureRequestProblem, VECTOR_FORM } from "./visualPolicy";
import { DIAGRAM_GUIDE, acceptDiagram } from "../diagrams/write";
import { diagramCacheKey } from "../diagrams/cache";
import { componentFitsSubject, hasVisualForm, isGeometryOrMechanics, isRealProcess, needsVectorDiagram } from "../diagrams/visualForm";
import { dropContradictingPoints } from "./graphCheck";
import { auditBoardForRelease, figureDataIssues } from "./releaseAudit";
import { BOARD_REVIEW_PROMPT, boardReviewRequest, parseBoardReview, type BoardReview } from "./boardReview";
import { deferRevealLeaks, teachingCycleIssues } from "./predict";
import { alignToNarration, anchorNotes, unshownSentences } from "./narrationSync";
import { coursePicture, coursePicturesOn, CoursePictureError } from "./coursePicture";
import { withBoardWriting, withCoursePicture, type CourseBoardContext } from "./coursePicturePrompt";
import { mathsPicture, MathsPictureError, withMathsPicture } from "./mathsPicture";
import { asMathsPicture, withMathsBoardWriting, type MathsBoardContext } from "./mathsPicturePrompt";
import { courseCodeDiagramsOff, offInCourses } from "./courseFigures";


export type { CanvasLecture };

/**
 * A CANVAS LECTURE, end to end: topic → plan (scripts + stages) → one spec per board, in parallel →
 * pictures for illustration boards → Beat[] the ordinary LessonPlayer plays.
 *
 * Measured shape of the cost: the plan is one call; every board is one small JSON call (seconds, not
 * the minutes a generated React board takes); an illustration adds a picture (~20 s) and a locate
 * pass. Lectures and pictures are saved per student (lib/canvas/store.ts), so a replay costs nothing.
 *
 * THE TIME BUDGET. Azure Container Apps ends any request at ~240 s, and the whole lecture is made in
 * one streamed request. Measured runs took 64-154 s; the budget below keeps the slow tail inside the
 * limit by dropping OPTIONAL work as it runs short — a spec retry, a redrawn picture, the second
 * look at a picture's points — never a board.
 */

export const PLAN_MODEL = process.env.CANVAS_PLAN_MODEL ?? "gpt-5.6-luna";
const SPEC_MODEL = process.env.CANVAS_SPEC_MODEL ?? "gpt-5.6-luna";
const BUDGET_MS = Number(process.env.CANVAS_BUDGET_MS) || 195_000;

/** Time left before the lecture must be finished, for this generation. */
export type Clock = { left: () => number };

export type { CanvasPlanBeat };
export { canvasSentences, validatePlan } from "./plan";

export type CanvasProgress = { step: string; detail?: string };


export function client(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  return createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export function bounded<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export async function jsonCall(openai: OpenAI, model: string, system: string, user: string, maxTokens: number): Promise<{ json: unknown; costUsd: number }> {
  const res = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: maxTokens,
    reasoning_effort: "low",
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const costUsd = costFor(model, res.usage);
  const text = res.choices[0]?.message?.content ?? "";
  try {
    return { json: JSON.parse(text), costUsd };
  } catch {
    throw Object.assign(new Error(`model returned invalid JSON (${text.length} chars, finish=${res.choices[0]?.finish_reason})`), { costUsd });
  }
}

/* ── one board ────────────────────────────────────────────────────────────────────────────── */

/** Words that mean "this turns into that" — a board where a morph IS the explanation. */
const CHANGE_OF_STATE = /\b(melt|boil|freez|evaporat|condens|sublimat|becom|turn(?:s|ed|ing)? into|transform|convert|chang(?:e|es|ed|ing) into|grow(?:s|n)? into|split(?:s)? into|break(?:s)? down into)/i;

function specUserPrompt(topic: string, plan: CanvasPlanBeat[], beat: CanvasPlanBeat, lastError?: string, extra: string[] = [], vector?: FigureDrawing): string {
  const index = plan.indexOf(beat);
  const sentences = canvasSentences(beat.script);
  const outline = plan.map((b) => `${b.id}. ${b.title} (${b.stage})${b.id === beat.id ? "   ← THIS BOARD" : ""}`).join("\n");
  const previous = plan[index - 1];
  const parent = beat.inside ? plan.find((b) => b.id === beat.inside!.beat) : undefined;
  const lines = [
    `Lesson: ${topic}`,
    `Outline:\n${outline}`,
    "",
    `THIS BOARD: ${beat.id} — ${beat.title}`,
    `Stage: ${beat.stage}`,
    `What it shows: ${beat.brief}`,
    `Its objects (use these as element ids, and on a figure board label every one as a part): ${beat.objects.join(", ") || "(none named)"}`,
    ...(beat.stage === "figure" && beat.figure && figureComponent(beat.figure) ? [figureBrief(figureComponent(beat.figure)!)] : []),
    ...(beat.stage === "equation" && beat.figure && figureComponent(beat.figure) ? [workingFigureBrief(figureComponent(beat.figure)!)] : []),
    ...(beat.figure === "electromagnetism" && /\btransformers?\b|\bturns ratio\b|\bstep[- ](up|down)\b/i.test(`${beat.title} ${beat.brief} ${beat.script}`) ? [`This board is a TRANSFORMER: params.device MUST be "transformer" (never solenoid). Set np, ns and vp; code computes Vs = Vp × Ns / Np. Label primary-coil, secondary-coil and core.`] : []),
    ...(beat.figure === "coordinateGrid" && /\btransform/i.test(`${beat.title} ${beat.brief}`) ? [`This board is a GEOMETRIC TRANSFORMATION: give shape vertices and transform (reflection, rotation, translation or enlargement). Code computes A′B′C′.`] : []),
    ...(beat.stage === "figure" && beat.figure === "library" && beat.figureAsset ? [libraryBrief(libraryStageAsset(beat.figureAsset.id) ?? beat.figureAsset)] : []),
    ...(beat.stage === "figure" && beat.figure === "drawn" && vector ? [vectorBrief(vector)] : []),
    ...(beat.stage === "figure" && beat.figure === "drawn" && !vector ? [`FIGURE BOARD — draw the textbook diagram of what this board teaches (${beat.brief || beat.title}). ${DRAWN_GUIDE} Label 3-6 parts the narration names, each revealed ("s") on the sentence that first names it; cues point at part ids.`] : []),
    ...(beat.stage === "diagram" ? [DIAGRAM_GUIDE, `Draw the standard textbook diagram for: ${beat.brief || beat.title}.`] : []),
    ...(beat.stage === "sketch" ? [SKETCH_GUIDE, `Draw this board as a sketch: ${beat.brief || beat.title}.`] : []),
    ...(beat.stage === "flow" && /\bcycle\b/i.test(`${beat.title} ${beat.brief}`) ? [`This board is a CYCLE: use "arrangement": "cycle", with an arrow from the last stage back to the first.`] : []),
    ...(beat.requiredVisual?.mustShow.length ? [`The syllabus requires this board to visibly show: ${beat.requiredVisual.mustShow.join("; ")}. Each must be a drawn, labelled element, not only spoken.`] : []),
    `Narration, numbered (${sentences.length} sentences, s = 0 to ${sentences.length - 1}):`,
    ...sentences.map((s, i) => `[${i}] ${s}`),
    "",
    previous ? `The previous board (${previous.id}, "${previous.title}") drew: ${previous.objects.join(", ") || "nothing named"}.` : "This is the first board.",
    beat.carry.length ? `"carry": ${JSON.stringify(beat.carry)} — these fly across from the previous board; draw them on this board with exactly these ids.` : `"carry": [].`,
    parent ? `"inside": {"beat": "${parent.id}", "id": "${beat.inside!.object}"} — this board is a close-up inside the ${beat.inside!.object} on board ${parent.id}.` : `"inside": null.`,
    beat.interaction === "try"
      ? `"interaction": a "try" interaction is REQUIRED on this board, and the stage must react to its variables.`
      : beat.interaction
        ? `"interaction": a "${beat.interaction}" interaction is REQUIRED on this board.`
        : `"interaction": null.`,
    `"overview": ${beat.overview}.`,
    ...(beat.boardNotes?.length && beat.stage !== "exam" ? [`"notes": [] — the notes column is written for you from what Aria says, sentence by sentence; put everything else in the stage.`] : []),
    ...(CHANGE_OF_STATE.test(`${beat.title} ${beat.brief} ${beat.script}`) && (beat.stage === "flow" || beat.stage === "scene")
      ? [`This board is about something TURNING INTO something else: the element that changes MUST carry "becomes" on the sentence where it changes.`]
      : []),
    ...(beat.overview ? [`This is the recap. Earlier boards you can "visit": ${plan.slice(0, index).map((b) => `${b.id} "${b.title}"`).join(", ")}.`] : []),
    ...extra,
  ];
  if (lastError) lines.push("", `Your previous answer could not be used: ${lastError}. Return a complete, valid board.`);
  return lines.join("\n");
}

/**
 * The board writer's instructions for a library diagram (lib/figures/library.ts): a real textbook
 * diagram with its own words taken off. The model chooses which parts to label and how to name them;
 * the anchors are the diagram's own, filled in by the server.
 */
function libraryBrief(asset: NonNullable<CanvasPlanBeat["figureAsset"]>): string {
  const title = libraryAssetTitle(asset.id) ?? asset.id;
  return `FIGURE BOARD: the stage is a real textbook diagram ("${title}") shown exactly; its parts are already located, so a label always lands on its part. Return "stage": {"kind": "figure", "component": "library", "parts": [{"id", "name", "s", "say"}]} (no params, no asset — the server adds the diagram). Label 3 to 8 of these parts — every one the narration names — the ones the narration talks about (ids exactly as given): ${asset.parts.map((p) => `${p.id} ("${p.name}")`).join(", ")}. Give each the "name" the narration uses (at most 34 characters; keep the textbook term) and reveal it ("s") on the sentence that first names it, with a short "say". Never label a part this list does not have. Cues point at part ids.`;
}

/** The board writer's instructions for a vector diagram the server has already drawn and checked. */
function vectorBrief(drawing: FigureDrawing): string {
  return `FIGURE BOARD: the stage is a textbook diagram already drawn and checked for this board; its parts are located, so a label always lands on its part. Return "stage": {"kind": "figure", "component": "drawn", "parts": [{"id", "name", "s", "say"}]} (no drawing — the server adds it). Label every one of these parts the narration names (ids exactly as given): ${drawing.parts.map((p) => `${p.id} ("${p.name}")`).join(", ")}. Keep each "name" (at most 34 characters) and reveal it ("s") on the sentence that first names it, with a short "say". Cues point at part ids.`;
}

/** The board writer's instructions for a code-drawn figure, written from the component itself. */
/** A board's code-drawn figure: the stage itself, or the one its working is written beside. */
export function figureOf(spec: CanvasBoardSpec | null | undefined): FigureStage | undefined {
  if (!spec) return undefined;
  return spec.stage.kind === "figure" ? spec.stage : spec.stage.kind === "equation" ? spec.stage.figure : undefined;
}

/** WORKING BESIDE ITS FIGURE (owner, 2026-10-22): the lines of working on the right, the figure on the left. */
function workingFigureBrief(c: FigureComponent): string {
  return `WORKING BESIDE A FIGURE: this board writes its working line by line on the RIGHT while the "${c.name}" figure — ${c.title} — is drawn exactly by code on the LEFT. Return "stage": {"kind": "equation", "tokens": […], "steps": […], "figure": {"component": "${c.name}", "params": {…}, "parts": [{"id", "name", "s", "say"}]}}. The steps: one line per sentence of working, every step the narration says (see the equation rules). The figure's params (all optional): ${c.params}. Choose params that show exactly this board's example (the same numbers as the working). Label 2 to 6 parts the narration names (ids exactly as given): ${c.parts.map((p) => `${p.id} ("${p.name}")`).join(", ")}, each revealed ("s") on the sentence that first names it. Cues point at figure part ids when Aria talks about the picture and at equation tokens when she talks about a line. No notes: the working IS the board's writing.`;
}

function figureBrief(c: FigureComponent): string {
  return `FIGURE BOARD: the stage is the "${c.name}" figure, drawn exactly by code — ${c.title}. Return "stage": {"kind": "figure", "component": "${c.name}", "params": {…}, "parts": [{"id", "name", "s", "say"}]}. params (all optional): ${c.params}. Label 3 to 8 of these parts — every one the narration names (ids exactly as given): ${c.parts.map((p) => `${p.id} ("${p.name}")`).join(", ")}. Give each the "name" the narration uses (e.g. "Burette (hydrochloric acid)", at most 34 characters) and reveal it ("s") on the sentence that first names it. Choose params that match what this board teaches (an end-point board shows the end-point colour). Cues point at part ids.`;
}

/** Faults a board may still ship with when nothing better arrives in time; never meaning, numbers or answer timing. */

/** Described diagrams are drawn by the vector pipeline unless CANVAS_VECTOR_DIAGRAMS=off. */
const VECTOR_DIAGRAMS = process.env.CANVAS_VECTOR_DIAGRAMS !== "off";
/** The board review runs unless CANVAS_BOARD_REVIEW=off. */
const BOARD_REVIEW = process.env.CANVAS_BOARD_REVIEW !== "off";
/** Problems that mean the VISUAL itself is wrong for the board — rewriting the same visual will not cure them. */
const VISUAL_FAULTS = new Set(["wrong-visual", "invented-data", "off-topic"]);

/**
 * The last check before release (lib/canvas/boardReview.ts): what the board draws, judged against
 * what Aria says. A reviewer that errors or times out never holds a board back.
 */
async function reviewBoard(openai: OpenAI, topic: string, spec: CanvasBoardSpec, beat: CanvasPlanBeat, budget?: { used: number }): Promise<BoardReview & { costUsd: number }> {
  if (!BOARD_REVIEW || (budget && budget.used >= 2)) return { ship: true, problems: [], costUsd: 0 };
  if (budget) budget.used++;
  try {
    const { json, costUsd } = await bounded(jsonCall(openai, SPEC_MODEL, BOARD_REVIEW_PROMPT, boardReviewRequest(spec, beat, topic), 1200), 25_000, `review ${beat.id}`);
    return { ...parseBoardReview(json), costUsd };
  } catch (error) {
    return { ship: true, problems: [], costUsd: (error as { costUsd?: number }).costUsd ?? 0 };
  }
}

/** The diagrams this board has had rejected, including the one it has now. */
const rejected = (beat: CanvasPlanBeat) => [...new Set([...(beat.rejectedFigures ?? []), ...(beat.figure && beat.figure !== "drawn" && beat.figure !== "library" ? [beat.figure] : [])])];

/** The same board without its visual: a worked equation for a calculation, else a step-by-step flow. */
/** A maths or computer-science lecture (lib/canvas/subjectLook.ts), read from its topic and its boards. */
function labLecture(topic: string, plan: CanvasPlanBeat[]): boolean {
  return asMathsOrCs(plannedSubject(plan), () => isLabLookTopic([topic, ...plan.map((b) => `${b.title} ${b.brief}`)].join(" ")));
}

function plainBeat(beat: CanvasPlanBeat, allowFigure = true, lab = false): CanvasPlanBeat {
  // A calculation is numbers being worked: an operation between numbers, or "calculate"/"work out"
  // with numbers. "This means…" and the notation "n = 23" made a sociology board and a genetics board
  // into equation boards of cut-off words (audit 2026-10-17).
  const worked = (beat.script.match(/\d[\d,.]*\s*[×x*÷/+−-]\s*\(?\d/g) ?? []).length;
  const calculation = worked >= 1 && (worked >= 2 || /\b(calculat\w*|substitut\w*|work(ed)? out|the mean|standard deviation|variance)\b/i.test(beat.script));
  const base = { ...beat, figure: undefined, figureAsset: undefined, objects: [], requiredVisual: undefined, rejectedFigures: rejected(beat) };
  // A course lesson has no code diagrams (owner, 2026-10-24): its board is rebuilt as a gpt-image-2
  // picture board (or its working), never a figure, sketch, flow or boxes.
  if (beat.course && courseCodeDiagramsOff()) return { ...base, objects: beat.objects, stage: calculation && beat.stage === "equation" ? "equation" : "illustration" };
  // Maths and CS never fall back to cards: the board is drawn live as a sketch (owner, 2026-10-20) —
  // a rejected graph of two lines became a scene of boxes with no graph (QA batch 1, 2026-10-21).
  if (lab) return { ...base, stage: calculation && beat.stage === "equation" ? "equation" : "sketch" };
  // A diagram drawn by code that fits the board comes first: a failed picture of chromosome sets fell
  // back to a flow of icons ("Haploid nucleus → twice the number → Diploid nucleus"), which teaches
  // nothing (owner, 2026-10-17).
  const text = `${beat.title} ${beat.brief} ${beat.script}`;
  const fitting = !allowFigure ? undefined : [classifyInstructionalTask(beat).figure, figureFor(`${beat.title} ${beat.brief}`)?.name, figureFor(`${beat.title} ${beat.brief} ${beat.script}`)?.name]
    .find((name): name is string => Boolean(name) && !base.rejectedFigures.includes(name!) && Boolean(figureComponent(name!)) && componentFitsSubject(name!, text) && !(beat.course && offInCourses(name!)));
  // A failed vector diagram must not loop back into another vector attempt — it ships as a plain board.
  const alreadyTriedDiagram = beat.stage === "diagram" || beat.figure === "drawn";
  if (fitting && !calculation && !alreadyTriedDiagram) {
    const component = figureComponent(fitting)!;
    return { ...base, stage: "figure", figure: fitting, objects: labelledFigureParts(component, classifyInstructionalTask(beat).requiredParts ?? []) };
  }
  if (calculation) return { ...base, stage: "equation" };
  // Scene-grammar diagrams are retired (lib/canvas/visualPolicy.ts): a visual form is the coordinate
  // vector diagram, whose own failure falls back here as a plain board.
  // Free-form vector diagrams are retired: only exact geometry (a map, data, a construction, mechanics)
  // named by the board itself is drawn as one; anything else is a plain board.
  const tb = `${beat.title} ${beat.brief}`;
  if (!alreadyTriedDiagram && VECTOR_DIAGRAMS && (VECTOR_FORM.test(tb) || isGeometryOrMechanics(tb))) return { ...base, stage: "figure", figure: "drawn" };
  // A flow for a real process — steps, causes, a cycle — or a board the visual choice called a
  // diagram or a sequence; anything else is labelled boxes.
  const processLike = isRealProcess(text) || beat.visualType === "diagram" || beat.visualType === "sequence" || /\bcycle\b/i.test(`${beat.title} ${beat.brief}`);
  return { ...base, stage: processLike ? "flow" : "scene" };
}

/**
 * The same board as the diagram the reviewer said it should show: generated as a checked textbook
 * diagram (lib/canvas/textbookDiagram.ts) when pictures are on, else described line art.
 */
// Only real charts and tables (owner, 2026-10-17): words such as "values", "scale", "data" or
// "evidence" in a subject refused pictures of organs and landscapes that merely mentioned them.
export const CHART_LIKE = /\b(graphs?|charts?|bar charts?|axis|axes|legend|tables?|plots?|histograms?|pie charts?|timelines?)\b|%/i;

/** Is this something a generated textbook picture can show? A real physical thing, not a chart. */
export function pictureable(text: string): boolean {
  return PHYSICAL.test(text) && !CHART_LIKE.test(text) && !pictureRequestProblem(text, []);
}

function drawnBeat(beat: CanvasPlanBeat, why = ""): CanvasPlanBeat {
  // A picture only for a physical thing the review described; a chart or argument is a vector diagram.
  // Any board that is not maths, a chart or a map can be a checked picture (free-form diagrams retired).
  const pictures = process.env.CANVAS_AI_PICTURES !== "off" && !CHART_LIKE.test(`${why} ${beat.title}`) && [null, "not a physical thing"].includes(pictureRequestProblem(`${beat.title} ${beat.brief}`, [])) && !/\b(equation|formula|calculat\w*|solve|graph)\b/i.test(beat.title);
  // A sequence the review asks for ("HIV infection → possible later AIDS") is a clean flow of cards:
  // the scene-grammar diagram drew it as overlapping blobs with labels on empty space (live test,
  // 2026-10-17). Maps, data, apparatus and structures stay diagrams.
  const text = `${beat.title} ${beat.brief} ${why}`;
  const flow = !pictures && isRealProcess(text) && !needsVectorDiagram(text);
  // A life-science board never falls back to the coordinate vector diagram (owner, 2026-10-17).
  const tb = `${beat.title} ${beat.brief}`;
  const exact = VECTOR_FORM.test(tb) || isGeometryOrMechanics(tb);
  const stage = pictures ? "illustration" : flow ? "flow" : VECTOR_DIAGRAMS && exact ? "figure" : "scene";
  return { ...beat, stage, figure: stage === "figure" ? "drawn" : undefined, figureAsset: undefined, objects: [], requiredVisual: undefined, rejectedFigures: rejected(beat) };
}

function diagramKeyFor(beat: CanvasPlanBeat): string {
  const nums = (beat.script.match(/-?\d+(?:\.\d+)?/g) ?? []).slice(0, 12);
  return diagramCacheKey(`${beat.title} ${beat.brief}`, [...(beat.objects ?? []), ...(beat.requiredVisual?.mustShow ?? [])], nums);
}

export async function generateSpec(openai: OpenAI, topic: string, plan: CanvasPlanBeat[], beat: CanvasPlanBeat, clock: Clock, extra: string[] = [], plain = false, opts: { mathsCheck?: boolean; examiner?: ExaminerSubject; hurry?: () => boolean } = {}): Promise<{ spec: CanvasBoardSpec; costUsd: number; attempts: number; /** The board it was written for, when that changed (a maths code figure switched to a picture). */ beat?: CanvasPlanBeat }> {
  if (beat.stage === "diagram") {
    const cached = await loadSharedDiagramRecord<{ spec: CanvasBoardSpec }>(diagramKeyFor(beat)).catch(() => null);
    if (cached?.spec?.stage?.kind === "diagram") return { spec: cached.spec, costUsd: 0, attempts: 1 };
  }
  // Counted on every attempt: the maths/CS examiner can grow the narration (a squeezed trace becomes one
  // sentence per pass), and a board checked against the old count had its later steps cut (CS round, 2026-10-22).
  const sentenceCount = () => canvasSentences(beat.script).length;
  // Each board remembers the narration it was written for: a board that ships without being written
  // again after the narration grew takes its own narration back, so voice and board stay in step.
  const writtenFor = new WeakMap<CanvasBoardSpec, string>();
  const inStep = (shipped: CanvasBoardSpec): CanvasBoardSpec => {
    const own = writtenFor.get(shipped);
    if (own !== undefined && own !== beat.script) {
      console.log(`[canvas] ${beat.id}: narration change undone — the board was not written again for it`);
      beat.script = own;
    }
    return shipped;
  };
  /*
   * WHAT ARIA SAYS IS WRITTEN (owner's manager, 2026-10-23: "whatever it was saying was not being written
   * down"). The planner writes a short phrase for nearly every sentence ("H₂ N₂ O₂ F₂ Cl₂ Br₂ I₂"); it goes
   * on the board on that sentence, on every board that ships — a working board that kept its closest
   * attempt used to ship the writer's one note instead (only 28% of working boards' planned notes reached
   * the board). Only a note that exactly repeats a written line of working is left off.
   */
  let spokenOnce: Promise<{ notes: CanvasBoardSpec["notes"]; costUsd: number }> | null = null;
  const writeAsSaid = async (target: CanvasBoardSpec): Promise<void> => {
    if (!spokenOnce) {
      spokenOnce = spokenNotes(openai, beat, clock);
      costUsd += (await spokenOnce).costUsd;
    }
    const spoken = await spokenOnce;
    if (spoken.notes.length && target.stage.kind !== "exam") target.notes = anchorNotes(spoken.notes, beat.script);
    // A note that only repeats a row of the working is the same answer twice (maths benchmark R6).
    if (target.stage.kind === "equation") {
      const eq = target.stage;
      const text = new Map(eq.tokens.map((t) => [t.id, t.text]));
      const rows = eq.steps.map((st) => normalizeMath(st.order.map((id) => text.get(id) ?? "").join("")).replace(/÷/g, "/"));
      target.notes = target.notes.filter((n) => !repeatsWorking(n.text, rows));
    }
    // On a figure, sketch or scene the notes are the only writing: the answer Aria reaches is one of them.
    if (target.stage.kind !== "equation" && target.stage.kind !== "exam" && target.stage.kind !== "code") {
      target.notes = orderNotesAsSaid(tidyNotes(withResultNotes(target.notes, beat.script, (text, s, k) => ({ id: `answer-${k + 1}`, text, s }))), beat.script);
    }
  };
  // A code board in a data-structures lesson draws the structure beside the code (lib/canvas/structure.ts).
  const needsStructure = beat.stage === "structure" || (beat.stage === "code" && asCodeLesson(plannedSubject(plan), () => isDataStructureTopic(`${topic} ${beat.title} ${beat.brief}`)));
  const asked = needsStructure && beat.stage === "code"
    ? [
        ...extra,
        `This board runs an operation on a DATA STRUCTURE: draw it in "structure" beside the code (pseudocode unless a language was asked for), and give every step the "ops" its lines perform, so the structure changes as each line is read. The stage looks like this (fill it with THIS board's structure and values):`,
        `{"kind": "code", "language": "pseudocode", "reveal": "all", "lines": ["...", "..."], "structure": {"kind": "tree", "variant": "bst", "nodes": [{"id": "n50", "value": "50"}, {"id": "n30", "value": "30"}], "edges": [{"from": "n50", "to": "n30", "side": "left"}], "pointers": [{"name": "root", "to": "n50"}]}, "steps": [{"s": 0, "lines": [1], "ops": [{"op": "point", "name": "curr", "to": "n50"}]}, {"s": 1, "lines": [2, 3], "note": "30 < 50: go left", "ops": [{"op": "mark", "id": "n50", "as": "compare"}, {"op": "point", "name": "curr", "to": "n30"}]}]}`,
      ]
    : extra;
  let costUsd = 0;
  let lastError: string | undefined;
  let softest: { spec: CanvasBoardSpec; faults: number } | undefined;
  let visualRejections = 0;
  // The maths examiner (lib/canvas/mathsCheck.ts): at most two reads of a board — the first, and the
  // rewrite it asked for.
  let mathsChecks = 0;
  // The last board that passed every code gate and the review, with the examiner's faults on it: shipped
  // rather than replaced by a free-hand sketch or a plain board when its rewrite runs out of time — a
  // Venn figure missing one count became a wrong sketch that way (maths benchmark R5).
  let examined: { spec: CanvasBoardSpec; faults: string[] } | null = null;
  // At most two reviews a board: the review must not turn a 2-minute lecture into a 6-minute one.
  const reviews = { used: 0 };
  // A MATHS BOARD'S CODE FIGURE REJECTED ONCE (owner, 2026-10-26: "if it's rejected one time I want it to
  // display the second time"): the board is written again for a gpt-image-2 picture, which is shown as
  // drawn (lib/canvas/mathsPicture.ts). Typed-prompt and PDF maths lectures only (visualPolicy marks them).
  const secondTimePicture = async (why: string) => {
    const switched = asMathsPicture(beat);
    console.log(`[canvas] ${beat.id}: its ${beat.stage}${beat.figure ? ` (${beat.figure})` : ""} was rejected once — drawn by gpt-image-2 the second time (${why.slice(0, 200)})`);
    const again = await generateSpec(openai, topic, plan, switched, clock, [...extra, `This board's code-drawn figure was rejected (${why.slice(0, 300)}); it is drawn as a picture instead — write the board for that picture.`], plain, opts);
    return { ...again, costUsd: again.costUsd + costUsd, beat: again.beat ?? switched };
  };
  // Builds the same board again without its visual when the review rejected the visual itself.
  const rebuildPlain = async (why: string) => {
    // A course lesson's board is written again as a gpt-image-2 picture board with the fault named — never
    // a sketch, a vector diagram or plain boxes (owner, 2026-10-24: no code diagrams).
    if (beat.course && courseCodeDiagramsOff()) {
      console.log(`[canvas] ${beat.id}: its ${beat.stage} board was rejected — written again (${why.slice(0, 200)})`);
      const again = await generateSpec(openai, topic, plan, plainBeat(beat), clock, [...extra, `An earlier version of this board was rejected because ${why}. Correct exactly that.`], true);
      return { ...again, costUsd: again.costUsd + costUsd };
    }
    // First the diagram the reviewer said the board needs, drawn from its description (and reviewed
    // like any board); only if that fails, the board without a diagram.
    // Only a physical thing is redrawn from the review's description: with pictures on, anything else
    // (a chart, a framework) became a picture request the image model could never satisfy.
    if (labLecture(topic, plan) && beat.stage !== "sketch") {
      console.log(`[canvas] ${beat.id}: its ${beat.figure ?? beat.stage} visual was rejected — drawn live as a sketch (${why.slice(0, 200)})`);
      const sketched = await generateSpec(openai, topic, plan, plainBeat(beat, false, true), clock, [...extra, `An earlier visual on this board was rejected: ${why}. Draw instead exactly what this describes.`], true);
      if (sketched.attempts !== -1) return { ...sketched, costUsd: sketched.costUsd + costUsd };
      costUsd += sketched.costUsd;
    }
    const suggested = /\bshould (instead )?(show|depict|identify|be)\b/i.test(why) && beat.figure !== "drawn" && beat.stage !== "illustration" && clock.left() > 70_000
      && (VECTOR_DIAGRAMS || process.env.CANVAS_AI_PICTURES === "off" || pictureable(why));
    if (suggested) {
      console.log(`[canvas] ${beat.id}: the board review rejected its ${beat.figure ?? beat.stage} visual twice — redrawn as the diagram the review describes (${why.slice(0, 200)})`);
      const drawn = await generateSpec(openai, topic, plan, drawnBeat(beat, why), clock, [...extra, `An earlier diagram on this board was rejected: ${why}. Draw the diagram this describes, labelling exactly what the narration teaches.`], true);
      if (drawn.attempts !== -1) return { ...drawn, costUsd: drawn.costUsd + costUsd };
      costUsd += drawn.costUsd;
    }
    console.log(`[canvas] ${beat.id}: the board review rejected its ${beat.stage} visual twice — rebuilt as a plain board (${why.slice(0, 200)})`);
    const rebuilt = await generateSpec(openai, topic, plan, plainBeat(beat, true, labLecture(topic, plan)), clock, [...extra, `An earlier version of this board was rejected because ${why}. Teach it without that visual.`], true);
    return { ...rebuilt, costUsd: rebuilt.costUsd + costUsd };
  };
  // The code alone, kept when its structure could not be made right: plainer, never wrong.
  let plainCode: CanvasBoardSpec | null = null;
  // An equation board that still misses something after its retries: kept rather than replaced by
  // a placeholder scene (its terms are whole now; only the check's last complaint is left).
  let closestEquation: CanvasBoardSpec | null = null;
  // A described diagram is drawn by the vector pipeline first (lib/diagrams/write.ts): real
  // coastlines, plotted data, exact counts, checked by code and by eye. One that cannot pass is not
  // drawn at all — the board is taught plainly, which beats a wrong diagram (owner, 2026-10-17).
  let vector: FigureDrawing | undefined;
  if (beat.stage === "figure" && beat.figure === "drawn" && VECTOR_DIAGRAMS && clock.left() > 60_000) {
    const made = await vectorDiagram(openai, { title: beat.title, brief: beat.brief, narration: beat.script, mustShow: beat.requiredVisual?.mustShow, topic }, { share: !beat.source, timeLeft: () => clock.left() });
    costUsd += made.costUsd;
    console.log(`[canvas] ${beat.id}: ${made.log}`);
    if (made.diagram) vector = made.diagram.drawing;
    else {
      const rebuilt = await generateSpec(openai, topic, plan, plainBeat(beat, true, labLecture(topic, plan)), clock, extra, true);
      return { ...rebuilt, costUsd: rebuilt.costUsd + costUsd };
    }
  } else if (beat.stage === "figure" && beat.figure === "drawn") {
    // No time (or no switch) for the checked vector pipeline: free-hand line art is never the
    // stand-in. Its labels were checked only against its own shapes, and a label check of saved
    // lectures found its parts wrong ("Mitochondria" in a sperm's head, "Prostate gland" on a bare
    // oval; 2026-10-17). A code-drawn figure that fits, else a plain board, is taught instead.
    const rebuilt = await generateSpec(openai, topic, plan, plainBeat(beat, true, labLecture(topic, plan)), clock, extra, true);
    return { ...rebuilt, costUsd: rebuilt.costUsd + costUsd };
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    // A retry is optional work: with too little time left the board falls back instead.
    // A second attempt still runs with 30 s left (one bounded call): with a 75 s floor most slow
    // boards skipped every retry and shipped the fallback.
    if (attempt > 1 && clock.left() < (attempt === 2 ? 30_000 : 75_000)) break;
    try {
      const { json, costUsd: c } = await bounded(jsonCall(openai, SPEC_MODEL, CANVAS_SPEC_PROMPT, specUserPrompt(topic, plan, beat, lastError, asked, vector), needsStructure ? 9000 : 6000), Math.min(needsStructure ? 60_000 : 45_000, Math.max(10_000, clock.left() - 60_000)), `board ${beat.id}`);
      costUsd += c;
      const raw = json as Record<string, unknown>;
      // The plan decides the stage; a model that drifted to another one is corrected, not trusted.
      if (raw.stage && typeof raw.stage === "object" && (raw.stage as Record<string, unknown>).kind !== beat.stage) {
        lastError = `the stage must be "${beat.stage}", not "${String((raw.stage as Record<string, unknown>).kind)}"`;
        continue;
      }
      // A library diagram's art and anchors come from the server's index, never from the model.
      if (beat.figure === "library" && raw.stage && typeof raw.stage === "object") {
        const stage = raw.stage as Record<string, unknown>;
        stage.component = "library";
        stage.asset = libraryStageAsset(beat.figureAsset?.id) ?? beat.figureAsset;
      }
      // An equation step naming an id with no token ("equals-6", "thirty-six") is repaired, not retried.
      if (beat.stage === "equation" && raw.stage && typeof raw.stage === "object") {
        const fixed = repairEquationOrder(raw.stage);
        if (fixed) console.log(`[canvas] board ${beat.id}: ${fixed} equation step id(s) repaired`);
      }
      // A vector diagram: repair layout; only invented numbers come back for one retry.
      if (beat.stage === "diagram" && raw.stage && typeof raw.stage === "object") {
        const accepted = acceptDiagram(raw, beat.script, beat.requiredVisual?.mustShow ?? []);
        if (!accepted) {
          lastError = `the diagram spec was empty — return a textbook diagram with regions, arrows or a series`;
          continue;
        }
        (raw.stage as Record<string, unknown>).kind = "diagram";
        (raw.stage as Record<string, unknown>).spec = accepted.spec;
        (raw.stage as Record<string, unknown>).parts = accepted.parts;
        if (accepted.factIssues.length && attempt === 1) {
          lastError = `wrong facts or numbers: ${accepted.factIssues.join("; ")}. Use only numbers the narration states.`;
          continue;
        }
      }
      // A described diagram that fails its checks is sent back with what to fix, not a generic error.
      // The vector diagram is the server's; whatever drawing the model wrote is replaced by it.
      if (vector && raw.stage && typeof raw.stage === "object") Object.assign(raw.stage as Record<string, unknown>, { component: "drawn", drawing: vector });
      if (!vector && beat.figure === "drawn" && raw.stage && typeof raw.stage === "object") {
        const { issues } = drawnFigure((raw.stage as Record<string, unknown>).drawing);
        // A box diagram is a flow board drawn badly: build the flow instead of retrying the drawing.
        if (!plain && issues.some((i) => i.startsWith("BOX DIAGRAM"))) return rebuildPlain("its drawn diagram was only empty boxes and rings");
        if (issues.length) {
          lastError = `the drawing needs fixing: ${issues.join("; ")}`;
          continue;
        }
      }
      let spec = validateCanvasSpec(raw, sentenceCount(), [], beat.script);
      if (spec) writtenFor.set(spec, beat.script);
      // TEXT THAT DOES NOT FIT IS REWRITTEN TO FIT, never cut (owner, 2026-10-17): every over-long
      // piece goes to one small call that rewrites it within its exact room, and the board is checked
      // again with the rewritten text.
      // The layout's own room too: a card's detail can fit its character limit and still not fit its
      // card (seven "…" on one geography board, QA 2026-10-17). Laying the board out records those.
      const layoutCuts = (s: CanvasBoardSpec | null) => { takeFigureCutItems(); if (s) layoutPanel(s); return takeFigureCutItems(); };
      const overlong = [...validationCutItems(), ...layoutCuts(spec)];
      if (spec && overlong.length && clock.left() > 15_000) {
        const fitted = await shortenToFit(openai, overlong).catch((error) => { costUsd += (error as { costUsd?: number }).costUsd ?? 0; return null; });
        if (fitted) {
          costUsd += fitted.costUsd;
          replaceStrings(raw, fitted.replacements);
          spec = validateCanvasSpec(raw, sentenceCount(), [], beat.script);
          if (spec) writtenFor.set(spec, beat.script);
          const still = validationCutItems().length + layoutCuts(spec).length;
          console.log(`[canvas] ${beat.id}: ${fitted.replacements.size} text(s) rewritten to fit${still ? `, ${still} still ended at a break` : ""}`);
        }
      }
      // A function graph labels the features the lesson is about: "Root x = 0" on a direct-proportion
      // graph taught nothing (live test, 2026-10-17). A feature the narration never mentions is unlabelled.
      const graphFig = figureOf(spec);
      if (graphFig && graphFig.component === "functionGraph") {
        const said: Record<string, RegExp> = { root: /\b(roots?|x-intercepts?|zeros?|solutions?|crosses the x-axis|cuts the x-axis)\b/i, "y-intercept": /\b(y-intercepts?|intercepts? (on|with) the y|crosses the y-axis|cuts the y-axis)\b/i, "turning-point": /\b(turning points?|maximum|minimum|stationary points?|vertex)\b/i, intersection: /\b(intersect\w*|meet|cross each other|solutions? of)\b/i };
        const keep = graphFig.parts.filter((p) => !said[p.id] || said[p.id].test(beat.script));
        if (keep.length && keep.length < graphFig.parts.length) graphFig.parts = keep;
      }
      // A label written on a part it does not name was replaced by the part's own name (lib/canvas/labelMatch.ts).
      const relabelled = takeLabelMismatches();
      if (relabelled.length) console.log(`[canvas] ${beat.id}: ${relabelled.length} label(s) corrected — ${relabelled.join(" | ").slice(0, 300)}`);
      // An arrow that would cut through another box is dropped rather than drawn across it (the
      // first board of an economics lesson shipped with arrows slicing through three boxes, 2026-10-17).
      if (spec && (spec.stage.kind === "scene" || spec.stage.kind === "flow")) {
        const tidy = dropCrossingArrows(spec, layoutPanel(spec));
        if (tidy !== spec) Object.assign(spec, tidy);
      }
      // An Argand board written without its numbers drew the default 3 + 4i while Aria spoke about
      // −3 + 4i (audit 2026-10-17): the numbers come from the board's own narration.
      const argandFig = figureOf(spec);
      if (argandFig && argandFig.component === "argand") {
        const params = (argandFig.params ??= {});
        if (!params.points && !params.loci) {
          const found = complexNumbersIn(beat.script);
          if (found) params.points = found;
        }
      }
      if (spec?.stage.kind === "graph") {
        spec.stage = dropContradictingPoints(spec.stage);
      }
      // A note goes up when Aria says it, never sentences before (maths and CS boards).
      if (spec && asMathsOrCs(plannedSubject(plan), () => isLabLookTopic(topic))) spec.notes = orderNotesAsSaid(revealNotesWhenSaid(spec.notes, beat.script), beat.script);
      // NOTHING BEFORE IT IS SAID (owner, 2026-10-22): code writes itself line by line as Aria reaches each
      // line; a listing shown whole from the start put lines on the board she had not yet said a word about.
      // Every code board, whatever the lecture is called — a PDF named "Lecture 7" is still code.
      if (spec?.stage.kind === "code") {
        spec.stage.reveal = "build";
        // The line Aria names is the line she means, and the line lit (lib/canvas/codeSync.ts).
        const lines = fixLineReferences(spec, beat.script);
        if (lines.fixed) {
          console.log(`[canvas] ${beat.id}: ${lines.fixed} line number(s) in the narration corrected to the line that does it`);
          beat.script = lines.script;
          writtenFor.set(spec, beat.script);
        }
      }
      if (spec?.stage.kind === "figure" && spec.stage.component === "library") {
        // Filled again after validation from the index itself (the authoritative copy).
        const asset = libraryStageAsset(spec.stage.asset?.id);
        if (asset) spec.stage.asset = asset;
      }
      if (!spec) {
        lastError = `the ${beat.stage} stage was missing what it needs to draw (check the schema)`;
        continue;
      }
      // Only the mandatory labels are written: what the syllabus requires and what Aria names
      // (lib/canvas/labelPolicy.ts) — a diagram is not a labelling exercise.
      Object.assign(spec, withMandatoryLabels(spec, beat));
      // NEVER FAIL ON WHAT CODE CAN FIX (owner, 2026-10-17: "I don't want it to fail in any way"). 26% of
      // boards failed every attempt and shipped the crude backup, mostly for things the writer could
      // not change (the board type the plan fixed) or code could fix itself (a missing label).
      addRequiredParts(spec, beat);
      if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.includes(spec.stage.kind)) console.log(`[canvas] ${beat.id}: kept as ${spec.stage.kind} (the contract asked for ${beat.requiredVisual.stages.join("/")}; the plan's stage wins)`);
      const contractNotes = beat.requiredVisual ? visualContractIssues(spec, beat.requiredVisual).filter((i) => !/requires|stage/i.test(i)) : [];
      // No quiz written inside a board: the check card is written separately, after the board.
      // No drawing task either (owner, 2026-10-17: "they are annoying"), even one the board model adds.
      if (spec.interaction?.kind === "quiz" || spec.interaction?.kind === "draw") delete spec.interaction;
      // A try-it task without enough reactions is left off, not a reason to fail the board.
      if (spec.interaction?.kind === "try" && spec.interaction.reactions.length < 2) delete spec.interaction;
      const drawnStructure = spec.stage.kind === "code" ? spec.stage.structure : spec.stage.kind === "structure" ? spec.stage.structure : undefined;
      if (drawnStructure && (spec.stage.kind === "code" || spec.stage.kind === "structure") && keepSearchedCells(drawnStructure, spec.stage.steps)) console.log(`[canvas] board ${beat.id}: a search's removed cells are crossed out instead`);
      if (drawnStructure && (spec.stage.kind === "code" || spec.stage.kind === "structure") && repairPositionalIds(drawnStructure, spec.stage.steps, canvasSentences(beat.script))) console.log(`[canvas] board ${beat.id}: array ops read by position, rewritten to the cells' ids`);
      if (drawnStructure && attempt < 3) {
        const problem = narratedStructureMismatch(drawnStructure, spec.stage.kind === "code" || spec.stage.kind === "structure" ? spec.stage.steps : [], canvasSentences(beat.script));
        if (problem) {
          lastError = problem;
          console.warn(`[canvas] board ${beat.id}: ${problem}`);
          continue;
        }
      }
      if (spec.stage.kind === "code" && spec.stage.structure && attempt < 3) {
        const problem = structureStateMismatch(spec.stage.structure, spec.stage.steps);
        if (problem) {
          lastError = problem;
          console.warn(`[canvas] board ${beat.id}: ${problem}`);
          continue;
        }
      }
      if (spec.stage.kind === "code" && attempt < 3) {
        const problem = missingStackProblem(spec.stage, spec.heading, beat.script);
        if (problem) {
          lastError = problem;
          console.warn(`[canvas] board ${beat.id}: ${problem}`);
          continue;
        }
      }
      if (spec.stage.kind === "equation") {
        const problem = equationProblem((raw as { stage?: unknown }).stage, spec.stage, beat.script);
        if (problem) {
          // Kept in case no attempt passes: it ships with what Aria says written, like every other board
          // (it shipped the writer's one note instead: 1 of 9 planned notes on a Chemistry board, 2026-10-23).
          alignToNarration(spec, beat);
          deferRevealLeaks(spec, beat);
          await writeAsSaid(spec);
          closestEquation = spec;
          lastError = problem;
          console.warn(`[canvas] board ${beat.id}: ${problem}`);
          continue;
        }
      }
      const structureProblem = boardStructureProblem(spec, needsStructure);
      if (structureProblem) {
        const plain = withoutStructure(spec);
        if (plain) await writeAsSaid(plain);
        plainCode = plain ?? plainCode;
        lastError = structureProblem;
        console.warn(`[canvas] board ${beat.id}: ${structureProblem}`);
        continue;
      }
      // Everything appears on the sentence that first says it (lib/canvas/narrationSync.ts).
      alignToNarration(spec, beat);
      deferRevealLeaks(spec, beat);
      await writeAsSaid(spec);
      // Vision pass, on by default since 2026-10-17 (DIAGRAM_VISION=off disables it): an editor looks
      // at the rendered diagram, labels included — the main diagram route was the one visual nobody
      // saw before a student did. The attempt that ships is the one checked: the repair used to go out
      // unseen, and three messy diagrams of one lecture were second attempts (live test, 2026-10-17).
      // A repair the editor still rejects is rebuilt — as a checked picture for a cell, organ or plant.
      if (spec.stage.kind === "diagram" && process.env.DIAGRAM_VISION !== "off" && attempt <= 2 && clock.left() > 45_000) {
        try {
          const { boardPng } = await import("../bench/renderSvg");
          const png = boardPng(spec);
          const verdict = await checkVectorDiagram(openai, png, beat.title, spec.stage.parts.map((p) => p.name), beat.script);
          costUsd += verdict.costUsd;
          const notes = [...verdict.problems, ...verdict.misspellings];
          if (!verdict.accurate && notes.length) {
            lastError = `textbook editor: ${notes.join("; ")}. Keep every number the narration states; spell every label as the narration spells it.`;
            if (attempt === 2 && !plain) return rebuildPlain(`the diagram is still wrong: ${notes.join("; ")}. It should show ${beat.title.toLowerCase()} correctly`);
            continue;
          }
        } catch (error) {
          console.log(`[canvas] ${beat.id}: vector vision skipped — ${(error as Error).message}`);
        }
      }
      const findings: Finding[] = [
        // A board-type rule the writer cannot satisfy ("requires the heart renderer, not illustration")
        // is the plan's business, not this board's: it never fails a board.
        ...auditBoardForRelease(spec, beat).filter((f) => !(f.gate === "semantic" && /requires (the |figure component )/.test(f.message)) && f.gate !== "quiz"),
        ...contractNotes.map((message) => ({ gate: "visual-contract", message })),
        // Words the layout had to leave off (an arrow's label, a callout, a step's second line): a note,
        // so the first attempt is rewritten shorter instead of shipping with words silently missing.
        ...(() => { takeLayoutDrops(); layoutPanel(spec); return takeLayoutDrops(); })().slice(0, 4).map((message) => ({ gate: "text-dropped", message: `${message} — write it shorter or with fewer items` })),
        ...figureDataIssues(spec, beat.script).map((message) => ({ gate: "figure-data", message })),
        // Every line of code lit by the sentence that explains it (lib/canvas/codeSync.ts).
        ...codeSyncIssues(spec, beat.script),
        // A figure whose fixed design contradicts the board (a time axis where Aria never mentions time).
        ...(figureOf(spec) && !componentFitsSubject(figureOf(spec)!.component, `${beat.title} ${beat.brief} ${beat.script}`)
          ? [{ gate: "figure-content", message: `the ${figureOf(spec)!.component} figure does not fit this board (its axes or kind contradict what Aria says): draw what the narration describes instead — for a quantity against another quantity, a "graph" with those axes` }]
          : []),
        // A data figure given no data draws its built-in example: "−2 < x ≤ 3" on a rounding-bounds
        // board, twice, in a saved lecture (label check, 2026-10-17). Never shipped; the writer fills it.
        ...(figureOf(spec) && DEMO_DATA.has(figureOf(spec)!.component) && !Object.keys(figureOf(spec)!.params ?? {}).length
          ? [{ gate: "figure-content", message: `the ${figureOf(spec)!.component} figure has no params, so it would draw its built-in example: give it this board's own data from the narration` }]
          : []),
        // A graph shows how one quantity changes with another. Two flat lines of single numbers on a
        // "Comparison" axis from 0 to 1 (the speeds of light and sound, bench 2026-10-18) teach nothing.
        ...(spec.stage.kind === "graph" && spec.stage.curves.length > 0 && spec.stage.curves.every((c) => !/(?<![a-z])x(?![a-z])/i.test(c.expr))
          ? [{ gate: "figure-content", message: "every curve on this graph is a flat line of one number, so it shows no relationship: plot how one quantity changes with another, or — when the board only compares two values — draw the thing they describe instead of a graph" }]
          : []),
        // Words a line runs through, or printed over each other, cannot be read: "Longer wavelength"
        // across two boxes and an arrow through "absorbed energy" shipped on a light board (owner
        // screenshot, 2026-10-18). Two or more such collisions send the drawing back.
        ...(() => {
          const st = spec.stage;
          const drawing = st.kind === "figure" && st.component === "drawn" ? st.drawing : st.kind === "diagram" ? st.drawing ?? compileDiagram(st.spec) : undefined;
          const issues = drawing ? textCollisions(drawing) : [];
          return issues.length >= 2 ? [{ gate: "figure-content", message: `words on the diagram cannot be read — ${issues.slice(0, 3).join("; ")}: keep every word clear of lines, arrows and other words (inside a box, or beside what it names)` }]
            : issues.length ? [{ gate: "figure-data", message: `on the diagram, ${issues[0]}: move it clear` }] : [];
        })(),
        // A function graph draws the board's own curve or nothing: an unreadable "x^n" or "sin(x + h)"
        // drew the built-in x² − 2x − 3 on three calculus boards (bench, 2026-10-18).
        ...(figureOf(spec)?.component === "functionGraph" && functionGraphProblem(figureOf(spec)!.params ?? {})
          ? [{ gate: "figure-content", message: functionGraphProblem(figureOf(spec)!.params ?? {})! }]
          : []),
        ...(figureOf(spec) && figureOf(spec)!.component !== "drawn" && figureOf(spec)!.component !== "library"
          ? (() => {
              const fig = figureOf(spec)!;
              const foreign = foreignFigureWords(fig.component, fig.params ?? {}, `${beat.title} ${beat.brief} ${beat.script}`, fig.parts.map((p) => p.name));
              const message = `the figure shows words this board never teaches (${foreign.slice(0, 6).join(", ")}): fill its params with this board's own content from the narration`;
              return foreign.length >= 5 ? [{ gate: "figure-content", message }] : foreign.length ? [{ gate: "figure-data", message }] : [];
            })()
          : []),
      ];
      // A code line left unexplained is sent back once; after that the board ships with the note.
      let fatal = findings.filter((f) => FATAL_GATES.has(f.gate) || (f.gate === "code-sync" && attempt === 1));
      // THE STUDENT IS ABOUT TO REACH THIS BOARD (opts.hurry, lib/progressiveLectureWorker.ts): the polish
      // passes are skipped — a second review, a second examiner read unless the first found false maths or
      // wrong code, a rewrite for minor faults, growing the narration, tidying notes. A student waiting
      // on a board loses more than a small blemish costs; fixes for real faults still run.
      const hurried = opts.hurry?.() ?? false;
      // The review judges what the student will see; only its serious findings count as fatal.
      if (!fatal.length && !(hurried && reviews.used >= 1)) {
        const review = await reviewBoard(openai, topic, spec, beat, reviews);
        costUsd += review.costUsd;
        // A label on the WRONG part misleads a student (owner, 2026-10-17: labels "very very very
        // accurate"); a label merely missing does not, and stays a note.
        // A GRAPH SHIPS UNLESS SOMETHING IS SERIOUSLY WRONG (owner, 2026-10-18: "in 95 percent it should
        // show the graph"). "Invented data" on a graph means numbers Aria never said: the graph becomes a
        // shape graph — the same curve with no numbers — and ships, where three enzyme curves and the
        // photoelectric line were rejected twice and became cards. Wrong shape, topic or axes still block.
        if (spec.stage.kind === "graph" && review.problems.some((p) => p.kind === "invented-data")) {
          spec.stage.qualitative = true;
          if (spec.interaction?.kind === "try" && spec.interaction.readouts?.length) spec.interaction = { ...spec.interaction, readouts: [] };
          review.problems = review.problems.map((p) => (p.kind === "invented-data" ? { ...p, kind: "graph-numbers-hidden" } : p));
          console.log(`[canvas] ${beat.id}: graph numbers Aria never says — shown as a shape graph`);
        }
        // A try-it readout ("Temperature = 50 gives rate = 1") is a number the student reads off a
        // slider, not the graph: a fault in it takes the readouts away, never the graph.
        if (spec.stage.kind === "graph" && spec.interaction?.kind === "try" && review.problems.some((p) => /\bread-?outs?\b/i.test(p.detail))) {
          spec.interaction = { ...spec.interaction, readouts: [] };
          review.problems = review.problems.filter((p) => !/\bread-?outs?\b/i.test(p.detail));
        }
        const serious = review.problems.filter((p) => FATAL_REVIEW.has(p.kind) || (p.kind === "mislabelled" && !/\b(missing|not (?:visibly )?labell?ed|unlabell?ed|no label|lacks? (?:a |its )?label)/i.test(p.detail)));
        if (serious.length) {
          fatal = serious.map((p) => ({ gate: "review", message: `${p.kind}: ${p.detail}` }));
          if (serious.some((p) => VISUAL_FAULTS.has(p.kind))) visualRejections++;
          console.log(`[canvas] ${beat.id}: board review sent it back — ${fatal.map((f) => f.message).join(" | ").slice(0, 400)}`);
          const wrongFigure = serious.filter((p) => p.kind === "wrong-visual");
          if (beat.mathsPictureFallback && wrongFigure.length && clock.left() > 100_000) return secondTimePicture(wrongFigure.map((p) => p.detail).join("; "));
        } else findings.push(...review.problems.map((p) => ({ gate: "review-note", message: `${p.kind}: ${p.detail}` })));
      }
      if (visualRejections >= 2 && !plain && (beat.stage === "figure" || beat.stage === "graph" || beat.stage === "illustration" || beat.stage === "diagram")) return rebuildPlain(fatal.map((f) => f.message).join("; "));
      // A visual the review rejected twice is never shipped by an unreviewed third attempt: an already
      // plain board drops its diagram altogether (the blood-vessel figure shipped this way, 2026-10-17).
      if (visualRejections >= 2 && plain && beat.stage === "figure" && clock.left() > 25_000) {
        console.log(`[canvas] ${beat.id}: the review rejected its ${beat.figure} twice — rebuilt without a diagram`);
        const bare = await generateSpec(openai, topic, plan, plainBeat(beat, false, labLecture(topic, plan)), clock, [...extra, `An earlier diagram on this board was rejected: ${fatal.map((f) => f.message).join("; ").slice(0, 300)}. Teach it without a diagram.`], true);
        return { ...bare, costUsd: bare.costUsd + costUsd };
      }
      // THE MATHS EXAMINER reads a board the code checks and the review passed (maths lectures only).
      // A third read only after a rewrite that still has false maths, a broken line or a contradicting
      // figure: those never ship while there is time to fix them.
      const serious = (kinds: string[]) => kinds.some((k) => /false-maths|garbled|figure-contradicts|wrong-code|wrong-trace/.test(k));
      const examine = hurried ? mathsChecks < 1 || (mathsChecks < 2 && examined && serious(examined.faults)) : mathsChecks < 2 || (mathsChecks < 3 && examined && serious(examined.faults));
      if (!fatal.length && opts.mathsCheck && examine && clock.left() > 45_000) {
        mathsChecks++;
        const verdict = await mathsCheck(openai, topic, spec, beat, Math.min(60_000, clock.left() - 30_000), opts.examiner ?? "maths");
        costUsd += verdict.costUsd;
        // Working Aria says that the board does not show is written in by code, at its sentence
        // (lib/canvas/writeMissing.ts); only a line that could not be written goes back to the writer.
        const missing = verdict.problems.filter((p) => isMissingLine(p.kind));
        const wrote = missing.length ? writeMissingLines(spec, missing, beat.script, canvasSentences(beat.script).length) : { written: 0, left: [] };
        if (wrote.written) console.log(`[canvas] ${beat.id}: wrote ${wrote.written} line(s) of working Aria says that the board did not show`);
        verdict.problems = verdict.problems.filter((p) => !missing.includes(p) || wrote.left.includes(p));
        const said = verdict.problems.filter((p) => p.where === "narration" && !isMissingLine(p.kind));
        let narrationChanged = 0;
        if (said.length) {
          // A squeezed trace may grow the narration only while a rewrite of the board will surely follow
          // (the plan already splits most of them: lib/canvas/squeeze.ts); a rewrite that ran out of time
          // was paid for and then undone (CS round 4, 7 times).
          const patched = patchNarration(beat.script, said, { grow: !hurried && mathsChecks < 2 && clock.left() > 150_000 });
          narrationChanged = patched.changed;
          if (patched.changed) {
            beat.script = patched.script;
            console.log(`[canvas] ${beat.id}: maths examiner corrected ${patched.changed} sentence(s) of the narration`);
          }
        }
        const drawn = verdict.problems.filter((p) => p.where === "board" || isMissingLine(p.kind));
        console.log(`[canvas] ${beat.id}: maths examiner (${MATHS_CHECK_MODEL}, ${Math.round(verdict.ms / 1000)}s, $${verdict.costUsd.toFixed(4)})${verdict.checked ? "" : " skipped"} — ${verdict.problems.length ? verdict.problems.map((p) => `${p.where}/${p.kind}: ${p.detail}`).join(" | ").slice(0, 500) : "ships"}`);
        const contradicts = drawn.filter((p) => p.kind === "figure-contradicts");
        if (beat.mathsPictureFallback && contradicts.length && clock.left() > 100_000) return secondTimePicture(contradicts.map((p) => p.detail).join("; "));
        const rewrite = (!hurried && mathsChecks < 2) || (mathsChecks < 3 && serious(drawn.map((p) => p.kind)));
        if (drawn.length && rewrite) {
          examined = { spec, faults: drawn.map((p) => `${p.kind}: ${p.detail}`) };
          fatal = [{ gate: "maths", message: mathsFixes(drawn) }];
        } else if (drawn.length || (said.length && mathsChecks >= 2)) {
          findings.push(...drawn.map((p) => ({ gate: "maths-note", message: `${p.kind}: ${p.detail}` })));
        } else if (narrationChanged && mathsChecks < 2) {
          // The narration changed under a board written for it: the board is written once more for the new
          // words — only when it really changed (a refused fix used to cost a rewrite for nothing).
          fatal = [{ gate: "maths", message: `the narration was corrected (${said.map((p) => p.fix).join(" ")}): write the board for it` }];
        }
      }
      if (fatal.length) {
        // The writer is told the serious faults only — a long list of notes made it fix one thing and break another.
        lastError = fatal.map((f) => `${f.gate}: ${f.message}`).join("; ");
        continue;
      }
      // No serious fault. The first attempt with notes gets one more try to tidy them; after that the
      // best board ships — notes never send a lecture to the backup.
      if (findings.length && attempt === 1 && !hurried && clock.left() > 60_000) {
        if (!softest || findings.length < softest.faults) softest = { spec, faults: findings.length };
        lastError = findings.slice(0, 3).map((f) => `${f.gate}: ${f.message}`).join("; ");
        continue;
      }
      const best = softest && softest.faults < findings.length ? softest.spec : spec;
      if (findings.length) console.log(`[canvas] ${beat.id}: shipped with ${findings.length} note(s) — ${findings.map((f) => f.gate).join(", ")}`);
      if (best.stage.kind === "diagram") await saveSharedDiagramRecord(diagramKeyFor(beat), { spec: best }).catch(() => undefined);
      return { spec: inStep(best), costUsd, attempts: attempt };
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
      lastError = (error as Error).message;
    }
  }
  if (softest) {
    console.log(`[canvas] ${beat.id}: kept the best attempt (${softest.faults} note(s)) — ${lastError ?? ""}`);
    return { spec: inStep(softest.spec), costUsd, attempts: 3 };
  }
  if (closestEquation) {
    // No attempt passed: the closest one ships without any incomplete or false line of working.
    if (closestEquation.stage.kind === "equation") {
      const dropped = dropBrokenRows(closestEquation.stage, checkNumbers);
      if (dropped) console.log(`[canvas] ${beat.id}: ${dropped} broken or false line(s) of working taken off the kept board`);
    }
    return { spec: inStep(closestEquation), costUsd, attempts: 3 };
  }
  if (plainCode) {
    console.warn(`[canvas] board ${beat.id}: kept as code without its structure`);
    return { spec: inStep(plainCode), costUsd, attempts: 3 };
  }
  if (examined) {
    console.log(`[canvas] ${beat.id}: shipped the examined board — its rewrite did not pass in time (${examined.faults.join(" | ").slice(0, 300)})`);
    return { spec: inStep(examined.spec), costUsd, attempts: 3 };
  }
  // Serious faults on every attempt: the writer builds the same board plainly (a clear flow or a worked
  // equation) before anything is left to the code-built backup.
  if (!plain && clock.left() > 35_000) return rebuildPlain(lastError ?? "its visual did not fit the narration");
  console.log(`[canvas] ${beat.id}: every attempt failed — last reason: ${lastError ?? "time budget"}`);
  // The backup is built from what Aria says. It always ships: a lecture never stops for one board.
  const backupBeat = visualRejections ? plainBeat(beat, true, labLecture(topic, plan)) : beat;
  return { spec: fallbackSpec(backupBeat), costUsd, attempts: -1 };
}

const SHORTEN_PROMPT = `You rewrite pieces of text from a school lesson board so each fits its room. Return JSON only: {"items": [{"i": number, "text": string}]}. Each new text keeps the meaning, the key term, every number and unit, and the notation (CO₂, x², ≤), reads as a complete phrase, and has AT MOST the number of characters given — count them. Drop filler words first, then secondary detail; never end with "…".`;

/** One small call: every over-long text rewritten within its exact room. */
export async function shortenToFit(openai: OpenAI, items: Array<{ text: string; max: number }>): Promise<{ replacements: Map<string, string>; costUsd: number }> {
  // Every piece in one call (24 left the rest of a crowded board cut).
  const unique = [...new Map(items.map((item) => [item.text, item])).values()].slice(0, 48);
  const list = unique.map((item, i) => ({ i, max: item.max, text: item.text }));
  const { json, costUsd } = await bounded(jsonCall(openai, SPEC_MODEL, SHORTEN_PROMPT, JSON.stringify({ items: list }), Math.min(4000, 400 + list.length * 60)), 20_000, "shorten");
  const replacements = new Map<string, string>();
  for (const out of ((json as { items?: Array<{ i?: number; text?: string }> }).items ?? [])) {
    const item = typeof out.i === "number" ? list[out.i] : undefined;
    const text = typeof out.text === "string" ? out.text.replace(/\s+/g, " ").trim().replace(/…$/, "") : "";
    if (!item || !text) continue;
    // Still too long: ended at a natural break, never cut mid-phrase with "…".
    replacements.set(item.text, text.length <= item.max ? text : trimToFit(text, item.max));
  }
  return { replacements, costUsd };
}

/** Every string in the model's board JSON equal to an over-long text is replaced by its rewrite. */
function replaceStrings(value: unknown, replacements: Map<string, string>): void {
  if (!value || typeof value !== "object") return;
  const entries = Array.isArray(value) ? value.map((v, i) => [i, v] as const) : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    if (typeof child === "string") {
      const norm = child.replace(/\s+/g, " ").trim();
      if (replacements.has(norm)) (value as Record<string | number, unknown>)[key] = replacements.get(norm);
      // A diagram's list param ("for": "a; b; c") holds the over-long item inside a longer string.
      else for (const [from, to] of replacements) if (from.length >= 8 && norm.includes(from)) (value as Record<string | number, unknown>)[key] = norm.split(from).join(to);
    } else replaceStrings(child, replacements);
  }
}

/** The longest phrase the notes column writes (two lines of the column). */
export const SPOKEN_NOTE_MAX = 34;
/**
 * The board's notes are what Aria says, sentence by sentence (lib/canvas/plan.ts boardNotes): each
 * appears on exactly its sentence, so the student reads what they hear. A phrase over the column's
 * room is rewritten to fit, never cut.
 */
async function spokenNotes(openai: OpenAI, beat: CanvasPlanBeat, clock: Clock): Promise<{ notes: CanvasBoardSpec["notes"]; costUsd: number }> {
  const planned = beat.boardNotes ?? [];
  if (!planned.length) return { notes: [], costUsd: 0 };
  let costUsd = 0;
  const long = planned.filter((n) => n.text.length > SPOKEN_NOTE_MAX).map((n) => ({ text: n.text, max: SPOKEN_NOTE_MAX }));
  let fitted = new Map<string, string>();
  if (long.length && clock.left() > 20_000) {
    const out = await shortenToFit(openai, long).catch(() => null);
    if (out) { fitted = out.replacements; costUsd += out.costUsd; }
  }
  const notes = planned.map((n, i) => {
    const text = n.text.length <= SPOKEN_NOTE_MAX ? n.text : fittedNote(n.text, fitted.get(n.text), SPOKEN_NOTE_MAX);
    return { id: `say-${i + 1}`, text, s: n.s };
  });
  return { notes, costUsd };
}

type Finding = { gate: string; message: string };


/** Figures that are only their data: with no params they draw a built-in example from another lesson. */
const DEMO_DATA = new Set(["numberLine", "dotPlot", "barChart", "pieChart", "histogram", "boxPlot", "scatterPlot", "cumulativeFrequency", "venn", "probabilityTree", "sankey", "sequences", "functionGraph", "coordinateGrid", "argand", "timeline", "causeConsequence", "conceptTable", "evaluationScale", "sourceCard"]);

/** Faults a board may never ship with: wrong numbers, unbalanced reactions, another lesson's content. */
const FATAL_GATES = new Set(["numbers", "atom-balance", "figure-content"]);
/** Review findings that mean the board would mislead a student. */
const FATAL_REVIEW = new Set(["factually-wrong", "contradicts-narration", "invented-data", "wrong-visual", "off-topic"]);

/**
 * The parts a figure must show — the task's own minimum and what the syllabus contract names — are
 * labelled by code when the writer left them off ("required part solution-set is not visibly labelled"
 * failed every attempt of several boards, audit 2026-10-17).
 */
function addRequiredParts(spec: CanvasBoardSpec, beat: CanvasPlanBeat): void {
  if (spec.stage.kind === "diagram") {
    const drawing = spec.stage.drawing;
    if (!drawing) return;
    const sentences = canvasSentences(beat.script);
    for (const id of beat.requiredVisual?.mustShow ?? []) {
      if (spec.stage.parts.some((p) => p.id === id || p.name.toLowerCase() === id.toLowerCase())) continue;
      const part = drawing.parts.find((p) => p.id === id || p.name.toLowerCase().includes(id.toLowerCase()));
      if (!part) continue;
      const said = sentences.findIndex((x) => x.toLowerCase().includes(part.name.toLowerCase().replace(/\s*\(.*\)$/, "")));
      spec.stage.parts.push({ id: part.id, name: part.name, s: Math.max(0, said) });
    }
    return;
  }
  if (spec.stage.kind !== "figure") return;
  const stage = spec.stage;
  const available = stage.asset?.parts ?? (stage.component === "drawn" ? [] : figureComponent(stage.component)?.build(stage.params ?? {}).parts ?? []);
  const want = new Set([...(classifyInstructionalTask(beat).figure === stage.component ? classifyInstructionalTask(beat).requiredParts ?? [] : []), ...(beat.requiredVisual?.mustShow ?? [])]);
  const sentences = canvasSentences(beat.script);
  for (const id of want) {
    if (stage.parts.some((p) => p.id === id)) continue;
    const part = available.find((p) => p.id === id);
    if (!part) continue;
    const said = sentences.findIndex((x) => x.toLowerCase().includes(part.name.toLowerCase().replace(/\s*\(.*\)$/, "")));
    stage.parts.push({ id: part.id, name: part.name, s: Math.max(0, said) });
  }
}

export { fallbackSpec, pictureRequestProblem };

/* ── pictures ─────────────────────────────────────────────────────────────────────────────── */

export function sharedIllustrationName(subject: string, parts: string[]): string {
  const signature = JSON.stringify({ model: illustrationImageModel(), style: ILLUSTRATION_STYLE_VERSION, subject: subject.trim().toLowerCase(), parts: parts.map((part) => part.trim().toLowerCase()).sort() });
  return `asset-${createHash("sha256").update(signature).digest("hex").slice(0, 32)}`;
}

function fallbackReason(error: unknown): "budget" | "generation" | "validation" | "storage" {
  const message = error instanceof Error ? error.message : String(error);
  if (/no time|timed out|budget/i.test(message)) return "budget";
  if (/blob|container|storage|store|upload/i.test(message)) return "storage";
  if (/locat|verify|part|text in image|valid/i.test(message)) return "validation";
  return "generation";
}

/**
 * The same board rewritten without a picture by the board writer (a real flow or worked equation,
 * reviewed like any board) — used when no picture passed its check and there is time for one call.
 */
export function plainRebuild(openai: OpenAI, topic: string, plan: CanvasPlanBeat[], beat: CanvasPlanBeat, clock: Clock, extra: string[] = []): () => Promise<{ spec: CanvasBoardSpec; costUsd: number } | null> {
  return async () => {
    if (clock.left() < 35_000) return null;
    // A maths picture that could not be made: the board is drawn as the sketch it was before (lib/canvas/mathsPicture.ts).
    if (beat.mathsPicture) {
      const made = await generateSpec(openai, topic, plan, { ...beat, stage: "sketch", mathsPicture: undefined, requiredVisual: beat.requiredVisual ? { ...beat.requiredVisual, stages: ["sketch"] } : undefined }, clock, extra, true);
      return { spec: made.spec, costUsd: made.costUsd };
    }
    // With time left, the vector diagram first (it falls back to the plain board itself).
    const vector = VECTOR_DIAGRAMS && clock.left() > 110_000 && beat.stage === "illustration";
    const made = vector
      ? await generateSpec(openai, topic, plan, { ...beat, stage: "figure", figure: "drawn", figureAsset: undefined, objects: [], requiredVisual: beat.requiredVisual ? { ...beat.requiredVisual, stages: ["figure"] } : undefined }, clock, [...extra, "A textbook picture of this board could not be made accurately; it is drawn as a diagram instead."], true)
      : await generateSpec(openai, topic, plan, plainBeat(beat), clock, [...extra, "A textbook picture of this board could not be made accurately. Teach the same idea without a picture, with every box and arrow carrying what the narration says."], true);
    return { spec: made.spec, costUsd: made.costUsd };
  };
}

/**
 * A typed-prompt or PDF maths board's figure drawn by gpt-image-2, white on black (lib/canvas/mathsPicture.ts).
 * A figure that cannot be made leaves the board the sketch it was before; with no time for that, written.
 */
async function mathsIllustration(openai: OpenAI, userId: string, lectureId: string, beat: CanvasPlanBeat, spec: CanvasBoardSpec, log: string[], clock: Clock, rebuild: (() => Promise<{ spec: CanvasBoardSpec; costUsd: number } | null>) | undefined, ctx: MathsBoardContext): Promise<{ spec: CanvasBoardSpec; costUsd: number }> {
  const started = Date.now();
  // A student's own document's figure is theirs; a typed topic's figure is shared with the next student.
  const share = !beat.source;
  const own = `${lectureId}-${beat.id}`;
  let costUsd = 0;
  try {
    if (clock.left() < 90_000) throw new Error("no time left for a picture");
    const pic = await bounded(mathsPicture(openai, withMathsBoardWriting(ctx, spec), {
      share,
      asDrawn: beat.mathsPictureAsDrawn,
      budget: { left: () => clock.left() - 50_000 },
      save: async (_key, display) => { if (!share) await saveCanvasImage(userId, own, display); },
    }), Math.min(240_000, clock.left() - 45_000), "maths picture");
    log.push(`${beat.id}: maths picture ${Math.round((Date.now() - started) / 1000)}s — ${pic.log}`);
    return { spec: withMathsPicture(spec, pic, `/api/canvas-lecture/image/${share ? pic.key : own}`), costUsd: pic.costUsd };
  } catch (error) {
    costUsd += error instanceof MathsPictureError ? error.costUsd : 0;
    log.push(`${beat.id}: maths picture failed — ${(error as Error).message}; drawn as a sketch`);
    const rebuilt = rebuild ? await rebuild().catch(() => null) : null;
    if (rebuilt) return { spec: rebuilt.spec, costUsd: costUsd + rebuilt.costUsd };
    return { spec: fallbackSpec(beat), costUsd };
  }
}

/** A typed-prompt or PDF maths working board with its gpt-image-2 picture beside the lines (white on black). */
async function mathsPictureBesideWorking(openai: OpenAI, userId: string, lectureId: string, beat: CanvasPlanBeat, spec: CanvasBoardSpec, log: string[], clock: Clock, ctx: MathsBoardContext): Promise<{ spec: CanvasBoardSpec; costUsd: number }> {
  if (spec.stage.kind !== "equation") return { spec, costUsd: 0 };
  const share = !beat.source;
  const own = `${lectureId}-${beat.id}`;
  const started = Date.now();
  try {
    if (clock.left() < 70_000) throw new Error("no time left for a picture");
    const pic = await bounded(mathsPicture(openai, withMathsBoardWriting(ctx, spec), {
      share,
      asDrawn: beat.mathsPictureAsDrawn,
      budget: { left: () => clock.left() - 20_000 },
      save: async (_key, display) => { if (!share) await saveCanvasImage(userId, own, display); },
    }), Math.min(240_000, clock.left() - 15_000), "maths picture");
    const placed = withMathsPicture({ ...spec, stage: { kind: "illustration", subject: pic.fields.diagramType, parts: [], labels: [] } }, pic, `/api/canvas-lecture/image/${share ? pic.key : own}`);
    log.push(`${beat.id}: maths picture beside the working ${Math.round((Date.now() - started) / 1000)}s — ${pic.log}`);
    return { spec: { ...spec, stage: { ...spec.stage, picture: placed.stage as IllustrationStage }, cues: placed.cues }, costUsd: pic.costUsd };
  } catch (error) {
    log.push(`${beat.id}: maths picture beside the working failed — ${(error as Error).message}; the working stands alone`);
    return { spec, costUsd: error instanceof MathsPictureError ? error.costUsd : 0 };
  }
}

/** A course picture's own state, for the board's vision check (lib/canvas/progressive.ts). */
export type CoursePictureState = { redrawn: boolean; remember?: () => Promise<void> };

export async function illustrate(openai: OpenAI, userId: string, lectureId: string, beat: CanvasPlanBeat, spec: CanvasBoardSpec, log: string[], clock: Clock, rebuild?: () => Promise<{ spec: CanvasBoardSpec; costUsd: number } | null>, course?: CourseBoardContext | null, options: { redraw?: string[]; maths?: MathsBoardContext | null } = {}): Promise<{ spec: CanvasBoardSpec; costUsd: number; picture?: CoursePictureState }> {
  if (spec.stage.kind === "equation" && beat.pictureBeside && course) return pictureBesideWorking(openai, userId, lectureId, beat, spec, log, clock, course, options);
  if (spec.stage.kind === "equation" && beat.mathsPicture && !beat.course && options.maths) return mathsPictureBesideWorking(openai, userId, lectureId, beat, spec, log, clock, options.maths);
  if (spec.stage.kind !== "illustration") return { spec, costUsd: 0 };
  if (beat.mathsPicture && !beat.course && options.maths) return mathsIllustration(openai, userId, lectureId, beat, spec, log, clock, rebuild, options.maths);
  const stage = spec.stage;
  const started = Date.now();
  let costUsd = 0;
  // EVERY COURSE VISUAL IS gpt-image-2 (owner, 2026-10-24: "relying on gpt-image-2 for everything"): no
  // guard against charts or formulas (it draws them as exact diagrams), no earlier picture path, and no
  // code-drawn rebuild — a picture that cannot be made leaves the board written (lib/canvas/fallback.ts).
  if (course && beat.course && courseCodeDiagramsOff()) {
    const share = !beat.source;
    const own = `${lectureId}-${beat.id}`;
    try {
      if (clock.left() < 70_000) throw new Error("no time left for a picture");
      const pic = await bounded(coursePicture(openai, withBoardWriting(course, spec), {
        share,
        redraw: options.redraw,
        budget: { left: () => clock.left() - 20_000 },
        save: async (_key, display) => { if (!share) await saveCanvasImage(userId, own, display); },
      }), Math.min(280_000, clock.left() - 15_000), "course picture");
      log.push(`${beat.id}: course picture ${Math.round((Date.now() - started) / 1000)}s — ${pic.log}`);
      return { spec: withCoursePicture(spec, pic, `/api/canvas-lecture/image/${share ? pic.key : own}`), costUsd: pic.costUsd, picture: { redrawn: pic.redrawn, remember: pic.remember } };
    } catch (error) {
      log.push(`${beat.id}: course picture failed — ${(error as Error).message}; the board is written`);
      const written = fallbackSpec(beat);
      return { spec: { ...written, ...(spec.interaction ? { interaction: spec.interaction } : {}), visualFallback: { from: "illustration", reason: fallbackReason(error), message: "This board is written because its picture could not be drawn." } }, costUsd: error instanceof CoursePictureError ? error.costUsd : 0 };
    }
  }
  try {
    // Too little time for a picture AND its rebuild: the rebuild comes straight away.
    if (clock.left() < (rebuild ? 95_000 : 50_000)) throw new Error("no time left for a picture");
    const subject = pictureSubject(stage.subject);
    const names = stage.parts.map((p) => p.name);
    // The last guard before money is spent: a picture has no words, so a chart, table or argument
    // asked of it can only fail its check.
    const unfit = pictureRequestProblem(subject, names);
    // "Not on the physical-word list" no longer refuses a picture (free-form diagrams retired; the
    // textbook check decides what can be drawn). Maps, charts, counts, formulas and arguments still are.
    // When the planner said the board shows a THING, only words-and-symbols boards are refused: a
    // number in its text ("one parent, 2 offspring") is not a reason to give up the picture.
    const plannerThing = beat.visualType === "thing" && !/^(a chart|words, symbols|working or units|a map)/.test(unfit ?? "");
    if (unfit && unfit !== "not a physical thing" && !plannerThing) throw new Error(`not a picture — ${unfit} (not sent to the image model)`);
    // A diagram is shared across students unless it comes from a student's own document.
    const share = !beat.source;
    const own = `${lectureId}-${beat.id}`;
    // A COURSE LESSON'S PICTURE is drawn with its labels by gpt-image-2 from the board's own context —
    // what Aria says, the syllabus block it teaches (owner, 2026-10-24) — and comes back with where each
    // label points and what the picture shows (lib/canvas/coursePicture.ts). Not passed: the earlier path.
    if (course && coursePicturesOn() && clock.left() > (rebuild ? 150_000 : 115_000)) {
      try {
        const pic = await bounded(coursePicture(openai, course, {
          share,
          budget: { left: () => clock.left() - (rebuild ? 55_000 : 20_000) },
          save: async (_key, display) => { if (!share) await saveCanvasImage(userId, own, display); },
        }), Math.min(280_000, clock.left() - (rebuild ? 55_000 : 20_000)), "course picture");
        costUsd += pic.costUsd;
        log.push(`${beat.id}: course picture ${Math.round((Date.now() - started) / 1000)}s — ${pic.log}`);
        return { spec: withCoursePicture(spec, pic, `/api/canvas-lecture/image/${share ? pic.key : own}`), costUsd };
      } catch (error) {
        costUsd += error instanceof CoursePictureError ? error.costUsd : 0;
        log.push(`${beat.id}: course picture not used — ${(error as Error).message}`);
      }
    }
    // Generated, checked by a textbook editor, located, and remembered (lib/canvas/textbookDiagram.ts).
    const diagram = await bounded(textbookDiagram(openai, subject, names, {
      share,
      budget: { left: () => clock.left() },
      save: async (_key, display) => { if (!share) await saveCanvasImage(userId, own, display); },
    // With a rebuild to fall back on, the picture leaves it time: a picture that took two and a half
    // minutes to fail left none, and four Krebs boards became static text cards (bench, 2026-10-18).
    }), Math.min(170_000, clock.left() - (rebuild ? 55_000 : 20_000)), "textbook diagram");
    costUsd += diagram.costUsd;
    // Matched by the part's name in a normal form ("The left ventricle" = "left ventricles"): an exact
    // match dropped located parts over a capital or a plural.
    const byName = new Map(diagram.parts.map((p) => [partNameKey(p.name), p]));
    const parts = stage.parts
      .map((p) => {
        const at = byName.get(partNameKey(p.name));
        return at ? { ...p, x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 } : null;
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    const kept = new Set(parts.map((p) => p.id));
    log.push(`${beat.id}: textbook diagram ${Math.round((Date.now() - started) / 1000)}s — ${diagram.log}`);
    const pictured: CanvasBoardSpec = {
      ...spec,
      stage: { ...stage, parts, labels: stage.labels.filter((l) => kept.has(l)), src: `/api/canvas-lecture/image/${share ? diagram.key : own}`, paper: diagram.paper },
      cues: spec.cues.filter((c) => !c.target || !stage.parts.some((p) => p.id === c.target) || kept.has(c.target)),
    };
    // Labels are chosen again from the parts actually found on the picture (lib/canvas/labelPolicy.ts):
    // a part the picture lost can no longer hold a narration-named label another found part could take.
    return { spec: withMandatoryLabels(pictured, beat), costUsd };
  } catch (error) {
    log.push(`${beat.id}: picture failed — ${(error as Error).message}`);
    // No diagram passed: never a wrong picture. The board writer rebuilds it as a plain board when
    // there is time; otherwise it is built from what Aria says (lib/canvas/fallback.ts), keeping its card.
    const reason = fallbackReason(error);
    const rebuilt = rebuild ? await rebuild().catch(() => null) : null;
    if (rebuilt) {
      costUsd += rebuilt.costUsd;
      log.push(`${beat.id}: rebuilt as a ${rebuilt.spec.stage.kind} board`);
      return { spec: { ...rebuilt.spec, visualFallback: { from: "illustration", reason, message: "A plain board is shown because no textbook diagram passed its accuracy check." } }, costUsd };
    }
    const plain = fallbackSpec(plainBeat(beat));
    return {
      spec: {
        ...plain,
        ...(spec.interaction ? { interaction: spec.interaction } : {}),
        visualFallback: { from: "illustration", reason, message: "A plain board is shown because no textbook diagram passed its accuracy check." },
      },
      costUsd,
    };
  }
}

/**
 * A COURSE WORKING BOARD'S PICTURE BESIDE ITS LINES (owner, 2026-10-24: no code figures; "working beside
 * its figure", 2026-10-22): gpt-image-2 draws what the working is about — the triangle, the graph, the
 * apparatus — with the board's own values, and the lines are written beside it (lib/canvas/layout.ts).
 * A picture that cannot be made leaves the working on its own: never a code figure.
 */
async function pictureBesideWorking(openai: OpenAI, userId: string, lectureId: string, beat: CanvasPlanBeat, spec: CanvasBoardSpec, log: string[], clock: Clock, course: CourseBoardContext, options: { redraw?: string[] }): Promise<{ spec: CanvasBoardSpec; costUsd: number; picture?: CoursePictureState }> {
  if (spec.stage.kind !== "equation") return { spec, costUsd: 0 };
  const share = !beat.source;
  const own = `${lectureId}-${beat.id}`;
  const started = Date.now();
  try {
    if (clock.left() < 70_000) throw new Error("no time left for a picture");
    const pic = await bounded(coursePicture(openai, withBoardWriting(course, spec), {
      share,
      redraw: options.redraw,
      budget: { left: () => clock.left() - 20_000 },
      save: async (_key, display) => { if (!share) await saveCanvasImage(userId, own, display); },
    }), Math.min(280_000, clock.left() - 15_000), "course picture");
    // The picture is placed as a picture board would be, then set beside the working.
    const placed = withCoursePicture({ ...spec, stage: { kind: "illustration", subject: pic.fields.diagramType, parts: [], labels: [] } }, pic, `/api/canvas-lecture/image/${share ? pic.key : own}`);
    log.push(`${beat.id}: picture beside the working ${Math.round((Date.now() - started) / 1000)}s — ${pic.log}`);
    return { spec: { ...spec, stage: { ...spec.stage, picture: placed.stage as IllustrationStage }, cues: placed.cues }, costUsd: pic.costUsd, picture: { redrawn: pic.redrawn, remember: pic.remember } };
  } catch (error) {
    log.push(`${beat.id}: picture beside the working failed — ${(error as Error).message}; the working stands alone`);
    return { spec, costUsd: error instanceof CoursePictureError ? error.costUsd : 0 };
  }
}

/** The ordinary lesson Beat that carries one canvas board. */
export function canvasBeat(id: string, beat: CanvasPlanBeat, index: number, spec: CanvasBoardSpec): Beat {
  const op: CanvasBoardOp = { kind: "canvasBoard", spec, at: 0, endAt: 1 };
  return {
    id,
    title: beat.title,
    conceptId: slug(beat.title, beat.id),
    teacherMove: beat.brief,
    stepLabel: `${index + 1} · ${beat.title}`,
    slideKind: "intro",
    points: spec.notes.map((n) => n.text),
    keyClaims: spec.notes.map((n) => n.text),
    script: beat.script,
    draw: { caption: spec.heading, ops: [op as never] },
  };
}

/* ── the lecture ──────────────────────────────────────────────────────────────────────────── */

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

export async function generateCanvasLecture(topic: string, userId: string, onProgress: (p: CanvasProgress) => void = () => {}): Promise<CanvasLecture> {
  const started = Date.now();
  const clock: Clock = { left: () => BUDGET_MS - (Date.now() - started) };
  const openai = client();
  const lectureId = `${slug(topic, "lesson").slice(0, 24)}-${randomBytes(3).toString("hex")}`;
  const log: string[] = [];
  let costUsd = 0;

  onProgress({ step: "plan", detail: "Planning the lesson" });
  let plan: { title: string; beats: CanvasPlanBeat[] } | null = null;
  for (let attempt = 1; attempt <= 2 && !plan && clock.left() > 110_000; attempt++) {
    const { json, costUsd: c } = await bounded(jsonCall(openai, PLAN_MODEL, CANVAS_PLAN_PROMPT, `Topic: ${topic}`, 9000), Math.min(85_000, clock.left() - 100_000), "plan");
    costUsd += c;
    const valid = validatePlan(json);
    // No student knowledge here, so no refresher was offered (lib/canvas/plan.ts).
    plan = valid && withRefresherOnlyIfOffered(valid, false);
  }
  if (!plan) throw new Error("the lesson plan could not be made");
  const visualPolicy = applyLessonVisualPolicy(plan.beats, { mode: "prompt", findAsset: findLibraryFigure, topic });
  plan = { ...plan, beats: visualPolicy.beats };
  if (visualPolicy.audit.changes.length) log.push(`visual policy: ${visualPolicy.audit.changes.join(" | ")}`);
  log.push(`plan: ${plan.beats.map((b) => `${b.id}=${b.stage}${b.inside ? `(inside ${b.inside.beat}.${b.inside.object})` : ""}${b.interaction ? `[${b.interaction}]` : ""}`).join(" ")} in ${Math.round((Date.now() - started) / 1000)}s`);
  onProgress({ step: "boards", detail: `${plan.beats.length} boards: ${plan.beats.map((b) => b.title).join(" · ")}` });

  const boardsStarted = Date.now();
  const planBeats = plan.beats;
  let done = 0;
  const specs = await inBatches(planBeats, 8, async (beat) => {
    const t0 = Date.now();
    const made = await generateSpec(openai, topic, planBeats, beat, clock);
    costUsd += made.costUsd;
    log.push(`${beat.id}: ${made.spec.stage.kind} spec in ${Math.round((Date.now() - t0) / 1000)}s, ${made.attempts < 0 ? "FALLBACK board" : `${made.attempts} attempt(s)`}`);
    onProgress({ step: "board", detail: `Board ${++done}/${planBeats.length}: ${beat.title}` });
    const pictured = await illustrate(openai, userId, lectureId, beat, made.spec, log, clock, plainRebuild(openai, topic, planBeats, beat, clock));
    costUsd += pictured.costUsd;
    if (made.spec.stage.kind === "illustration") onProgress({ step: "picture", detail: `Illustrated: ${beat.title}` });
    return pictured.spec;
  });
  log.push(`boards: ${Math.round((Date.now() - boardsStarted) / 1000)}s`);

  unifyConceptColours(specs);

  // Cross-board references are checked against what the boards actually drew.
  const beatIdOf = (planId: string) => `cv-${lectureId}-${planId}`;
  const targetsOf = specs.map((spec) => new Set(Object.keys(layoutPanel(spec).targets)));
  const markTypes = specs.map((spec) => new Map(layoutPanel(spec).marks.map((m) => [m.id, m.type])));
  const beats: Beat[] = planBeats.map((beat, i) => {
    let spec = specs[i];
    const parentIndex = beat.inside ? planBeats.findIndex((b) => b.id === beat.inside!.beat) : -1;
    const insideOk = parentIndex >= 0 && parentIndex < i && targetsOf[parentIndex].has(beat.inside!.object);
    spec = { ...spec };
    if (insideOk) spec.inside = { beat: beatIdOf(beat.inside!.beat), id: beat.inside!.object };
    else delete spec.inside;
    // Only a whole element of the same kind flies across (a node to a node) — never a token into a dot.
    const carry = (spec.carry ?? beat.carry).filter((id) => i > 0 && Boolean(markTypes[i - 1].get(id)) && markTypes[i - 1].get(id) === markTypes[i].get(id));
    if (carry.length) spec.carry = carry;
    else delete spec.carry;
    if (beat.overview) spec.overview = true;
    // A visit may only go back, to a board the student has already seen. The model sometimes names
    // boards by title rather than id; those visits are dropped here, BEFORE deciding whether the
    // recap needs the fallback tour — deciding first left recaps with no tour at all.
    const earlierIds = new Set(planBeats.slice(0, i).map((b) => b.id));
    spec.cues = spec.cues.filter((c) => c.action !== "visit" || earlierIds.has(c.beat ?? ""));
    if (beat.overview && !spec.cues.some((c) => c.action === "visit")) spec.cues = [...spec.cues, ...recapTour(beat, planBeats.slice(0, i))];
    spec.cues = spec.cues.map((c) => (c.action === "visit" ? { ...c, beat: beatIdOf(c.beat!) } : c));
    return canvasBeat(beatIdOf(beat.id), beat, i, spec);
  });

  const lecture: CanvasLecture = { id: lectureId, topic, title: plan.title, beats, costUsd: Math.round(costUsd * 1000) / 1000, createdAt: new Date().toISOString(), ms: Date.now() - started, log };
  await saveCanvasLecture(userId, lecture);
  onProgress({ step: "done", detail: `Ready in ${Math.round(lecture.ms / 1000)}s · $${lecture.costUsd.toFixed(2)}` });
  return lecture;
}
