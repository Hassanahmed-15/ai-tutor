import { figureComponent, figureFor } from "../figures/registry";
import { classifyInstructionalTask } from "./instructionalTask";
import type { CanvasPlanBeat, CanvasStage } from "./types";

/** How freely the lesson may add visuals beyond a supplied source. */
export type VisualPolicyMode = "course" | "prompt" | "reference" | "strict";

export type VisualPolicyAudit = {
  mode: VisualPolicyMode;
  illustrations: number;
  meaningfulVisuals: number;
  targetMeaningfulVisuals: number;
  changes: string[];
};

export const PHYSICAL = /\b(cell|organelle|organ|anatom|heart|lung|kidney|leaf|root|stem|flower|plant part|animal|skeleton|muscle|apparatus|equipment|machine|engine|circuit|battery|magnet|rock layer|volcano|landform|weather system|planet|telescope|microscope|cross[- ]section|cutaway|internal structure|burette|pipette|conical flask|beaker|test[- ]tube|bunsen|thermometer|measuring cylinder|condenser|filter funnel|evaporating basin|cuvette|colorimeter|gas syringe|delivery tube|electrode)\b/i;
const STRUCTURAL = /\b(label|identify|part|structure|inside|cross[- ]section|cutaway|anatomy|location)\b/i;
const NON_PICTURE = /\b(equation|formula|calculate|solve|graph|plot|gradient|slope|code|program|algorithm|loop|variable|molecule|molecular|vsepr|bond angle|lone pair|atom count|balanced equation)\b/i;

function boardText(beat: CanvasPlanBeat): string {
  return `${beat.title} ${beat.brief} ${beat.script} ${beat.objects.join(" ")}`;
}

/** Higher means a textbook picture carries information that a symbolic renderer cannot. */
export function pictureNeedScore(beat: CanvasPlanBeat): number {
  const text = boardText(beat);
  let score = 0;
  if (PHYSICAL.test(text)) score += 3;
  if (STRUCTURAL.test(text)) score += 2;
  if (beat.requiredVisual?.stages.includes("illustration")) score += 4;
  if (NON_PICTURE.test(text)) score -= 5;
  return score;
}

/** Prefer exact native renderers whenever the lesson is symbolic, sequential or quantitative. */
export function nativeStageFor(beat: CanvasPlanBeat): CanvasStage {
  const stage = classifyInstructionalTask(beat).stage;
  // "Native" means a renderer that does not call the image model. A physical-structure task still
  // falls back to a labelled scene when pictures are disabled or forbidden in strict mode.
  return stage === "illustration" ? "scene" : stage;
}

/**
 * An electrolysis board about the cell itself. Its words ("cell", "apparatus") scored it as a
 * picture and its half-equations as an equation board, so the native wired-cell renderer (power
 * supply, electrodes, polarity, ions moving — lib/canvas/layout.ts electrolyticCellParts) never ran
 * in a real lesson (O Level audit 2026-10-15); a generated picture cannot be trusted to wire it right.
 */
export function isElectrolyticCellBeat(beat: CanvasPlanBeat): boolean {
  const text = boardText(beat);
  return /\belectroly(?:sis|tic|te)\b/i.test(text) && /\banode\b/i.test(text) && /\bcathode\b/i.test(text) && /\b(cell|apparatus|set[- ]?up|circuit|power supply|battery|electrodes?|diagram)\b/i.test(text);
}

/** A board about the forces on one object: drawn as a free-body diagram (lib/canvas/layout.ts freeBodyParts). */
export function isFreeBodyBeat(beat: CanvasPlanBeat): boolean {
  const text = boardText(beat);
  return /\bfree[- ]body\b|\bforces? (?:acting )?on (?:the|a|an)\b|\b(?:balanced|unbalanced) forces\b|\bresultant force\b/i.test(text) && /\b(weight|gravity)\b/i.test(text);
}

