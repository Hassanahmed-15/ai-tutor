import { complexNumbersIn } from "../figures/components/argand";
import "server-only";

import { createHash, randomBytes } from "node:crypto";
import OpenAI from "openai";
import type { Beat } from "../lessonContent";
import { costFor } from "../modelPricing";
import { drawIllustration, ILLUSTRATION_STYLE_VERSION, illustrationImageModel, locateParts, pictureSubject, prepareStoredIllustration, verifyParts } from "../illustratedBoard";
import { layoutPanel } from "./layout";
import { recapTour, unifyConceptColours } from "./lessonPasses";
import { CANVAS_PLAN_PROMPT, CANVAS_SPEC_PROMPT } from "./prompts";
import { canvasSentences, validatePlan, withRefresherOnlyIfOffered } from "./plan";
import { type CanvasBoardOp, type CanvasBoardSpec, type CanvasPlanBeat } from "./types";
import { slug, validateCanvasSpec } from "./validate";
import { fallbackSpec } from "./fallback";
import { figureComponent } from "../figures/registry";
import { DRAWN_GUIDE, drawnFigure } from "../figures/drawn";
import { findLibraryFigure, libraryAssetTitle, libraryStageAsset } from "../figures/library";
import type { FigureComponent } from "../figures/types";
import { loadSharedCanvasImage, saveCanvasImage, saveCanvasLecture, saveSharedCanvasImage, type CanvasLecture } from "./store";
import { boardStructureProblem, isDataStructureTopic, withoutStructure } from "./structure";
import { equationProblem } from "./equationCheck";
import { createOpenAI } from "../openaiClient";
import { visualContractIssues } from "../curriculum/visualContract";
import { applyLessonVisualPolicy } from "./visualPolicy";
import { auditBoardForRelease } from "./releaseAudit";

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
  return `FIGURE BOARD: the stage is a real textbook diagram ("${title}") shown exactly; its parts are already located, so a label always lands on its part. Return "stage": {"kind": "figure", "component": "library", "parts": [{"id", "name", "s", "say"}]} (no params, no asset — the server adds the diagram). Label 3 to 6 of these parts — the ones the narration talks about (ids exactly as given): ${asset.parts.map((p) => `${p.id} ("${p.name}")`).join(", ")}. Give each the "name" the narration uses (at most 34 characters; keep the textbook term) and reveal it ("s") on the sentence that first names it, with a short "say". Never label a part this list does not have. Cues point at part ids.`;
}

/** The board writer's instructions for a code-drawn figure, written from the component itself. */
function figureBrief(c: FigureComponent): string {
  return `FIGURE BOARD: the stage is the "${c.name}" figure, drawn exactly by code — ${c.title}. Return "stage": {"kind": "figure", "component": "${c.name}", "params": {…}, "parts": [{"id", "name", "s", "say"}]}. params (all optional): ${c.params}. Label 3 to 6 of these parts (ids exactly as given): ${c.parts.map((p) => `${p.id} ("${p.name}")`).join(", ")}. Give each the "name" the narration uses (e.g. "Burette (hydrochloric acid)", at most 34 characters) and reveal it ("s") on the sentence that first names it. Choose params that match what this board teaches (an end-point board shows the end-point colour). Cues point at part ids.`;
}

/** Faults a board may still ship with when nothing better arrives in time; never meaning, numbers or answer timing. */
const SOFT_GATES = new Set(["layout", "quiz", "student-view"]);

export async function generateSpec(openai: OpenAI, topic: string, plan: CanvasPlanBeat[], beat: CanvasPlanBeat, clock: Clock, extra: string[] = []): Promise<{ spec: CanvasBoardSpec; costUsd: number; attempts: number }> {
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
        if (issues.length) {
          lastError = `the drawing needs fixing: ${issues.join("; ")}`;
          continue;
        }
      }
      const spec = validateCanvasSpec(raw, sentences.length);
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
      // One authoritative audit covers semantics, student-view legibility, calculations, molecular
      // geometry, answer timing, graphs, quiz writing and deterministic layout.
      const releaseFindings = auditBoardForRelease(spec, beat);
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
    console.log(`[canvas] ${beat.id}: kept the best attempt (${softest.faults} soft issue(s)) — ${lastError ?? ""}`);
    return { spec: softest.spec, costUsd, attempts: 3 };
  }
  if (closestEquation) return { spec: closestEquation, costUsd, attempts: 3 };
  if (plainCode) {
    console.warn(`[canvas] board ${beat.id}: kept as code without its structure`);
    return { spec: plainCode, costUsd, attempts: 3 };
  }
  console.log(`[canvas] ${beat.id}: every attempt failed — last reason: ${lastError ?? "time budget"}`);
  const fallback = fallbackSpec(beat);
  const fallbackIssues = auditBoardForRelease(fallback, beat);
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

