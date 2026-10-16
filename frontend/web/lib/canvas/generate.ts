import "server-only";
import { complexNumbersIn } from "../figures/components/argand";

import { createHash, randomBytes } from "node:crypto";
import OpenAI from "openai";
import type { Beat } from "../lessonContent";
import { costFor } from "../modelPricing";
import { ILLUSTRATION_STYLE_VERSION, illustrationImageModel, pictureSubject } from "../illustratedBoard";
import { textbookDiagram } from "./textbookDiagram";
import { withMandatoryLabels } from "./labelPolicy";
import { layoutPanel } from "./layout";
import { dropCrossingArrows } from "./layoutQa";
import { recapTour, unifyConceptColours } from "./lessonPasses";
import { CANVAS_PLAN_PROMPT, CANVAS_SPEC_PROMPT } from "./prompts";
import { canvasSentences, validatePlan, withRefresherOnlyIfOffered } from "./plan";
import { type CanvasBoardOp, type CanvasBoardSpec, type CanvasPlanBeat } from "./types";
import { slug, validateCanvasSpec, validationCuts } from "./validate";
import { fallbackSpec } from "./fallback";
import { figureComponent } from "../figures/registry";
import { foreignFigureWords } from "../figures/foreignText";
import { DRAWN_GUIDE, drawnFigure } from "../figures/drawn";
import { findLibraryFigure, libraryAssetTitle, libraryStageAsset } from "../figures/library";
import type { FigureComponent } from "../figures/types";
import { loadSharedCanvasImage, saveCanvasImage, saveCanvasLecture, saveSharedCanvasImage, type CanvasLecture } from "./store";
import { boardStructureProblem, isDataStructureTopic, withoutStructure } from "./structure";
import { equationProblem } from "./equationCheck";
import { createOpenAI } from "../openaiClient";
import { visualContractIssues } from "../curriculum/visualContract";
import { applyLessonVisualPolicy, PHYSICAL } from "./visualPolicy";
import { auditBoardForRelease, figureDataIssues } from "./releaseAudit";
import { BOARD_REVIEW_PROMPT, boardReviewRequest, parseBoardReview, type BoardReview } from "./boardReview";
import { deferRevealLeaks, teachingCycleIssues } from "./predict";
import { alignToNarration, unshownSentences } from "./narrationSync";


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