/** The ids the wired-cell renderer recognises (lib/canvas/prompts.ts asks for them too). */
export const ELECTROLYTIC_CELL_OBJECTS = ["power-supply", "electrolyte", "anode", "cathode"];

function firstRequiredStage(beat: CanvasPlanBeat): CanvasStage | null {
  const stages = beat.requiredVisual?.stages ?? [];
  return stages.find((stage): stage is CanvasStage => ["illustration", "flow", "equation", "graph", "compare", "scene", "code", "molecule", "atom-map", "figure"].includes(stage)) ?? null;
}

function meaningful(stage: CanvasStage, apparatus = false): boolean {
  // A generic scene is useful as a last resort, but it is not counted as textbook-grade visual
  // evidence. Every other stage has a renderer with a specific explanatory grammar — and so does a
  // scene the wired-cell renderer draws.
  return stage !== "scene" || apparatus;
}

/**
 * Makes the lesson visual by outcome, not by decoration.
 *
 * A normal lesson may introduce at most two generated base pictures. More are retained only when
 * separate syllabus contracts explicitly require labelled physical structures. The remaining
 * visual load is carried by deterministic renderers: flows, graphs, equations, molecules and code.
 */
export function applyLessonVisualPolicy(
  input: CanvasPlanBeat[],
  options: {
    mode: VisualPolicyMode;
    aiPictures?: boolean;
    /**
     * The textbook diagram library (lib/figures/library.ts findLibraryFigure), passed in so this
     * policy stays pure: a board's words (and what the syllabus says it must show) → a diagram, or null.
     */
    findAsset?: (text: string, mustShow?: string[]) => NonNullable<CanvasPlanBeat["figureAsset"]> | null;
  },
): { beats: CanvasPlanBeat[]; audit: VisualPolicyAudit } {
  const beats = input.map((beat) => ({ ...beat, requiredVisual: beat.requiredVisual ? { stages: [...beat.requiredVisual.stages], mustShow: [...beat.requiredVisual.mustShow] } : undefined }));
  const changes: string[] = [];
  // AI-generated pictures are off unless CANVAS_AI_PICTURES=on (owner, 2026-10-16: "I don't want any
  // vague diagram created by GPT image"): every picture board is drawn by code instead.
  const aiPictures = options.aiPictures ?? (typeof process !== "undefined" && process.env?.CANVAS_AI_PICTURES === "on");
  const maxIllustrations = !aiPictures || options.mode === "strict" ? 0 : beats.length <= 1 ? 1 : 2;

  // A deterministic curriculum contract wins over a model's decorative stage choice.
  for (const beat of beats) {
    const required = firstRequiredStage(beat);
    if (required && beat.requiredVisual && !beat.requiredVisual.stages.includes(beat.stage)) {
      changes.push(`${beat.id}: ${beat.stage} → ${required} (curriculum visual contract)`);
      beat.stage = required;
    }
  }

  // A picture has no words, so a table, grid or framework drawn as one cannot be read. Abstract
  // content goes to a native comparison board instead (audit 2026-10-15: a "perspective grid").
  for (const beat of beats) {
    if (beat.stage !== "illustration" || PHYSICAL.test(boardText(beat))) continue;
    if (!/\b(grid|table|chart|matrix|columns?|rows?|framework|perspectives?|viewpoints?|criteria|strengths?|limitations?|evaluat\w*|argument|theor(?:y|ies)|concept)\b/i.test(boardText(beat))) continue;
    changes.push(`${beat.id}: illustration → compare (abstract content cannot be a picture)`);
    beat.stage = "compare";
    if (beat.requiredVisual) beat.requiredVisual.stages = ["compare"];
  }

  // A board whose subject a code-drawn component draws exactly (lib/figures) becomes a figure board:
  // the titration audited at 3/10 as gear icons on a flow chart is drawn as the apparatus itself.
  for (const beat of beats) {
    if (beat.refresher) continue;
    const decision = classifyInstructionalTask(beat);
    const semantic = decision.figure ? figureComponent(decision.figure) : undefined;
    // A semantic decision may replace a generic graph/flow because the figure is a stricter form of
    // that representation. Other library figures replace only picture-like stages.
    if (!semantic && !["illustration", "scene", "flow"].includes(beat.stage)) continue;
    const component = semantic ?? figureFor(boardText(beat));
    if (!component) continue;
    changes.push(`${beat.id}: ${beat.stage} → figure (${component.name}, drawn by code)`);
    beat.stage = "figure";
    beat.figure = component.name;
    beat.objects = component.parts.slice(0, 6).map((p) => p.id);
    if (beat.requiredVisual) {
      beat.requiredVisual.stages = ["figure"];
      if (decision.requiredParts?.length) beat.requiredVisual.mustShow = [...new Set([...beat.requiredVisual.mustShow, ...decision.requiredParts])];
    }
  }
  // A picture board — or a board that would otherwise be a plain scene — whose subject the library
  // has a real textbook diagram for shows that diagram, its parts labelled exactly (lib/figures/library.ts).
  // Strict source mode teaches only from the student's own pages, so it never adds one.
  if (options.findAsset && options.mode !== "strict") {
    for (const beat of beats) {
      if (beat.refresher || beat.stage === "figure") continue;
      if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.some((st) => st === "illustration" || st === "scene" || st === "figure")) continue;
      // The wired cell and the free-body diagram have renderers of their own.
      if (isElectrolyticCellBeat(beat) || isFreeBodyBeat(beat)) continue;
      const plainScene = beat.stage === "scene" && nativeStageFor(beat) === "scene";
      if (beat.stage !== "illustration" && !plainScene) continue;
      const asset = options.findAsset(boardText(beat), beat.requiredVisual?.mustShow ?? []);
      if (!asset) continue;
      changes.push(`${beat.id}: ${beat.stage} → figure (library diagram ${asset.id})`);
      beat.stage = "figure";
      beat.figure = "library";
      beat.figureAsset = asset;
      // The parts the board says first, then the rest — what the board writer may label.
      const text = boardText(beat).toLowerCase();
      const said = asset.parts.filter((p) => text.includes(p.name.toLowerCase().replace(/\s*\(.*\)$/, "")));
      beat.objects = [...new Set([...said, ...asset.parts].map((p) => p.id))].slice(0, 6);
      if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
    }
  }

  if (!aiPictures) {
    for (const beat of beats) {
      if (beat.stage !== "illustration") continue;
      const routed = nativeStageFor(beat);
      changes.push(`${beat.id}: illustration → ${routed} (AI pictures are off)`);
      beat.stage = routed;
      if (beat.requiredVisual) beat.requiredVisual.stages = [routed];
    }
  }

  // Strict source mode may clean and annotate supplied figures, but it must not generate a new
  // factual picture. Until a source figure is attached to the canvas, use a grounded native board.
  if (options.mode === "strict") {
    for (const beat of beats) {
      if (beat.stage !== "illustration") continue;
      const replacement = nativeStageFor(beat);
      beat.stage = replacement === "scene" ? "scene" : replacement;
      if (beat.requiredVisual?.stages.includes("illustration")) beat.requiredVisual.stages = [beat.stage];
      changes.push(`${beat.id}: illustration → ${beat.stage} (strict source mode)`);
    }
  }

  // If a course/reference lesson teaches a physical structure, ensure at least one real textbook
  // illustration. Never replace a board whose curriculum contract requires a different renderer.
  if (maxIllustrations > 0 && !beats.some((beat) => beat.stage === "illustration")) {
    const candidate = beats
      .filter((beat) => !beat.requiredVisual?.stages.length || beat.requiredVisual.stages.includes("illustration") || beat.requiredVisual.stages.includes("scene"))
      .map((beat) => ({ beat, score: pictureNeedScore(beat) }))
      .sort((a, b) => b.score - a.score)[0];
    if (candidate && candidate.score >= 4) {
      changes.push(`${candidate.beat.id}: ${candidate.beat.stage} → illustration (physical structure needs a textbook view)`);
      candidate.beat.stage = "illustration";
      if (candidate.beat.requiredVisual?.stages.includes("scene")) candidate.beat.requiredVisual.stages = ["illustration"];
    }
  }

  // Keep the strongest pictures. A third picture is allowed only when a distinct syllabus
  // contract explicitly requires it; this is the exception for anatomy-heavy lessons.
  const pictures = beats.filter((beat) => beat.stage === "illustration");
  const protectedIds = new Set(pictures.filter((beat) => beat.requiredVisual?.stages.includes("illustration")).map((beat) => beat.id));
  const keep = new Set(
    pictures
      .sort((a, b) => Number(protectedIds.has(b.id)) - Number(protectedIds.has(a.id)) || pictureNeedScore(b) - pictureNeedScore(a))
      .slice(0, Math.max(maxIllustrations, protectedIds.size))
      .map((beat) => beat.id),
  );
  for (const beat of pictures) {
    if (keep.has(beat.id)) continue;
    const replacement = nativeStageFor(beat);
    beat.stage = replacement === "illustration" ? "scene" : replacement;
    changes.push(`${beat.id}: illustration → ${beat.stage} (lesson picture budget)`);
  }

  // The first board about the electrolytic cell is drawn by the wired-cell renderer, unless its
  // curriculum contract asks for a different kind of board.
  const apparatus = new Set<string>();
  const cell = beats.find((beat) => !beat.refresher && isElectrolyticCellBeat(beat) && (!beat.requiredVisual?.stages.length || beat.requiredVisual.stages.some((st) => st === "scene" || st === "illustration")));
  if (cell) {
    if (cell.stage !== "scene") changes.push(`${cell.id}: ${cell.stage} → scene (wired electrolytic cell)`);
    cell.stage = "scene";
    if (cell.requiredVisual) cell.requiredVisual.stages = ["scene"];
    cell.objects = [...new Set([...ELECTROLYTIC_CELL_OBJECTS, ...cell.objects])].slice(0, 6);
    apparatus.add(cell.id);
  }

  // The first board about the forces on an object is a free-body diagram.
  const forces = beats.find((beat) => !beat.refresher && !apparatus.has(beat.id) && isFreeBodyBeat(beat) && (!beat.requiredVisual?.stages.length || beat.requiredVisual.stages.some((st) => st === "scene" || st === "illustration")));
  if (forces) {
    if (forces.stage !== "scene") changes.push(`${forces.id}: ${forces.stage} → scene (free-body diagram)`);
    forces.stage = "scene";
    if (forces.requiredVisual) forces.requiredVisual.stages = ["scene"];
    forces.objects = [...new Set(["body", ...forces.objects])].slice(0, 6);
    apparatus.add(forces.id);
  }

  // Replace generic card-like scenes when the content clearly names a purpose-built renderer.
  for (const beat of beats) {
    if (beat.stage !== "scene" || apparatus.has(beat.id)) continue;
    const routed = nativeStageFor(beat);
    if (routed === "scene") continue;
    if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.includes(routed)) continue;
    beat.stage = routed;
    changes.push(`${beat.id}: scene → ${routed} (purpose-built visual renderer)`);
  }

  const meaningfulVisuals = beats.filter((beat) => meaningful(beat.stage, apparatus.has(beat.id))).length;
  const targetMeaningfulVisuals = Math.min(beats.length, beats.length <= 1 ? 1 : Math.max(2, Math.ceil(beats.length * 0.6)));
  return {
    beats,
    audit: {
      mode: options.mode,
      illustrations: beats.filter((beat) => beat.stage === "illustration").length,
      meaningfulVisuals,
      targetMeaningfulVisuals,
      changes,
    },
  };
}