export async function illustrate(openai: OpenAI, userId: string, lectureId: string, beat: CanvasPlanBeat, spec: CanvasBoardSpec, log: string[], clock: Clock): Promise<{ spec: CanvasBoardSpec; costUsd: number }> {
  if (spec.stage.kind !== "illustration") return { spec, costUsd: 0 };
  const stage = spec.stage;
  const started = Date.now();
  let costUsd = 0;
  try {
    if (clock.left() < 50_000) throw new Error("no time left for a picture");
    const subject = pictureSubject(stage.subject);
    const names = stage.parts.map((p) => p.name);
    // Only curriculum visuals are globally reusable. Their key contains no student text or id.
    const sharedName = beat.requiredVisual && !beat.source ? sharedIllustrationName(subject, names) : null;
    const cached = sharedName ? await loadSharedCanvasImage(sharedName) : null;
    // An image model sometimes letters its own picture despite being told not to; our labels would
    // then sit beside its misspelt ones. That picture is drawn once more.
    let picture = cached
      ? await bounded(prepareStoredIllustration(cached), Math.min(12_000, clock.left() - 30_000), "cached picture")
      : await bounded(drawIllustration(openai, subject), Math.min(80_000, clock.left() - 30_000), "picture");
    let redrawn = false;
    costUsd += picture.costUsd;
    let located = await bounded(locateParts(openai, picture.jpeg, subject, names), Math.min(40_000, Math.max(8_000, clock.left() - 12_000)), "locate");
    costUsd += located.costUsd;
    if (located.textInImage && clock.left() > 110_000) {
      log.push(`${beat.id}: picture had text in it — drawn again`);
      picture = await bounded(drawIllustration(openai, `${subject} Absolutely no letters, words or numbers anywhere in the image.`), 80_000, "picture");
      redrawn = true;
      costUsd += picture.costUsd;
      located = await bounded(locateParts(openai, picture.jpeg, subject, names), 40_000, "locate");
      costUsd += located.costUsd;
    }
    const name = sharedName ?? `${lectureId}-${beat.id}`;
    if (sharedName) {
      if (!cached || redrawn) await saveSharedCanvasImage(sharedName, picture.display);
    } else {
      await saveCanvasImage(userId, name, picture.display);
    }
    // The second look at the points is optional work too.
    const unchecked = { parts: located.parts, corrected: [] as string[], costUsd: 0 };
    const checked = clock.left() > 45_000
      ? await bounded(verifyParts(openai, picture.jpeg, subject, located.parts), Math.min(35_000, clock.left() - 12_000), "verify").catch(() => unchecked)
      : unchecked;
    costUsd += checked.costUsd;
    const byName = new Map(checked.parts.map((p) => [p.name.toLowerCase(), p]));
    const parts = stage.parts
      .map((p) => {
        const at = byName.get(p.name.toLowerCase());
        return at ? { ...p, x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 } : null;
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    const kept = new Set(parts.map((p) => p.id));
    log.push(`${beat.id}: picture ${Math.round((Date.now() - started) / 1000)}s${cached ? " (shared cache hit)" : ""}, located ${parts.length}/${stage.parts.length}${checked.corrected.length ? `, corrected ${checked.corrected.join(", ")}` : ""}${located.textInImage ? ", TEXT IN IMAGE" : ""}`);
    return {
      spec: {
        ...spec,
        stage: { ...stage, parts, labels: stage.labels.filter((l) => kept.has(l)), src: `/api/canvas-lecture/image/${name}`, paper: picture.paper },
        cues: spec.cues.filter((c) => !c.target || !stage.parts.some((p) => p.id === c.target) || kept.has(c.target)),
      },
      costUsd,
    };
  } catch (error) {
    log.push(`${beat.id}: picture failed — ${(error as Error).message}`);
    // No picture: keep the board, drawn as a scene of its parts, so the lesson never loses a board.
    // Two-cell boxes sit in columns A, C and E of the 6-wide grid so no two overlap.
    const reason = fallbackReason(error);
    return {
      spec: {
        ...spec,
        stage: { kind: "scene", items: stage.parts.slice(0, 6).map((p, i) => ({ id: p.id, kind: "box" as const, label: p.name, cell: `${"ACE"[i % 3]}${i < 3 ? 1 : 3}`, span: "2x2", s: p.s })), arrows: [] },
        visualFallback: { from: "illustration", reason, message: "A simplified labelled diagram is shown because the textbook picture was unavailable." },
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
    const pictured = await illustrate(openai, userId, lectureId, beat, made.spec, log, clock);
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