function specUserPrompt(topic: string, plan: CanvasPlanBeat[], beat: CanvasPlanBeat, lastError?: string, extra: string[] = []): string {
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
    ...(beat.figure === "electromagnetism" && /\btransformers?\b|\bturns ratio\b|\bstep[- ](up|down)\b/i.test(`${beat.title} ${beat.brief} ${beat.script}`) ? [`This board is a TRANSFORMER: params.device MUST be "transformer" (never solenoid). Set np, ns and vp; code computes Vs = Vp × Ns / Np. Label primary-coil, secondary-coil and core.`] : []),
    ...(beat.figure === "coordinateGrid" && /\btransform/i.test(`${beat.title} ${beat.brief}`) ? [`This board is a GEOMETRIC TRANSFORMATION: give shape vertices and transform (reflection, rotation, translation or enlargement). Code computes A′B′C′.`] : []),
    ...(beat.stage === "figure" && beat.figure === "library" && beat.figureAsset ? [libraryBrief(libraryStageAsset(beat.figureAsset.id) ?? beat.figureAsset)] : []),
    ...(beat.stage === "figure" && beat.figure === "drawn" ? [`FIGURE BOARD — draw the textbook diagram of what this board teaches (${beat.brief || beat.title}). ${DRAWN_GUIDE} Label 3-6 parts the narration names, each revealed ("s") on the sentence that first names it; cues point at part ids.`] : []),
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

/** The board writer's instructions for a code-drawn figure, written from the component itself. */
function figureBrief(c: FigureComponent): string {
  return `FIGURE BOARD: the stage is the "${c.name}" figure, drawn exactly by code — ${c.title}. Return "stage": {"kind": "figure", "component": "${c.name}", "params": {…}, "parts": [{"id", "name", "s", "say"}]}. params (all optional): ${c.params}. Label 3 to 8 of these parts — every one the narration names (ids exactly as given): ${c.parts.map((p) => `${p.id} ("${p.name}")`).join(", ")}. Give each the "name" the narration uses (e.g. "Burette (hydrochloric acid)", at most 34 characters) and reveal it ("s") on the sentence that first names it. Choose params that match what this board teaches (an end-point board shows the end-point colour). Cues point at part ids.`;
}

/** Faults a board may still ship with when nothing better arrives in time; never meaning, numbers or answer timing. */
const SOFT_GATES = new Set(["layout", "quiz", "student-view", "figure-data", "sync"]);

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
function plainBeat(beat: CanvasPlanBeat): CanvasPlanBeat {
  // A calculation is numbers being worked: an operation between numbers, or "calculate"/"work out"
  // with numbers. "This means…" and the notation "n = 23" made a sociology board and a genetics board
  // into equation boards of cut-off words (audit 2026-10-17).
  const worked = (beat.script.match(/\d[\d,.]*\s*[×x*÷/+−-]\s*\(?\d/g) ?? []).length;
  const calculation = worked >= 1 && (worked >= 2 || /\b(calculat\w*|substitut\w*|work(ed)? out|the mean|standard deviation|variance)\b/i.test(beat.script));
  return { ...beat, stage: calculation ? "equation" : "flow", figure: undefined, figureAsset: undefined, objects: [], requiredVisual: undefined, rejectedFigures: rejected(beat) };
}

/**
 * The same board as the diagram the reviewer said it should show: generated as a checked textbook
 * diagram (lib/canvas/textbookDiagram.ts) when pictures are on, else described line art.
 */
/**
 * Words that mean a chart, table or argument — things a picture with no words cannot show. The image
 * model was asked for "primary, secondary and tertiary bars with percentage values and a legend"
 * (employment structure, audit 2026-10-17): the editor rightly refused it twice, $0.04 for nothing.
 */
export const CHART_LIKE = /\b(graphs?|charts?|bars?|axis|axes|legend|percentages?|per ?cent|statistics?|data|tables?|plots?|curves?|timelines?|scales?|judgements?|arguments?|evidence|costs? and benefits?|framework|model of|stages? of development|indicators?|index|survey|values?)\b|%/i;

/** Is this something a generated textbook picture can show? A real physical thing, not a chart. */
export function pictureable(text: string): boolean {
  return PHYSICAL.test(text) && !CHART_LIKE.test(text);
}

function drawnBeat(beat: CanvasPlanBeat, why = ""): CanvasPlanBeat {
  // A picture only for a physical thing the review described; a chart or argument is drawn plain.
  const pictures = process.env.CANVAS_AI_PICTURES !== "off" && pictureable(`${why} ${beat.title}`);
  return { ...beat, stage: pictures ? "illustration" : "figure", figure: pictures ? undefined : "drawn", figureAsset: undefined, objects: [], requiredVisual: undefined, rejectedFigures: rejected(beat) };
}

export async function generateSpec(openai: OpenAI, topic: string, plan: CanvasPlanBeat[], beat: CanvasPlanBeat, clock: Clock, extra: string[] = [], plain = false): Promise<{ spec: CanvasBoardSpec; costUsd: number; attempts: number }> {
  const sentences = canvasSentences(beat.script);
  // A code board in a data-structures lesson draws the structure beside the code (lib/canvas/structure.ts).
  const needsStructure = beat.stage === "structure" || (beat.stage === "code" && isDataStructureTopic(`${topic} ${beat.title} ${beat.brief}`));
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
  // At most two reviews a board: the review must not turn a 2-minute lecture into a 6-minute one.
  const reviews = { used: 0 };
  // Builds the same board again without its visual when the review rejected the visual itself.
  const rebuildPlain = async (why: string) => {
    // First the diagram the reviewer said the board needs, drawn from its description (and reviewed
    // like any board); only if that fails, the board without a diagram.
    // Only a physical thing is redrawn from the review's description: with pictures on, anything else
    // (a chart, a framework) became a picture request the image model could never satisfy.
    const suggested = /\bshould (instead )?(show|depict|identify|be)\b/i.test(why) && beat.figure !== "drawn" && beat.stage !== "illustration" && clock.left() > 70_000
      && (process.env.CANVAS_AI_PICTURES === "off" || pictureable(why));
    if (suggested) {
      console.log(`[canvas] ${beat.id}: the board review rejected its ${beat.figure ?? beat.stage} visual twice — redrawn as the diagram the review describes (${why.slice(0, 200)})`);
      const drawn = await generateSpec(openai, topic, plan, drawnBeat(beat, why), clock, [...extra, `An earlier diagram on this board was rejected: ${why}. Draw the diagram this describes, labelling exactly what the narration teaches.`], true);
      if (drawn.attempts !== -1) return { ...drawn, costUsd: drawn.costUsd + costUsd };
      costUsd += drawn.costUsd;
    }
    console.log(`[canvas] ${beat.id}: the board review rejected its ${beat.stage} visual twice — rebuilt as a plain board (${why.slice(0, 200)})`);
    const rebuilt = await generateSpec(openai, topic, plan, plainBeat(beat), clock, [...extra, `An earlier version of this board was rejected because ${why}. Teach it without that visual.`], true);
    return { ...rebuilt, costUsd: rebuilt.costUsd + costUsd };
  };
  // The code alone, kept when its structure could not be made right: plainer, never wrong.
  let plainCode: CanvasBoardSpec | null = null;
  // An equation board that still misses something after its retries: kept rather than replaced by
  // a placeholder scene (its terms are whole now; only the check's last complaint is left).
  let closestEquation: CanvasBoardSpec | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    // A retry is optional work: with too little time left the board falls back instead.
    // A second attempt still runs with 30 s left (one bounded call): with a 75 s floor most slow
    // boards skipped every retry and shipped the fallback.
    if (attempt > 1 && clock.left() < (attempt === 2 ? 30_000 : 75_000)) break;
    try {
      const { json, costUsd: c } = await bounded(jsonCall(openai, SPEC_MODEL, CANVAS_SPEC_PROMPT, specUserPrompt(topic, plan, beat, lastError, asked), needsStructure ? 9000 : 6000), Math.min(needsStructure ? 60_000 : 45_000, Math.max(10_000, clock.left() - 60_000)), `board ${beat.id}`);
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
      // A described diagram that fails its checks is sent back with what to fix, not a generic error.
      if (beat.figure === "drawn" && raw.stage && typeof raw.stage === "object") {
        const { issues } = drawnFigure((raw.stage as Record<string, unknown>).drawing);
        // A box diagram is a flow board drawn badly: build the flow instead of retrying the drawing.
        if (!plain && issues.some((i) => i.startsWith("BOX DIAGRAM"))) return rebuildPlain("its drawn diagram was only empty boxes and rings");
        if (issues.length) {
          lastError = `the drawing needs fixing: ${issues.join("; ")}`;
          continue;
        }
      }
      const spec = validateCanvasSpec(raw, sentences.length);
      // Text cut to fit is told to the writer, so the next attempt fits rather than being cut again.
      const cut = validationCuts();
      // An arrow that would cut through another box is dropped rather than drawn across it (the
      // first board of an economics lesson shipped with arrows slicing through three boxes, 2026-10-17).
      if (spec && (spec.stage.kind === "scene" || spec.stage.kind === "flow")) {
        const tidy = dropCrossingArrows(spec, layoutPanel(spec));
        if (tidy !== spec) Object.assign(spec, tidy);
      }
      // An Argand board written without its numbers drew the default 3 + 4i while Aria spoke about
      // −3 + 4i (audit 2026-10-17): the numbers come from the board's own narration.
      if (spec?.stage.kind === "figure" && spec.stage.component === "argand") {
        const params = (spec.stage.params ??= {});
        if (!params.points && !params.loci) {
          const found = complexNumbersIn(beat.script);
          if (found) params.points = found;
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
      if (beat.requiredVisual && beat.requiredVisual.stages.length && !beat.requiredVisual.stages.includes(spec.stage.kind)) {
        lastError = `the board must use a visual stage capable of showing ${beat.requiredVisual.mustShow.join(", ")}; expected one of ${beat.requiredVisual.stages.join(", ")}, got ${spec.stage.kind}`;
        continue;
      }
      if (beat.requiredVisual) {
        const visualIssues = visualContractIssues(spec, beat.requiredVisual);
        if (visualIssues.length) {
          lastError = `visual contract failed: ${visualIssues.join("; ")}`;
          continue;
        }
      }
      // No quiz on any board (owner's direction, 2026-10-16: no "Predict it"), even one the board model adds.
      if (spec.interaction?.kind === "quiz") delete spec.interaction;
      if (beat.interaction && spec.interaction?.kind !== beat.interaction) {
        lastError = `the board must carry a "${beat.interaction}" interaction`;
        continue;
      }
      if (spec.interaction?.kind === "try" && spec.interaction.reactions.length < 2) {
        lastError = `the "try" interaction needs 3 to 5 reactions whose "when" conditions use only the slider variables (${spec.interaction.controls.map((c) => c.var).join(", ")})`;
        continue;
      }
      if (spec.stage.kind === "equation") {
        const problem = equationProblem((raw as { stage?: unknown }).stage, spec.stage, beat.script);
        if (problem) {
          closestEquation = spec;
          lastError = problem;
          console.warn(`[canvas] board ${beat.id}: ${problem}`);
          continue;
        }
      }
      const structureProblem = boardStructureProblem(spec, needsStructure);
      if (structureProblem) {
        plainCode = withoutStructure(spec) ?? plainCode;
        lastError = structureProblem;
        console.warn(`[canvas] board ${beat.id}: ${structureProblem}`);
        continue;
      }
      // Everything appears on the sentence that first says it (lib/canvas/narrationSync.ts) — the
      // writer's own timing was wrong for a third of items — then anything that would give the
      // prediction away waits for the reveal (lib/canvas/predict.ts deferRevealLeaks).
      alignToNarration(spec, beat);
      deferRevealLeaks(spec, beat);
      // One authoritative audit covers semantics, student-view legibility, calculations, molecular
      // geometry, answer timing, graphs, quiz writing and deterministic layout.
      let releaseFindings = [
        ...auditBoardForRelease(spec, beat),
        ...figureDataIssues(spec, beat.script).map((message) => ({ gate: "figure-data", message })),
        // A content figure with no data of its own draws its example lesson (Treaty of Versailles on a
        // psychology board, audit 2026-10-17): never shipped, not even as the best attempt.
        ...(spec.stage.kind === "figure" && spec.stage.component !== "drawn" && spec.stage.component !== "library"
          ? (() => {
              const foreign = foreignFigureWords(spec.stage.component, spec.stage.params ?? {}, `${beat.title} ${beat.brief} ${beat.script}`, spec.stage.parts.map((p) => p.name));
              const message = `the figure shows words this board never teaches (${foreign.slice(0, 6).join(", ")}): fill its params with this board's own content from the narration`;
              // Five or more foreign words is an example lesson; three or four may be the figure's own
              // structure words (mitosis stages) the narration skipped — a soft fault, not a rejection.
              return foreign.length >= 5 ? [{ gate: "figure-content", message }] : foreign.length ? [{ gate: "figure-data", message }] : [];
            })()
          : []),
        // What Aria says is on the board: teaching sentences with nothing about them are sent back.
        ...(() => {
          const sentences = canvasSentences(beat.script);
          const bare = unshownSentences(spec, beat).filter((i) => !beat.teachingCycle || i !== beat.teachingCycle.reveal);
          return bare.length >= 2 ? [{ gate: "sync", message: `these sentences put nothing on the board — add the element each one teaches, in its own words, revealed on that sentence: ${bare.slice(0, 4).map((i) => `[${i}] "${sentences[i].slice(0, 90)}"`).join("; ")}` }] : [];
        })(),
        ...(cut.length ? [{ gate: "layout", message: `text was cut to fit — rewrite each piece to fit its room (shorter wording, or split it over more items): ${cut.slice(0, 4).join("; ")}` }] : []),
      ];
      if (!releaseFindings.length) {
        // Passed every rule: the review judges what the student will see.
        const review = await reviewBoard(openai, topic, spec, beat, reviews);
        costUsd += review.costUsd;
        if (!review.ship) {
          releaseFindings = review.problems.map((p) => ({ gate: "review", message: `${p.kind}: ${p.detail}` })) as typeof releaseFindings;
          if (review.problems.some((p) => VISUAL_FAULTS.has(p.kind))) visualRejections++;
          console.log(`[canvas] ${beat.id}: board review sent it back — ${releaseFindings.map((f) => f.message).join(" | ").slice(0, 400)}`);
        }
      }
      if (visualRejections >= 2 && !plain && (beat.stage === "figure" || beat.stage === "graph" || beat.stage === "illustration")) return rebuildPlain(releaseFindings.map((f) => f.message).join("; "));
      if (releaseFindings.length) {
        lastError = releaseFindings.map((finding) => `${finding.gate}: ${finding.message}`).join("; ");
        // A board whose only faults are soft — tidiness, quiz wording, legibility notes — is kept in
        // reserve: when attempts or time run out it beats the plain backup (audit 2026-10-17: a history
        // board with one long label was thrown away for the backup).
        if (releaseFindings.every((f) => SOFT_GATES.has(f.gate)) && (!softest || releaseFindings.length < softest.faults)) softest = { spec, faults: releaseFindings.length };
        continue;
      }
      return { spec, costUsd, attempts: attempt };
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
      lastError = (error as Error).message;
    }
  }
  if (softest) {
    const review = await reviewBoard(openai, topic, softest.spec, beat, reviews);
    costUsd += review.costUsd;
    if (review.ship) {
      console.log(`[canvas] ${beat.id}: kept the best attempt (${softest.faults} soft issue(s)) — ${lastError ?? ""}`);
      return { spec: softest.spec, costUsd, attempts: 3 };
    }
    if (review.problems.some((p) => VISUAL_FAULTS.has(p.kind))) visualRejections++;
  }
  if (closestEquation) return { spec: closestEquation, costUsd, attempts: 3 };
  if (plainCode) {
    console.warn(`[canvas] board ${beat.id}: kept as code without its structure`);
    return { spec: plainCode, costUsd, attempts: 3 };
  }
  if (visualRejections >= 1 && !plain && (beat.stage === "figure" || beat.stage === "graph" || beat.stage === "illustration") && clock.left() > 40_000) return rebuildPlain(lastError ?? "its visual did not fit the narration");
  console.log(`[canvas] ${beat.id}: every attempt failed — last reason: ${lastError ?? "time budget"}`);
  // A visual the review rejected is not drawn again as the backup.
  const backupBeat = visualRejections ? plainBeat(beat) : beat;
  const fallback = fallbackSpec(backupBeat);
  const fallbackIssues = auditBoardForRelease(fallback, backupBeat);
  if (fallbackIssues.length) throw Object.assign(new Error(`no releasable board: ${fallbackIssues.map((finding) => `${finding.gate}: ${finding.message}`).join("; ")}`), { costUsd });
  return { spec: fallback, costUsd, attempts: -1 };
}

export { fallbackSpec };

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
    const made = await generateSpec(openai, topic, plan, plainBeat(beat), clock, [...extra, "A textbook picture of this board could not be made accurately. Teach the same idea without a picture, with every box and arrow carrying what the narration says."], true);
    return { spec: made.spec, costUsd: made.costUsd };
  };
}

export async function illustrate(openai: OpenAI, userId: string, lectureId: string, beat: CanvasPlanBeat, spec: CanvasBoardSpec, log: string[], clock: Clock, rebuild?: () => Promise<{ spec: CanvasBoardSpec; costUsd: number } | null>): Promise<{ spec: CanvasBoardSpec; costUsd: number }> {
  if (spec.stage.kind !== "illustration") return { spec, costUsd: 0 };
  const stage = spec.stage;
  const started = Date.now();
  let costUsd = 0;
  try {
    if (clock.left() < 50_000) throw new Error("no time left for a picture");
    const subject = pictureSubject(stage.subject);
    const names = stage.parts.map((p) => p.name);
    // The last guard before money is spent: a picture has no words, so a chart, table or argument
    // asked of it can only fail its check.
    if (CHART_LIKE.test(`${subject} ${names.join(" ")}`) && !PHYSICAL.test(subject)) throw new Error("a chart or table is not a picture (not sent to the image model)");
    // Generated, checked by a textbook editor, located, and remembered (lib/canvas/textbookDiagram.ts).
    // A diagram is shared across students unless it comes from a student's own document.
    const share = !beat.source;
    const own = `${lectureId}-${beat.id}`;
    const diagram = await bounded(textbookDiagram(openai, subject, names, {
      share,
      budget: { left: () => clock.left() },
      save: async (_key, display) => { if (!share) await saveCanvasImage(userId, own, display); },
    }), Math.min(170_000, clock.left() - 20_000), "textbook diagram");
    costUsd += diagram.costUsd;
    const byName = new Map(diagram.parts.map((p) => [p.name.toLowerCase(), p]));
    const parts = stage.parts
      .map((p) => {
        const at = byName.get(p.name.toLowerCase());
        return at ? { ...p, x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 } : null;
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    const kept = new Set(parts.map((p) => p.id));
    log.push(`${beat.id}: textbook diagram ${Math.round((Date.now() - started) / 1000)}s — ${diagram.log}`);
    return {
      spec: {
        ...spec,
        stage: { ...stage, parts, labels: stage.labels.filter((l) => kept.has(l)), src: `/api/canvas-lecture/image/${share ? diagram.key : own}`, paper: diagram.paper },
        cues: spec.cues.filter((c) => !c.target || !stage.parts.some((p) => p.id === c.target) || kept.has(c.target)),
      },
      costUsd,
    };
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
  const visualPolicy = applyLessonVisualPolicy(plan.beats, { mode: "prompt", findAsset: findLibraryFigure });
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
